import { getDb } from './db.mjs'
import { json, ipDe } from './http.mjs'
import { MAX_FALLOS_PIN } from './config.mjs'
import { huella } from './tokens.mjs'
import { rolDePin } from './pin.mjs'

// Revisa el PIN del personal y frena los intentos repetidos.
// Devuelve { db, rol } o { error: Response }.
export async function autorizar(req, context, pin, roles = ['puerta', 'admin']) {
    const db = await getDb()
    const fallos = db.collection('puerta_fallos')
    const h = huella(ipDe(req, context))
    const recientes = await fallos.countDocuments({ huella: h, en: { $gte: new Date(Date.now() - 600_000) } })
    if (recientes >= MAX_FALLOS_PIN) return { error: json({ error: 'Demasiados intentos. Espere 10 minutos.' }, 429) }

    const rol = rolDePin(pin)
    if (!rol) {
        await fallos.insertOne({ huella: h, en: new Date() })
        return { error: json({ error: 'PIN incorrecto' }, 401) }
    }
    if (!roles.includes(rol)) return { error: json({ error: 'Esta acción necesita el PIN de administración' }, 403) }
    return { db, rol }
}
