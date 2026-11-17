import { json, leerJson, limpiar } from './_lib/http.mjs'
import { autorizar } from './_lib/acceso.mjs'
import { hoyCR } from './_lib/fechas.mjs'
import { boletosConQr } from './_lib/boletos.mjs'
import { completarPago } from './_lib/pagos.mjs'
import { reintentarPendientes } from './_lib/loyverse.mjs'

const SOLO_ADMIN = ['aprobar', 'boletos', 'reintentar-loyverse']

// POST /api/panel { pin, accion, ... }: acciones del personal desde el panel.
//   buscar    (puerta): busca una compra por código o por teléfono
//   ingresar  (puerta): da ingreso a toda una compra sin escanear (cliente sin celular o sin QR)
//   aprobar   (admin):  aprueba un pago a mano con el número de comprobante
//   boletos   (admin):  vuelve a mostrar los boletos de una compra pagada
//   reintentar-loyverse (admin): envía a Loyverse las ventas pendientes
export default async (req, context) => {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    const d = await leerJson(req, 2048)
    if (!d || typeof d.accion !== 'string') return json({ error: 'Solicitud inválida' }, 400)
    const acceso = await autorizar(req, context, d.pin, SOLO_ADMIN.includes(d.accion) ? ['admin'] : ['puerta', 'admin'])
    if (acceso.error) return acceso.error
    const { db } = acceso
    const ordenes = db.collection('ordenes')
    const boletos = db.collection('boletos')
    const codigo = String(d.codigo ?? '').toUpperCase().trim()
    const hoy = hoyCR()

    if (d.accion === 'buscar') {
        const texto = String(d.texto ?? '').toUpperCase().trim()
        const digitos = texto.replace(/\D/g, '')
        let filtro
        if (/^[A-Z0-9]{6}$/.test(texto) && !/^\d{6}$/.test(texto)) filtro = { codigo: texto }
        else if (digitos.length >= 4 && digitos.length <= 15) filtro = { telefono: { $regex: digitos + '$' } }
        else return json({ error: 'Escriba el código de la compra (6 letras y números) o el teléfono del cliente' }, 400)
        const lista = await ordenes.find(filtro).sort({ creadaEn: -1 }).limit(10).toArray()
        const resultados = []
        for (const o of lista) {
            resultados.push({
                codigo: o.codigo, estado: o.estado, nombre: o.nombre, nombrePase: o.nombrePase,
                cantidad: o.cantidad, total: o.total, fechaVisita: o.fechaVisita, esHoy: o.fechaVisita === hoy,
                vencida: o.estado === 'pendiente' && new Date(o.venceEn) < new Date(),
                ingresados: await boletos.countDocuments({ ordenCodigo: o.codigo, estado: 'usado' })
            })
        }
        return json({ resultados })
    }

    if (!/^[A-Z0-9]{6}$/.test(codigo) && d.accion !== 'reintentar-loyverse') return json({ error: 'Código de compra no válido' }, 400)

    if (d.accion === 'ingresar') {
        const o = await ordenes.findOne({ codigo })
        if (!o) return json({ error: 'Compra no encontrada' }, 404)
        if (o.estado !== 'pagada') return json({ error: 'Esta compra todavía no está pagada' }, 409)
        if (o.fechaVisita !== hoy) return json({ error: `Esta compra es para el ${o.fechaVisita}` }, 409)
        const r = await boletos.updateMany({ ordenCodigo: codigo, fechaVisita: hoy, estado: 'valido' }, { $set: { estado: 'usado', usadoEn: new Date(), via: 'panel' } })
        return json({ ingresados: r.modifiedCount, mensaje: r.modifiedCount ? `Ingresaron ${r.modifiedCount} persona(s)` : 'Todas las personas de esta compra ya habían ingresado' })
    }

    if (d.accion === 'boletos') {
        const o = await ordenes.findOne({ codigo })
        if (!o) return json({ error: 'Compra no encontrada' }, 404)
        if (o.estado !== 'pagada') return json({ error: 'Esta compra todavía no está pagada' }, 409)
        return json({ codigo, boletos: await boletosConQr(o) })
    }

    if (d.accion === 'aprobar') {
        const comprobante = String(d.comprobante ?? '').replace(/\D/g, '')
        if (comprobante.length < 4 || comprobante.length > 30) return json({ error: 'Escriba el número de comprobante que muestra el cliente' }, 400)
        const o = await ordenes.findOne({ codigo })
        if (!o) return json({ error: 'Compra no encontrada' }, 404)
        if (o.estado === 'pagada') return json({ codigo, boletos: await boletosConQr(o), yaEstabaPagada: true })

        // El comprobante es único: un mismo SINPE no puede pagar dos compras.
        const pagos = db.collection('pagos_sinpe')
        const pago = { comprobante, ultimos4: comprobante.slice(-4), monto: o.total, fecha: new Date(), estado: 'reservado', fuentes: ['manual'], ordenCodigo: codigo }
        try {
            await pagos.insertOne(pago)
        } catch (e) {
            if (e?.code !== 11000) throw e
            const libre = await pagos.findOneAndUpdate(
                { comprobante, estado: { $in: ['libre', 'por_confirmar', 'anulado'] }, monto: o.total },
                { $set: { estado: 'reservado', ordenCodigo: codigo }, $addToSet: { fuentes: 'manual' } },
                { returnDocument: 'after' })
            if (!libre) return json({ error: 'Ese comprobante ya se usó en otra compra o es por otro monto. No lo acepte sin revisar el celular del cliente.' }, 409)
        }
        const cierre = await completarPago(db, codigo, pago, { aprobacion: 'manual', notaAprobacion: limpiar(d.nota, 120) })
        if (!cierre) {
            await pagos.updateOne({ comprobante, estado: 'reservado' }, { $set: { estado: 'anulado' } })
            return json({ error: 'La compra cambió de estado. Búsquela de nuevo.' }, 409)
        }
        return json({ codigo, boletos: cierre.boletos, correoEnviado: cierre.correoEnviado })
    }

    if (d.accion === 'reintentar-loyverse') return json(await reintentarPendientes(db, 20))

    return json({ error: 'Acción no reconocida' }, 400)
}

export const config = { path: '/api/panel' }
