import { timingSafeEqual, createHash } from 'node:crypto'
import { getDb } from './_lib/db.mjs'
import { hoyCR } from './_lib/fechas.mjs'
import { generarIcs } from './_lib/cotizaciones.mjs'

const igual = (a, b) => {
    const h = x => createHash('sha256').update(String(x)).digest()
    return timingSafeEqual(h(a), h(b))
}

// GET /api/calendario.ics?k=TOKEN — calendario privado de eventos y tareas.
// Se agrega en Google Calendar con «Otros calendarios → Desde URL». Google lo refresca solo cada pocas horas.
export default async req => {
    const token = process.env.CALENDARIO_TOKEN
    const k = new URL(req.url).searchParams.get('k') || ''
    if (!token || token.length < 24 || !igual(k, token)) return new Response('No autorizado', { status: 401 })
    const db = await getDb()
    const desde = new Date(Date.parse(hoyCR() + 'T12:00:00Z') - 60 * 86400000).toISOString().slice(0, 10)
    const lista = await db.collection('cotizaciones').find({ fechaEvento: { $gte: desde } }).sort({ fechaEvento: 1 }).limit(1000).toArray()
    return new Response(generarIcs(lista), {
        headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'X-Robots-Tag': 'noindex' }
    })
}

export const config = { path: '/api/calendario.ics' }
