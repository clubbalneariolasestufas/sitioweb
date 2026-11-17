import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.QR_SIGNING_SECRET = 'x'.repeat(48)
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
const estado = (await import('../netlify/functions/estado.mjs')).default
const { calcularEstado } = await import('../netlify/functions/_lib/estado.mjs')
const { reintentarPendientes } = await import('../netlify/functions/_lib/loyverse.mjs')

let db
beforeEach(() => { db = crearDbFalsa(); setDbParaPruebas(db) })

const post = (handler, cuerpo, ip = '1.1.1.1') =>
    handler(new Request('http://x/api', { method: 'POST', body: JSON.stringify(cuerpo) }), { ip })

// Próxima fecha de visita que no sea miércoles
function fechaVisita(offset = 1) {
    for (let i = offset; i < offset + 10; i++) {
        const f = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10)
        if (diaSemana(f) !== 3) return f
    }
}
const base = () => ({ pase: 'dia', cantidad: 2, nombre: 'Ana Mora', telefono: '8850-9393', fechaVisita: fechaVisita() })

async function ordenPagada({ ultimos4 = '4821', comprobante = 'C-1', cuerpo = base() } = {}) {
    const r = await post(crear, cuerpo)
    const orden = await r.json()
    db.collection('pagos_sinpe').filas.push({ comprobante, ultimos4, monto: orden.total, fecha: new Date(), estado: 'libre' })
    const v = await post(verificarPago, { codigo: orden.codigo, ultimos4 })
    return { orden, v, datos: await v.json() }
}

test('crea la orden y calcula el monto en el servidor', async () => {
    const r = await post(crear, { ...base(), total: 1, precio: 1 })
    assert.equal(r.status, 201)
    const o = await r.json()
    assert.equal(o.total, 12000)
    assert.match(o.codigo, /^[A-Z2-9]{6}$/)
    const guardada = db.collection('ordenes').filas[0]
    assert.equal(guardada.telefono, '88509393')
    assert.ok(!('ip' in guardada), 'no se guarda la IP real')
})

test('rechaza datos inválidos', async () => {
    const miercoles = (() => { for (let i = 1; i < 10; i++) { const f = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10); if (diaSemana(f) === 3) return f } })()
    const casos = [
        { pase: 'vip' }, { cantidad: 0 }, { cantidad: 51 }, { cantidad: 1.5 },
        { fechaVisita: '2020-01-01' }, { fechaVisita: '2026-13-40' }, { fechaVisita: miercoles },
        { fechaVisita: '2099-01-01' }, { nombre: 'A' }, { telefono: '123' }, { correo: 'malo' }, { web: 'bot' }
    ]
    for (const c of casos) {
        const r = await post(crear, { ...base(), ...c })
        assert.equal(r.status, 400, JSON.stringify(c))
    }
    assert.equal(db.collection('ordenes').filas.length, 0)
})

test('limita órdenes por hora desde un mismo cliente', async () => {
    let ultimo
    for (let i = 0; i < 21; i++) ultimo = await post(crear, base(), '9.9.9.9')
    assert.equal(ultimo.status, 429)
    assert.equal((await post(crear, base(), '8.8.8.8')).status, 201)
})

test('pago correcto entrega boletos con QR y consume el pago', async () => {
    const { v, datos } = await ordenPagada()
    assert.equal(v.status, 200)
    assert.equal(datos.boletos.length, 2)
    assert.ok(datos.boletos[0].qr.startsWith('data:image/png;base64,'))
    assert.equal(db.collection('pagos_sinpe').filas[0].estado, 'usado')
    assert.equal(db.collection('ordenes').filas[0].estado, 'pagada')
    assert.equal(db.collection('boletos').filas.length, 2)
})

test('un mismo pago no sirve para dos órdenes', async () => {
    await ordenPagada()
    const o2 = await (await post(crear, base())).json()
    const r = await post(verificarPago, { codigo: o2.codigo, ultimos4: '4821' })
    assert.equal(r.status, 404)
})

test('no acepta monto distinto, dígitos distintos ni pagos viejos', async () => {
    const o = await (await post(crear, base())).json()
    const pagos = db.collection('pagos_sinpe').filas
    pagos.push({ comprobante: 'A', ultimos4: '1111', monto: o.total - 1, fecha: new Date(), estado: 'libre' })
    pagos.push({ comprobante: 'B', ultimos4: '2222', monto: o.total, fecha: new Date(), estado: 'libre' })
    pagos.push({ comprobante: 'C', ultimos4: '3333', monto: o.total, fecha: new Date(Date.now() - 3 * 3600_000), estado: 'libre' })
    for (const u of ['1111', '3333', '9999']) {
        const r = await post(verificarPago, { codigo: o.codigo, ultimos4: u })
        assert.equal(r.status, 404, u)
    }
    assert.ok(pagos.every(p => p.estado === 'libre'))
})

test('bloquea tras 5 intentos fallidos', async () => {
    const o = await (await post(crear, base())).json()
    for (let i = 0; i < 5; i++) assert.equal((await post(verificarPago, { codigo: o.codigo, ultimos4: '0000' })).status, 404)
    assert.equal((await post(verificarPago, { codigo: o.codigo, ultimos4: '0000' })).status, 429)
})

test('orden vencida responde 410', async () => {
    const o = await (await post(crear, base())).json()
    db.collection('ordenes').filas[0].venceEn = new Date(Date.now() - 1000)
    assert.equal((await post(verificarPago, { codigo: o.codigo, ultimos4: '4821' })).status, 410)
})

test('volver a consultar una orden pagada exige los mismos 4 dígitos', async () => {
    const { orden, datos } = await ordenPagada()
    const ok = await post(verificarPago, { codigo: orden.codigo, ultimos4: '4821' })
    assert.equal(ok.status, 200)
    assert.deepEqual((await ok.json()).boletos.map(b => b.id), datos.boletos.map(b => b.id))
    assert.equal(db.collection('boletos').filas.length, 2, 'no duplica boletos')
    assert.equal((await post(verificarPago, { codigo: orden.codigo, ultimos4: '0000' })).status, 403)
})

test('puerta: PIN, boleto válido, reutilizado, falso y de otra fecha', async () => {
    const { datos } = await ordenPagada()
    const boletos = db.collection('boletos').filas
    boletos.forEach(b => { b.fechaVisita = hoyCR() })
    const [b1, b2] = datos.boletos

    assert.equal((await post(validar, { pin: '000000', token: b1.token })).status, 401)

    const ok = await (await post(validar, { pin: '482913', token: b1.token })).json()
    assert.equal(ok.resultado, 'ok')
    const dos = await (await post(validar, { pin: '482913', token: b1.token })).json()
    assert.equal(dos.resultado, 'usado')

    const falso = await (await post(validar, { pin: '482913', token: b2.token.slice(0, -3) + 'abc' })).json()
    assert.equal(falso.resultado, 'falso')
    const basura = await (await post(validar, { pin: '482913', token: 'hola' })).json()
    assert.equal(basura.resultado, 'falso')

    boletos.find(b => b.id === b2.id).fechaVisita = '2030-01-01'
    const otra = await (await post(validar, { pin: '482913', token: b2.token })).json()
    assert.equal(otra.resultado, 'otra_fecha')
})

test('puerta: bloquea tras 10 PIN incorrectos', async () => {
    for (let i = 0; i < 10; i++) await post(validar, { pin: 'mal', token: 'x' }, '7.7.7.7')
    assert.equal((await post(validar, { pin: '482913', token: 'x' }, '7.7.7.7')).status, 429)
})

/* ---------- Panel del personal, grupos, Loyverse y semáforo ---------- */

const ponerHoy = () => {
    db.collection('boletos').filas.forEach(b => { b.fechaVisita = hoyCR() })
    db.collection('ordenes').filas.forEach(o => { o.fechaVisita = hoyCR() })
}

test('puerta: un escaneo puede dar ingreso a los acompañantes del grupo', async () => {
    const { datos } = await ordenPagada({ cuerpo: { ...base(), cantidad: 4 } })
    ponerHoy()
    const uno = await (await post(validar, { pin: '482913', token: datos.boletos[0].token })).json()
    assert.equal(uno.resultado, 'ok')
    assert.equal(uno.restantesGrupo, 3)
    const grupo = await (await post(validar, { pin: '482913', token: datos.boletos[0].token, grupo: true })).json()
    assert.equal(grupo.resultado, 'grupo')
    assert.equal(grupo.ingresados, 3)
    const otro = await (await post(validar, { pin: '482913', token: datos.boletos[2].token })).json()
    assert.equal(otro.resultado, 'usado')
})

test('panel: buscar por código y por teléfono, y dar ingreso sin QR', async () => {
    const { orden } = await ordenPagada()
    ponerHoy()
    const porCodigo = await (await post(panel, { pin: '482913', accion: 'buscar', texto: orden.codigo.toLowerCase() })).json()
    assert.equal(porCodigo.resultados[0].estado, 'pagada')
    const porTel = await (await post(panel, { pin: '482913', accion: 'buscar', texto: '9393' })).json()
    assert.equal(porTel.resultados.length, 1)
    assert.equal((await post(panel, { pin: '482913', accion: 'buscar', texto: 'x' })).status, 400)

    const ing = await (await post(panel, { pin: '482913', accion: 'ingresar', codigo: orden.codigo })).json()
    assert.equal(ing.ingresados, 2)
    const otra = await (await post(panel, { pin: '482913', accion: 'ingresar', codigo: orden.codigo })).json()
    assert.equal(otra.ingresados, 0)
})

test('panel: aprobar a mano exige PIN de administración y no repite comprobantes', async () => {
    const o1 = await (await post(crear, base())).json()
    assert.equal((await post(panel, { pin: '482913', accion: 'aprobar', codigo: o1.codigo, comprobante: '99887766' })).status, 403)
    assert.equal((await post(panel, { pin: 'malo', accion: 'aprobar', codigo: o1.codigo, comprobante: '99887766' })).status, 401)

    const ok = await post(panel, { pin: '771204', accion: 'aprobar', codigo: o1.codigo, comprobante: '99887766' })
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).boletos.length, 2)
    const guardada = db.collection('ordenes').filas[0]
    assert.equal(guardada.estado, 'pagada')
    assert.equal(guardada.aprobacion, 'manual')
    assert.equal(db.collection('pagos_sinpe').filas[0].estado, 'usado')

    const o2 = await (await post(crear, base())).json()
    assert.equal((await post(panel, { pin: '771204', accion: 'aprobar', codigo: o2.codigo, comprobante: '99887766' })).status, 409)

    // también sirve para una orden vencida, y el cliente puede recuperar boletos con los 4 dígitos
    db.collection('ordenes').filas[1].venceEn = new Date(Date.now() - 1000)
    assert.equal((await post(panel, { pin: '771204', accion: 'aprobar', codigo: o2.codigo, comprobante: '55443322' })).status, 200)
    assert.equal((await post(verificarPago, { codigo: o2.codigo, ultimos4: '3322' })).status, 200)
    assert.equal((await post(panel, { pin: '771204', accion: 'boletos', codigo: o2.codigo })).status, 200)
    assert.equal((await post(panel, { pin: '482913', accion: 'boletos', codigo: o2.codigo })).status, 403)
})

test('Loyverse: registra el recibo, reintenta si falla y no duplica', async () => {
    Object.assign(process.env, { LOYVERSE_TOKEN: 't', LOYVERSE_STORE_ID: 'tienda-1', LOYVERSE_PAYMENT_TYPE_ID: 'pago-1', LOYVERSE_VARIANT_DIA: 'var-dia' })
    const original = globalThis.fetch
    const llamadas = []
    let fallar = true
    globalThis.fetch = async (url, opciones = {}) => {
        llamadas.push({ url, cuerpo: opciones.body ? JSON.parse(opciones.body) : null })
        if (fallar) return new Response('caído', { status: 503 })
        return new Response(JSON.stringify({ receipt_number: '2-1001' }), { status: 200 })
    }
    try {
        const { v } = await ordenPagada()
        assert.equal(v.status, 200, 'el cliente recibe sus boletos aunque Loyverse falle')
        const orden = db.collection('ordenes').filas[0]
        assert.equal(orden.loyverseEstado, 'pendiente')

        const e = await calcularEstado(db, { conLoyverse: false })
        assert.equal(e.items.find(i => i.id === 'recibos').estado, 'amarillo')

        fallar = false
        const r = await reintentarPendientes(db)
        assert.equal(r.registrados, 1)
        assert.equal(orden.loyverseEstado, 'registrado')
        assert.equal(orden.loyverseRecibo, '2-1001')
        const cuerpo = llamadas.at(-1).cuerpo
        assert.equal(cuerpo.store_id, 'tienda-1')
        assert.deepEqual(cuerpo.line_items, [{ variant_id: 'var-dia', quantity: 2, price: 6000 }])
        assert.equal(cuerpo.payments[0].payment_type_id, 'pago-1')

        const antes = llamadas.length
        assert.equal((await reintentarPendientes(db)).reintentados, 0)
        assert.equal(llamadas.length, antes, 'no vuelve a enviar un recibo ya registrado')
    } finally {
        globalThis.fetch = original
        for (const k of ['LOYVERSE_TOKEN', 'LOYVERSE_STORE_ID', 'LOYVERSE_PAYMENT_TYPE_ID', 'LOYVERSE_VARIANT_DIA']) delete process.env[k]
    }
})

test('semáforo: detecta lector apagado, módem sin señal y todo en orden', async () => {
    const lector = db.collection('estado_sistema').filas
    let e = await calcularEstado(db)
    assert.equal(e.items.find(i => i.id === 'lector').estado, 'gris')

    lector.push({ _id: 'lector', en: new Date(Date.now() - 20 * 60000), modem: {}, correo: {} })
    e = await calcularEstado(db)
    assert.equal(e.global, 'rojo')
    assert.equal(e.items.find(i => i.id === 'lector').estado, 'rojo')

    Object.assign(lector[0], { en: new Date(), modem: { conectado: true, registrado: false, senal: 0 }, correo: { activo: true, conectado: true } })
    e = await calcularEstado(db)
    assert.equal(e.items.find(i => i.id === 'modem').estado, 'rojo')

    lector[0].modem = { conectado: true, registrado: true, senal: 20, operador: 'kolbi', ultimoSms: new Date() }
    e = await calcularEstado(db)
    assert.equal(e.items.find(i => i.id === 'modem').estado, 'verde')
    assert.equal(e.items.find(i => i.id === 'correo').estado, 'verde')
    assert.ok(e.items.every(i => i.estado !== 'rojo'))

    const r = await post(estado, { pin: '482913' })
    assert.equal(r.status, 200)
    assert.equal((await r.json()).rol, 'puerta')
    assert.equal((await post(estado, { pin: 'nada' })).status, 401)
})

/* ---------- Pago reconocido por el código escrito en la descripción del SINPE ---------- */

test('pago por código en la descripción: sin dígitos, una sola vez y con el monto exacto', async () => {
    const o = await (await post(crear, base())).json()
    const pagos = db.collection('pagos_sinpe').filas
    // todavía no llega: el sitio sigue esperando y no gasta intentos
    const espera = await post(verificarPago, { codigo: o.codigo })
    assert.equal(espera.status, 404)
    assert.equal((await espera.json()).esperando, true)
    assert.equal(db.collection('ordenes').filas[0].intentos, 0)

    // llega con el código pero por otro monto: no entrega boletos
    pagos.push({ comprobante: 'X1', ultimos4: '0001', monto: o.total - 1000, fecha: new Date(), estado: 'libre', codigoOrden: o.codigo })
    assert.equal((await post(verificarPago, { codigo: o.codigo })).status, 409)
    assert.equal(db.collection('ordenes').filas[0].estado, 'pendiente')
    pagos.length = 0

    // un pago del mismo monto con el código de OTRA orden no sirve
    pagos.push({ comprobante: 'X2', ultimos4: '0002', monto: o.total, fecha: new Date(), estado: 'libre', codigoOrden: 'ZZZZZZ' })
    assert.equal((await post(verificarPago, { codigo: o.codigo })).status, 404)

    // llega el correcto
    pagos.push({ comprobante: 'X3', ultimos4: '0777', monto: o.total, fecha: new Date(), estado: 'libre', codigoOrden: o.codigo })
    const r = await post(verificarPago, { codigo: o.codigo })
    assert.equal(r.status, 200)
    assert.equal((await r.json()).boletos.length, 2)
    assert.equal(pagos.find(p => p.comprobante === 'X3').estado, 'usado')
    assert.equal(pagos.find(p => p.comprobante === 'X2').estado, 'libre')

    // ya pagada: para volver a ver los boletos hacen falta los 4 dígitos del comprobante
    assert.equal((await post(verificarPago, { codigo: o.codigo })).status, 403)
    assert.equal((await post(verificarPago, { codigo: o.codigo, ultimos4: '0000' })).status, 403)
    assert.equal((await post(verificarPago, { codigo: o.codigo, ultimos4: '0777' })).status, 200)
})
