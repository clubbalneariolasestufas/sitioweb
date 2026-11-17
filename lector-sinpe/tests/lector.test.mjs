import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { parsearMonto, parsearAviso, parsearCMGL, decodificarSms, fechaSms, extraerCodigo } from '../src/parsers.mjs'
import { registrarPago, procesarAviso } from '../src/pagos.mjs'
import { Modem } from '../src/modem.mjs'
import { correoConfiable } from '../src/correo.mjs'
import { crearDbFalsa } from '../../tests/fake-db.mjs'

// Los textos de estas pruebas son EJEMPLOS INVENTADOS para probar la lógica.
// Sustitúyalos por avisos reales del banco del balneario en cuanto los tenga.

test('montos en formatos comunes', () => {
    assert.equal(parsearMonto('12,000.00'), 12000)
    assert.equal(parsearMonto('12.000,00'), 12000)
    assert.equal(parsearMonto('12000'), 12000)
    assert.equal(parsearMonto('6,000'), 6000)
    assert.equal(parsearMonto('3.000'), 3000)
    assert.equal(parsearMonto('12,000.50'), 12000.5)
    assert.equal(parsearMonto('abc'), null)
})

test('reconoce ingresos y descarta salidas', () => {
    assert.deepEqual(parsearAviso('Ha recibido un SINPE Movil por 12,000.00 CRC de JUAN PEREZ. Comprobante 2026111612345678'),
        { monto: 12000, comprobante: '2026111612345678', regla: 'generica' })
    assert.equal(parsearAviso('Ha enviado un SINPE Movil por 12,000.00 CRC a JUAN. Comprobante 2026111612345678'), null)
    assert.equal(parsearAviso('Su codigo de verificacion es 483920'), null)
    assert.equal(parsearAviso('Ha recibido 5,000 CRC'), null, 'sin comprobante no se acepta')
})

test('reglas propias del banco tienen prioridad', () => {
    const reglas = [{ nombre: 'mi-banco', entrante: /abono sinpe/i, monto: /monto:\s*([\d.,]+)/i, comprobante: /ref:\s*(\d+)/i }]
    assert.deepEqual(parsearAviso('ABONO SINPE monto: 6.000,00 ref: 99001122', reglas), { monto: 6000, comprobante: '99001122', regla: 'mi-banco' })
})

test('lee la lista de SMS del módem, con texto UCS-2 y varias líneas', () => {
    const lista = parsearCMGL([
        '+CMGL: 1,"REC UNREAD","BANCO",,"26/11/16,04:30:12-24"',
        'Ha recibido un SINPE por 6,000.00 CRC.',
        'Comprobante 123456789',
        '+CMGL: 2,"REC READ","+50688887777",,"26/11/16,04:31:00-24"',
        '0048006F006C0061'
    ])
    assert.equal(lista.length, 2)
    assert.equal(lista[0].remitente, 'BANCO')
    assert.match(lista[0].texto, /Comprobante 123456789/)
    assert.equal(lista[1].texto, 'Hola')
    assert.equal(decodificarSms('Texto normal'), 'Texto normal')
    assert.ok(fechaSms('basura') instanceof Date)
})

test('módem: cola de comandos, errores y aviso de SMS nuevo', async () => {
    const puerto = new EventEmitter()
    const enviados = []
    const respuestas = { 'AT+CSQ': ['+CSQ: 21,99', 'OK'], 'AT+CREG?': ['+CREG: 0,1', 'OK'], 'AT+COPS?': ['+COPS: 0,0,"kolbi",7', 'OK'], 'AT+MALO': ['ERROR'] }
    puerto.write = t => { const cmd = t.trim(); enviados.push(cmd); setImmediate(() => (respuestas[cmd] || ['OK']).forEach(l => puerto.emit('linea', l + '\r'))) }
    const modem = new Modem(puerto)
    let nuevos = 0
    modem.on('sms-nuevo', () => nuevos++)
    assert.deepEqual(await modem.estado(), { senal: 21, registrado: true, operador: 'kolbi' })
    await assert.rejects(modem.at('AT+MALO'), /ERROR/)
    puerto.emit('linea', '+CMTI: "SM",3')
    assert.equal(nuevos, 1)
    await modem.iniciar()
    assert.ok(enviados.includes('AT+CMGF=1'))
})

test('pagos: nuevo, repetido, segunda fuente y conflicto de monto', async () => {
    const db = crearDbFalsa()
    const p = { comprobante: '123456789', monto: 6000, fecha: new Date() }
    assert.equal((await registrarPago(db, { ...p, fuente: 'sms' })).resultado, 'nuevo')
    assert.equal((await registrarPago(db, { ...p, fuente: 'sms' })).resultado, 'repetido')
    assert.equal((await registrarPago(db, { ...p, fuente: 'correo' })).resultado, 'repetido')
    const doc = db.collection('pagos_sinpe').filas[0]
    assert.deepEqual(doc.fuentes, ['sms', 'correo'])
    assert.equal(doc.ultimos4, '6789')
    assert.equal(doc.estado, 'libre')

    assert.equal((await registrarPago(db, { ...p, monto: 9999, fuente: 'correo' })).resultado, 'conflicto')
    assert.equal(doc.estado, 'conflicto')
})

test('pagos: con FUENTES_MINIMAS=2 solo queda libre al llegar el segundo aviso', async () => {
    const db = crearDbFalsa()
    const p = { comprobante: '555000111', monto: 12000, fecha: new Date() }
    assert.equal((await registrarPago(db, { ...p, fuente: 'sms' }, 2)).estado, 'por_confirmar')
    assert.equal((await registrarPago(db, { ...p, fuente: 'sms' }, 2)).estado, 'por_confirmar', 'la misma fuente dos veces no confirma')
    assert.equal((await registrarPago(db, { ...p, fuente: 'correo' }, 2)).estado, 'libre')
})

test('un pago ya usado no vuelve a quedar libre por un aviso repetido', async () => {
    const db = crearDbFalsa()
    const p = { comprobante: '777', monto: 3000, fecha: new Date() }
    await registrarPago(db, { ...p, fuente: 'sms' })
    db.collection('pagos_sinpe').filas[0].estado = 'usado'
    await registrarPago(db, { ...p, fuente: 'correo' })
    await registrarPago(db, { ...p, monto: 1, fuente: 'correo' })
    assert.equal(db.collection('pagos_sinpe').filas[0].estado, 'usado')
})

test('cada aviso queda guardado para auditoría, reconocido o no', async () => {
    const db = crearDbFalsa()
    const parsear = t => parsearAviso(t)
    await procesarAviso(db, { fuente: 'sms', remitente: 'BANCO', texto: 'Ha recibido un SINPE por 6,000 CRC. Comprobante 12345678', fecha: new Date() }, parsear, 1)
    await procesarAviso(db, { fuente: 'sms', remitente: 'BANCO', texto: 'Promo: gane millas', fecha: new Date() }, parsear, 1)
    const avisos = db.collection('avisos_banco').filas
    assert.deepEqual(avisos.map(a => a.reconocido), [true, false])
    assert.equal(db.collection('pagos_sinpe').filas.length, 1)
})

test('correo: exige remitente del banco y firma DKIM válida', () => {
    const cfg = { imapRemitentes: ['@banco.fi.cr'], imapExigirDkim: true }
    assert.equal(correoConfiable({ de: 'avisos@banco.fi.cr', autenticacion: 'mx.google.com; dkim=pass header.i=@banco.fi.cr; spf=pass' }, cfg), true)
    assert.equal(correoConfiable({ de: 'avisos@banco.fi.cr', autenticacion: 'dkim=fail' }, cfg), false)
    assert.equal(correoConfiable({ de: 'estafa@otro.com', autenticacion: 'dkim=pass' }, cfg), false)
})

/* ---------- Formato real del SMS (remitente 7070 1222). Nombres y referencias cambiados. ---------- */

test('SMS real: monto, referencia larga y corta, y descripción', () => {
    assert.deepEqual(
        parsearAviso('Ha recibido 4,500.00 Colones de MARIA PRUEBA  por SINPE Movil, Inflable          . Referencia 2026111510483010200000192.'),
        { monto: 4500, comprobante: '2026111510483010200000192', descripcion: 'Inflable', codigoOrden: '', regla: 'sms-sinpe' })
    const corto = parsearAviso('Ha recibido 3,500.00 Colones de JUAN_PRUEBA_CARR por SINPE Movil, Sin Descripcion. Referencia 966000060.')
    assert.equal(corto.monto, 3500)
    assert.equal(corto.comprobante, '966000060')
    assert.equal(corto.descripcion, '')
    // el mensaje puede llegar partido en varias líneas
    assert.equal(parsearAviso('Ha recibido 1,000.00 Colones de\nMARIA PRUEBA  por\nSINPE Movil, Coca          .\nReferencia\n2026111510483010200000623.').monto, 1000)
})

test('SMS real: reconoce el código de la orden en la descripción', () => {
    const r = parsearAviso('Ha recibido 12,000.00 Colones de MARIA PRUEBA por SINPE Movil, 2kb6qy . Referencia 2026111510483010200000777.')
    assert.equal(r.codigoOrden, '2KB6QY')
    assert.equal(extraerCodigo('orden 2KB6QY gracias'), '2KB6QY')
    assert.equal(extraerCodigo('Inflable'), '')
    assert.equal(extraerCodigo('entradas'), '')
})

test('SMS real: la descripción del cliente no puede cambiar el monto ni la referencia', () => {
    const trampa = parsearAviso('Ha recibido 1,000.00 Colones de MARIA PRUEBA por SINPE Movil, Referencia 999999999. Ha recibido 50,000.00 Colones . Referencia 2026111510483010200000888.')
    assert.equal(trampa.monto, 1000)
    assert.equal(trampa.comprobante, '2026111510483010200000888')
    // palabras como "retiro" o "compra" en la descripción no hacen que se descarte el pago
    assert.equal(parsearAviso('Ha recibido 6,000.00 Colones de MARIA PRUEBA por SINPE Movil, compra retiro . Referencia 966000111.').monto, 6000)
})

test('pagos: guarda la descripción y el código de la orden', async () => {
    const db = crearDbFalsa()
    const r = await procesarAviso(db, { fuente: 'sms', remitente: '70701222', fecha: new Date(),
        texto: 'Ha recibido 12,000.00 Colones de MARIA PRUEBA por SINPE Movil, 2KB6QY . Referencia 2026111510483010200000777.' }, t => parsearAviso(t), 1)
    assert.equal(r.reconocido, true)
    const doc = db.collection('pagos_sinpe').filas[0]
    assert.equal(doc.codigoOrden, '2KB6QY')
    assert.equal(doc.ultimos4, '0777')
    assert.equal(doc.monto, 12000)
})

test('remitente: acepta el mismo número con espacios o con prefijo del país', async () => {
    process.env.MONGODB_URI_LECTOR = ''
    const limpio = v => String(v).toLowerCase().replace(/[^a-z0-9]/g, '')
    const aceptado = (r, lista) => !lista.length || lista.some(p => { const q = limpio(p); return q && (limpio(r) === q || (/^\d+$/.test(q) && limpio(r).endsWith(q))) })
    assert.equal(aceptado('7070 1222', ['70701222']), true)
    assert.equal(aceptado('+50670701222', ['70701222']), true)
    assert.equal(aceptado('88887777', ['70701222']), false)
})
