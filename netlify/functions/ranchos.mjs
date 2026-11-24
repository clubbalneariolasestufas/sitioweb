import { getDb } from './_lib/db.mjs'
import { json } from './_lib/http.mjs'
import { hoyCR, fechaValida } from './_lib/fechas.mjs'
import { ocupacionRango } from './_lib/ranchos.mjs'
import { tenisRango } from './_lib/tenis.mjs'
import { precioRancho, estaCerrado, MAX_DIAS_ADELANTE } from '../../src/js/precios-tiquetes.js'

const sumar = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)

// GET /api/ranchos?desde=AAAA-MM-DD&dias=42 — ranchos ocupados y medias horas de cancha tomadas, por día.
// No devuelve datos de clientes.
export default async req => {
    const u = new URL(req.url)
    const hoy = hoyCR()
    let desde = u.searchParams.get('desde') || hoy
    if (!fechaValida(desde) || desde < hoy) desde = hoy
    const dias = Math.min(Math.max(Number(u.searchParams.get('dias')) || 1, 1), MAX_DIAS_ADELANTE + 1)
    const hasta = sumar(desde, dias - 1)
    const db = await getDb()
    const [mapa, tenis] = await Promise.all([ocupacionRango(db, desde, hasta), tenisRango(db, desde, hasta)])
    const lista = []
    for (let i = 0; i < dias; i++) {
        const f = sumar(desde, i)
        lista.push({ fecha: f, cerrado: estaCerrado(f), ocupados: (mapa[f] || []).sort((a, b) => a - b), tenis: tenis[f] || [], precioRancho: precioRancho(f) })
    }
    return new Response(JSON.stringify({ desde, dias: lista }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    })
}

export const config = { path: '/api/ranchos' }
