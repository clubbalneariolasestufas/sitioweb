import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

// Formato guardado: scrypt$sal$hash (se genera con scripts/hash-pin.mjs)
export function hashPin(pin, sal = randomBytes(16)) {
    const h = scryptSync(String(pin), sal, 32)
    return `scrypt$${sal.toString('base64')}$${h.toString('base64')}`
}

function coincide(pin, guardado) {
    if (!guardado) return false
    const [alg, sal, hash] = guardado.split('$')
    if (alg !== 'scrypt' || !sal || !hash) return false
    const esperado = Buffer.from(hash, 'base64')
    const h = scryptSync(pin, Buffer.from(sal, 'base64'), esperado.length)
    return timingSafeEqual(h, esperado)
}

// Dos PIN: el de puerta (escanear, buscar, dar ingreso) y el de administración
// (además aprueba pagos a mano y reenvía boletos).
export function rolDePin(pin) {
    if (typeof pin !== 'string' || !pin || pin.length > 64) return null
    if (coincide(pin, process.env.ADMIN_PIN_HASH)) return 'admin'
    if (coincide(pin, process.env.GATE_PIN_HASH)) return 'puerta'
    return null
}
