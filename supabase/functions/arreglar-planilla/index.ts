// Arreglos de la planilla de la remisería (4/11/2026). NO queda subida: se sube un rato, se usa una vez por planilla (la
// copia de prueba y, al pasar, la de verdad) y se borra. Pasos en etapa-3-gestion.md. Se puede repetir sin problema.
// 1. "Comisiones": la columna A era una fórmula con los choferes de las primeras respuestas (junio de 2023), así que los
//    que llegaron después no estaban y su hoja daba #N/A en la comisión, el saldo y la ganancia. Pasa a ser una lista fija
//    con todas las hojas de choferes: los que ya estaban quedan con su porcentaje y los que faltaban, con el 20%.
//    Desde entonces, al armar la hoja de un chofer nuevo hay que agregarlo ahí.
// 2. "TD Comision" (tabla dinámica): repite la fecha en cada fila, así "Facturacion por dia" suma a todos los choferes del
//    día (sumaba solo al primero de cada día), y estira las fórmulas de "Comision $" y "Comision USD" para más días.
// 3. Estira las hojas de choferes que se le indiquen (ej. "Brian", que llegaba hasta el 26/3/2026): 1000 días más.
// 4. (6/11) "Marca temporal" sin formato de fecha: las filas que la app metía arriba hasta el 3/11 tomaron el formato del
//    encabezado y se veían como un número (46314,85956). Les pone el mismo formato de fecha y hora que el resto.
// Usa los secrets FIREBASE_CUENTA y PLANILLA_ID. Para usarla (así se hizo el 4/11 con la copia): copiarla a
// supabase/functions/zz-arreglar-planilla poniendo una clave al azar en lugar de Deno.env.get('ARREGLO_TOKEN'), subirla,
// llamarla con la clave anon y borrar la función y la carpeta. Sin la clave, no hace nada.
// Uso: POST { token, estirar: ['Brian'] } muestra lo que haría; con hacer: true, lo hace.

const HOJA = 'Respuestas de formulario 1'
const POR_DEFECTO = 0.2
const DIAS_MAS = 1000
const FORMATO_MARCA = 'm/d/yyyy h:mm:ss' // el que puso el formulario de Google

type Cuenta = { client_email: string; private_key: string }
// deno-lint-ignore no-explicit-any
type Hoja = { title: string; sheetId: number; gridProperties: { rowCount: number; columnCount: number } } & Record<string, any>

const q = (titulo: string) => `'${titulo.replace(/'/g, "''")}'`

Deno.serve(async (req) => {
  const c = await req.json().catch(() => ({}))
  const token = Deno.env.get('ARREGLO_TOKEN')
  if (!token || c?.token !== token) return new Response('no', { status: 403 })
  try {
    return Response.json(await arreglar(!!c.hacer, (c.estirar ?? []) as string[]))
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
})

async function arreglar(hacer: boolean, estirar: string[]) {
  const g = new Google(Deno.env.get('PLANILLA_ID')!, await permisoDeGoogle(JSON.parse(Deno.env.get('FIREBASE_CUENTA')!)))
  const informe: string[] = []
  const pedidos: unknown[] = []      // spreadsheets:batchUpdate (estructura)
  const valores: unknown[] = []      // values:batchUpdate (contenido)

  const hojas: Hoja[] = (await g.get('?fields=sheets.properties(title,sheetId,gridProperties)')).sheets.map((s: { properties: Hoja }) => s.properties)
  const porTitulo = new Map(hojas.map((h) => [h.title, h]))

  // Las hojas de choferes: en A1 dicen "Nombre del Chofer" y en A2, el nombre.
  const otras = hojas.filter((h) => h.title !== HOJA)
  const a12 = await g.valores(otras.map((h) => `${q(h.title)}!A1:A2`), 'FORMATTED_VALUE')
  const choferes = new Set<string>()
  a12.forEach((v: { values?: unknown[][] }) => {
    const [a1, a2] = (v.values ?? []).map((f) => String(f?.[0] ?? '').trim())
    if (/^nombre del chofer/i.test(a1 ?? '') && a2) choferes.add(a2)
  })

  // 1. Comisiones
  const com = porTitulo.get('Comisiones')
  if (!com) informe.push('No hay hoja "Comisiones": no se tocó.')
  else {
    const [formulas] = await g.valores(["'Comisiones'!A2:A2"], 'FORMULA')
    const [actual] = await g.valores(["'Comisiones'!A2:B"], 'UNFORMATTED_VALUE')
    const filas: unknown[][] = actual.values ?? []
    const lista = new Map<string, number>()
    const sinChofer: string[] = []
    filas.forEach((f, i) => {
      const nombre = String(f?.[0] ?? '').trim()
      if (nombre) { if (!lista.has(nombre)) lista.set(nombre, typeof f[1] === 'number' ? f[1] : POR_DEFECTO) }
      else if (typeof f?.[1] === 'number' && f[1] !== POR_DEFECTO) sinChofer.push(`fila ${i + 2}: ${f[1]}`)
    })
    const ya = new Set([...lista.keys()].map((n) => n.toLowerCase())) // la planilla no distingue mayúsculas
    const faltan = [...choferes].filter((n) => !ya.has(n.toLowerCase()))
    const eraFormula = String(formulas.values?.[0]?.[0] ?? '').startsWith('=')
    if (!faltan.length && !eraFormula) informe.push('Comisiones: ya estaba bien.')
    else {
      for (const n of faltan) lista.set(n, POR_DEFECTO)
      const orden = [...lista.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { sensitivity: 'base' }))
      valores.push({ range: `'Comisiones'!A2:B${orden.length + 1}`, values: orden.map(([n, v]) => [n, v]) })
      // Debajo de la lista quedaban porcentajes sueltos (sin chofer): se borran.
      if (filas.length > orden.length) valores.push({ range: `'Comisiones'!A${orden.length + 2}:B${filas.length + 1}`,
        values: Array.from({ length: filas.length - orden.length }, () => ['', '']) })
      informe.push(`Comisiones: ${eraFormula ? 'la lista era una fórmula con los choferes de junio de 2023; ahora es fija, ' : ''}`
        + `con ${orden.length} choferes. Se agregaron con el ${POR_DEFECTO * 100}%: ${faltan.join(', ') || 'ninguno'}.`)
      if (sinChofer.length) informe.push(`Comisiones: había porcentajes distintos sin chofer al lado (${sinChofer.join(', ')}).`)
    }
  }

  // 2. TD Comision (tabla dinámica en A1)
  const td = porTitulo.get('TD Comision')
  if (!td) informe.push('No hay hoja "TD Comision": no se tocó.')
  else {
    const datos = await g.get(`?ranges=${encodeURIComponent("'TD Comision'!A1")}&fields=sheets.data.rowData.values.pivotTable`)
    const pivot = datos.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.pivotTable
    if (!pivot?.rows?.length) informe.push('TD Comision: no se encontró la tabla dinámica en A1.')
    else if (pivot.rows[0].repeatHeadings) informe.push('TD Comision: ya repetía la fecha.')
    else {
      pivot.rows[0].repeatHeadings = true
      pedidos.push({ updateCells: { rows: [{ values: [{ pivotTable: pivot }] }], start: { sheetId: td.sheetId, rowIndex: 0, columnIndex: 0 },
        fields: 'pivotTable' } })
      informe.push('TD Comision: ahora repite la fecha en cada fila ("Facturacion por dia" suma a todos los choferes).')
    }
    // Fórmulas de E y F (comisión en pesos y en dólares): que sobren para muchos días más.
    const [ab] = await g.valores(["'TD Comision'!A1:B"], 'UNFORMATTED_VALUE')
    const usadas = (ab.values ?? []).length
    const total = td.gridProperties.rowCount
    const quiero = usadas + 10000
    if (total < usadas + 3000) { // quedan menos de un año de días: se estiran
      pedidos.push({ appendDimension: { sheetId: td.sheetId, dimension: 'ROWS', length: quiero - total } })
      pedidos.push({ copyPaste: {
        source: { sheetId: td.sheetId, startRowIndex: total - 1, endRowIndex: total, startColumnIndex: 4, endColumnIndex: 6 },
        destination: { sheetId: td.sheetId, startRowIndex: total, endRowIndex: quiero, startColumnIndex: 4, endColumnIndex: 6 },
        pasteType: 'PASTE_NORMAL' } })
      informe.push(`TD Comision: fórmulas de "Comision $" y "Comision USD" estiradas de la fila ${total} a la ${quiero}.`)
    } else informe.push('TD Comision: las fórmulas ya alcanzaban.')
  }

  // 3. Hojas de choferes que se quedaron cortas
  for (const titulo of estirar) {
    const h = porTitulo.get(titulo)
    if (!h) { informe.push(`No hay hoja "${titulo}".`); continue }
    const [a] = await g.valores([`${q(titulo)}!A1:A`], 'UNFORMATTED_VALUE', 'SERIAL_NUMBER')
    const colA: unknown[][] = a.values ?? []
    const ultima = colA.length                         // última fila con algo en A
    const fecha = colA[ultima - 1]?.[0]
    if (typeof fecha !== 'number') { informe.push(`${titulo}: la última fila no tiene fecha; no se tocó.`); continue }
    const faltanFilas = ultima + DIAS_MAS - h.gridProperties.rowCount
    if (faltanFilas > 0) pedidos.push({ appendDimension: { sheetId: h.sheetId, dimension: 'ROWS', length: faltanFilas } })
    // La última fila se copia (fórmulas que se corren solas, formato) y después se escriben las fechas.
    pedidos.push({ copyPaste: {
      source: { sheetId: h.sheetId, startRowIndex: ultima - 1, endRowIndex: ultima, startColumnIndex: 0, endColumnIndex: h.gridProperties.columnCount },
      destination: { sheetId: h.sheetId, startRowIndex: ultima, endRowIndex: ultima + DIAS_MAS, startColumnIndex: 0, endColumnIndex: h.gridProperties.columnCount },
      pasteType: 'PASTE_NORMAL' } })
    valores.push({ range: `${q(titulo)}!A${ultima + 1}:A${ultima + DIAS_MAS}`,
      values: Array.from({ length: DIAS_MAS }, (_, i) => [fecha + 1 + i]) })
    informe.push(`${titulo}: ${DIAS_MAS} días más (de la fila ${ultima + 1} a la ${ultima + DIAS_MAS}).`)
  }

  // 4. Marca temporal sin formato de fecha: el valor es una fecha (un número grande) pero se ve como número.
  const respuestas = porTitulo.get(HOJA)
  if (respuestas) {
    const [vistas] = await g.valores([`${q(HOJA)}!A2:A`], 'FORMATTED_VALUE')
    const [numeros] = await g.valores([`${q(HOJA)}!A2:A`], 'UNFORMATTED_VALUE', 'SERIAL_NUMBER')
    const tramos: [number, number][] = [] // filas de la hoja (desde 0) sin formato, de a tramos seguidos
    let cuantas = 0
    for (const [i, f] of ((numeros.values ?? []) as unknown[][]).entries()) {
      const n = f?.[0]
      if (typeof n !== 'number' || n < 30000 || !/^\d+([.,]\d+)?$/.test(String(vistas.values?.[i]?.[0] ?? ''))) continue
      const fila = i + 1 // A2 es la fila 1 contando desde 0
      const ultimo = tramos.at(-1)
      if (ultimo && ultimo[1] === fila) ultimo[1] = fila + 1
      else tramos.push([fila, fila + 1])
      cuantas++
    }
    for (const [desde, hasta] of tramos) {
      pedidos.push({ repeatCell: {
        range: { sheetId: respuestas.sheetId, startRowIndex: desde, endRowIndex: hasta, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: FORMATO_MARCA } } },
        fields: 'userEnteredFormat.numberFormat' } })
    }
    informe.push(cuantas
      ? `Marca temporal: ${cuantas} filas se veían como un número (${tramos.map(([d, h]) => `filas ${d + 1} a ${h}`).join(', ')}); ahora con fecha y hora.`
      : 'Marca temporal: ya estaba bien.')
  }

  if (hacer) {
    if (pedidos.length) await g.post(':batchUpdate', { requests: pedidos })
    if (valores.length) await g.post('/values:batchUpdate', { valueInputOption: 'RAW', data: valores })
  }
  return { hecho: hacer, informe }
}

class Google {
  constructor(private id: string, private permiso: string) {}

  async get(ruta: string) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.id}${ruta}`, { headers: { Authorization: 'Bearer ' + this.permiso } })
    const datos = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`Google respondió ${r.status}: ${datos?.error?.message ?? ''}`)
    return datos
  }

  async post(ruta: string, cuerpo: unknown) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.id}${ruta}`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + this.permiso, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
    const datos = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`Google respondió ${r.status}: ${datos?.error?.message ?? ''}`)
    return datos
  }

  async valores(rangos: string[], como: string, fechas = 'FORMATTED_STRING') {
    const r = rangos.map((x) => 'ranges=' + encodeURIComponent(x)).join('&')
    return (await this.get(`/values:batchGet?${r}&valueRenderOption=${como}&dateTimeRenderOption=${fechas}`)).valueRanges
  }
}

// Igual que en la función "planilla".
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
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: sinFirmar + '.' + base64url(firma) }),
  })
  const datos = await r.json()
  if (!datos.access_token) throw new Error('Google no dio permiso: ' + JSON.stringify(datos))
  return datos.access_token as string
}
