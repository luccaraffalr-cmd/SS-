// Escribe los viajes en la planilla de la remisería (Google Sheets), igual que el formulario de Google de los choferes
// (decidido el 9/10/2026: la app reemplaza al formulario y la planilla sigue siendo la principal para la plata).
// La llama la base de datos cuando se carga o corrige un pago (tabla "planilla_envios"), y cada 5 minutos si quedó algo.
// No recibe datos: siempre trabaja con lo que está pendiente en la base (salvo { accion: 'hojas' }, ver abajo).
// Secrets: FIREBASE_CUENTA (cuenta de servicio de Google, la misma de los avisos), PLANILLA_ID (el pedazo largo del link
// de la planilla) y, si hace falta, PLANILLA_HOJA (por defecto "Respuestas de formulario 1").
// La planilla tiene que estar compartida como editor con el client_email de la cuenta de servicio, y la Google Sheets API
// activada en el proyecto de Google ("senda-segura").
// Desde el 3/11/2026 escribe todos los pendientes de una vez (pocas llamadas a Google: así se pueden reescribir cientos de
// filas, por ejemplo al cambiarle el nombre en la planilla a un chofer), las filas nuevas van al final de la hoja, y con
// { accion: 'hojas' } (solo gestión) devuelve los nombres de las hojas de los choferes (su celda A2).
import { createClient } from 'npm:@supabase/supabase-js@2'

const HOJA = Deno.env.get('PLANILLA_HOJA') || 'Respuestas de formulario 1'
const ENCABEZADO_NUMERO = 'N.º viaje app' // columna que agrega la app para encontrar la fila al corregir
const ZONA = 'America/Argentina/Buenos_Aires'

// Columnas del formulario: A Marca temporal, B Chofer, C Fecha, D Cliente, E Origen, F Destino, G Forma Pago,
// H Cliente Cuenta Corriente, I Importe, J Demora, K Peaje, L Gas/Nafta. Después, el n.º de viaje de la app.
// En la planilla "Efectivo" = cobró el chofer (efectivo o transferencia) y "Cuenta Corriente" = cobra gestión.
const FORMA_EN_PLANILLA: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia_chofer: 'Efectivo',
  cuenta_corriente: 'Cuenta Corriente',
  transferencia_duenio: 'Cuenta Corriente',
}
// Provisorio (9/10/2026): falta definir con el dueño qué va en "Cliente Cuenta Corriente" cuando el pasajero le
// transfiere a él. Con un nombre que no es una columna de la hoja "Cuenta Corriente", no le suma deuda a ningún cliente.
const CLIENTE_TRANSFERENCIA_DUENIO = 'Transferencia al dueño'

type Envio = { viaje_id: number; pedido_en: string; intentos: number; planilla: string | null }
type Cuenta = { client_email: string; private_key: string }

// Para que la pueda llamar la página (lista de hojas en la ficha del chofer). Sin esto, el navegador la bloqueaba
// (visto en la auditoría del 17/11/2026) y el pedido previo (OPTIONS) disparaba una vuelta de escritura.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function respuesta(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const planillaId = Deno.env.get('PLANILLA_ID')
  const secreto = Deno.env.get('FIREBASE_CUENTA')
  // Sin configurar: los viajes quedan pendientes y se pasan cuando se configure.
  if (!planillaId || !secreto) return respuesta({ ok: false, motivo: 'Falta configurar la planilla (PLANILLA_ID)' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const cuerpo = await req.json().catch(() => ({}))
  if (cuerpo?.accion === 'hojas') return hojasDeChoferes(req, admin, planillaId, JSON.parse(secreto) as Cuenta)

  let planilla: Planilla | null = null
  let escritos = 0, fallidos = 0

  // deno-lint-ignore no-explicit-any
  const fallo = async (e: Envio, err: any) => {
    fallidos++
    const mensaje = (err as Error).message
    console.error('Viaje', e.viaje_id, mensaje)
    await admin.from('planilla_envios').update({ tomado_en: null, intentos: e.intentos + 1, error: mensaje.slice(0, 500) })
      .eq('viaje_id', e.viaje_id)
  }

  // Varias vueltas: si un viaje se corrige mientras se escribe, se vuelve a tomar en la vuelta siguiente.
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    const { data: envios, error } = await admin.rpc('tomar_envios_planilla', { p_limite: 100 })
    if (error) return respuesta({ error: error.message }, 500)
    if (!envios?.length) break

    // Ya se habían escrito en otra planilla (la de prueba): no se pasan a esta.
    const lista: Envio[] = []
    for (const e of envios as Envio[]) {
      if (e.planilla && e.planilla !== planillaId) {
        await admin.from('planilla_envios').update({ pendiente: false, tomado_en: null,
          error: 'Este viaje se había anotado en otra planilla (la de prueba). No se pasa a la de ahora.' })
          .eq('viaje_id', e.viaje_id)
      } else lista.push(e)
    }
    if (!lista.length) continue

    let filas: Map<number, (string | number)[]>
    try {
      filas = await armarFilas(admin, lista.map((e) => e.viaje_id))
    } catch (err) {
      for (const e of lista) await fallo(e, err)
      continue
    }
    // Los que ya no están finalizados: no hay nada que escribir.
    const aEscribir = lista.filter((e) => filas.has(e.viaje_id))
    for (const e of lista.filter((e) => !filas.has(e.viaje_id))) {
      await admin.from('planilla_envios').update({ pendiente: false, tomado_en: null }).eq('viaje_id', e.viaje_id)
    }
    if (!aEscribir.length) continue

    let resultados: { numero: number; corregida: boolean }[]
    try {
      planilla ??= await Planilla.abrir(planillaId, JSON.parse(secreto) as Cuenta)
      resultados = await planilla.guardarVarios(aEscribir.map((e) => ({ viajeId: e.viaje_id, fila: filas.get(e.viaje_id)! })))
    } catch (err) {
      for (const e of aEscribir) await fallo(e, err)
      continue
    }

    const ahora = new Date().toISOString()
    const cerrar = async (e: Envio, numero: number) => {
      const { data: cerrado } = await admin.from('planilla_envios')
        .update({ pendiente: false, tomado_en: null, enviado_en: ahora, fila: numero, planilla: planillaId, error: null })
        .eq('viaje_id', e.viaje_id).eq('pedido_en', e.pedido_en).select('viaje_id')
      if (!cerrado?.length) { // lo corrigieron mientras se escribía: queda pendiente para la vuelta siguiente
        await admin.from('planilla_envios').update({ tomado_en: null, fila: numero, planilla: planillaId })
          .eq('viaje_id', e.viaje_id)
      }
    }
    for (let desde = 0; desde < aEscribir.length; desde += 20) { // de a 20 a la vez
      await Promise.all(aEscribir.slice(desde, desde + 20).map((e, k) => cerrar(e, resultados[desde + k].numero)))
    }
    await admin.from('registro').insert(aEscribir.map((e, i) => ({ viaje_id: e.viaje_id,
      accion: `📄 ${resultados[i].corregida ? 'Corregido' : 'Anotado'} en la planilla (fila ${resultados[i].numero})` })))
    escritos += aEscribir.length
  }
  return respuesta({ ok: true, escritos, fallidos })
})

// Los nombres de las hojas de los choferes (la celda A2 de cada hoja que en A1 dice "Nombre del Chofer"), para elegir el
// "Nombre en la planilla" de cada chofer en su ficha. Solo para gestión.
// deno-lint-ignore no-explicit-any
async function hojasDeChoferes(req: Request, admin: any, planillaId: string, cuenta: Cuenta) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: usuario } = await admin.auth.getUser(token)
  const { data: perfil } = usuario?.user
    ? await admin.from('perfiles').select('rol').eq('id', usuario.user.id).maybeSingle()
    : { data: null }
  if (!['admin', 'operador'].includes(perfil?.rol)) return respuesta({ error: 'Solo para gestión' }, 403)
  try {
    const planilla = await Planilla.abrirSoloLectura(planillaId, cuenta)
    return respuesta({ nombres: await planilla.nombresDeChoferes() })
  } catch (err) {
    return respuesta({ error: (err as Error).message }, 500)
  }
}

// Las filas de los viajes, tal cual las escribía el formulario (los que no están finalizados no aparecen).
// deno-lint-ignore no-explicit-any
async function armarFilas(admin: any, viajeIds: number[]) {
  const { data: viajes, error } = await admin.from('viajes')
    .select('id, estado, tipo, cliente_nombre, origen, destino, hora_presentacion, hora_asignacion, iniciado_en,'
      + ' pago_cargado_en, importe, forma_pago, cuenta_otro, demora, peaje, nafta, chofer_id,'
      + ' chofer:perfiles!viajes_chofer_id_fkey(nombre), cuenta:cuentas_corrientes!viajes_cuenta_id_fkey(nombre)')
    .in('id', viajeIds)
  if (error) throw new Error('No se pudieron leer los viajes: ' + error.message)
  const finalizados = viajes.filter((v: { estado: string }) => v.estado === 'finalizado')
  const choferIds = [...new Set(finalizados.map((v: { chofer_id: string }) => v.chofer_id))]
  const { data: choferes } = choferIds.length
    ? await admin.from('choferes').select('id, nombre_planilla').in('id', choferIds)
    : { data: [] }
  const nombres = new Map((choferes ?? []).map((c: { id: string; nombre_planilla: string | null }) => [c.id, c.nombre_planilla]))
  // deno-lint-ignore no-explicit-any
  return new Map(finalizados.map((v: any) => [v.id, armarFila(v, nombres.get(v.chofer_id) as string | null)]))
}

// deno-lint-ignore no-explicit-any
function armarFila(v: any, nombrePlanilla: string | null) {
  const chofer = nombrePlanilla?.trim() || v.chofer?.nombre || ''

  // Fecha del viaje: la de presentación si es programado; si no, cuando salió a hacerlo.
  const cuando = v.tipo === 'programado' && v.hora_presentacion ? v.hora_presentacion : (v.iniciado_en ?? v.hora_asignacion)

  // Cuenta corriente "Otro" (nombre escrito a mano): en la planilla va a "Otro" y el nombre, en Cliente.
  const esOtro = v.forma_pago === 'cuenta_corriente' && !v.cuenta && v.cuenta_otro
  const cliente = esOtro && v.cliente_nombre && v.cliente_nombre !== v.cuenta_otro
    ? `${v.cuenta_otro} (${v.cliente_nombre})` : esOtro ? v.cuenta_otro : (v.cliente_nombre ?? '')
  const clienteCuenta = v.forma_pago === 'cuenta_corriente' ? (v.cuenta?.nombre ?? 'Otro')
    : v.forma_pago === 'transferencia_duenio' ? CLIENTE_TRANSFERENCIA_DUENIO : ''

  const numeroOVacio = (n: number | null) => (n ? Number(n) : '')
  return [
    fechaHora(v.pago_cargado_en),
    texto(chofer),
    fecha(cuando),
    texto(cliente),
    texto(v.origen),
    texto(v.destino),
    FORMA_EN_PLANILLA[v.forma_pago] ?? '',
    texto(clienteCuenta),
    Number(v.importe),
    numeroOVacio(v.demora),
    numeroOVacio(v.peaje),
    numeroOVacio(v.nafta),
  ]
}

// Texto tal cual, salvo que empiece como una fórmula (=, +, -, @): ahí se escribe como texto.
const texto = (s: string | null) => {
  const t = (s ?? '').trim()
  return /^[=+\-@]/.test(t) ? "'" + t : t
}
// "2026-10-09" y "2026-10-09 14:23:05" en hora argentina (la planilla los toma como fecha).
const fecha = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const fechaHora = (iso: string) => fecha(iso) + ' ' +
  new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .format(new Date(iso))

// 0 → A, 12 → M, 26 → AA
function letra(columna: number): string {
  return (columna >= 26 ? letra(Math.floor(columna / 26) - 1) : '') + String.fromCharCode(65 + (columna % 26))
}
const rango = (a1: string) => `'${HOJA.replace(/'/g, "''")}'!${a1}`

// La hoja de respuestas de la planilla, por la API de Google Sheets.
class Planilla {
  private columnaNumero = 0                  // dónde va el n.º de viaje de la app
  private filas = new Map<number, number>()  // n.º de viaje → fila
  private ultima = 1                         // última fila con datos (columna A, la marca temporal)

  private constructor(private id: string, private permiso: string) {}

  // Solo para leer (los nombres de las hojas de los choferes).
  static async abrirSoloLectura(id: string, cuenta: Cuenta) {
    return new Planilla(id, await permisoDeGoogle(cuenta))
  }

  static async abrir(id: string, cuenta: Cuenta) {
    const p = await Planilla.abrirSoloLectura(id, cuenta)
    // Encabezados: si todavía no está la columna del n.º de viaje, se agrega después de la última (la M).
    const encabezados = (await p.leer(rango('1:1')))[0] ?? []
    let columna = encabezados.findIndex((t: unknown) => String(t).trim() === ENCABEZADO_NUMERO)
    if (columna < 0) {
      columna = Math.max(12, encabezados.length)
      await p.asegurarColumnas(columna + 1) // la hoja del formulario viene con las columnas justas (A a L)
      await p.escribir(rango(`${letra(columna)}1`), [[ENCABEZADO_NUMERO]])
    }
    p.columnaNumero = columna
    const numeros = await p.leer(rango(`${letra(columna)}:${letra(columna)}`))
    numeros.forEach((fila: unknown[], i: number) => {
      const n = Number(fila[0])
      if (i > 0 && Number.isInteger(n) && n > 0) p.filas.set(n, i + 1)
    })
    p.ultima = Math.max(1, (await p.leer(rango('A:A'))).length)
    return p
  }

  // Escribe las filas de los viajes, con dos pedidos a Google en total: corrige las que ya estaban (busca el n.º de viaje)
  // y agrega las otras juntas al final de la hoja. Devuelve la fila de cada uno, en el mismo orden.
  async guardarVarios(viajes: { viajeId: number; fila: (string | number)[] }[]) {
    const fin = letra(this.columnaNumero)
    const completas = viajes.map(({ viajeId, fila }) => {
      const completa = [...fila]
      while (completa.length < this.columnaNumero) completa.push('')
      completa[this.columnaNumero] = viajeId
      return completa
    })
    const resultados: { numero: number; corregida: boolean }[] = new Array(viajes.length)

    // Las que ya estaban: se deja la marca temporal original (columna A).
    const correcciones = viajes.map((v, i) => ({ i, numero: this.filas.get(v.viajeId) })).filter((c) => c.numero)
    if (correcciones.length) {
      await this.pedir(':batchUpdate', { method: 'POST', body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: correcciones.map(({ i, numero }) => ({ range: rango(`B${numero}:${fin}${numero}`), values: [completas[i].slice(1)] })),
      }) })
      for (const { i, numero } of correcciones) resultados[i] = { numero: numero!, corregida: true }
    }

    // Las nuevas, después de la última fila con datos (si se le da toda la columna, Google a veces las mete más arriba).
    const nuevas = viajes.map((_, i) => i).filter((i) => !resultados[i])
    if (nuevas.length) {
      const r = await this.pedir(
        `${encodeURIComponent(rango(`A${this.ultima}:${fin}${this.ultima}`))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { method: 'POST', body: JSON.stringify({ values: nuevas.map((i) => completas[i]) }) })
      const desde = Number(/!\D+(\d+)/.exec(r.updates?.updatedRange ?? '')?.[1])
      nuevas.forEach((i, k) => {
        const numero = desde ? desde + k : 0
        if (numero) this.filas.set(viajes[i].viajeId, numero)
        resultados[i] = { numero, corregida: false }
      })
      if (desde) this.ultima = desde + nuevas.length - 1
    }
    return resultados
  }

  // Las hojas de los choferes: en A1 dicen "Nombre del Chofer" y en A2, el nombre que se busca en la columna B (Chofer).
  async nombresDeChoferes() {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.id}?fields=sheets.properties.title`,
      { headers: { Authorization: 'Bearer ' + this.permiso } })
    const datos = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(explicarError(r.status, datos?.error?.message ?? ''))
    // deno-lint-ignore no-explicit-any
    const titulos: string[] = (datos.sheets ?? []).map((h: any) => h.properties.title).filter((t: string) => t !== HOJA)
    if (!titulos.length) return []
    const rangos = titulos.map((t) => 'ranges=' + encodeURIComponent(`'${t.replace(/'/g, "''")}'!A1:A2`)).join('&')
    const valores = await this.pedir(`:batchGet?${rangos}&valueRenderOption=FORMATTED_VALUE`)
    const nombres = new Set<string>()
    for (const v of valores.valueRanges ?? []) {
      const [a1, a2] = (v.values ?? []).map((f: unknown[]) => String(f?.[0] ?? '').trim())
      if (/^nombre del chofer/i.test(a1 ?? '') && a2) nombres.add(a2)
    }
    return [...nombres].sort((a, b) => a.localeCompare(b, 'es'))
  }

  // Si la hoja tiene menos columnas que las que hacen falta, le agrega las que faltan al final.
  async asegurarColumnas(cantidad: number) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.id}?fields=sheets.properties(sheetId,title,gridProperties.columnCount)`,
      { headers: { Authorization: 'Bearer ' + this.permiso } })
    const datos = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(explicarError(r.status, datos?.error?.message ?? ''))
    // deno-lint-ignore no-explicit-any
    const hoja = datos.sheets?.find((h: any) => h.properties.title === HOJA)?.properties
    if (!hoja) throw new Error(`La planilla no tiene la hoja "${HOJA}".`)
    const faltan = cantidad - (hoja.gridProperties?.columnCount ?? 0)
    if (faltan <= 0) return
    const r2 = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.id}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.permiso, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ appendDimension: { sheetId: hoja.sheetId, dimension: 'COLUMNS', length: faltan } }] }),
    })
    if (!r2.ok) {
      const error = await r2.json().catch(() => ({}))
      throw new Error(explicarError(r2.status, error?.error?.message ?? ''))
    }
  }

  private async leer(a1: string) {
    const r = await this.pedir(`${encodeURIComponent(a1)}?valueRenderOption=UNFORMATTED_VALUE`)
    return r.values ?? []
  }

  private escribir(a1: string, valores: unknown[][]) {
    return this.pedir(`${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', body: JSON.stringify({ values: valores }) })
  }

  // ruta: un rango ("Hoja!A1:B2…") o una acción de varios rangos (":batchUpdate", ":batchGet?…").
  private async pedir(ruta: string, opciones: RequestInit = {}) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.id}/values${ruta.startsWith(':') ? '' : '/'}${ruta}`, {
      ...opciones,
      headers: { Authorization: 'Bearer ' + this.permiso, 'Content-Type': 'application/json' },
    })
    const datos = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(explicarError(r.status, datos?.error?.message ?? ''))
    return datos
  }
}

// El error de Google, en palabras (lo ve gestión en el viaje).
function explicarError(estado: number, mensaje: string) {
  if (estado === 403 && /has not been used|is disabled/i.test(mensaje)) {
    return 'Falta activar la Google Sheets API en el proyecto de Google de la app.'
  }
  if (estado === 403) return 'La planilla no está compartida con la app (como editor).'
  if (estado === 404) return 'No se encuentra la planilla (revisar el link configurado).'
  if (estado === 400 && /parse range/i.test(mensaje)) return `La planilla no tiene la hoja "${HOJA}".`
  return `Google respondió ${estado}: ${mensaje}`
}

// Permiso de Google para escribir en planillas (se firma con la clave de la cuenta de servicio).
// Igual que en "notificar", con otro permiso (scope).
function base64url(datos: Uint8Array | string) {
  const bytes = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos
  let binario = ''
  for (const b of bytes) binario += String.fromCharCode(b)
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function permisoDeGoogle(cuenta: Cuenta) {
  const ahora = Math.floor(Date.now() / 1000)
  const sinFirmar = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + base64url(JSON.stringify({
    iss: cuenta.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600,
  }))
  const pem = cuenta.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const clave = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(sinFirmar)))
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: sinFirmar + '.' + base64url(firma),
    }),
  })
  const datos = await r.json()
  if (!datos.access_token) throw new Error('Google no dio permiso: ' + JSON.stringify(datos))
  return datos.access_token as string
}
