// Pagos parciales (Propuesta A): la cuenta de cada orden. Montos en colones enteros.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.QR_SIGNING_SECRET = 'x'.repeat(48)
process.env.SINPE_NUMBER = '6003-4009'
const { hashPin } = await import('../netlify/functions/_lib/pin.mjs')
process.env.GATE_PIN_HASH = hashPin('482913')
process.env.ADMIN_PIN_HASH = hashPin('771204')

const { setDbParaPruebas } = await import('../netlify/functions/_lib/db.mjs')
const { crearDbFalsa } = await import('./fake-db.mjs')
const { hoyCR, diaSemana } = await import('../netlify/functions/_lib/fechas.mjs')
const crear = (await import('../netlify/functions/ordenes.mjs')).default
const verificarPago = (await import('../netlify/functions/verificar-pago.mjs')).default
const validar = (await import('../netlify/functions/validar-boleto.mjs')).default
const panel = (await import('../netlify/functions/panel.mjs')).default
const { pistaMonto, aplicarPagosConCodigo, avisarSaldos } = await import('../netlify/functions/_lib/cuenta.mjs')
const { cuadrePagos } = await import('../netlify/functions/_lib/estado.mjs')

let db
beforeEach(() => { db = crearDbFalsa(); setDbParaPruebas(db) })

const post = (handler, cuerpo, ip = '1.1.1.1') =>
    handler(new Request('http://x/api', { method: 'POST', body: JSON.stringify(cuerpo) }), { ip })
function fecha(cumple) {
    for (let i = 1; i < 15; i++) {
        const f = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10)
        if (cumple(diaSemana(f))) return f
    }
}
const entreSemana = () => fecha(d => d >= 1 && d <= 5 && d !== 3)
const finde = () => fecha(d => d === 0 || d === 6)
// 5 entradas = ₡17 500 (el ejemplo de la consulta)
const orden17500 = (extra = {}) => ({ general: 5, menores: 0, ranchos: [], nombre: 'Ana Mora', telefono: '8850-9393', correo: 'ana@correo.cr', fechaVisita: entreSemana(), ...extra })
let n = 0
const sinpe = (codigoOrden, monto, extra = {}) => {
    const comprobante = String(900000 + ++n)
    db.collection('pagos_sinpe').filas.push({ comprobante, ultimos4: comprobante.slice(-4), monto, fecha: new Date(), estado: 'libre', codigoOrden, fuentes: ['sms'], ...extra })
    return comprobante
}
const nueva = async (cuerpo = orden17500()) => {
    const r = await post(crear, cuerpo)
    assert.equal(r.status, 201)
    return r.json()
}
// Pasa la visita a hoy para probar la puerta
const visitaHoy = codigo => {
    const o = db.collection('ordenes').filas.find(x => x.codigo === codigo)
    o.fechaVisita = hoyCR()
    db.collection('boletos').filas.filter(b => b.ordenCodigo === codigo).forEach(b => { b.fechaVisita = hoyCR() })
}

test('pista: detecta el cero que falta y los números cambiados de lugar', () => {
    assert.equal(pistaMonto(17500, 1750), 'Parece que faltó un cero en el monto.')
    assert.equal(pistaMonto(17500, 175), 'Parece que faltaron dos ceros en el monto.')
    assert.equal(pistaMonto(17500, 175000), 'Parece que sobró un cero en el monto.')
    assert.equal(pistaMonto(17500, 15700), 'Parece que se cambiaron de lugar números del monto.')
    assert.equal(pistaMonto(17500, 10000), '')
    assert.equal(pistaMonto(17500, 17500), '')
})

test('₡1 750 de ₡17 500: avisa de inmediato el faltante, no da ingreso y el segundo SINPE completa', async () => {
    const o = await nueva()
    assert.equal(o.total, 17500)
    sinpe(o.codigo, 1750)
    // Con solo el código se ven los montos, pero no los QR (los da la llave de la compra)
    const ajeno = await (await post(verificarPago, { codigo: o.codigo })).json()
    assert.equal(ajeno.parcial, true)
    assert.equal(ajeno.boletos, null)
    const r = await post(verificarPago, { codigo: o.codigo, llave: o.llave })
    assert.equal(r.status, 200)
    const d = await r.json()
    assert.equal(d.parcial, true)
    assert.equal(d.recibido, 1750)
    assert.equal(d.saldo, 15750)
    assert.equal(d.pista, 'Parece que faltó un cero en el monto.')
    assert.match(d.mensaje, /Recibimos ₡1\s?750 de ₡17\s?500\. Faltan ₡15\s?750/)
    assert.equal(d.boletos.length, 5, 'boletos con saldo pendiente para pagar en la entrada')
    assert.equal(db.collection('ordenes').filas[0].estado, 'parcial')

    // El cuadre está bien: 0 < P < D
    assert.equal((await cuadrePagos(db)).estado, 'verde')

    // Otro SINPE con el mismo código por el faltante exacto: se suma y queda pagada
    sinpe(o.codigo, 15750)
    const r2 = await (await post(verificarPago, { codigo: o.codigo, llave: o.llave })).json()
    assert.equal(r2.parcial, undefined)
    assert.equal(r2.boletos.length, 5)
    // Ya pagada: el dueño ve sus boletos con la llave; sin llave ni 4 dígitos, no
    assert.equal((await post(verificarPago, { codigo: o.codigo })).status, 403)
    assert.equal((await post(verificarPago, { codigo: o.codigo, llave: 'x'.repeat(16) })).status, 403)
    assert.equal((await (await post(verificarPago, { codigo: o.codigo, llave: o.llave })).json()).boletos.length, 5)
    assert.equal(r2.recibido, 17500)
    assert.equal(r2.saldo, 0)
    const g = db.collection('ordenes').filas[0]
    assert.equal(g.estado, 'pagada')
    assert.deepEqual(g.cobros.map(c => [c.metodo, c.monto]), [['sinpe', 1750], ['sinpe', 15750]])
    assert.equal((await cuadrePagos(db)).estado, 'verde')
})

test('puerta: con saldo no pasa; se cobra el faltante exacto solo el día de la visita y luego entra', async () => {
    const o = await nueva()
    sinpe(o.codigo, 1750)
    const d = await (await post(verificarPago, { codigo: o.codigo, llave: o.llave })).json()

    // Antes del día de la visita no se puede cobrar en la entrada
    const antes = await post(panel, { pin: '482913', accion: 'cobrar-saldo', codigo: o.codigo, metodo: 'efectivo', monto: 15750 })
    assert.equal(antes.status, 409)

    visitaHoy(o.codigo)
    const token = db.collection('boletos').filas[0].token
    const escaneo = await (await post(validar, { pin: '482913', token })).json()
    assert.equal(escaneo.resultado, 'saldo')
    assert.equal(escaneo.saldo, 15750)
    assert.equal(db.collection('boletos').filas[0].estado, 'valido', 'no se marca usado')
    assert.equal((await post(panel, { pin: '482913', accion: 'ingresar', codigo: o.codigo })).status, 409)

    // Monto distinto al faltante: no se acepta
    assert.equal((await post(panel, { pin: '482913', accion: 'cobrar-saldo', codigo: o.codigo, metodo: 'efectivo', monto: 15000 })).status, 400)
    const cobro = await post(panel, { pin: '482913', accion: 'cobrar-saldo', codigo: o.codigo, metodo: 'efectivo', monto: 15750 })
    assert.equal(cobro.status, 200)
    assert.equal((await cobro.json()).estado, 'pagada')
    const g = db.collection('ordenes').filas[0]
    assert.deepEqual(g.cobros.map(c => [c.metodo, c.monto]), [['sinpe', 1750], ['efectivo', 15750]])
    assert.equal(g.saldoCobradoEnPuerta, 'efectivo')
    assert.equal((await (await post(validar, { pin: '482913', token })).json()).resultado, 'ok')
    assert.ok(d.boletos.length === 5)
})

test('Loyverse: el recibo lleva el total de la venta repartido en SINPE web y efectivo', async () => {
    Object.assign(process.env, { LOYVERSE_TOKEN: 't', LOYVERSE_STORE_ID: 's', LOYVERSE_PAYMENT_TYPE_ID: 'sinpe-web', LOYVERSE_PAYMENT_TYPE_EFECTIVO: 'efectivo', LOYVERSE_VARIANT_GENERAL: 'vg' })
    const original = globalThis.fetch
    const cuerpos = []
    globalThis.fetch = async (url, op = {}) => { if (op.body) cuerpos.push(JSON.parse(op.body)); return new Response(JSON.stringify({ receipt_number: '1' }), { status: 200 }) }
    try {
        const o = await nueva()
        sinpe(o.codigo, 1750)
        await post(verificarPago, { codigo: o.codigo })
        assert.equal(cuerpos.length, 0, 'nada a Loyverse mientras la cuenta no esté completa')
        visitaHoy(o.codigo)
        await post(panel, { pin: '482913', accion: 'cobrar-saldo', codigo: o.codigo, metodo: 'efectivo', monto: 15750 })
        const recibo = cuerpos.find(c => c.line_items)
        assert.deepEqual(recibo.line_items, [{ variant_id: 'vg', quantity: 5, price: 3500 }])
        assert.deepEqual(recibo.payments.map(p => [p.payment_type_id, p.money_amount]), [['sinpe-web', 1750], ['efectivo', 15750]])
        assert.equal(recibo.payments.reduce((s, p) => s + p.money_amount, 0), 17500)
    } finally {
        globalThis.fetch = original
        for (const k of ['LOYVERSE_TOKEN', 'LOYVERSE_STORE_ID', 'LOYVERSE_PAYMENT_TYPE_ID', 'LOYVERSE_PAYMENT_TYPE_EFECTIVO', 'LOYVERSE_VARIANT_GENERAL']) delete process.env[k]
    }
})

test('sobrepago: más de ₡1 000 es crédito el mismo día (una sola vez); ₡1 000 o menos no', async () => {
    const o = await nueva()
    sinpe(o.codigo, 22500)
    const d = await (await post(verificarPago, { codigo: o.codigo })).json()
    assert.equal(d.sobrepago, 5000)
    assert.equal(d.credito, 5000)
    const g = db.collection('ordenes').filas[0]
    assert.deepEqual(g.cobros.map(c => c.monto), [17500], 'a la venta entra solo el total')
    assert.equal((await cuadrePagos(db)).estado, 'verde', 'P − D = sobrepago')
    assert.equal((await post(panel, { pin: '482913', accion: 'credito-entregado', codigo: o.codigo })).status, 409, 'solo el día de la visita')
    visitaHoy(o.codigo)
    assert.equal((await (await post(validar, { pin: '482913', token: db.collection('boletos').filas[0].token })).json()).credito, 5000)
    assert.equal((await post(panel, { pin: '482913', accion: 'credito-entregado', codigo: o.codigo })).status, 200)
    assert.equal((await post(panel, { pin: '482913', accion: 'credito-entregado', codigo: o.codigo })).status, 409, 'no se entrega dos veces')

    const o2 = await nueva()
    sinpe(o2.codigo, 18500)
    const d2 = await (await post(verificarPago, { codigo: o2.codigo })).json()
    assert.equal(d2.sobrepago, 1000)
    assert.equal(d2.credito, 0)
})

test('rescate sin código: últimos 4 + monto pagado; con otro monto no se toma', async () => {
    const o = await nueva()
    const comp = sinpe('', 1750)
    const ult = comp.slice(-4)
    // Sin monto, busca un pago por el saldo (₡17 500): no lo hay
    assert.equal((await post(verificarPago, { codigo: o.codigo, ultimos4: ult })).status, 404)
    assert.equal((await post(verificarPago, { codigo: o.codigo, ultimos4: ult, montoPagado: 1800 })).status, 404)
    const r = await post(verificarPago, { codigo: o.codigo, ultimos4: ult, montoPagado: 1750 })
    assert.equal(r.status, 200)
    assert.equal((await r.json()).saldo, 15750)
    // Completa por rescate, sin escribir el monto: se busca el saldo
    const comp2 = sinpe('', 15750)
    const r2 = await (await post(verificarPago, { codigo: o.codigo, ultimos4: comp2.slice(-4) })).json()
    assert.equal(r2.saldo, 0)
    assert.equal(db.collection('ordenes').filas[0].estado, 'pagada')
})

test('aprobación manual: exige el monto real y suma a la cuenta; no acepta un monto distinto al del banco', async () => {
    const o = await nueva()
    assert.equal((await post(panel, { pin: '771204', accion: 'aprobar', codigo: o.codigo, comprobante: '55550001' })).status, 400, 'sin monto')
    const r = await (await post(panel, { pin: '771204', accion: 'aprobar', codigo: o.codigo, comprobante: '55550001', monto: 1750 })).json()
    assert.equal(r.estado, 'parcial')
    assert.equal(r.saldo, 15750)
    // El lector ya tenía este comprobante por ₡15 750: escribir otro monto se rechaza
    const comp = sinpe('', 15750)
    assert.equal((await post(panel, { pin: '771204', accion: 'aprobar', codigo: o.codigo, comprobante: comp, monto: 17500 })).status, 409)
    const ok = await (await post(panel, { pin: '771204', accion: 'aprobar', codigo: o.codigo, comprobante: comp, monto: 15750 })).json()
    assert.equal(ok.estado, 'pagada')
    assert.equal(ok.boletos.length, 5)
})

test('cuadre: el banco reporta otro monto para un comprobante ya usado y el semáforo se pone en rojo', async () => {
    const o = await nueva()
    await post(panel, { pin: '771204', accion: 'aprobar', codigo: o.codigo, comprobante: '77770001', monto: 17500 })
    assert.equal((await cuadrePagos(db)).estado, 'verde')
    // Así lo marca el lector cuando le llega el SMS real por ₡1 750 con ese comprobante
    db.collection('pagos_sinpe').filas[0].conflictoMonto = 1750
    const c = await cuadrePagos(db)
    assert.equal(c.estado, 'rojo')
    assert.match(c.detalle, /monto distinto/)
})

test('rancho en pago parcial: firme si lo pagado cubre el rancho; si no, el apartado se alarga una vez', async () => {
    // Fin de semana: rancho ₡10 000 + 5 entradas ₡17 500 = ₡27 500
    const o = await nueva(orden17500({ fechaVisita: finde(), ranchos: [3] }))
    assert.equal(o.total, 27500)
    sinpe(o.codigo, 2750)
    const d = await (await post(verificarPago, { codigo: o.codigo })).json()
    assert.equal(d.reservasGarantizadas, false)
    assert.equal(d.faltaParaGarantizar, 7250)
    const res = db.collection('ranchos_reservas').filas[0]
    assert.equal(res.firme, false)
    assert.ok(new Date(res.hasta) - Date.now() > 25 * 60_000, 'apartado de 30 minutos')

    sinpe(o.codigo, 10000)
    const d2 = await (await post(verificarPago, { codigo: o.codigo })).json()
    assert.equal(d2.reservasGarantizadas, true)
    assert.equal(db.collection('ranchos_reservas').filas[0].firme, true)
})

test('tarea programada: une el SINPE aunque el cliente cerró la página y avisa el faltante por correo una vez', async () => {
    const o = await nueva()
    sinpe(o.codigo, 1750)
    assert.equal(await aplicarPagosConCodigo(db), 1)
    assert.equal(db.collection('ordenes').filas[0].estado, 'parcial')

    const enviados = []
    const enviar = async m => { enviados.push(m); return true }
    // Todavía no pasan 10 minutos: no se envía
    assert.equal(await avisarSaldos(db, { enviar }), 0)
    const luego = new Date(Date.now() + 11 * 60_000)
    assert.equal(await avisarSaldos(db, { enviar, ahora: luego }), 1)
    assert.equal(await avisarSaldos(db, { enviar, ahora: luego }), 0, 'una sola vez')
    assert.equal(enviados[0].para, 'ana@correo.cr')
    assert.match(enviados[0].asunto, /Falta ₡15\s?750/)
    assert.match(enviados[0].texto, /faltó un cero/)
    assert.match(enviados[0].texto, /En la entrada del balneario, el mismo día/)
    assert.match(enviados[0].texto, new RegExp(`descripción el código ${o.codigo}`))
    assert.ok(!enviados[0].texto.includes('undefined'))

    // Sin correo, no se intenta
    const o2 = await nueva(orden17500({ correo: '' }))
    sinpe(o2.codigo, 1000)
    await aplicarPagosConCodigo(db)
    assert.equal(await avisarSaldos(db, { enviar, ahora: luego }), 0)
})
