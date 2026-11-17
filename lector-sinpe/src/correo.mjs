import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

// ¿El correo viene de verdad del banco? Revisa el remitente y la firma (DKIM) que valida Gmail.
export function correoConfiable({ de, autenticacion }, { imapRemitentes, imapExigirDkim }) {
    const dir = String(de || '').toLowerCase()
    if (imapRemitentes.length && !imapRemitentes.some(r => (r.startsWith('@') ? dir.endsWith(r) : dir === r))) return false
    if (imapExigirDkim && !/dkim=pass/i.test(String(autenticacion || ''))) return false
    return true
}

// Lee la cuenta dedicada. Llama a alAviso({ fuente, remitente, texto, fecha }) por cada correo nuevo del banco.
export async function vigilarCorreo(cfg, alAviso, estado, log = console) {
    for (;;) {
        const cliente = new ImapFlow({
            host: cfg.imapHost, port: cfg.imapPuerto, secure: true,
            auth: { user: cfg.imapUsuario, pass: cfg.imapClave }, logger: false
        })
        try {
            await cliente.connect()
            await cliente.mailboxOpen(cfg.imapCarpeta)
            estado.conectado = true
            log.info('Correo: conectado')

            let revisando = false
            const revisar = async () => {
                if (revisando) return
                revisando = true
                try {
                    const uids = await cliente.search({ seen: false, since: new Date(Date.now() - 2 * 86400_000) }, { uid: true })
                    for (const uid of uids || []) {
                        const msg = await cliente.fetchOne(String(uid), { source: true }, { uid: true })
                        if (!msg?.source) continue
                        const correo = await simpleParser(msg.source)
                        const de = correo.from?.value?.[0]?.address
                        const auth = [].concat(correo.headers.get('authentication-results') || []).join(' ')
                        if (correoConfiable({ de, autenticacion: auth }, cfg)) {
                            await alAviso({ fuente: 'correo', remitente: de, texto: `${correo.subject || ''}. ${correo.text || ''}`, fecha: correo.date || new Date() })
                            estado.ultimoCorreo = new Date()
                        }
                        // Se marca como leído solo después de guardarlo: si falla la base de datos, se reintenta
                        await cliente.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
                    }
                } catch (e) {
                    log.error('Correo: error al revisar:', e.message)
                } finally {
                    revisando = false
                }
            }

            cliente.on('exists', revisar)                 // llegó un correo nuevo
            const reloj = setInterval(revisar, 120_000)   // y por si acaso, cada 2 minutos
            await revisar()
            await new Promise(ok => { cliente.on('close', ok); cliente.on('error', ok) })
            clearInterval(reloj)
        } catch (e) {
            log.error('Correo: no se pudo conectar:', e.message)
        }
        estado.conectado = false
        try { await cliente.logout() } catch {}
        await new Promise(ok => setTimeout(ok, 30_000))   // reintenta en 30 segundos
    }
}
