// Registra el bot de tareas: dirección del sitio (webhook), secreto y menú de comandos.
// Uso, una sola vez y cada vez que cambie la dirección del sitio:
//   node --env-file=.env scripts/telegram-configurar.mjs
// Necesita en .env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET y SITE_URL (las mismas que en Netlify).
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secreto } = process.env
const sitio = (process.env.SITE_URL || '').replace(/\/+$/, '')
if (!token || !secreto || !sitio) { console.error('Faltan TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET o SITE_URL en .env'); process.exit(1) }
if (!/^[A-Za-z0-9_-]{16,256}$/.test(secreto)) { console.error('TELEGRAM_WEBHOOK_SECRET debe tener de 16 a 256 letras, números, - o _'); process.exit(1) }
const api = async (metodo, cuerpo) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
    const d = await r.json()
    console.log(`${metodo}: ${d.ok ? 'OK' : 'ERROR ' + d.description}`)
    return d
}
const yo = await api('getMe', {})
if (yo.ok) console.log(`Bot: @${yo.result.username}`)
await api('setWebhook', { url: sitio.replace(/\/$/, '') + '/api/telegram', secret_token: secreto, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true })
await api('setMyCommands', { commands: [
    { command: 'hoy', description: 'Tareas de hoy y atrasadas' },
    { command: 'manana', description: 'Tareas de mañana' },
    { command: 'semana', description: 'Resumen de los próximos 7 días' },
    { command: 'evento', description: 'Tareas de un evento: /evento COT-2026-001' },
    { command: 'id', description: 'Número de este chat' },
    { command: 'ayuda', description: 'Qué hace el bot' }
] })
const info = await api('getWebhookInfo', {})
if (info.ok) console.log(`Webhook: ${info.result.url} · pendientes: ${info.result.pending_update_count}${info.result.last_error_message ? ' · último error: ' + info.result.last_error_message : ''}`)
