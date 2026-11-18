import 'dotenv/config'
import { readFileSync, existsSync } from 'node:fs'

const lista = v => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const e = process.env

export const cfg = {
    mongoUri: e.MONGODB_URI_LECTOR || e.MONGODB_URI,
    mongoDb: e.MONGODB_DB || 'las_estufas',

    modemActivo: e.MODEM_ACTIVO !== 'false',
    // modem = el lector abre el módem directamente (sin central).
    // asterisk = la central maneja el módem y le entrega los SMS al lector por HTTP local.
    smsFuente: (e.SMS_FUENTE || 'modem').toLowerCase(),
    asteriskPuerto: Number(e.ASTERISK_PUERTO_HTTP || 8085),
    asteriskToken: e.ASTERISK_TOKEN || '',
    asteriskDispositivo: e.ASTERISK_DISPOSITIVO || 'quectel0',
    asteriskPendientes: e.ASTERISK_PENDIENTES || '/var/spool/asterisk/sinpe/pendientes.txt',
    modemPuerto: e.MODEM_PORT || '/dev/ttyUSB0',
    modemBaud: Number(e.MODEM_BAUD || 115200),
    simPin: e.SIM_PIN || '',
    smsRemitentes: lista(e.SMS_REMITENTES),          // remitentes aceptados (número corto o nombre del banco)
    sondeoSeg: Number(e.MODEM_SONDEO_SEG || 15),

    imapActivo: Boolean(e.IMAP_USER && e.IMAP_APP_PASSWORD),
    imapHost: e.IMAP_HOST || 'imap.gmail.com',
    imapPuerto: Number(e.IMAP_PORT || 993),
    imapUsuario: e.IMAP_USER,
    imapClave: e.IMAP_APP_PASSWORD,
    imapCarpeta: e.IMAP_FOLDER || 'INBOX',
    imapRemitentes: lista(e.IMAP_FROM_FILTER),       // direcciones o dominios (@banco.fi.cr) aceptados
    imapExigirDkim: e.IMAP_EXIGIR_DKIM !== 'false',

    // 1 = basta el SMS o el correo. 2 = el pago solo queda disponible cuando llegan los dos avisos.
    fuentesMinimas: Number(e.FUENTES_MINIMAS || 1),
    latidoSeg: Number(e.LATIDO_SEG || 60)
}

// Reglas propias del banco (opcional): archivo reglas.json junto a package.json
export function cargarReglas(ruta = new URL('../reglas.json', import.meta.url)) {
    if (!existsSync(ruta)) return []
    return JSON.parse(readFileSync(ruta, 'utf8')).map(r => ({
        nombre: r.nombre,
        entrante: new RegExp(r.entrante, 'i'),
        monto: new RegExp(r.monto, 'i'),
        comprobante: new RegExp(r.comprobante, 'i')
    }))
}
