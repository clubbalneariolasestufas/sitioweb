import { ESTADOS, REGLAS, areasExclusivas, tareasDe, nombreArea, colones } from '../../../src/js/precios-eventos.js'
import { hoyCR } from './fechas.mjs'
import { enviarCorreo } from './correo.mjs'

export const ACTIVOS = Object.keys(ESTADOS).filter(e => ESTADOS[e].apartaFecha)

// ¿Esta cotización todavía aparta la fecha? (las vencidas aún no marcadas por la tarea programada no cuentan)
export function aparta(c, ahora = new Date()) {
    if (!ESTADOS[c.estado]?.apartaFecha) return false
    if (c.estado === 'solicitada') return new Date(c.apartadoHasta) > ahora
    if (c.estado === 'cotizada') return new Date(c.validaHasta) > ahora
    return true
}

// Áreas exclusivas ya tomadas en una fecha (sin contar la cotización `excepto`)
export async function areasOcupadas(db, fecha, excepto = null) {
    const lista = await db.collection('cotizaciones').find({ fechaEvento: fecha, estado: { $in: ACTIVOS } }).toArray()
    const ocupadas = new Set()
    for (const c of lista) if (c.codigo !== excepto && aparta(c)) areasExclusivas(c.seleccion?.areas).forEach(a => ocupadas.add(a))
    return ocupadas
}

export async function nuevoCodigo(db, ahora = new Date()) {
    const anio = hoyCR(ahora).slice(0, 4)
    const r = await db.collection('contadores').findOneAndUpdate(
        { _id: 'cot-' + anio }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' })
    return `COT-${anio}-${String(r.n).padStart(3, '0')}`
}

// Vista pública (seguimiento del cliente): sin datos internos
export function vistaCliente(c) {
    return {
        codigo: c.codigo, estado: c.estado, nombreEstado: ESTADOS[c.estado]?.nombre || c.estado,
        tipoEvento: c.tipoEvento, fechaEvento: c.fechaEvento, horaInicio: c.horaInicio, horaFin: c.horaFin,
        personas: c.calculo.personas, lineas: c.calculo.lineas,
        subtotal: c.calculo.subtotal, servicio: c.calculo.servicio, iva: c.calculo.iva,
        total: c.totalFinal ?? c.calculo.total, adelanto: c.adelantoFinal ?? c.calculo.adelanto,
        apartadoHasta: c.apartadoHasta, validaHasta: c.validaHasta || null,
        mensaje: c.mensajeCliente || '', historial: (c.historial || []).map(h => ({ estado: h.estado, en: h.en }))
    }
}

export const conTareas = c => ({ ...c, tareas: tareasDe(c) })

// Marca como vencidas las solicitudes y cotizaciones cuyo plazo pasó.
export async function vencerCotizaciones(db, ahora = new Date()) {
    const col = db.collection('cotizaciones')
    const lista = await col.find({ estado: { $in: ['solicitada', 'cotizada'] } }).toArray()
    let n = 0
    for (const c of lista) {
        if (aparta(c, ahora)) continue
        const r = await col.updateOne({ codigo: c.codigo, estado: c.estado }, {
            $set: { estado: 'vencida', actualizadaEn: ahora },
            $push: { historial: { estado: 'vencida', en: ahora, por: 'sistema' } }
        })
        n += r.modifiedCount
    }
    return n
}

// Resumen diario por correo para la administración: tareas de hoy y mañana, y solicitudes nuevas.
export async function resumenDiario(db, ahora = new Date()) {
    const destino = process.env.EVENTOS_EMAIL || process.env.CLUB_EMAIL
    if (!destino) return false
    const hoy = hoyCR(ahora)
    const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Costa_Rica', hour: '2-digit', hour12: false }).format(ahora))
    if (hora < 6) return false
    const marca = db.collection('estado_sistema')
    const previa = await marca.findOne({ _id: 'resumen-eventos' })
    if (previa?.fecha === hoy) return false

    const manana = new Date(Date.parse(hoy + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
    const hasta = new Date(Date.parse(hoy + 'T12:00:00Z') + 8 * 86400000).toISOString().slice(0, 10)
    const proximas = await db.collection('cotizaciones').find({ fechaEvento: { $gte: hoy, $lte: hasta }, estado: { $in: ['reservada', 'confirmada', 'cotizada', 'solicitada'] } }).toArray()
    const tareas = []
    for (const c of proximas) for (const t of tareasDe(c)) if (!t.hecha && (t.fecha === hoy || t.fecha === manana) && ['reservada', 'confirmada'].includes(c.estado))
        tareas.push(`${t.fecha === hoy ? 'HOY' : 'Mañana'} · ${t.texto} · ${c.codigo} ${c.nombre} (${c.fechaEvento}) · ${t.encargado}`)
    const pendientes = (await db.collection('cotizaciones').find({ estado: 'solicitada' }).toArray()).filter(c => aparta(c, ahora))

    if (!tareas.length && !pendientes.length) { await marca.updateOne({ _id: 'resumen-eventos' }, { $set: { fecha: hoy } }, { upsert: true }); return false }
    const texto = [
        tareas.length ? 'TAREAS\n' + tareas.join('\n') : 'Sin tareas para hoy ni mañana.',
        pendientes.length ? '\nSOLICITUDES POR COTIZAR\n' + pendientes.map(c => `${c.codigo} · ${c.nombre} · ${c.fechaEvento} · ${c.calculo.personas} personas · ${colones(c.calculo.total)}`).join('\n') : '',
        '\nAbra el panel de eventos para ver el detalle.'
    ].join('\n')
    const ok = await enviarCorreo({ para: destino, asunto: `Las Estufas: eventos y tareas del ${hoy}`, texto })
    if (ok) await marca.updateOne({ _id: 'resumen-eventos' }, { $set: { fecha: hoy } }, { upsert: true })
    return ok
}

export function avisarNuevaSolicitud(c) {
    const destino = process.env.EVENTOS_EMAIL || process.env.CLUB_EMAIL
    if (!destino) return Promise.resolve(false)
    const areas = (c.seleccion.areas || []).map(nombreArea).join(', ') || 'ninguna'
    return enviarCorreo({
        para: destino,
        asunto: `Nueva solicitud de evento ${c.codigo} (${c.fechaEvento})`,
        texto: `${c.nombre} · ${c.telefono}${c.correo ? ' · ' + c.correo : ''}\n${c.tipoEvento}${c.institucion ? ' · ' + c.institucion : ''}\nFecha: ${c.fechaEvento} ${c.horaInicio || ''}-${c.horaFin || ''}\nPersonas: ${c.calculo.personas}\nÁreas: ${areas}\nTotal estimado: ${colones(c.calculo.total)}\nComentarios: ${c.comentarios || '-'}\n\nLa fecha queda apartada ${REGLAS.diasApartado} días. Envíe la cotización desde el panel de eventos.`
    })
}

// ---------- Calendario (ICS) para Google Calendar ----------
const escIcs = t => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const fIcs = iso => iso.replace(/-/g, '')
const sig = iso => new Date(Date.parse(iso + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
const doblar = linea => { const out = []; let s = linea; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74) } out.push(s); return out.join('\r\n') }

export function generarIcs(cotizaciones, ahora = new Date()) {
    const sello = ahora.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Club Las Estufas//Eventos//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Las Estufas · Eventos', 'X-WR-TIMEZONE:America/Costa_Rica']
    for (const c of cotizaciones) {
        if (!['cotizada', 'reservada', 'confirmada', 'solicitada'].includes(c.estado)) continue
        const firme = ['reservada', 'confirmada'].includes(c.estado)
        const evento = ['BEGIN:VEVENT', `UID:${c.codigo}@lasestufas`, `DTSTAMP:${sello}`]
        if (c.horaInicio && c.horaFin) evento.push(`DTSTART;TZID=America/Costa_Rica:${fIcs(c.fechaEvento)}T${c.horaInicio.replace(':', '')}00`, `DTEND;TZID=America/Costa_Rica:${fIcs(c.fechaEvento)}T${c.horaFin.replace(':', '')}00`)
        else evento.push(`DTSTART;VALUE=DATE:${fIcs(c.fechaEvento)}`, `DTEND;VALUE=DATE:${fIcs(sig(c.fechaEvento))}`)
        evento.push(
            `SUMMARY:${escIcs(`${firme ? '' : '[' + ESTADOS[c.estado].nombre + '] '}${c.tipoEvento} · ${c.nombre} (${c.calculo.personas} p.)`)}`,
            `DESCRIPTION:${escIcs(`${c.codigo}\nTel. ${c.telefono}\nÁreas: ${(c.seleccion.areas || []).map(nombreArea).join(', ') || '-'}\nTotal: ${colones(c.totalFinal ?? c.calculo.total)}`)}`,
            `STATUS:${firme ? 'CONFIRMED' : 'TENTATIVE'}`, 'END:VEVENT')
        L.push(...evento)
        if (firme) for (const t of tareasDe(c)) {
            if (t.hecha) continue
            L.push('BEGIN:VEVENT', `UID:${c.codigo}-${t.id}@lasestufas`, `DTSTAMP:${sello}`,
                `DTSTART;VALUE=DATE:${fIcs(t.fecha)}`, `DTEND;VALUE=DATE:${fIcs(sig(t.fecha))}`,
                `SUMMARY:${escIcs(`Tarea: ${t.texto} (${c.codigo})`)}`, `DESCRIPTION:${escIcs(`Encargado: ${t.encargado}\nEvento del ${c.fechaEvento}: ${c.nombre}`)}`,
                'BEGIN:VALARM', 'TRIGGER:-PT15H', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(t.texto)}`, 'END:VALARM', 'END:VEVENT')
        }
    }
    L.push('END:VCALENDAR')
    return L.map(doblar).join('\r\n') + '\r\n'
}
