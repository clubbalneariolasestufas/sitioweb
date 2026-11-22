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
    seleccion: { personas: { adultos: 4, ninos: 30 }, areas: ['rancho'], menu: 'casado', extras: ['sonido'] },
    nombre: 'Escuela Palmitos', telefono: '8888-1234', correo: 'dir@escuela.cr', ...extra
})

test('cálculo: entradas, áreas, menú por persona, servicio solo en comida, IVA y adelanto', () => {
    const c = P.calcular({ personas: { adultos: 4, ninos: 30 }, areas: ['rancho'], menu: 'casado', extras: ['sonido'] })
    assert.equal(c.personas, 34)
    assert.equal(c.entradas, 4 * 6000 + 30 * 3000)
    assert.equal(c.alimentacion, 34 * 4500)
    assert.equal(c.servicio, Math.round(34 * 4500 * 0.10))
    assert.equal(c.subtotal, 114000 + 25000 + 153000 + 15000)
    assert.equal(c.iva, Math.round((c.subtotal + c.servicio) * 0.13))
    assert.equal(c.total, c.subtotal + c.servicio + c.iva)
    assert.equal(c.adelanto + c.saldo, c.total)
})

test('cálculo: ignora lo desconocido y cantidades raras', () => {
    const c = P.calcular({ personas: { adultos: -5, ninos: 2.7, vip: 99 }, areas: ['rancho', 'piscina-privada', 'rancho'], menu: 'caviar', extras: ['x'] })
    assert.deepEqual(c.seleccion.areas, ['rancho'])
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
        { seleccion: { personas: { adultos: 3 }, areas: ['rancho'] } }
    ]
    for (const c of casos) assert.equal((await post(cotizar, solicitud(c))).status, 400, JSON.stringify(c))
    assert.equal(db.collection('cotizaciones').filas.length, 0)
})

test('no permite dos grupos en el mismo rancho el mismo día, pero sí otra área', async () => {
    assert.equal((await post(cotizar, solicitud())).status, 201)
    const r = await post(cotizar, solicitud({ nombre: 'Empresa XYZ' }))
    assert.equal(r.status, 409)
    assert.match((await r.json()).error, /Rancho/)
    const otra = solicitud({ nombre: 'Empresa XYZ' }); otra.seleccion = { ...otra.seleccion, areas: ['salon'] }
    assert.equal((await post(cotizar, otra)).status, 201)
    const d = await (await get(disponibilidad, `/api/disponibilidad?desde=${solicitud().fechaEvento}&dias=1`)).json()
    assert.deepEqual(d.dias[0].ocupadas.sort(), ['rancho', 'salon'])
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
    const t = P.tareasDe({ fechaEvento: '2026-12-11', seleccion: { menu: 'casado' } })
    assert.deepEqual(t.map(x => [x.id, x.fecha]), [['cocina', '2026-12-04'], ['cantidad', '2026-12-08'], ['saldo', '2026-12-09'], ['areas', '2026-12-10'], ['puerta', '2026-12-11']])
    assert.equal(P.tareasDe({ fechaEvento: '2026-12-11', seleccion: { menu: 'ninguno' } }).length, 4)
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
