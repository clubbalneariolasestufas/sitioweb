import { boletosConQr } from './boletos.mjs'
import { enviarBoletos } from './correo.mjs'
import { loyverseConfigurado, sincronizarOrden } from './loyverse.mjs'
import { apartarRanchos } from './ranchos.mjs'

// Cierra una venta: marca la orden como pagada, consume el pago, crea los boletos,
// envía el correo y registra el recibo en Loyverse. Devuelve null si la orden ya no estaba pendiente.
export async function completarPago(db, codigo, pago, extra = {}) {
    const ordenes = db.collection('ordenes')
    const pagada = await ordenes.findOneAndUpdate(
        { codigo, estado: 'pendiente' },
        { $set: {
            estado: 'pagada', pagadaEn: new Date(),
            comprobante: pago.comprobante, ultimos4Usado: pago.ultimos4,
            loyverseEstado: loyverseConfigurado() ? 'pendiente' : 'omitido', loyverseIntentos: 0,
            ...extra
        } },
        { returnDocument: 'after' }
    )
    if (!pagada) return null
    await db.collection('pagos_sinpe').updateOne({ comprobante: pago.comprobante }, { $set: { estado: 'usado', usadoEn: new Date(), ordenCodigo: codigo } })

    // Ranchos: el apartado se vuelve firme. Si el pago llegó después de que el apartado venció
    // y otra persona tomó el rancho, la venta sigue y se marca para que el personal le ofrezca otro.
    let ranchoConflicto = null
    if (pagada.ranchos?.length) {
        const r = await apartarRanchos(db, { fecha: pagada.fechaVisita, ranchos: pagada.ranchos, orden: codigo, firme: true })
        if (!r.ok) {
            ranchoConflicto = r.ocupado
            await ordenes.updateOne({ codigo }, { $set: { ranchoConflicto: r.ocupado } })
        }
    }

    const boletos = await boletosConQr(pagada)
    // Pasos secundarios: si fallan, el cliente igual recibe sus boletos y el panel avisa del pendiente
    const correoEnviado = await enviarBoletos({ para: pagada.correo, orden: pagada, boletos })
    try { await sincronizarOrden(db, codigo) } catch (e) { console.error('Loyverse:', e.message) }
    return { orden: pagada, boletos, correoEnviado, ranchoConflicto }
}
