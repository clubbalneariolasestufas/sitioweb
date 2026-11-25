// Bot de Telegram de tareas de eventos (con la API de Telegram simulada)
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

Object.assign(process.env, { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '-1001', TELEGRAM_WEBHOOK_SECRET: 'secreto-de-prueba-123' })
const { setDbParaPruebas } = await import('../netlify/functions/_lib/db.mjs')
const { crearDbFalsa } = await import('./fake-db.mjs')
const { hoyCR } = await import('../netlify/functions/_lib/fechas.mjs')
const { procesarUpdate, avisosTelegram, avisarCambioEvento } = await import('../netlify/functions/_lib/telegram.mjs')
const webhook = (await import('../netlify/functions/telegram.mjs')).default

let db, enviados, original
const sumar = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
beforeEach(() => {
    db = crearDbFalsa(); setDbParaPruebas(db); enviados = []
    original = globalThis.fetch
    globalThis.fetch = async (url, op) => {
        enviados.push({ metodo: url.split('/').pop(), ...JSON.parse(op.body) })
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))
    }
})
afterEach(() => { globalThis.fetch = original })

// Cumpleaños de 60 personas en el salón, con decoración y comida, dentro de 1 día
const evento = (extra = {}) => {
    const c = { codigo: 'COT-2026-001', estado: 'reservada', tipoEvento: 'Cumpleaños', nombre: 'Familia Rojas', fechaEvento: sumar(hoyCR(), 1),
        calculo: { personas: 60 }, seleccion: { menu: 'comida', areas: ['techada'], extras: ['decoracion'] }, tareasHechas: [], ...extra }
    db.collection('cotizaciones').filas.push(c)
    return c
}
const grupo = { id: -1001 }

test('/hoy manda cada tarea pendiente con su botón «Hecha»; incluye las atrasadas', async () => {
    evento()
    assert.equal(await procesarUpdate(db, { message: { chat: grupo, text: '/hoy' } }), 'lista')
    const tareas = enviados.filter(m => m.reply_markup)
    // Hoy (víspera): lavar el salón; atrasadas: decoración (−5), confirmaciones, platillos y rótulo (−3), pagos (−2), cocina (−7)
    const textos = tareas.map(m => m.text).join('\n')
    assert.match(textos, /Lavar el salón/)
    assert.match(textos, /Rotulación de cumpleaños/)
    assert.match(textos, /ATRASADA/)
    assert.equal(tareas[0].reply_markup.inline_keyboard[0][0].text, '✅ Hecha')
    assert.ok(!textos.includes('Secar y acomodar sillas'), 'las sillas son de mañana')
})

test('el botón «Hecha» marca la tarea en el evento (igual que el panel), dice quién y se puede deshacer', async () => {
    evento()
    const q = (data) => ({ callback_query: { id: 'q1', data, from: { first_name: 'Alejandro' }, message: { message_id: 7, chat: grupo } } })
    assert.equal(await procesarUpdate(db, q('h|COT-2026-001|salon')), 'hecha')
    const c = db.collection('cotizaciones').filas[0]
    assert.deepEqual(c.tareasHechas, ['salon'])
    assert.equal(c.tareasRegistro[0].por, 'Alejandro')
    const editado = enviados.find(m => m.metodo === 'editMessageText')
    assert.match(editado.text, /✅ Hecha por Alejandro a las \d\d:\d\d/)
    assert.equal(editado.reply_markup.inline_keyboard[0][0].callback_data, 'u|COT-2026-001|salon')
    assert.equal(await procesarUpdate(db, q('u|COT-2026-001|salon')), 'deshecha')
    assert.deepEqual(c.tareasHechas, [])
    assert.equal(await procesarUpdate(db, q('h|COT-2026-001|inventada')), 'sin-tarea')
})

test('solo el grupo del personal: otros chats no ven tareas ni marcan; /id sí responde', async () => {
    evento()
    assert.equal(await procesarUpdate(db, { message: { chat: { id: 555 }, text: '/hoy' } }), 'no-autorizado')
    assert.ok(!enviados.some(m => m.reply_markup))
    assert.equal(await procesarUpdate(db, { callback_query: { id: 'x', data: 'h|COT-2026-001|salon', from: {}, message: { message_id: 1, chat: { id: 555 } } } }), 'no-autorizado')
    assert.deepEqual(db.collection('cotizaciones').filas[0].tareasHechas, [])
    assert.equal(await procesarUpdate(db, { message: { chat: { id: 555 }, text: '/id' } }), 'id')
    assert.match(enviados.at(-1).text, /555/)
})

test('webhook: sin el encabezado secreto responde 401 y no hace nada', async () => {
    const pedir = h => webhook(new Request('http://x/api/telegram', { method: 'POST', headers: h, body: JSON.stringify({ message: { chat: grupo, text: '/ayuda' } }) }))
    assert.equal((await pedir({})).status, 401)
    assert.equal((await pedir({ 'x-telegram-bot-api-secret-token': 'otro-secreto-de-prueba' })).status, 401)
    assert.equal(enviados.length, 0)
    assert.equal((await pedir({ 'x-telegram-bot-api-secret-token': 'secreto-de-prueba-123' })).status, 200)
    assert.match(enviados[0].text, /Bot de tareas/)
})

test('resumen de la mañana una sola vez al día; recordatorio de la tarde solo si queda algo', async () => {
    evento()
    const hoy = hoyCR()
    const a = h => new Date(`${hoy}T${h}:00-06:00`)
    assert.deepEqual((await avisosTelegram(db, a('05:30'))).hechos, [])
    assert.deepEqual((await avisosTelegram(db, a('06:30'))).hechos, ['manana'])
    const n = enviados.length
    assert.match(enviados[0].text, /Buenos días/)
    assert.deepEqual((await avisosTelegram(db, a('07:00'))).hechos, [], 'no se repite')
    assert.equal(enviados.length, n)
    assert.deepEqual((await avisosTelegram(db, a('15:30'))).hechos, ['tarde'])
    assert.match(enviados.at(-1).text, /Quedan \d+ tarea/)
})

test('/semana y /evento; aviso al grupo cuando un evento queda reservado', async () => {
    const c = evento()
    assert.equal(await procesarUpdate(db, { message: { chat: grupo, text: '/semana' } }), 'semana')
    assert.match(enviados.at(-1).text, /Secar y acomodar sillas/)
    assert.equal(await procesarUpdate(db, { message: { chat: grupo, text: '/evento cot-2026-001' } }), 'evento')
    assert.equal(await procesarUpdate(db, { message: { chat: grupo, text: '/evento COT-2026-999' } }), 'sin-evento')
    assert.equal(await avisarCambioEvento(c), true)
    assert.match(enviados.at(-1).text, /Evento reservada|Evento reservado|reservada/i)
    assert.equal(await avisarCambioEvento({ ...c, estado: 'solicitada' }), false)
})
