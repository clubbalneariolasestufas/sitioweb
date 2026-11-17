// Loyverse es el punto central de venta: cada compra en línea queda como un recibo en el POS,
// con su tipo de pago propio, para que el cierre de caja y los reportes salgan de un solo lugar.
import { PASES } from './config.mjs'

const BASE = 'https://api.loyverse.com/v1.0'
const env = () => ({
    token: process.env.LOYVERSE_TOKEN,
    tienda: process.env.LOYVERSE_STORE_ID,
    tipoPago: process.env.LOYVERSE_PAYMENT_TYPE_ID
})
export const varianteDe = paseId => process.env['LOYVERSE_VARIANT_' + String(paseId).toUpperCase()]
export const loyverseConfigurado = () => { const e = env(); return Boolean(e.token && e.tienda && e.tipoPago) }

async function api(ruta, opciones = {}) {
    const resp = await fetch(BASE + ruta, {
        ...opciones,
        headers: { Authorization: `Bearer ${env().token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(7000)
    })
    const texto = await resp.text()
    if (!resp.ok) throw new Error(`Loyverse respondió ${resp.status}: ${texto.slice(0, 200)}`)
    return texto ? JSON.parse(texto) : {}
}

// Registra el recibo de una orden pagada. Solo una ejecución a la vez puede tomar la orden
// (estado pendiente -> enviando), para no crear dos recibos de la misma venta.
export async function sincronizarOrden(db, codigo) {
    const ordenes = db.collection('ordenes')
    const orden = await ordenes.findOneAndUpdate(
        { codigo, estado: 'pagada', loyverseEstado: 'pendiente' },
        { $set: { loyverseEstado: 'enviando', loyverseDesde: new Date() }, $inc: { loyverseIntentos: 1 } },
        { returnDocument: 'after' }
    )
    if (!orden) return { omitido: true }
    try {
        const variante = varianteDe(orden.paseId)
        if (!variante) throw new Error(`Falta la variable LOYVERSE_VARIANT_${orden.paseId.toUpperCase()}`)
        const pagadaEn = new Date(orden.pagadaEn || Date.now()).toISOString()
        const recibo = await api('/receipts', {
            method: 'POST',
            body: JSON.stringify({
                store_id: env().tienda,
                source: 'Sitio web',
                receipt_date: pagadaEn,
                note: `Orden web ${orden.codigo} · Comprobante SINPE ${orden.comprobante} · Visita ${orden.fechaVisita} · ${orden.nombre}`.slice(0, 250),
                line_items: [{ variant_id: variante, quantity: orden.cantidad, price: orden.total / orden.cantidad }],
                payments: [{ payment_type_id: env().tipoPago, paid_at: pagadaEn }]
            })
        })
        await ordenes.updateOne({ codigo }, { $set: { loyverseEstado: 'registrado', loyverseRecibo: recibo.receipt_number || '', loyverseError: '' } })
        return { registrado: true, recibo: recibo.receipt_number }
    } catch (e) {
        // Si no hubo respuesta (corte de red), Loyverse pudo haber creado el recibo: se marca para revisar a mano.
        const sinRespuesta = e.name === 'TimeoutError' || e.name === 'AbortError'
        await ordenes.updateOne({ codigo }, { $set: { loyverseEstado: sinRespuesta ? 'revisar' : 'pendiente', loyverseError: String(e.message).slice(0, 300) } })
        return { error: e.message }
    }
}

export async function reintentarPendientes(db, max = 10) {
    if (!loyverseConfigurado()) return { reintentados: 0, registrados: 0 }
    const pendientes = await db.collection('ordenes').find({ estado: 'pagada', loyverseEstado: 'pendiente' }).limit(max).toArray()
    let registrados = 0
    for (const o of pendientes) if ((await sincronizarOrden(db, o.codigo)).registrado) registrados++
    return { reintentados: pendientes.length, registrados }
}

// Prueba de conexión: lee el comercio y compara los precios del sitio con los del POS.
export async function probarLoyverse() {
    const comercio = await api('/merchant')
    const avisos = []
    try {
        const { items = [] } = await api('/items?limit=250')
        const variantes = new Map(items.flatMap(i => (i.variants || []).map(v => [v.variant_id, v])))
        for (const [id, pase] of Object.entries(PASES)) {
            const v = variantes.get(varianteDe(id))
            if (!v) { avisos.push(`"${pase.nombre}" no está enlazado a un artículo de Loyverse`); continue }
            const precio = v.stores?.find(s => s.store_id === env().tienda)?.price ?? v.default_price
            if (precio != null && Number(precio) !== pase.precio)
                avisos.push(`"${pase.nombre}" cuesta ₡${pase.precio} en el sitio y ₡${precio} en Loyverse`)
        }
    } catch (e) {
        avisos.push('No se pudieron comparar los precios: ' + e.message)
    }
    return { comercio: comercio.business_name || comercio.name || '', avisos }
}
