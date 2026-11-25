import { createHash } from 'node:crypto'

// Revisión de las variables de entorno SIN mostrar sus valores.
// Para cada variable dice si existe, si tiene el formato esperado y una «huella»
// (primeros 8 caracteres del SHA-256 del valor). La misma huella en Netlify y en el
// .env local significa que el contenido es idéntico; distinta, que no lo es.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PIN = /^scrypt\$[A-Za-z0-9+/=]{20,}\$[A-Za-z0-9+/=]{40,}$/

// grupo: para ordenar la tabla · req: 'si' (el sitio no funciona sin ella), 'funcion' (una parte deja de funcionar), 'no' (opcional)
export const VARIABLES = [
    { nombre: 'MONGODB_URI', grupo: 'Base de datos', req: 'si', secreta: true, ok: v => /^mongodb(\+srv)?:\/\/[^:\s]+:[^@\s]+@\S+$/.test(v), formato: 'mongodb+srv://usuario:clave@cluster…' },
    { nombre: 'MONGODB_DB', grupo: 'Base de datos', req: 'si', ok: v => v === 'las_estufas', formato: 'las_estufas' },
    { nombre: 'QR_SIGNING_SECRET', grupo: 'Seguridad', req: 'si', secreta: true, ok: v => v.length >= 32, formato: '32 caracteres o más' },
    { nombre: 'GATE_PIN_HASH', grupo: 'Seguridad', req: 'si', secreta: true, ok: v => PIN.test(v), formato: 'scrypt$…$… (de scripts/hash-pin.mjs, sin comillas)' },
    { nombre: 'ADMIN_PIN_HASH', grupo: 'Seguridad', req: 'si', secreta: true, ok: v => PIN.test(v), formato: 'scrypt$…$… (de scripts/hash-pin.mjs, sin comillas)' },
    { nombre: 'SITE_URL', grupo: 'Sitio', req: 'si', ok: v => /^https:\/\/[^\s/]+\.[^\s/]+$/.test(v), formato: 'https://dominio (sin / al final)' },
    { nombre: 'SINPE_NUMBER', grupo: 'Sitio', req: 'si', ok: v => /^\d{8}$/.test(v), formato: '8 dígitos, sin guion' },
    { nombre: 'ORDEN_VENCE_MIN', grupo: 'Sitio', req: 'no', ok: v => /^\d+$/.test(v) && +v >= 15 && +v <= 1440, formato: 'minutos entre 15 y 1440 (si falta: 120)' },
    { nombre: 'CLUB_EMAIL', grupo: 'Correo', req: 'funcion', ok: v => CORREO.test(v), formato: 'correo' },
    { nombre: 'EVENTOS_EMAIL', grupo: 'Correo', req: 'funcion', ok: v => CORREO.test(v), formato: 'correo' },
    { nombre: 'SMTP_HOST', grupo: 'Correo', req: 'funcion', ok: v => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v), formato: 'smtp.gmail.com' },
    { nombre: 'SMTP_PORT', grupo: 'Correo', req: 'no', ok: v => v === '465' || v === '587', formato: '465 o 587 (si falta: 465)' },
    { nombre: 'SMTP_USER', grupo: 'Correo', req: 'funcion', ok: v => CORREO.test(v), formato: 'correo de la cuenta que envía' },
    { nombre: 'SMTP_APP_PASSWORD', grupo: 'Correo', req: 'funcion', secreta: true, ok: v => v.replace(/\s/g, '').length === 16, formato: 'contraseña de aplicación de Gmail (16 letras)' },
    { nombre: 'MAIL_FROM', grupo: 'Correo', req: 'no', ok: v => v.length > 3, formato: 'Nombre <correo> (si falta: SMTP_USER)' },
    { nombre: 'LOYVERSE_TOKEN', grupo: 'Loyverse', req: 'funcion', secreta: true, ok: v => /^[A-Za-z0-9]{20,}$/.test(v), formato: 'token de acceso del Back Office' },
    { nombre: 'LOYVERSE_STORE_ID', grupo: 'Loyverse', req: 'funcion', ok: v => UUID.test(v), formato: 'UUID (scripts/loyverse-ids.mjs)' },
    { nombre: 'LOYVERSE_PAYMENT_TYPE_ID', grupo: 'Loyverse', req: 'funcion', ok: v => UUID.test(v), formato: 'UUID del pago «SINPE web»' },
    { nombre: 'LOYVERSE_PAYMENT_TYPE_EFECTIVO', grupo: 'Loyverse', req: 'no', ok: v => UUID.test(v), formato: 'UUID del pago «Efectivo» (opcional)' },
    { nombre: 'LOYVERSE_VARIANT_GENERAL', grupo: 'Loyverse', req: 'funcion', ok: v => UUID.test(v), formato: 'UUID de «Entrada general»' },
    { nombre: 'LOYVERSE_VARIANT_RANCHO', grupo: 'Loyverse', req: 'funcion', ok: v => UUID.test(v), formato: 'UUID de «Rancho (fin de semana)»' },
    { nombre: 'LOYVERSE_VARIANT_TENIS', grupo: 'Loyverse', req: 'funcion', ok: v => UUID.test(v), formato: 'UUID de «Cancha de tenis (media hora)»' },
    { nombre: 'CALENDARIO_TOKEN', grupo: 'Eventos', req: 'funcion', secreta: true, ok: v => /^[A-Za-z0-9_-]{24,}$/.test(v), formato: '24+ letras, números, _ o -' },
    { nombre: 'TELEGRAM_BOT_TOKEN', grupo: 'Telegram', req: 'funcion', secreta: true, ok: v => /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(v), formato: '123456789:AA… (de @BotFather)' },
    { nombre: 'TELEGRAM_CHAT_ID', grupo: 'Telegram', req: 'funcion', ok: v => /^-?\d{5,}$/.test(v), formato: '-100… (use /id en el grupo)' },
    { nombre: 'TELEGRAM_WEBHOOK_SECRET', grupo: 'Telegram', req: 'funcion', secreta: true, ok: v => /^[A-Za-z0-9_-]{16,256}$/.test(v), formato: '16 a 256 letras, números, _ o -' }
]

// Variables de versiones anteriores que ya no se usan
export const OBSOLETAS = ['LOYVERSE_VARIANT_DIA', 'LOYVERSE_VARIANT_CERVECERO', 'LOYVERSE_VARIANT_ECONOMICO']

export const huella = v => createHash('sha256').update(String(v)).digest('hex').slice(0, 8)

// estado: ok | falta | formato | aviso
export function revisarVariables(env = process.env) {
    const filas = VARIABLES.map(def => {
        const crudo = env[def.nombre]
        const base = { nombre: def.nombre, grupo: def.grupo, requerida: def.req, secreta: !!def.secreta }
        if (crudo == null || crudo === '') {
            const nota = def.req === 'si' ? 'Falta: el sitio no funciona sin ella' : def.req === 'funcion' ? 'Falta: esa parte queda apagada' : 'Opcional; se usa el valor por defecto'
            return { ...base, estado: def.req === 'no' ? 'aviso' : 'falta', huella: null, nota }
        }
        if (crudo !== crudo.trim()) return { ...base, estado: 'formato', huella: huella(crudo), nota: 'Tiene espacios al inicio o al final' }
        if (/^["'].*["']$/.test(crudo)) return { ...base, estado: 'formato', huella: huella(crudo), nota: 'Está entre comillas: pegue el valor sin comillas' }
        return { ...base, estado: def.ok(crudo) ? 'ok' : 'formato', huella: huella(crudo), nota: def.ok(crudo) ? '' : 'Formato esperado: ' + def.formato }
    })
    const g = filas.find(f => f.nombre === 'GATE_PIN_HASH'), a = filas.find(f => f.nombre === 'ADMIN_PIN_HASH')
    if (g?.huella && g.huella === a?.huella) Object.assign(a, { estado: 'formato', nota: 'Es igual al PIN de puerta: deben ser distintos' })
    const obsoletas = OBSOLETAS.filter(n => env[n])
    const resumen = { ok: filas.filter(f => f.estado === 'ok').length, falta: filas.filter(f => f.estado === 'falta').length, formato: filas.filter(f => f.estado === 'formato').length, total: filas.length }
    return { filas, obsoletas, resumen }
}
