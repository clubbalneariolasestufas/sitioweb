import { getDb } from './_lib/db.mjs'
import { json, leerJson, ipDe, limpiar } from './_lib/http.mjs'
import { hoyCR, fechaValida, diaSemana, diasEntre } from './_lib/fechas.mjs'
import { huella } from './_lib/tokens.mjs'
import { calcular, areasExclusivas, nombreArea, REGLAS, TIPOS_EVENTO } from '../../src/js/precios-eventos.js'
import { areasOcupadas, nuevoCodigo, vistaCliente, avisarNuevaSolicitud } from './_lib/cotizaciones.mjs'

const MAX_POR_HORA = 6
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

// POST /api/cotizaciones: el cliente pide una cotización. El monto lo calcula el servidor.
// GET  /api/cotizaciones?codigo=COT-2026-001&tel=9393: seguimiento (pide los últimos 4 del teléfono).
export default async (req, context) => {
    if (req.method === 'GET') return seguimiento(req)
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

    const d = await leerJson(req, 6144)
    if (!d || d.web) return json({ error: 'Solicitud inválida' }, 400)

    const tipoEvento = TIPOS_EVENTO.includes(d.tipoEvento) ? d.tipoEvento : null
    if (!tipoEvento) return json({ error: 'Elija el tipo de actividad' }, 400)

    const hoy = hoyCR()
    const fecha = d.fechaEvento
    if (!fechaValida(fecha)) return json({ error: 'Fecha no válida' }, 400)
    const faltan = diasEntre(hoy, fecha)
    if (faltan < REGLAS.minDiasAnticipacion) return json({ error: `Las cotizaciones se piden con al menos ${REGLAS.minDiasAnticipacion} días de anticipación. Para antes, escríbanos por WhatsApp.` }, 400)
    if (faltan > REGLAS.maxDiasAdelante) return json({ error: 'Esa fecha está demasiado lejos' }, 400)
    if (REGLAS.diasCerrado.includes(diaSemana(fecha))) return json({ error: 'Los miércoles el balneario permanece cerrado' }, 400)

    const horaInicio = HORA.test(d.horaInicio || '') ? d.horaInicio : ''
    const horaFin = HORA.test(d.horaFin || '') ? d.horaFin : ''
    if (horaInicio && horaFin && horaFin <= horaInicio) return json({ error: 'La hora de fin debe ser después de la de inicio' }, 400)

    const calculo = calcular(d.seleccion)
    if (calculo.personas < REGLAS.minPersonas) return json({ error: `Las cotizaciones de grupo son a partir de ${REGLAS.minPersonas} personas` }, 400)

    const nombre = limpiar(d.nombre, 80)
    if (nombre.length < 2) return json({ error: 'Escriba su nombre' }, 400)
    const telefono = limpiar(d.telefono, 20).replace(/\D/g, '')
    if (telefono.length < 8 || telefono.length > 15) return json({ error: 'Teléfono no válido' }, 400)
    const correo = limpiar(d.correo, 120).toLowerCase()
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return json({ error: 'Correo no válido' }, 400)

    const db = await getDb()
    const col = db.collection('cotizaciones')
    const ahora = new Date()
    const h = huella(ipDe(req, context))
    if (await col.countDocuments({ huella: h, creadaEn: { $gte: new Date(ahora - 3600_000) } }) >= MAX_POR_HORA)
        return json({ error: 'Demasiadas solicitudes. Intente más tarde o escríbanos por WhatsApp.' }, 429)

    const ocupadas = await areasOcupadas(db, fecha)
    const choque = areasExclusivas(calculo.seleccion.areas).filter(a => ocupadas.has(a))
    if (choque.length) return json({ error: `Ese día ya está apartado: ${choque.map(nombreArea).join(' y ')}. Elija otra fecha u otra área.`, ocupadas: [...ocupadas] }, 409)

    const cot = {
        codigo: await nuevoCodigo(db, ahora),
        estado: 'solicitada',
        tipoEvento, institucion: limpiar(d.institucion, 80),
        fechaEvento: fecha, horaInicio, horaFin,
        seleccion: calculo.seleccion, calculo,
        nombre, telefono, correo, comentarios: limpiar(d.comentarios, 600),
        huella: h, creadaEn: ahora, actualizadaEn: ahora,
        apartadoHasta: new Date(ahora.getTime() + REGLAS.diasApartado * 86400000),
        historial: [{ estado: 'solicitada', en: ahora, por: 'cliente' }],
        tareasHechas: []
    }
    await col.insertOne(cot)
    await avisarNuevaSolicitud(cot)
    return json(vistaCliente(cot), 201)
}

async function seguimiento(req) {
    const u = new URL(req.url)
    const codigo = String(u.searchParams.get('codigo') || '').toUpperCase().trim()
    const tel = String(u.searchParams.get('tel') || '').replace(/\D/g, '')
    if (!/^COT-\d{4}-\d{3,}$/.test(codigo) || tel.length !== 4) return json({ error: 'Escriba el código (COT-2026-001) y los últimos 4 números de su teléfono' }, 400)
    const db = await getDb()
    const c = await db.collection('cotizaciones').findOne({ codigo })
    // Mismo mensaje si no existe o si el teléfono no coincide: no revela qué códigos existen
    if (!c || !c.telefono.endsWith(tel)) return json({ error: 'No encontramos una solicitud con esos datos' }, 404)
    return json(vistaCliente(c))
}

export const config = { path: '/api/cotizaciones' }
