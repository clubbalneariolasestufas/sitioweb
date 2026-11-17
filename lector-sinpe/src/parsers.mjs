// Convierte el texto de un aviso del banco (SMS o correo) en { monto, comprobante }.
// IMPORTANTE: cada banco redacta distinto. Las reglas genéricas de abajo son un punto de partida;
// con los primeros avisos reales hay que confirmar o agregar una regla en reglas.json
// (use `npm run probar-parser -- "texto del aviso"` para probar).

// Formato real del SMS que recibe el balneario (remitente 7070 1222):
//   "Ha recibido 4,500.00 Colones de NOMBRE por SINPE Movil, DESCRIPCION . Referencia 2026111510483010248320192."
// La descripción la escribe el cliente, así que el texto se ancla al inicio y al final:
// lo que el cliente ponga en medio no puede cambiar el monto ni la referencia.
const SMS_SINPE = /^Ha recibido ([\d,]+\.\d{2}) Colones de (.+?)\s+por SINPE Movil,\s*(.*?)\s*\.?\s*Referencia\s+(\d{6,30})\.?$/i

// Código de orden del sitio dentro de la descripción (6 caracteres, sin 0, 1, I ni O)
export function extraerCodigo(descripcion) {
    const m = String(descripcion || '').toUpperCase().match(/(?:^|[^A-Z0-9])([A-HJ-NP-Z2-9]{6})(?![A-Z0-9])/)
    return m ? m[1] : ''
}

const ENTRANTE = /(ha recibido|has recibido|recibi[oó]|le (?:ha )?(?:transferido|enviado|depositado)|le transfiri[oó]|le envi[oó]|acreditad[oa]|abono a su cuenta|dep[oó]sito a su cuenta|cr[eé]dito a su cuenta)/i
const SALIENTE = /(ha enviado|has enviado|usted envi[oó]|usted realiz[oó]|transferencia enviada|se debit[oó]|d[eé]bito a su cuenta|pago realizado|compra (?:aprobada|realizada)|retiro)/i
const MONTO = [
    /(?:CRC|₡|¢|colones)\s*([\d][\d.,]*)/i,
    /([\d][\d.,]*)\s*(?:CRC|colones)/i,
    /(?:monto|por)\D{0,12}([\d][\d.,]*)/i
]
const COMPROBANTE = /(?:comprobante|referencia|ref\.?|documento|doc\.?|n[uú]mero de transacci[oó]n|transacci[oó]n|c[oó]digo de referencia)\D{0,20}(\d{6,30})/i

// "12,000.00", "12.000,00", "12000", "12 000" -> 12000
export function parsearMonto(texto) {
    let t = String(texto).replace(/\s/g, '').replace(/[.,]$/, '')
    const decimales = t.match(/[.,](\d{2})$/)
    if (decimales) t = t.slice(0, -3)
    t = t.replace(/[.,]/g, '')
    if (!/^\d{1,9}$/.test(t)) return null
    const entero = Number(t)
    return decimales && Number(decimales[1]) > 0 ? entero + Number(decimales[1]) / 100 : entero
}

export function parsearAviso(texto, reglas = []) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim()
    if (!t) return null

    const sms = t.match(SMS_SINPE)
    if (sms) {
        const monto = parsearMonto(sms[1])
        const descripcion = /^sin descripcion$/i.test(sms[3]) ? '' : sms[3]
        if (monto) return { monto, comprobante: sms[4], descripcion, codigoOrden: extraerCodigo(descripcion), regla: 'sms-sinpe' }
    }

    for (const r of reglas) {
        if (!r.entrante.test(t)) continue
        const monto = parsearMonto(t.match(r.monto)?.[1] ?? '')
        const comprobante = t.match(r.comprobante)?.[1]
        if (monto && comprobante) return { monto, comprobante, regla: r.nombre }
    }

    if (SALIENTE.test(t) || !ENTRANTE.test(t)) return null
    let monto = null
    for (const patron of MONTO) { monto = parsearMonto(t.match(patron)?.[1] ?? ''); if (monto) break }
    const comprobante = t.match(COMPROBANTE)?.[1]
    if (!monto || !comprobante) return null
    return { monto, comprobante, regla: 'generica' }
}

// Algunos módems entregan los mensajes con tildes como texto hexadecimal (UCS-2)
export function decodificarSms(texto) {
    const t = String(texto || '').trim()
    if (t.length >= 8 && t.length % 4 === 0 && /^[0-9A-F]+$/i.test(t)) {
        const buf = Buffer.from(t, 'hex')
        let salida = ''
        for (let i = 0; i + 1 < buf.length; i += 2) salida += String.fromCharCode(buf.readUInt16BE(i))
        return salida
    }
    return t
}

// Respuesta de AT+CMGL en modo texto -> [{ indice, estado, remitente, fecha, texto }]
export function parsearCMGL(lineas) {
    const mensajes = []
    let actual = null
    for (const linea of lineas) {
        const m = linea.match(/^\+CMGL:\s*(\d+),"([^"]*)","([^"]*)"(?:,"[^"]*"|,)?(?:,"([^"]*)")?/)
        if (m) {
            actual = { indice: Number(m[1]), estado: m[2], remitente: decodificarSms(m[3]), fecha: fechaSms(m[4]), texto: '' }
            mensajes.push(actual)
        } else if (actual) {
            actual.texto += (actual.texto ? '\n' : '') + linea
        }
    }
    mensajes.forEach(x => { x.texto = decodificarSms(x.texto) })
    return mensajes
}

// "26/11/16,04:30:12-24" (la zona viene en cuartos de hora) -> Date
export function fechaSms(marca) {
    const m = String(marca || '').match(/^(\d\d)\/(\d\d)\/(\d\d),(\d\d):(\d\d):(\d\d)([+-]\d\d)?/)
    if (!m) return new Date()
    const [, a, mes, d, h, min, s, zona] = m
    const utc = Date.UTC(2000 + Number(a), Number(mes) - 1, Number(d), Number(h), Number(min), Number(s))
    const fecha = new Date(utc - Number(zona || 0) * 15 * 60000)
    // Un reloj de red mal puesto no debe dejar pagos fuera de la ventana de búsqueda
    return Math.abs(fecha.getTime() - Date.now()) > 12 * 3600_000 ? new Date() : fecha
}
