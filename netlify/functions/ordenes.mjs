import { randomInt } from 'node:crypto'
import { getDb } from './_lib/db.mjs'
import { json, leerJson, ipDe, limpiar } from './_lib/http.mjs'
import { PASES, DIAS_CERRADO, MAX_PERSONAS, MAX_DIAS_ADELANTE, ORDEN_VENCE_MIN, MAX_ORDENES_POR_HORA, sinpe } from './_lib/config.mjs'
import { hoyCR, fechaValida, diaSemana, diasEntre } from './_lib/fechas.mjs'
import { huella } from './_lib/tokens.mjs'

// Sin letras ni números que se confundan (0/O, 1/I)
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const nuevoCodigo = () => Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')

// POST /api/ordenes: crea una orden pendiente de pago. El monto lo calcula el servidor.
export default async (req, context) => {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    const d = await leerJson(req)
    if (!d || d.web) return json({ error: 'Solicitud inválida' }, 400)

    const pase = PASES[d.pase]
    if (!pase) return json({ error: 'Pase no válido' }, 400)

    const cantidad = Number(d.cantidad)
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_PERSONAS)
        return json({ error: `La cantidad debe ser de 1 a ${MAX_PERSONAS}` }, 400)

    const hoy = hoyCR()
    if (!fechaValida(d.fechaVisita)) return json({ error: 'Fecha no válida' }, 400)
    if (d.fechaVisita < hoy) return json({ error: 'La fecha ya pasó' }, 400)
    if (diasEntre(hoy, d.fechaVisita) > MAX_DIAS_ADELANTE)
        return json({ error: `Solo se venden entradas con hasta ${MAX_DIAS_ADELANTE} días de anticipación` }, 400)
    if (DIAS_CERRADO.includes(diaSemana(d.fechaVisita)))
        return json({ error: 'Los miércoles el balneario permanece cerrado' }, 400)

    const nombre = limpiar(d.nombre, 80)
    if (nombre.length < 2) return json({ error: 'Escriba su nombre' }, 400)
    const telefono = limpiar(d.telefono, 20).replace(/\D/g, '')
    if (telefono.length < 8 || telefono.length > 15) return json({ error: 'Teléfono no válido' }, 400)
    const correo = limpiar(d.correo, 120).toLowerCase()
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return json({ error: 'Correo no válido' }, 400)

    const db = await getDb()
    const col = db.collection('ordenes')
    const ahora = new Date()
    const h = huella(ipDe(req, context))

    const recientes = await col.countDocuments({ huella: h, creadaEn: { $gte: new Date(ahora - 3600_000) } })
    if (recientes >= MAX_ORDENES_POR_HORA) return json({ error: 'Demasiadas solicitudes. Intente más tarde.' }, 429)

    const orden = {
        estado: 'pendiente',
        paseId: d.pase, nombrePase: pase.nombre, cantidad,
        total: pase.precio * cantidad,
        fechaVisita: d.fechaVisita,
        nombre, telefono, correo,
        huella: h, intentos: 0,
        creadaEn: ahora,
        venceEn: new Date(ahora.getTime() + ORDEN_VENCE_MIN * 60_000)
    }

    for (let i = 0; i < 5; i++) {
        orden.codigo = nuevoCodigo()
        try {
            await col.insertOne({ ...orden })
            return json({
                codigo: orden.codigo,
                total: orden.total,
                sinpe: sinpe(),
                venceEn: orden.venceEn.toISOString(),
                minutosParaPagar: ORDEN_VENCE_MIN
            }, 201)
        } catch (e) {
            if (e?.code !== 11000) throw e
        }
    }
    return json({ error: 'No se pudo crear la orden. Intente de nuevo.' }, 500)
}

export const config = { path: '/api/ordenes' }
