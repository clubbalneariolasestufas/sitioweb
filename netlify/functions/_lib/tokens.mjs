import { createHmac, timingSafeEqual } from 'node:crypto'

function secreto() {
    const s = process.env.QR_SIGNING_SECRET
    if (!s || s.length < 32) throw new Error('QR_SIGNING_SECRET falta o tiene menos de 32 caracteres')
    return s
}
const hmac = cuerpo => createHmac('sha256', secreto()).update(cuerpo).digest()

// Token = base64url(JSON).firma. Sin la clave secreta no se puede fabricar un boleto.
export function firmar(payload) {
    const cuerpo = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${cuerpo}.${hmac(cuerpo).toString('base64url')}`
}

export function verificar(token) {
    if (typeof token !== 'string' || token.length > 600) return null
    const partes = token.split('.')
    if (partes.length !== 2 || !partes[0] || !partes[1]) return null
    const dado = Buffer.from(partes[1], 'base64url')
    const esperado = hmac(partes[0])
    if (dado.length !== esperado.length || !timingSafeEqual(dado, esperado)) return null
    try {
        return JSON.parse(Buffer.from(partes[0], 'base64url').toString())
    } catch {
        return null
    }
}

// Huella de un dato personal (IP): sirve para limitar abusos sin guardar la IP real.
export const huella = valor => createHmac('sha256', secreto()).update('ip:' + valor).digest('hex').slice(0, 24)
