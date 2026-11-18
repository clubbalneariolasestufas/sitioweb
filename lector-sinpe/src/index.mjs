import { MongoClient } from 'mongodb'
import { cfg, cargarReglas } from './config.mjs'
import { parsearAviso } from './parsers.mjs'
import { procesarAviso } from './pagos.mjs'
import { Modem, abrirPuerto } from './modem.mjs'
import { vigilarCorreo } from './correo.mjs'
import { crearServidorSms, procesarPendientes, parsearDispositivos, consultarAsterisk } from './asterisk.mjs'

const log = {
    info: (...a) => console.log(new Date().toISOString(), ...a),
    error: (...a) => console.error(new Date().toISOString(), ...a)
}
const dormir = ms => new Promise(ok => setTimeout(ok, ms))

if (!cfg.mongoUri) { log.error('Falta MONGODB_URI_LECTOR en el archivo .env'); process.exit(1) }

const reglas = cargarReglas()
const parsear = texto => parsearAviso(texto, reglas)
const cliente = new MongoClient(cfg.mongoUri, { serverSelectionTimeoutMS: 8000 })
const db = cliente.db(cfg.mongoDb)

const estado = {
    inicio: new Date(),
    modem: { activo: cfg.modemActivo, via: cfg.smsFuente, conectado: false, registrado: false, senal: 0, operador: '', ultimoSms: null },
    correo: { activo: cfg.imapActivo, conectado: false, ultimoCorreo: null }
}

async function alAviso(aviso) {
    const r = await procesarAviso(db, aviso, parsear, cfg.fuentesMinimas)
    if (r.reconocido) log.info(`Pago ${r.resultado}: ₡${r.monto} comprobante …${String(r.comprobante).slice(-4)} (${aviso.fuente})`)
    else log.info(`Aviso sin reconocer (${aviso.fuente}) de ${aviso.remitente}`)
}

/* ---------- Latido: el panel del personal muestra en rojo si deja de llegar ---------- */
async function latido() {
    for (;;) {
        try {
            await db.collection('estado_sistema').updateOne({ _id: 'lector' }, { $set: { en: new Date(), ...estado } }, { upsert: true })
        } catch (e) { log.error('Sin conexión con la base de datos:', e.message) }
        await dormir(cfg.latidoSeg * 1000)
    }
}

/* ---------- Módem: lee los SMS del banco ---------- */
// "7070 1222", "70701222" y "+50670701222" se tratan como el mismo remitente
export function remitenteAceptado(remitente, permitidos) {
    if (!permitidos.length) return true
    const limpio = v => String(v).toLowerCase().replace(/[^a-z0-9]/g, '')
    const r = limpio(remitente)
    return permitidos.some(p => { const q = limpio(p); return q && (r === q || (/^\d+$/.test(q) && r.endsWith(q))) })
}

async function cicloModem() {
    for (;;) {
        let puerto
        try {
            puerto = await abrirPuerto(cfg.modemPuerto, cfg.modemBaud)
            const modem = new Modem(puerto, { simPin: cfg.simPin })
            await modem.iniciar()
            estado.modem.conectado = true
            log.info('Módem: listo en', cfg.modemPuerto)

            let cerrado = false
            let despertar = () => {}
            puerto.on('cerrado', () => { cerrado = true; despertar() })
            modem.on('sms-nuevo', () => despertar())

            while (!cerrado) {
                Object.assign(estado.modem, await modem.estado())
                for (const sms of await modem.leerMensajes()) {
                    const aceptado = remitenteAceptado(sms.remitente, cfg.smsRemitentes)
                    if (aceptado) {
                        await alAviso({ fuente: 'sms', remitente: sms.remitente, texto: sms.texto, fecha: sms.fecha })
                        estado.modem.ultimoSms = new Date()
                    } else log.info('SMS ignorado de remitente no autorizado:', sms.remitente)
                    // Se borra de la SIM solo después de guardarlo: si la base de datos falla, se reintenta
                    await modem.borrar(sms.indice)
                }
                await Promise.race([dormir(cfg.sondeoSeg * 1000), new Promise(ok => { despertar = ok })])
            }
        } catch (e) {
            log.error('Módem:', e.message)
        }
        estado.modem.conectado = false
        estado.modem.registrado = false
        try { await puerto?.cerrar() } catch {}
        await dormir(15_000)   // reintenta en 15 segundos (módem desconectado, sin señal, etc.)
    }
}

/* ---------- Central Asterisk: recibe los SMS que le pasa la central ---------- */
async function smsDeAsterisk({ remitente, texto, fecha }) {
    if (!remitenteAceptado(remitente, cfg.smsRemitentes)) { log.info('SMS ignorado de remitente no autorizado:', remitente); return }
    await alAviso({ fuente: 'sms', remitente, texto, fecha })
    estado.modem.ultimoSms = new Date()
}

function puenteAsterisk() {
    const servidor = crearServidorSms({ token: cfg.asteriskToken, onSms: smsDeAsterisk, log })
    servidor.listen(cfg.asteriskPuerto, '127.0.0.1', () => log.info(`Central: esperando SMS en 127.0.0.1:${cfg.asteriskPuerto}`))
    ;(async () => {
        for (;;) {
            try {
                const n = await procesarPendientes(cfg.asteriskPendientes, smsDeAsterisk, log)
                if (n) log.info(`Central: ${n} SMS pendiente(s) procesado(s)`)
                Object.assign(estado.modem, parsearDispositivos(await consultarAsterisk('quectel show devices'), cfg.asteriskDispositivo))
            } catch (e) {
                Object.assign(estado.modem, { conectado: false, registrado: false, estadoCentral: 'la central no responde' })
                log.error('Central:', e.message)
            }
            await dormir(cfg.sondeoSeg * 1000)
        }
    })()
}

log.info(`Lector SINPE iniciado. Módem: ${cfg.modemActivo ? 'sí' : 'no'}. Correo: ${cfg.imapActivo ? 'sí' : 'no'}. Fuentes mínimas: ${cfg.fuentesMinimas}`)
if (!cfg.smsRemitentes.length) log.info('AVISO: SMS_REMITENTES está vacío; se aceptan SMS de cualquier número. Configúrelo con el remitente del banco.')
if (cfg.imapActivo && !cfg.imapRemitentes.length) log.info('AVISO: IMAP_FROM_FILTER está vacío; configure la dirección del banco.')

latido()
if (cfg.modemActivo && cfg.smsFuente === 'asterisk') puenteAsterisk()
else if (cfg.modemActivo) cicloModem()
if (cfg.imapActivo) vigilarCorreo(cfg, alAviso, estado.correo, log)

for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, async () => { await cliente.close().catch(() => {}); process.exit(0) })
