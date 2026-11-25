import { ipDe } from './http.mjs'
import { huella } from './tokens.mjs'

// Freno por cliente (huella de IP, nunca la IP real) para intentos fallidos:
// códigos que no existen, dígitos que no coinciden, seguimiento con datos equivocados.
// Los intentos se guardan en «limites» y se borran solos después de una hora (índice TTL).
const VENTANA_MS = 600_000

export async function bloqueado(db, req, context, clave, max) {
    const h = huella(ipDe(req, context))
    const n = await db.collection('limites').countDocuments({ huella: h, clave, en: { $gte: new Date(Date.now() - VENTANA_MS) } })
    return n >= max
}

export async function anotarFallo(db, req, context, clave) {
    await db.collection('limites').insertOne({ huella: huella(ipDe(req, context)), clave, en: new Date() })
}
