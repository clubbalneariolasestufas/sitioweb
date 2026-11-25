// Bot de Telegram para el seguimiento de las tareas de los eventos.
// Usa la misma lista de tareas que el panel de eventos y el calendario (tareasDe en precios-eventos.js):
// marcar «Hecha» en Telegram es lo mismo que marcarla en el panel.
//
// Variables: TELEGRAM_BOT_TOKEN (de @BotFather), TELEGRAM_CHAT_ID (el grupo del personal)
// y TELEGRAM_WEBHOOK_SECRET (texto aleatorio; Telegram lo manda en cada aviso al sitio).
import { tareasDe, PLANTILLA_TAREAS, ESTADOS, nombreArea } from '../../../src/js/precios-eventos.js'
import { hoyCR } from './fechas.mjs'

const FIRMES = ['reservada', 'confirmada']
export const telegramConfigurado = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const sumar = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']
const fechaLarga = iso => { const d = new Date(iso + 'T12:00:00Z'); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}` }
const horaCR = (ahora = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit', hour12: false }).format(ahora)

export async function telegram(metodo, cuerpo) {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(7000)
    })
    const d = await r.json().catch(() => ({}))
    if (!d.ok) throw new Error(`Telegram ${metodo}: ${d.description || r.status}`)
    return d.result
}
const enviar = (texto, botones, chat = process.env.TELEGRAM_CHAT_ID) => telegram('sendMessage', {
    chat_id: chat, text: texto, parse_mode: 'HTML', disable_web_page_preview: true, ...(botones ? { reply_markup: { inline_keyboard: botones } } : {})
})

// Tareas pendientes de eventos firmes entre dos fechas (incluye atrasadas si desde es anterior a hoy)
export async function tareasEntre(db, desde, hasta) {
    const eventos = await db.collection('cotizaciones').find({ estado: { $in: FIRMES }, fechaEvento: { $gte: desde, $lte: sumar(hasta, 10) } }).toArray()
    const lista = []
    for (const c of eventos) for (const t of tareasDe(c)) if (t.fecha >= desde && t.fecha <= hasta) lista.push({ c, t })
    return lista.sort((a, b) => a.t.fecha.localeCompare(b.t.fecha) || a.c.codigo.localeCompare(b.c.codigo))
}

export function textoTarea(c, t, hoy) {
    const marca = t.hecha ? '✅' : t.fecha < hoy ? '⚠️ ATRASADA ·' : t.fecha === hoy ? '📌' : '🗓'
    return [
        `${marca} <b>${esc(t.texto)}</b>`,
        `Encargado: ${esc(t.encargado)} · para el ${esc(fechaLarga(t.fecha))}`,
        `Evento ${esc(c.codigo)}: ${esc(c.tipoEvento || 'Evento')} de ${esc(c.nombre)}, ${esc(fechaLarga(c.fechaEvento))}, ${c.calculo?.personas ?? '?'} personas`
    ].join('\n')
}
const botonesTarea = (c, t) => t.hecha
    ? [[{ text: '↩️ Deshacer', callback_data: `u|${c.codigo}|${t.id}` }]]
    : [[{ text: '✅ Hecha', callback_data: `h|${c.codigo}|${t.id}` }]]

async function enviarTareas(lista, hoy) {
    for (const { c, t } of lista) await enviar(textoTarea(c, t, hoy), botonesTarea(c, t))
}

// Tarea programada (cada 30 min): resumen de la mañana (desde las 6:00) y recordatorio de la tarde (desde las 15:00).
// Cada uno sale una sola vez al día.
export async function avisosTelegram(db, ahora = new Date()) {
    if (!telegramConfigurado()) return { omitido: true }
    const hoy = hoyCR(ahora), hora = horaCR(ahora)
    const col = db.collection('estado_sistema')
    const marca = (await col.findOne({ _id: 'telegram' })) || {}
    const hechos = []
    if (hora >= '06:00' && marca.manana !== hoy) {
        await col.updateOne({ _id: 'telegram' }, { $set: { manana: hoy } }, { upsert: true })
        const lista = (await tareasEntre(db, sumar(hoy, -7), hoy)).filter(x => !x.t.hecha)
        const manana = (await tareasEntre(db, sumar(hoy, 1), sumar(hoy, 1))).filter(x => !x.t.hecha)
        const eventosHoy = await db.collection('cotizaciones').find({ estado: { $in: FIRMES }, fechaEvento: hoy }).toArray()
        await enviar([
            `☀️ <b>Buenos días. Tareas del ${esc(fechaLarga(hoy))}</b>`,
            eventosHoy.length ? `Eventos hoy: ${eventosHoy.map(c => `${esc(c.tipoEvento)} de ${esc(c.nombre)} (${c.calculo?.personas ?? '?'} p.)`).join('; ')}` : 'Hoy no hay eventos.',
            lista.length ? `Pendientes: ${lista.length}${lista.some(x => x.t.fecha < hoy) ? ' (hay atrasadas)' : ''}. Toque «✅ Hecha» al terminar cada una.` : 'No hay tareas pendientes para hoy.',
            manana.length ? `Mañana: ${manana.length} tarea(s).` : ''
        ].filter(Boolean).join('\n'))
        await enviarTareas(lista, hoy)
        hechos.push('manana')
    }
    if (hora >= '15:00' && marca.tarde !== hoy) {
        await col.updateOne({ _id: 'telegram' }, { $set: { tarde: hoy } }, { upsert: true })
        const quedan = (await tareasEntre(db, sumar(hoy, -7), hoy)).filter(x => !x.t.hecha)
        if (quedan.length) {
            await enviar(`⏰ <b>Quedan ${quedan.length} tarea(s) de hoy sin marcar</b>\n` + quedan.map(({ c, t }) => `• ${esc(t.texto)} (${esc(t.encargado)}, ${esc(c.codigo)})`).join('\n') + '\nUse /hoy para marcarlas.')
            hechos.push('tarde')
        }
    }
    return { hechos }
}

// Aviso al grupo cuando un evento cambia de estado (reservado, confirmado, cancelado)
export async function avisarCambioEvento(c) {
    if (!telegramConfigurado() || !['reservada', 'confirmada', 'cancelada'].includes(c.estado)) return false
    const tareas = tareasDe(c)
    const texto = c.estado === 'cancelada'
        ? `❌ <b>Evento cancelado</b>: ${esc(c.codigo)} · ${esc(c.nombre)} · ${esc(fechaLarga(c.fechaEvento))}. Sus tareas ya no aparecen.`
        : [`📅 <b>${c.estado === 'reservada' ? 'Evento reservado (adelanto pagado)' : 'Evento confirmado (cantidad final)'}</b>: ${esc(c.tipoEvento)} de ${esc(c.nombre)}`,
            `${esc(fechaLarga(c.fechaEvento))} · ${c.calculo?.personas ?? '?'} personas · ${esc((c.seleccion?.areas || []).map(nombreArea).join(', ') || 'sin áreas')}`,
            `Tareas programadas: ${tareas.length}. Primera: ${esc(tareas[0]?.texto || '-')} (${esc(tareas[0] ? fechaLarga(tareas[0].fecha) : '-')}).`,
            `Vea todas con /evento ${esc(c.codigo)}`].join('\n')
    try { await enviar(texto); return true } catch (e) { console.error(e.message); return false }
}

// Marca o desmarca una tarea (desde Telegram) y deja registro de quién y cuándo
export async function marcarTarea(db, codigo, tareaId, hecha, por) {
    if (!PLANTILLA_TAREAS.some(t => t.id === tareaId)) return null
    const col = db.collection('cotizaciones')
    const upd = hecha ? { $addToSet: { tareasHechas: tareaId } } : { $pull: { tareasHechas: tareaId } }
    await col.updateOne({ codigo }, { ...upd, $push: { tareasRegistro: { tarea: tareaId, hecha, por, via: 'telegram', en: new Date() } } })
    const c = await col.findOne({ codigo })
    if (!c) return null
    return { c, t: tareasDe(c).find(t => t.id === tareaId) }
}

const AYUDA = [
    '<b>Bot de tareas · Club Las Estufas</b>',
    '/hoy — tareas de hoy y atrasadas, con botón «Hecha»',
    '/manana — tareas de mañana',
    '/semana — resumen de los próximos 7 días',
    '/evento COT-2026-001 — todas las tareas de un evento',
    '/id — número de este chat (para configurar)',
    'Cada mañana a las 6:00 llega el resumen y a las 15:00 el recordatorio de lo que falta.'
].join('\n')

// Procesa un aviso de Telegram (mensaje o toque de botón). Devuelve lo que hizo, para las pruebas.
export async function procesarUpdate(db, u, ahora = new Date()) {
    const autorizado = chat => String(chat) === String(process.env.TELEGRAM_CHAT_ID)
    const hoy = hoyCR(ahora)

    if (u.callback_query) {
        const q = u.callback_query
        if (!autorizado(q.message?.chat?.id)) { await telegram('answerCallbackQuery', { callback_query_id: q.id, text: 'Chat no autorizado' }); return 'no-autorizado' }
        const [accion, codigo, tareaId] = String(q.data || '').split('|')
        const por = [q.from?.first_name, q.from?.last_name].filter(Boolean).join(' ') || q.from?.username || 'Alguien'
        const r = await marcarTarea(db, codigo, tareaId, accion === 'h', por)
        if (!r?.t) { await telegram('answerCallbackQuery', { callback_query_id: q.id, text: 'Esa tarea ya no existe' }); return 'sin-tarea' }
        const pie = r.t.hecha ? `\n✅ Hecha por ${esc(por)} a las ${horaCR(ahora)}` : `\n↩️ Desmarcada por ${esc(por)} a las ${horaCR(ahora)}`
        await telegram('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: textoTarea(r.c, r.t, hoy) + pie, parse_mode: 'HTML', reply_markup: { inline_keyboard: botonesTarea(r.c, r.t) } })
        await telegram('answerCallbackQuery', { callback_query_id: q.id, text: r.t.hecha ? '¡Listo, gracias!' : 'Desmarcada' })
        return r.t.hecha ? 'hecha' : 'deshecha'
    }

    const m = u.message
    if (!m?.text) return 'ignorado'
    const [comando, ...args] = m.text.trim().split(/\s+/)
    const cmd = comando.toLowerCase().replace(/@.*$/, '')
    if (cmd === '/id') { await enviar(`El número de este chat es <code>${esc(m.chat.id)}</code>.`, null, m.chat.id); return 'id' }
    if (!autorizado(m.chat.id)) { await enviar('Este chat no está autorizado. Use /id y pida al técnico que lo configure.', null, m.chat.id); return 'no-autorizado' }

    if (cmd === '/hoy' || cmd === '/manana' || cmd === '/mañana') {
        const dia = cmd === '/hoy' ? hoy : sumar(hoy, 1)
        const lista = (await tareasEntre(db, cmd === '/hoy' ? sumar(hoy, -7) : dia, dia)).filter(x => !x.t.hecha)
        if (!lista.length) { await enviar(`No hay tareas pendientes para ${cmd === '/hoy' ? 'hoy' : 'mañana'}. 👍`); return 'vacio' }
        await enviar(`<b>${lista.length} tarea(s) pendiente(s) · ${esc(fechaLarga(dia))}</b>`)
        await enviarTareas(lista, hoy)
        return 'lista'
    }
    if (cmd === '/semana') {
        const lista = await tareasEntre(db, hoy, sumar(hoy, 6))
        if (!lista.length) { await enviar('Sin tareas en los próximos 7 días.'); return 'vacio' }
        const porDia = {}
        for (const x of lista) (porDia[x.t.fecha] ??= []).push(x)
        await enviar('<b>Próximos 7 días</b>\n' + Object.entries(porDia).map(([f, xs]) =>
            `\n<b>${esc(fechaLarga(f))}</b>\n` + xs.map(({ c, t }) => `${t.hecha ? '✅' : '•'} ${esc(t.texto)} (${esc(t.encargado)}, ${esc(c.codigo)})`).join('\n')).join('\n'))
        return 'semana'
    }
    if (cmd === '/evento') {
        const codigo = String(args[0] || '').toUpperCase()
        const c = await db.collection('cotizaciones').findOne({ codigo })
        if (!c) { await enviar('No encontré ese evento. Ejemplo: /evento COT-2026-001'); return 'sin-evento' }
        await enviar(`<b>${esc(c.codigo)} · ${esc(c.tipoEvento)} de ${esc(c.nombre)}</b>\n${esc(fechaLarga(c.fechaEvento))} · ${esc(ESTADOS[c.estado]?.nombre || c.estado)}`)
        await enviarTareas(tareasDe(c).map(t => ({ c, t })), hoy)
        return 'evento'
    }
    await enviar(AYUDA)
    return 'ayuda'
}
