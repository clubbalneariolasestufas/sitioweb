import { randomInt } from 'node:crypto'
import { getDb } from './_lib/db.mjs'
import { json, leerJson, ipDe, limpiar } from './_lib/http.mjs'
import { MAX_PERSONAS, MAX_DIAS_ADELANTE, ORDEN_VENCE_MIN, MAX_ORDENES_POR_HORA, sinpe } from './_lib/config.mjs'
import { hoyCR, fechaValida, diasEntre } from './_lib/fechas.mjs'
import { huella } from './_lib/tokens.mjs'
import { calcularCompra, resumenCompra, estaCerrado, CAPACIDAD_RANCHO, HORARIO } from '../../src/js/precios-tiquetes.js'
import { apartarRanchos } from './_lib/ranchos.mjs'

// Sin letras ni números que se confundan (0/O, 1/I)
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const nuevoCodigo = () => Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')
const horaCR = (d = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)

// POST /api/ordenes { general, menores, ranchos: [n], fechaVisita, nombre, telefono, correo }
// Crea una orden pendiente de pago y aparta los ranchos 15 minutos. El monto lo calcula el servidor.
export default async (req, context) => {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    const d = await leerJson(req)
    if (!d || d.web) return json({ error: 'Solicitud inválida' }, 400)

    const hoy = hoyCR()
    const fecha = d.fechaVisita
    if (!fechaValida(fecha)) return json({ error: 'Fecha no válida' }, 400)
    if (fecha < hoy) return json({ error: 'La fecha ya pasó' }, 400)
    if (fecha === hoy && horaCR() >= HORARIO.cierra) return json({ error: 'Hoy ya cerramos. Escoja otra fecha.' }, 400)
    if (diasEntre(hoy, fecha) > MAX_DIAS_ADELANTE) return json({ error: `Solo se venden entradas con hasta ${MAX_DIAS_ADELANTE} días de anticipación` }, 400)
    if (estaCerrado(fecha)) return json({ error: 'Los miércoles el balneario permanece cerrado' }, 400)

    for (const k of ['general', 'menores']) {
        const v = d[k] ?? 0
        if (!Number.isInteger(v) || v < 0 || v > MAX_PERSONAS) return json({ error: 'Cantidad de personas no válida' }, 400)
    }
    if (Array.isArray(d.ranchos) && d.ranchos.some(n => !Number.isInteger(n))) return json({ error: 'Rancho no válido' }, 400)
    const c = calcularCompra({ general: d.general, menores: d.menores, ranchos: d.ranchos, fecha })
    if (c.ranchos.length !== (Array.isArray(d.ranchos) ? d.ranchos.length : 0)) return json({ error: 'Rancho no válido' }, 400)
    if (c.general < 1) return json({ error: 'Agregue al menos una entrada general' }, 400)
    if (c.personas > MAX_PERSONAS) return json({ error: `Máximo ${MAX_PERSONAS} personas por compra` }, 400)
    if (!c.caben) return json({ error: `Cada rancho recibe máximo ${CAPACIDAD_RANCHO} personas: para ${c.personas} personas elija ${c.ranchosNecesarios} ranchos` }, 400)

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
        // paseId/nombrePase/cantidad se mantienen para el panel, los boletos y los reportes
        paseId: 'general', nombrePase: resumenCompra(c), cantidad: c.personas,
        general: c.general, menores: c.menores, ranchos: c.ranchos, lineas: c.lineas,
        total: c.total,
        fechaVisita: fecha,
        nombre, telefono, correo,
        huella: h, intentos: 0,
        creadaEn: ahora,
        venceEn: new Date(ahora.getTime() + ORDEN_VENCE_MIN * 60_000)
    }

    for (let i = 0; i < 5; i++) {
        orden.codigo = nuevoCodigo()
        try {
            await col.insertOne({ ...orden })
        } catch (e) {
            if (e?.code === 11000) continue
            throw e
        }
        let ranchoHasta = null
        if (c.ranchos.length) {
            const r = await apartarRanchos(db, { fecha, ranchos: c.ranchos, orden: orden.codigo, ahora })
            if (!r.ok) {
                await col.updateOne({ codigo: orden.codigo }, { $set: { estado: 'anulada', motivo: 'rancho ocupado' } })
                return json({ error: `El rancho ${r.ocupado} se acaba de ocupar. Elija otro en el mapa.`, ranchoOcupado: r.ocupado }, 409)
            }
            ranchoHasta = r.hasta
            await col.updateOne({ codigo: orden.codigo }, { $set: { ranchoHastaEn: ranchoHasta } })
        }
        return json({
            codigo: orden.codigo,
            total: orden.total,
            resumen: orden.nombrePase,
            sinpe: sinpe(),
            venceEn: orden.venceEn.toISOString(),
            minutosParaPagar: ORDEN_VENCE_MIN,
            ranchoHastaEn: ranchoHasta ? ranchoHasta.toISOString() : null
        }, 201)
    }
    return json({ error: 'No se pudo crear la orden. Intente de nuevo.' }, 500)
}

export const config = { path: '/api/ordenes' }
