import { getDb } from './_lib/db.mjs'
import { json } from './_lib/http.mjs'
import { hoyCR, fechaValida, diaSemana } from './_lib/fechas.mjs'
import { areasExclusivas, REGLAS, AREAS } from '../../src/js/precios-eventos.js'
import { ACTIVOS, aparta } from './_lib/cotizaciones.mjs'

const sumar = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)

// GET /api/disponibilidad?desde=2026-12-01&dias=42
// Qué áreas exclusivas están apartadas cada día. No devuelve datos de clientes.
export default async req => {
    const u = new URL(req.url)
    const hoy = hoyCR()
    let desde = u.searchParams.get('desde') || hoy
    if (!fechaValida(desde) || desde < hoy) desde = hoy
    const dias = Math.min(Math.max(Number(u.searchParams.get('dias')) || 42, 1), 93)
    const hasta = sumar(desde, dias - 1)

    const db = await getDb()
    const lista = await db.collection('cotizaciones').find({ fechaEvento: { $gte: desde, $lte: hasta }, estado: { $in: ACTIVOS } }).toArray()
    const ocupado = {}
    for (const c of lista) if (aparta(c)) for (const a of areasExclusivas(c.seleccion?.areas)) (ocupado[c.fechaEvento] ??= new Set()).add(a)

    const exclusivas = AREAS.filter(a => a.exclusivo).map(a => a.id)
    const resultado = []
    for (let i = 0; i < dias; i++) {
        const f = sumar(desde, i)
        const tomadas = [...(ocupado[f] || [])]
        resultado.push({
            fecha: f,
            cerrado: REGLAS.diasCerrado.includes(diaSemana(f)),
            ocupadas: tomadas,
            lleno: exclusivas.every(a => tomadas.includes(a))
        })
    }
    return new Response(JSON.stringify({ desde, dias: resultado }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' }
    })
}

export const config = { path: '/api/disponibilidad' }
