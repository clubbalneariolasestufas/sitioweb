import { getDb } from './_lib/db.mjs'
import { json, leerJson } from './_lib/http.mjs'
import { MAX_INTENTOS, MAX_INTENTOS_VER, MAX_FALLOS_CODIGO, TOLERANCIA_PAGO_MIN, sinpe as numeroSinpe } from './_lib/config.mjs'
import { bloqueado, anotarFallo } from './_lib/limite.mjs'
import { timingSafeEqual } from 'node:crypto'
import { boletosConQr } from './_lib/boletos.mjs'
import { tomarPagos, evaluarOrden } from './_lib/cuenta.mjs'
import { colones } from '../../src/js/precios-tiquetes.js'

// POST /api/verificar-pago { codigo, ultimos4?, montoPagado? }
// Une a la cuenta de la orden los SINPE que escribe el lector (colección pagos_sinpe) y responde el estado:
//   1. Todo pago con el código de la orden en la descripción, sea cual sea el monto (pagos parciales se suman).
//   2. Rescate sin código: últimos 4 dígitos del comprobante + el monto pagado (por defecto, el saldo).
// Respuestas: esperando (404) · parcial (200, con saldo y boletos con saldo pendiente) · pagada (200).
// Cada pago se consume una sola vez.
export default async (req, context) => {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    const d = await leerJson(req)
    const codigo = String(d?.codigo ?? '').toUpperCase().trim()
    const ultimos4 = String(d?.ultimos4 ?? '').trim()
    if (!/^[A-Z0-9]{6}$/.test(codigo) || !/^(\d{4})?$/.test(ultimos4))
        return json({ error: 'Escriba el código de su orden y los últimos 4 dígitos del comprobante' }, 400)

    const db = await getDb()
    const ordenes = db.collection('ordenes')

    // Freno contra quien prueba códigos o dígitos al azar
    if (await bloqueado(db, req, context, 'codigo', MAX_FALLOS_CODIGO))
        return json({ error: 'Demasiados intentos. Espere 10 minutos o escríbanos por WhatsApp.' }, 429)

    const orden = await ordenes.findOne({ codigo })
    if (!orden) { await anotarFallo(db, req, context, 'codigo'); return json({ error: 'Orden no encontrada' }, 404) }

    // ¿Es el dueño de la compra? (llave guardada en su celular o en el enlace de su correo)
    const llave = String(d?.llave ?? '')
    const esDueno = Boolean(orden.llave && llave.length === orden.llave.length && timingSafeEqual(Buffer.from(llave), Buffer.from(orden.llave)))

    // Orden ya pagada: solo devuelve los boletos al dueño o a quien conoce los mismos 4 dígitos
    if (orden.estado === 'pagada' && esDueno) return json({ codigo, boletos: await boletosConQr(orden), correoEnviado: false, ranchos: orden.ranchos || [], tenis: orden.tenis || null, credito: orden.credito || 0, total: orden.total, recibido: orden.recibido ?? orden.total, saldo: 0 })
    if (orden.estado === 'pagada') {
        if (!ultimos4) return json({ error: 'Su orden ya está pagada. Para ver sus boletos de nuevo escriba los últimos 4 dígitos del comprobante.', pagada: true }, 403)
        // Límite por orden: sin él, 10 000 combinaciones bastarían para llevarse los boletos de otra persona
        if ((orden.intentosVer || 0) >= MAX_INTENTOS_VER) return json({ error: 'Demasiados intentos con esta orden. Escríbanos por WhatsApp con su comprobante.' }, 429)
        const propios = (await db.collection('pagos_sinpe').find({ ordenCodigo: codigo, estado: 'usado' }).toArray()).map(p => p.ultimos4)
        if (orden.ultimos4Usado !== ultimos4 && !propios.includes(ultimos4)) {
            await ordenes.updateOne({ codigo }, { $inc: { intentosVer: 1 } })
            await anotarFallo(db, req, context, 'codigo')
            return json({ error: 'Los dígitos no coinciden con el pago de esta orden' }, 403)
        }
        return json({ codigo, boletos: await boletosConQr(orden), correoEnviado: false, ranchos: orden.ranchos || [] })
    }

    const sinpe = numeroSinpe()
    const enCuenta = r => ({ total: r.total, recibido: r.recibido, saldo: r.saldo, sinpe })

    if (orden.estado === 'pendiente' && new Date(orden.venceEn) < new Date())
        return json({ error: 'La orden venció. Si ya pagó, escríbanos por WhatsApp con su comprobante.' }, 410)

    // 1. Todo SINPE que traiga el código de esta orden se une a su cuenta, sea cual sea el monto
    const desde = new Date(new Date(orden.creadaEn).getTime() - TOLERANCIA_PAGO_MIN * 60_000)
    let nuevos = await tomarPagos(db, codigo, { codigoOrden: codigo, fecha: { $gte: desde } })

    // 2. Rescate sin código: últimos 4 dígitos del comprobante y el monto que pagó (por defecto, el saldo).
    //    Los dos deben coincidir y hay límite de intentos, para que nadie reclame el pago de otra persona.
    let r = await evaluarOrden(db, codigo)
    if (!nuevos.length && ultimos4 && ['pendiente', 'parcial'].includes(r.tipo)) {
        const montoPagado = d.montoPagado == null || d.montoPagado === '' ? r.saldo : Number(d.montoPagado)
        if (!Number.isInteger(montoPagado) || montoPagado <= 0 || montoPagado > 10_000_000) return json({ error: 'Escriba el monto que pagó, sin puntos ni comas.' }, 400)
        const conteo = await ordenes.findOneAndUpdate(
            { codigo, estado: { $in: ['pendiente', 'parcial'] }, intentos: { $lt: MAX_INTENTOS } },
            { $inc: { intentos: 1 } },
            { returnDocument: 'after' }
        )
        if (!conteo) return json({ error: 'Demasiados intentos. Escríbanos por WhatsApp con su comprobante.' }, 429)
        nuevos = await tomarPagos(db, codigo, { ultimos4, monto: montoPagado, fecha: { $gte: desde } }, 1)
        if (!nuevos.length) return json({
            error: `Todavía no vemos un pago de ${colones(montoPagado)} con esos 4 números. Espere un minuto y vuelva a intentar.`,
            intentosRestantes: Math.max(0, MAX_INTENTOS - conteo.intentos), ...enCuenta(r)
        }, 404)
        r = await evaluarOrden(db, codigo)
    }

    if (r.tipo === 'pendiente') return json({ error: 'Todavía no vemos su pago.', esperando: true, ...enCuenta(r) }, 404)
    if (r.tipo === 'parcial') return json({
        codigo, parcial: true, mensaje: r.mensaje, pista: r.pista, ...enCuenta(r),
        boletos: esDueno ? r.boletos : null, reservasGarantizadas: r.reservas.garantizadas, faltaParaGarantizar: r.reservas.faltaParaGarantizar || 0,
        ranchos: r.orden.ranchos || [], tenis: r.orden.tenis || null
    })
    if (r.tipo !== 'pagada') return json({ error: 'La orden no se puede pagar.' }, 409)
    if (r.yaEstaba && !esDueno && !ultimos4) return json({ error: 'Su compra ya está pagada completa. Para ver sus boletos escriba los últimos 4 números del comprobante.', pagada: true }, 403)
    if (r.yaEstaba) return json({ codigo, boletos: await boletosConQr(r.orden), correoEnviado: false, ranchos: r.orden.ranchos || [], tenis: r.orden.tenis || null, sobrepago: r.sobrepago, credito: r.credito, ...enCuenta(r) })
    return json({
        codigo, boletos: r.boletos, correoEnviado: r.correoEnviado, ranchos: r.orden.ranchos || [], tenis: r.orden.tenis || null,
        ranchoConflicto: r.ranchoConflicto, tenisConflicto: r.tenisConflicto, sobrepago: r.sobrepago, credito: r.credito, ...enCuenta(r)
    })
}

export const config = { path: '/api/verificar-pago' }
