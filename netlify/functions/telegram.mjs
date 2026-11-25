import { timingSafeEqual } from 'node:crypto'
import { getDb } from './_lib/db.mjs'
import { procesarUpdate, telegramConfigurado } from './_lib/telegram.mjs'

// POST /api/telegram — Telegram llama aquí con cada mensaje o botón del grupo del personal (webhook).
// Solo se acepta si trae el encabezado secreto que se registró con setWebhook.
export default async req => {
    if (req.method !== 'POST' || !telegramConfigurado()) return new Response('no', { status: 404 })
    const secreto = process.env.TELEGRAM_WEBHOOK_SECRET || ''
    const recibido = req.headers.get('x-telegram-bot-api-secret-token') || ''
    if (!secreto || recibido.length !== secreto.length || !timingSafeEqual(Buffer.from(recibido), Buffer.from(secreto)))
        return new Response('no', { status: 401 })
    let u
    try { u = await req.json() } catch { return new Response('ok') }
    try { await procesarUpdate(await getDb(), u) } catch (e) { console.error('Telegram:', e.message) }
    // Siempre 200: si no, Telegram reintenta el mismo aviso una y otra vez
    return new Response('ok')
}

export const config = { path: '/api/telegram' }
