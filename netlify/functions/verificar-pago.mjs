import { getDb } from './_lib/db.mjs'
import { json, leerJson } from './_lib/http.mjs'
import { MAX_INTENTOS, TOLERANCIA_PAGO_MIN } from './_lib/config.mjs'
import { boletosConQr } from './_lib/boletos.mjs'
import { completarPago } from './_lib/pagos.mjs'

// POST /api/verificar-pago { codigo, ultimos4? }
// Busca un pago SINPE libre (los escribe el lector de SMS/correo en la colección pagos_sinpe):
//   1. Por el código de la orden que el cliente escribió en la descripción del SINPE, con el mismo monto.
//      No pide nada más al cliente; el sitio consulta solo cada pocos segundos.
//   2. Respaldo: mismo monto y mismos últimos 4 dígitos del comprobante (si no escribió el código).
// Cada pago se consume una sola vez.
export default async req => {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    const d = await leerJson(req)
    const codigo = String(d?.codigo ?? '').toUpperCase().trim()
    const ultimos4 = String(d?.ultimos4 ?? '').trim()
    if (!/^[A-Z0-9]{6}$/.test(codigo) || !/^(\d{4})?$/.test(ultimos4))
        return json({ error: 'Escriba el código de su orden y los últimos 4 dígitos del comprobante' }, 400)

    const db = await getDb()
    const ordenes = db.collection('ordenes')
    const pagos = db.collection('pagos_sinpe')

    const orden = await ordenes.findOne({ codigo })
    if (!orden) return json({ error: 'Orden no encontrada' }, 404)

    // Orden ya pagada: solo devuelve los boletos a quien conoce los mismos 4 dígitos
    if (orden.estado === 'pagada') {
        if (!ultimos4) return json({ error: 'Su orden ya está pagada. Para ver sus boletos de nuevo escriba los últimos 4 dígitos del comprobante.', pagada: true }, 403)
        if (orden.ultimos4Usado !== ultimos4) return json({ error: 'Los dígitos no coinciden con el pago de esta orden' }, 403)
        return json({ codigo, boletos: await boletosConQr(orden), correoEnviado: false })
    }

    if (new Date(orden.venceEn) < new Date())
        return json({ error: 'La orden venció. Si ya pagó, escríbanos por WhatsApp con su comprobante.' }, 410)

    const desde = new Date(new Date(orden.creadaEn).getTime() - TOLERANCIA_PAGO_MIN * 60_000)
    const reservar = filtro => pagos.findOneAndUpdate(
        { estado: 'libre', monto: orden.total, fecha: { $gte: desde }, ...filtro },
        { $set: { estado: 'reservado', ordenCodigo: codigo } },
        { returnDocument: 'after' }
    )

    // 1. Por el código escrito en la descripción del SINPE (atómico: un pago no sirve para dos órdenes)
    let pago = await reservar({ codigoOrden: codigo })

    if (!pago) {
        // Llegó un SINPE con este código pero por otro monto: no se entrega nada y se avisa
        const otroMonto = await pagos.findOne({ estado: 'libre', codigoOrden: codigo, fecha: { $gte: desde } })
        if (otroMonto) return json({
            error: 'Recibimos un SINPE con su código, pero el monto no coincide con el de la orden. Escríbanos por WhatsApp con su comprobante.',
            montoDistinto: true
        }, 409)
        if (!ultimos4) return json({ error: 'Todavía no vemos su pago.', esperando: true }, 404)

        // 2. Respaldo por últimos 4 dígitos, con límite de intentos (evita adivinar dígitos por fuerza bruta)
        const conteo = await ordenes.findOneAndUpdate(
            { codigo, estado: 'pendiente', intentos: { $lt: MAX_INTENTOS } },
            { $inc: { intentos: 1 } },
            { returnDocument: 'after' }
        )
        if (!conteo) return json({ error: 'Demasiados intentos. Escríbanos por WhatsApp con su comprobante.' }, 429)
        pago = await reservar({ ultimos4 })
        if (!pago) return json({
            error: 'Todavía no vemos su pago. Espere un minuto y vuelva a intentar; verifique el monto y los 4 dígitos.',
            intentosRestantes: Math.max(0, MAX_INTENTOS - conteo.intentos)
        }, 404)
    }

    const cierre = await completarPago(db, codigo, { comprobante: pago.comprobante, ultimos4: pago.ultimos4 })
    if (!cierre) {
        await pagos.updateOne({ comprobante: pago.comprobante }, { $set: { estado: 'libre' }, $unset: { ordenCodigo: '' } })
        return json({ error: 'La orden cambió de estado. Intente de nuevo.' }, 409)
    }
    return json({ codigo, boletos: cierre.boletos, correoEnviado: cierre.correoEnviado })
}

export const config = { path: '/api/verificar-pago' }
