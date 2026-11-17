// Registra en MongoDB los avisos del banco y los pagos reconocidos.
// Contrato con el sitio (colección pagos_sinpe, clave única en `comprobante`):
//   { comprobante, ultimos4, monto, fecha, estado, fuentes, descripcion, codigoOrden }
//   codigoOrden: código de la orden que el cliente escribió en la descripción del SINPE (si lo puso)
//   estado: por_confirmar -> libre -> reservado -> usado   (el sitio solo toma los "libre")

export async function guardarAviso(db, { fuente, remitente, texto, reconocido, motivo = '' }) {
    await db.collection('avisos_banco').insertOne({
        fuente, remitente: String(remitente || '').slice(0, 120), texto: String(texto || '').slice(0, 600),
        reconocido, motivo, en: new Date()
    })
}

export async function registrarPago(db, { comprobante, monto, fecha, fuente, descripcion = '', codigoOrden = '' }, fuentesMinimas = 1) {
    const pagos = db.collection('pagos_sinpe')
    const nuevo = {
        comprobante: String(comprobante), ultimos4: String(comprobante).slice(-4), monto,
        fecha: fecha || new Date(), fuentes: [fuente], creadoEn: new Date(),
        descripcion: String(descripcion).slice(0, 60), codigoOrden,
        estado: fuentesMinimas <= 1 ? 'libre' : 'por_confirmar'
    }
    try {
        await pagos.insertOne(nuevo)
        return { resultado: 'nuevo', estado: nuevo.estado }
    } catch (e) {
        if (e?.code !== 11000) throw e
    }

    // Ya existía: llegó la segunda fuente (o un aviso repetido)
    const previo = await pagos.findOneAndUpdate({ comprobante: nuevo.comprobante }, { $addToSet: { fuentes: fuente } }, { returnDocument: 'after' })
    if (previo.monto !== monto) {
        // Mismo comprobante con otro monto: nunca debe aprobarse solo
        await pagos.updateOne({ comprobante: nuevo.comprobante, estado: { $in: ['libre', 'por_confirmar'] } }, { $set: { estado: 'conflicto' } })
        return { resultado: 'conflicto', estado: 'conflicto' }
    }
    if (previo.estado === 'por_confirmar' && previo.fuentes.length >= fuentesMinimas) {
        await pagos.updateOne({ comprobante: nuevo.comprobante, estado: 'por_confirmar' }, { $set: { estado: 'libre', confirmadoEn: new Date() } })
        return { resultado: 'confirmado', estado: 'libre' }
    }
    return { resultado: 'repetido', estado: previo.estado }
}

// Procesa un aviso completo: lo guarda para auditoría y, si se reconoce, registra el pago.
export async function procesarAviso(db, aviso, parsear, fuentesMinimas) {
    const datos = parsear(aviso.texto)
    if (!datos) {
        await guardarAviso(db, { ...aviso, reconocido: false, motivo: 'no es un ingreso o no se entendió el formato' })
        return { reconocido: false }
    }
    if (!Number.isInteger(datos.monto)) {
        await guardarAviso(db, { ...aviso, reconocido: false, motivo: 'monto con céntimos' })
        return { reconocido: false }
    }
    const r = await registrarPago(db, { ...datos, fecha: aviso.fecha, fuente: aviso.fuente }, fuentesMinimas)
    await guardarAviso(db, { ...aviso, reconocido: true, motivo: r.resultado })
    return { reconocido: true, ...datos, ...r }
}
