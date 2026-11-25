import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.QR_SIGNING_SECRET = 'x'.repeat(48)
const { hashPin } = await import('../netlify/functions/_lib/pin.mjs')
process.env.GATE_PIN_HASH = hashPin('482913')
process.env.ADMIN_PIN_HASH = hashPin('771204')
process.env.CALENDARIO_TOKEN = 'cal-' + 'z'.repeat(30)

const { setDbParaPruebas } = await import('../netlify/functions/_lib/db.mjs')
const { crearDbFalsa } = await import('./fake-db.mjs')
const { diaSemana, hoyCR } = await import('../netlify/functions/_lib/fechas.mjs')
const P = await import('../src/js/precios-eventos.js')
const cotizar = (await import('../netlify/functions/cotizaciones.mjs')).default
const disponibilidad = (await import('../netlify/functions/disponibilidad.mjs')).default
const admin = (await import('../netlify/functions/eventos-admin.mjs')).default
const calendario = (await import('../netlify/functions/calendario.mjs')).default
const { vencerCotizaciones, generarIcs } = await import('../netlify/functions/_lib/cotizaciones.mjs')

let db
beforeEach(() => { db = crearDbFalsa(); setDbParaPruebas(db) })

const post = (h, cuerpo, ip = '2.2.2.2') => h(new Request('http://x/api', { method: 'POST', body: JSON.stringify(cuerpo) }), { ip })
const get = (h, ruta) => h(new Request('http://x' + ruta), {})
const ADMIN = '771204'

function fechaLibre(offset = 10) {
    for (let i = offset; i < offset + 10; i++) {
        const f = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10)
        if (diaSemana(f) !== 3) return f
    }
}
const solicitud = (extra = {}) => ({
    tipoEvento: 'Excursión escolar', fechaEvento: fechaLibre(), horaInicio: '09:00', horaFin: '15:00',
    seleccion: { personas: { adultos: 4, ninos: 30 }, areas: ['techada'], menu: 'comida', extras: ['dj'] },
    nombre: 'Escuela Palmitos', telefono: '8888-1234', correo: 'dir@escuela.cr', ...extra
})

test('cálculo: entrada ₡3 500, menores gratis, ranchos según el día y extras por cotizar', () => {
    const c = P.calcular({ personas: { adultos: 20, ninos: 5 }, areas: ['techada', 'ranchos', 'tenis'], ranchos: 2, horasTenis: 1, menu: 'comida', extras: ['dj', 'musica'] }, '2026-12-05')
    assert.equal(c.personas, 25)
    assert.equal(c.entradas, 20 * 3500)
    assert.equal(c.areas, 50000 + 2 * 10000 + 3000, 'techada ₡50 000 (25 personas); sábado: rancho ₡10 000; cancha ₡3 000 la hora')
    assert.equal(c.alimentacion, 0)
    assert.equal(c.iva, 0, 'precios con impuestos incluidos')
    assert.equal(c.total, 20 * 3500 + 73000)
    assert.ok(c.porCotizar)
    assert.ok(c.lineas.some(l => l.concepto === 'DJ (por cotizar)'))
    assert.equal(c.adelanto + c.saldo, c.total)
    assert.equal(P.calcular({ personas: { adultos: 20 }, areas: ['ranchos'], ranchos: 2 }, '2026-12-07').areas, 0, 'entre semana el rancho no cobra')
})

test('cálculo: de 51 personas en adelante la entrada baja a ₡3 000', () => {
    assert.equal(P.calcular({ personas: { adultos: 50 } }).entradas, 50 * 3500)
    const g = P.calcular({ personas: { adultos: 60, ninos: 4 } })
    assert.equal(g.entradas, 60 * 3000)
    assert.ok(g.grupo)
    assert.match(g.lineas[0].concepto, /precio de grupo/)
})

test('cálculo: ignora lo desconocido y cantidades raras', () => {
    const c = P.calcular({ personas: { adultos: -5, ninos: 2.7, vip: 99 }, areas: ['techada', 'piscina-privada', 'techada'], menu: 'caviar', extras: ['x'] })
    assert.deepEqual(c.seleccion.areas, ['techada'])
    assert.equal(c.seleccion.menu, 'ninguno')
    assert.equal(c.personas, 2)
})

test('crea la solicitud con código COT, recalcula el monto y aparta la fecha', async () => {
    const r = await post(cotizar, { ...solicitud(), total: 1 })
    assert.equal(r.status, 201)
    const c = await r.json()
    assert.match(c.codigo, new RegExp(`^COT-${hoyCR().slice(0, 4)}-001$`))
    assert.equal(c.estado, 'solicitada')
    assert.equal(c.total, P.calcular(solicitud().seleccion).total)
    const r2 = await post(cotizar, solicitud({ fechaEvento: fechaLibre(20) }))
    assert.match((await r2.json()).codigo, /-002$/)
    const guardada = db.collection('cotizaciones').filas[0]
    assert.equal(guardada.telefono, '88881234')
    assert.ok(!('ip' in guardada))
})

test('rechaza datos inválidos', async () => {
    const miercoles = (() => { for (let i = 5; i < 15; i++) { const f = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10); if (diaSemana(f) === 3) return f } })()
    const casos = [
        { tipoEvento: 'Rave' }, { fechaEvento: hoyCR() }, { fechaEvento: miercoles }, { fechaEvento: '2026-02-30' },
        { horaInicio: '15:00', horaFin: '09:00' }, { nombre: 'A' }, { telefono: '12' }, { correo: 'x@' }, { web: 'bot' },
        { seleccion: { personas: { adultos: 3 }, areas: ['techada'] } }
    ]
    for (const c of casos) assert.equal((await post(cotizar, solicitud(c))).status, 400, JSON.stringify(c))
    assert.equal(db.collection('cotizaciones').filas.length, 0)
})

test('no permite dos grupos en el área techada el mismo día, pero sí uno con ranchos', async () => {
    assert.equal((await post(cotizar, solicitud())).status, 201)
    const r = await post(cotizar, solicitud({ nombre: 'Empresa XYZ' }))
    assert.equal(r.status, 409)
    assert.match((await r.json()).error, /Área techada/)
    const otra = solicitud({ nombre: 'Empresa XYZ' }); otra.seleccion = { ...otra.seleccion, areas: ['ranchos'], ranchos: 3 }
    assert.equal((await post(cotizar, otra)).status, 201)
    const d = await (await get(disponibilidad, `/api/disponibilidad?desde=${solicitud().fechaEvento}&dias=1`)).json()
    assert.deepEqual(d.dias[0].ocupadas, ['techada'])
    assert.equal(d.dias[0].lleno, true)
    assert.ok(!JSON.stringify(d).includes('Escuela'), 'no expone datos de clientes')
})

test('la solicitud vence a los 2 días y libera la fecha', async () => {
    await post(cotizar, solicitud())
    const fila = db.collection('cotizaciones').filas[0]
    assert.equal(await vencerCotizaciones(db, new Date(Date.now() + 1 * 86400000)), 0)
    assert.equal(await vencerCotizaciones(db, new Date(Date.now() + 3 * 86400000)), 1)
    assert.equal(fila.estado, 'vencida')
    assert.equal((await post(cotizar, solicitud({ nombre: 'Otro grupo' }))).status, 201)
})

test('seguimiento pide los últimos 4 del teléfono y no revela códigos', async () => {
    const { codigo } = await (await post(cotizar, solicitud())).json()
    assert.equal((await get(cotizar, `/api/cotizaciones?codigo=${codigo}&tel=1234`)).status, 200)
    assert.equal((await get(cotizar, `/api/cotizaciones?codigo=${codigo}&tel=0000`)).status, 404)
    assert.equal((await get(cotizar, `/api/cotizaciones?codigo=COT-2026-999&tel=1234`)).status, 404)
    const v = await (await get(cotizar, `/api/cotizaciones?codigo=${codigo}&tel=1234`)).json()
    assert.ok(!('telefono' in v) && !('huella' in v) && !('correo' in v))
})

test('limita solicitudes por hora desde un mismo cliente', async () => {
    let r
    for (let i = 0; i < 7; i++) r = await post(cotizar, solicitud({ fechaEvento: fechaLibre(10 + i * 2) }), '7.7.7.7')
    assert.equal(r.status, 429)
})

test('administración: flujo completo de estados con adelanto y total ajustado', async () => {
    const { codigo } = await (await post(cotizar, solicitud())).json()
    assert.equal((await post(admin, { pin: '482913', accion: 'listar' })).status, 403, 'el PIN de puerta no entra')

    let r = await post(admin, { pin: ADMIN, accion: 'estado', codigo, estado: 'reservada', comprobante: '1234' })
    assert.equal(r.status, 409, 'no se salta pasos')

    r = await post(admin, { pin: ADMIN, accion: 'estado', codigo, estado: 'cotizada', totalFinal: 500000, mensajeCliente: 'Incluye mesas extra' })
    assert.equal(r.status, 200)
    let c = await r.json()
    assert.equal(c.adelantoFinal, 250000)
    assert.ok(new Date(c.validaHasta) > new Date(Date.now() + 14 * 86400000))

    assert.equal((await post(admin, { pin: ADMIN, accion: 'estado', codigo, estado: 'reservada' })).status, 400, 'pide comprobante')
    c = await (await post(admin, { pin: ADMIN, accion: 'estado', codigo, estado: 'reservada', comprobante: '2026-55-1234' })).json()
    assert.equal(c.estado, 'reservada')
    assert.equal(c.comprobanteAdelanto, '2026551234')

    c = await (await post(admin, { pin: ADMIN, accion: 'tarea', codigo, tarea: 'cocina', hecha: true })).json()
    assert.equal(c.tareas.find(t => t.id === 'cocina').hecha, true)
    c = await (await post(admin, { pin: ADMIN, accion: 'tarea', codigo, tarea: 'cocina', hecha: false })).json()
    assert.equal(c.tareas.find(t => t.id === 'cocina').hecha, false)

    c = await (await post(admin, { pin: ADMIN, accion: 'estado', codigo, estado: 'confirmada' })).json()
    c = await (await post(admin, { pin: ADMIN, accion: 'estado', codigo, estado: 'realizada' })).json()
    assert.deepEqual(c.historial.map(h => h.estado), ['solicitada', 'cotizada', 'reservada', 'confirmada', 'realizada'])

    const v = await (await get(cotizar, `/api/cotizaciones?codigo=${codigo}&tel=1234`)).json()
    assert.equal(v.total, 500000)
    assert.equal(v.mensaje, 'Incluye mesas extra')
})

test('tareas automáticas: fechas relativas al evento y cocina solo con menú', () => {
    const t = P.tareasDe({ fechaEvento: '2026-12-11', seleccion: { menu: 'comida' } })
    assert.deepEqual(t.map(x => [x.id, x.fecha]), [['cocina', '2026-12-04'], ['cantidad', '2026-12-08'], ['platillos', '2026-12-08'], ['saldo', '2026-12-09'], ['comida-dia', '2026-12-11'], ['puerta', '2026-12-11']])
    // Sin comida ni áreas: confirmaciones, pagos y puerta
    assert.deepEqual(P.tareasDe({ fechaEvento: '2026-12-11', seleccion: { menu: 'ninguno' } }).map(x => x.id), ['cantidad', 'saldo', 'puerta'])
    // Cumpleaños en el salón con decoración y DJ: lavar salón, secar sillas, rótulo y montaje
    const cumple = P.tareasDe({ fechaEvento: '2026-12-11', tipoEvento: 'Cumpleaños', seleccion: { menu: 'ninguno', areas: ['techada'], extras: ['decoracion', 'dj'] } })
    const ids = cumple.map(x => x.id)
    for (const id of ['decoracion', 'rotulo', 'musica', 'salon', 'sillas', 'montaje']) assert.ok(ids.includes(id), id)
    assert.equal(cumple.find(x => x.id === 'salon').fecha, '2026-12-10')
    assert.equal(cumple.find(x => x.id === 'sillas').fecha, '2026-12-11')
    assert.equal(cumple.find(x => x.id === 'musica').encargado, 'Alejandro')
    // Decoración sin cumpleaños: sin rótulo
    assert.ok(!P.tareasDe({ fechaEvento: '2026-12-11', tipoEvento: 'Actividad de empresa', seleccion: { extras: ['decoracion'] } }).some(x => x.id === 'rotulo'))
})

test('calendario ICS: requiere token y trae eventos y tareas', async () => {
    const { codigo } = await (await post(cotizar, solicitud())).json()
    await post(admin, { pin: ADMIN, accion: 'estado', codigo, estado: 'cotizada' })
    await post(admin, { pin: ADMIN, accion: 'estado', codigo, estado: 'reservada', comprobante: '99887766' })
    assert.equal((await get(calendario, '/api/calendario.ics?k=malo')).status, 401)
    const r = await get(calendario, '/api/calendario.ics?k=' + process.env.CALENDARIO_TOKEN)
    assert.equal(r.status, 200)
    const ics = await r.text()
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/)
    assert.match(ics, new RegExp(`UID:${codigo}@lasestufas`))
    assert.match(ics, /Tarea: Pedir insumos de cocina/)
    assert.match(ics, /STATUS:CONFIRMED/)
    assert.ok(ics.split('\r\n').every(l => l.length <= 75), 'líneas dobladas a 75')
    const enlace = await (await post(admin, { pin: ADMIN, accion: 'calendario' })).json()
    assert.match(enlace.url, /\/api\/calendario\.ics\?k=/)
})

test('ICS escapa comas, punto y coma y saltos de línea', () => {
    const ics = generarIcs([{ codigo: 'COT-2026-001', estado: 'solicitada', tipoEvento: 'Otro', nombre: 'Ana; Luis, y\notros', telefono: '1', fechaEvento: '2026-12-11', seleccion: { areas: [] }, calculo: { personas: 10, total: 1 } }])
    assert.match(ics, /Ana\\; Luis\\, y\\notros/)
})

test('área techada: ₡50 000 hasta 40 personas, ₡1 000 más por persona desde la 41, hasta 100', () => {
    const techada = n => P.calcular({ personas: { adultos: n }, areas: ['techada'] }).areas
    assert.equal(techada(30), 50000)
    assert.equal(techada(40), 50000)
    assert.equal(techada(41), 51000)
    assert.equal(techada(60), 70000)
    assert.equal(techada(100), 110000)
    const grande = P.calcular({ personas: { adultos: 101 }, areas: ['techada'] })
    assert.equal(grande.areas, 0)
    assert.ok(grande.coordinar)
    assert.match(grande.lineas.find(l => l.grupo === 'Áreas').concepto, /coordina con la administración/)
    // Menores también cuentan para mesas y sillas
    assert.equal(P.calcular({ personas: { adultos: 38, ninos: 5 }, areas: ['techada'] }).areas, 53000)
})

test('seguridad: el seguimiento frena a quien prueba teléfonos', async () => {
    const r = await post(cotizar, solicitud())
    const { codigo } = await r.json()
    for (let i = 0; i < 10; i++) assert.equal((await get(cotizar, `/api/cotizaciones?codigo=${codigo}&tel=${String(i).padStart(4, '0')}`)).status, 404)
    assert.equal((await get(cotizar, `/api/cotizaciones?codigo=${codigo}&tel=1234`)).status, 429)
})
