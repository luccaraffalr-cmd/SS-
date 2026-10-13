// Escribe los viajes en la planilla de la remisería (Google Sheets), igual que el formulario de Google de los choferes
// (decidido el 9/10/2026: la app reemplaza al formulario y la planilla sigue siendo la principal para la plata).
// La llama la base de datos cuando se carga o corrige un pago (tabla "planilla_envios"), y cada 5 minutos si quedó algo.
// No recibe datos: siempre trabaja con lo que está pendiente en la base.
// Secrets: FIREBASE_CUENTA (cuenta de servicio de Google, la misma de los avisos), PLANILLA_ID (el pedazo largo del link
// de la planilla) y, si hace falta, PLANILLA_HOJA (por defecto "Respuestas de formulario 1").
// La planilla tiene que estar compartida como editor con el client_email de la cuenta de servicio, y la Google Sheets API
// activada en el proyecto de Google ("senda-segura").
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

function respuesta(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async () => {
  const planillaId = Deno.env.get('PLANILLA_ID')
  const secreto = Deno.env.get('FIREBASE_CUENTA')
  // Sin configurar: los viajes quedan pendientes y se pasan cuando se configure.
  if (!planillaId || !secreto) return respuesta({ ok: false, motivo: 'Falta configurar la planilla (PLANILLA_ID)' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let planilla: Planilla | null = null
  let escritos = 0, fallidos = 0

  // Varias vueltas: si un viaje se corrige mientras se escribe, se vuelve a tomar en la vuelta siguiente.
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const { data: envios, error } = await admin.rpc('tomar_envios_planilla')
    if (error) return respuesta({ error: error.message }, 500)
    if (!envios?.length) break

    for (const e of envios as Envio[]) {
      try {
        // Ya se había escrito en otra planilla (la de prueba): no se pasa a esta.
        if (e.planilla && e.planilla !== planillaId) {
          await admin.from('planilla_envios').update({ pendiente: false, tomado_en: null,
            error: 'Este viaje se había anotado en otra planilla (la de prueba). No se pasa a la de ahora.' })
            .eq('viaje_id', e.viaje_id)
          continue
        }
        const fila = await armarFila(admin, e.viaje_id)
        if (!fila) { // el viaje ya no está finalizado: no hay nada que escribir
          await admin.from('planilla_envios').update({ pendiente: false, tomado_en: null }).eq('viaje_id', e.viaje_id)
          continue
        }
        planilla ??= await Planilla.abrir(planillaId, JSON.parse(secreto) as Cuenta)
        const { numero, corregida } = await planilla.guardar(e.viaje_id, fila)

        const ahora = new Date().toISOString()
        const { data: cerrado } = await admin.from('planilla_envios')
          .update({ pendiente: false, tomado_en: null, enviado_en: ahora, fila: numero, planilla: planillaId, error: null })
          .eq('viaje_id', e.viaje_id).eq('pedido_en', e.pedido_en).select('viaje_id')
        if (!cerrado?.length) { // lo corrigieron mientras se escribía: queda pendiente para la vuelta siguiente
          await admin.from('planilla_envios').update({ tomado_en: null, fila: numero, planilla: planillaId })
            .eq('viaje_id', e.viaje_id)
        }
        await admin.from('registro').insert({ viaje_id: e.viaje_id,
          accion: `📄 ${corregida ? 'Corregido' : 'Anotado'} en la planilla (fila ${numero})` })
        escritos++
      } catch (err) {
        fallidos++
        const mensaje = (err as Error).message
        console.error('Viaje', e.viaje_id, mensaje)
        await admin.from('planilla_envios').update({ tomado_en: null, intentos: e.intentos + 1, error: mensaje.slice(0, 500) })
          .eq('viaje_id', e.viaje_id)
      }
    }
  }
  return respuesta({ ok: true, escritos, fallidos })
})

// La fila del viaje, tal cual la escribía el formulario (null si el viaje no está finalizado).
// deno-lint-ignore no-explicit-any
async function armarFila(admin: any, viajeId: number) {
  const { data: v, error } = await admin.from('viajes')
    .select('id, estado, tipo, cliente_nombre, origen, destino, hora_presentacion, hora_asignacion, iniciado_en,'
      + ' pago_cargado_en, importe, forma_pago, cuenta_otro, demora, peaje, nafta, chofer_id,'
      + ' chofer:perfiles!viajes_chofer_id_fkey(nombre), cuenta:cuentas_corrientes(nombre)')
    .eq('id', viajeId).single()
  if (error) throw new Error('No se pudo leer el viaje: ' + error.message)
  if (v.estado !== 'finalizado') return null

  const { data: ch } = await admin.from('choferes').select('nombre_planilla').eq('id', v.chofer_id).maybeSingle()
  const chofer = ch?.nombre_planilla?.trim() || v.chofer?.nombre || ''

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
  private constructor(
    private id: string,
    private permiso: string,
    private columnaNumero: number,          // dónde va el n.º de viaje de la app
    private filas: Map<number, number>,     // n.º de viaje → fila
  ) {}

  static async abrir(id: string, cuenta: Cuenta) {
    const permiso = await permisoDeGoogle(cuenta)
    const p = new Planilla(id, permiso, 0, new Map())
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
    return p
  }

  // Escribe la fila del viaje: la corrige si ya estaba (busca el n.º de viaje), o la agrega al final.
  async guardar(viajeId: number, fila: (string | number)[]) {
    const completa = [...fila]
    while (completa.length < this.columnaNumero) completa.push('')
    completa[this.columnaNumero] = viajeId
    const fin = letra(this.columnaNumero)

    const existente = this.filas.get(viajeId)
    if (existente) {
      // Se deja la marca temporal original (columna A).
      await this.escribir(rango(`B${existente}:${fin}${existente}`), [completa.slice(1)])
      return { numero: existente, corregida: true }
    }
    const r = await this.pedir(
      `${encodeURIComponent(rango(`A:${fin}`))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: [completa] }) })
    const numero = Number(/!\D+(\d+)/.exec(r.updates?.updatedRange ?? '')?.[1])
    if (numero) this.filas.set(viajeId, numero)
    return { numero, corregida: false }
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

  private async pedir(ruta: string, opciones: RequestInit = {}) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.id}/values/${ruta}`, {
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
