import nodemailer from 'nodemailer'

// Envía los boletos por correo si el cliente dejó su dirección y hay SMTP configurado.
// Un fallo aquí nunca impide que el cliente vea sus boletos en pantalla.
export async function enviarBoletos({ para, orden, boletos }) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_APP_PASSWORD, MAIL_FROM } = process.env
    if (!para || !SMTP_HOST || !SMTP_USER || !SMTP_APP_PASSWORD) return false
    try {
        const puerto = Number(SMTP_PORT || 465)
        const transporte = nodemailer.createTransport({
            host: SMTP_HOST, port: puerto, secure: puerto === 465,
            auth: { user: SMTP_USER, pass: SMTP_APP_PASSWORD }
        })
        const adjuntos = boletos.map((b, i) => ({
            filename: `boleto-${orden.codigo}-${i + 1}.png`,
            content: Buffer.from(b.qr.split(',')[1], 'base64'),
            cid: `qr${i}@estufas`
        }))
        const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
        const items = boletos.map((b, i) =>
            `<p><strong>Boleto ${i + 1} de ${boletos.length}: ${esc(b.nombrePase)}</strong><br>Válido el ${esc(b.fechaVisita)}<br><img src="cid:qr${i}@estufas" width="220" alt="QR del boleto ${i + 1}"></p>`).join('')
        await transporte.sendMail({
            from: MAIL_FROM || SMTP_USER,
            to: para,
            subject: `Sus boletos del Club Las Estufas (${orden.codigo})`,
            html: `<p>Hola ${esc(orden.nombre)}, su pago fue confirmado. Presente cada código QR en la entrada.</p>${items}<p>Club Balneario Las Estufas, Palmitos de Naranjo, San Ramón.</p>`,
            attachments: adjuntos
        })
        return true
    } catch (e) {
        console.error('No se pudo enviar el correo:', e.message)
        return false
    }
}

// Aviso al correo del club cuando se pierde una conexión importante.
export async function enviarAlerta(asunto, texto) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_APP_PASSWORD, MAIL_FROM, CLUB_EMAIL } = process.env
    if (!CLUB_EMAIL || !SMTP_HOST || !SMTP_USER || !SMTP_APP_PASSWORD) return false
    try {
        const puerto = Number(SMTP_PORT || 465)
        const transporte = nodemailer.createTransport({ host: SMTP_HOST, port: puerto, secure: puerto === 465, auth: { user: SMTP_USER, pass: SMTP_APP_PASSWORD } })
        await transporte.sendMail({ from: MAIL_FROM || SMTP_USER, to: CLUB_EMAIL, subject: asunto, text: texto })
        return true
    } catch (e) {
        console.error('No se pudo enviar la alerta:', e.message)
        return false
    }
}
