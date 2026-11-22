import { json, leerJson, limpiar } from './_lib/http.mjs'
import { autorizar } from './_lib/acceso.mjs'
import { fechaValida, hoyCR } from './_lib/fechas.mjs'
import { ESTADOS, REGLAS, PLANTILLA_TAREAS, areasExclusivas, nombreArea } from '../../src/js/precios-eventos.js'
import { areasOcupadas, conTareas } from './_lib/cotizaciones.mjs'

const sumar = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)

// POST /api/eventos-admin { pin, accion, ... } — solo PIN de administración.
//   listar     { desde, hasta }  cotizaciones del rango (con sus tareas) y las solicitudes por atender
//   estado     { codigo, estado, nota, mensajeCliente, totalFinal, comprobante }  avanza el flujo
//   tarea      { codigo, tarea, hecha }  marca una tarea del evento
//   calendario                       enlace privado para suscribirse desde Google Calendar
export default async (req, context) => {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    const d = await leerJson(req, 4096)
    if (!d || typeof d.accion !== 'string') return json({ error: 'Solicitud inválida' }, 400)
    const acceso = await autorizar(req, context, d.pin, ['admin'])
    if (acceso.error) return acceso.error
    const col = acceso.db.collection('cotizaciones')

    if (d.accion === 'listar') {
        const hoy = hoyCR()
        const desde = fechaValida(d.desde) ? d.desde : sumar(hoy, -7)
        let hasta = fechaValida(d.hasta) ? d.hasta : sumar(desde, 41)
        if (hasta < desde || hasta > sumar(desde, 100)) hasta = sumar(desde, 41)
        const rango = await col.find({ fechaEvento: { $gte: desde, $lte: hasta } }).sort({ fechaEvento: 1 }).limit(500).toArray()
        const porAtender = await col.find({ estado: { $in: ['solicitada', 'cotizada'] } }).sort({ creadaEn: 1 }).limit(100).toArray()
        // Eventos firmes desde hace 7 días hasta 14 días adelante, para la lista de tareas
        const proximos = await col.find({ fechaEvento: { $gte: sumar(hoy, -7), $lte: sumar(hoy, 21) }, estado: { $in: ['reservada', 'confirmada'] } }).limit(200).toArray()
        return json({ desde, hasta, cotizaciones: rango.map(sinHuella).map(conTareas), porAtender: porAtender.map(sinHuella).map(conTareas), proximos: proximos.map(sinHuella).map(conTareas) })
    }

    if (d.accion === 'calendario') {
        const token = process.env.CALENDARIO_TOKEN
        if (!token || token.length < 24) return json({ error: 'Falta la variable CALENDARIO_TOKEN en Netlify (al menos 24 caracteres)' }, 409)
        const origen = new URL(req.url).origin
        return json({ url: `${origen}/api/calendario.ics?k=${encodeURIComponent(token)}` })
    }

    const codigo = String(d.codigo ?? '').toUpperCase().trim()
    if (!/^COT-\d{4}-\d{3,}$/.test(codigo)) return json({ error: 'Código no válido' }, 400)
    const c = await col.findOne({ codigo })
    if (!c) return json({ error: 'Cotización no encontrada' }, 404)
    const ahora = new Date()

    if (d.accion === 'tarea') {
        if (!PLANTILLA_TAREAS.some(t => t.id === d.tarea)) return json({ error: 'Tarea no válida' }, 400)
        await col.updateOne({ codigo }, d.hecha ? { $addToSet: { tareasHechas: d.tarea } } : { $pull: { tareasHechas: d.tarea } })
        return json(conTareas(sinHuella(await col.findOne({ codigo }))))
    }

    if (d.accion === 'estado') {
        const nuevo = d.estado
        if (!ESTADOS[nuevo]) return json({ error: 'Estado no válido' }, 400)
        if (!ESTADOS[c.estado].siguiente.includes(nuevo))
            return json({ error: `No se puede pasar de «${ESTADOS[c.estado].nombre}» a «${ESTADOS[nuevo].nombre}»` }, 409)

        const set = { estado: nuevo, actualizadaEn: ahora }
        const entrada = { estado: nuevo, en: ahora, por: 'admin' }
        const nota = limpiar(d.nota, 300)
        if (nota) entrada.nota = nota
        if (typeof d.mensajeCliente === 'string') set.mensajeCliente = limpiar(d.mensajeCliente, 400)

        if (d.totalFinal != null && d.totalFinal !== '') {
            const t = Math.round(Number(d.totalFinal))
            if (!Number.isFinite(t) || t < 0 || t > 50_000_000) return json({ error: 'Total no válido' }, 400)
            set.totalFinal = t
            set.adelantoFinal = Math.round(t * REGLAS.adelanto)
            entrada.total = t
        }

        // Volver a apartar la fecha (cotizar, reservar o reactivar) exige que las áreas sigan libres
        if (['cotizada', 'reservada', 'solicitada'].includes(nuevo)) {
            const ocupadas = await areasOcupadas(acceso.db, c.fechaEvento, codigo)
            const choque = areasExclusivas(c.seleccion?.areas).filter(a => ocupadas.has(a))
            if (choque.length) return json({ error: `Otra reserva ya tiene ese día: ${choque.map(nombreArea).join(' y ')}` }, 409)
        }
        if (nuevo === 'cotizada') set.validaHasta = new Date(ahora.getTime() + REGLAS.diasValidez * 86400000)
        if (nuevo === 'solicitada') set.apartadoHasta = new Date(ahora.getTime() + REGLAS.diasApartado * 86400000)
        if (nuevo === 'reservada') {
            const comprobante = String(d.comprobante ?? '').replace(/\D/g, '')
            if (comprobante.length < 4 || comprobante.length > 30) return json({ error: 'Escriba el número de comprobante del SINPE del adelanto' }, 400)
            set.comprobanteAdelanto = comprobante
            entrada.comprobante = comprobante
        }

        const r = await col.updateOne({ codigo, estado: c.estado }, { $set: set, $push: { historial: entrada } })
        if (!r.modifiedCount) return json({ error: 'La cotización cambió mientras tanto. Recargue.' }, 409)
        return json(conTareas(sinHuella(await col.findOne({ codigo }))))
    }

    return json({ error: 'Acción no reconocida' }, 400)
}

function sinHuella(c) { const { huella, _id, ...resto } = c; return resto }

export const config = { path: '/api/eventos-admin' }
