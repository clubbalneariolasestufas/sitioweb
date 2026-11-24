import { RANCHOS, MINUTOS_APARTADO } from '../../../src/js/precios-tiquetes.js'

// Agenda única de los ranchos. Un documento por (fecha, rancho), con _id "AAAA-MM-DD#n":
// el _id es único en la base, así que dos clientes nunca pueden quedarse con el mismo rancho.
//   firme: false -> apartado mientras llega el pago (vence en `hasta`)
//   firme: true  -> pagado, o marcado por el personal en la puerta
const COL = 'ranchos_reservas'
const LEJOS = new Date('2100-01-01T00:00:00Z')
const id = (fecha, n) => `${fecha}#${n}`

// Intenta quedarse con un cupo de una agenda (un rancho o media hora de cancha). Se puede si nadie
// lo tiene, si ya es de esta orden, o si el apartado anterior venció sin pagarse.
export async function tomarCupo(col, _id, datos, orden, hasta, firme, ahora) {
    const doc = { _id, ...datos, orden, hasta, firme, actualizado: ahora }
    try {
        await col.insertOne(doc)
        return 'nuevo'
    } catch (e) {
        if (e?.code !== 11000) throw e
    }
    const mio = await col.findOneAndUpdate({ _id, orden }, { $set: { hasta, firme, actualizado: ahora } })
    if (mio) return 'mio'
    const vencido = await col.findOneAndUpdate({ _id, firme: false, hasta: { $lt: ahora } }, { $set: { orden, hasta, firme, actualizado: ahora } })
    return vencido ? 'nuevo' : null
}
const tomarUno = (col, fecha, n, orden, hasta, firme, ahora) => tomarCupo(col, id(fecha, n), { fecha, rancho: n }, orden, hasta, firme, ahora)
export const LEJOS_2100 = LEJOS

// Aparta (o confirma, con firme=true) varios ranchos para una orden. Todo o nada.
export async function apartarRanchos(db, { fecha, ranchos, orden, firme = false, ahora = new Date() }) {
    const col = db.collection(COL)
    const hasta = firme ? LEJOS : new Date(ahora.getTime() + MINUTOS_APARTADO * 60_000)
    const tomados = []
    for (const n of ranchos) {
        const r = await tomarUno(col, fecha, n, orden, hasta, firme, ahora)
        if (!r) {
            // Devuelve los que se acababan de tomar en esta llamada
            for (const t of tomados) await col.deleteOne({ _id: id(fecha, t), orden, firme: false })
            return { ok: false, ocupado: n }
        }
        if (r === 'nuevo') tomados.push(n)
    }
    return { ok: true, hasta }
}

export async function liberarRanchos(db, orden) {
    return db.collection(COL).deleteMany({ orden, firme: false })
}

// Ranchos no disponibles en una fecha (pagados, del personal o con apartado vigente)
export async function ranchosOcupados(db, fecha, ahora = new Date()) {
    const docs = await db.collection(COL).find({ fecha }).toArray()
    return docs.filter(d => d.firme || new Date(d.hasta) > ahora).map(d => d.rancho).sort((a, b) => a - b)
}

export async function ocupacionRango(db, desde, hasta, ahora = new Date()) {
    const docs = await db.collection(COL).find({ fecha: { $gte: desde, $lte: hasta } }).toArray()
    const mapa = {}
    for (const d of docs) if (d.firme || new Date(d.hasta) > ahora) (mapa[d.fecha] ??= []).push(d.rancho)
    return mapa
}

// Vista del personal: estado de cada rancho en una fecha
export async function ranchosDelDia(db, fecha, ahora = new Date()) {
    const docs = await db.collection(COL).find({ fecha }).toArray()
    const ordenes = db.collection('ordenes')
    const salida = []
    for (const n of RANCHOS) {
        const d = docs.find(x => x.rancho === n)
        if (!d || (!d.firme && new Date(d.hasta) <= ahora)) { salida.push({ rancho: n, estado: 'libre' }); continue }
        if (String(d.orden).startsWith('PERSONAL')) { salida.push({ rancho: n, estado: 'personal', detalle: 'Ocupado en la puerta' }); continue }
        const o = await ordenes.findOne({ codigo: d.orden })
        salida.push({
            rancho: n,
            estado: d.firme ? 'reservado' : 'apartado',
            orden: d.orden,
            nombre: o?.nombre || '',
            personas: o?.cantidad || 0,
            hasta: d.firme ? null : d.hasta
        })
    }
    return salida
}

// El personal marca un rancho como ocupado (llegó alguien sin reserva) o lo libera
export async function ocuparEnPuerta(db, fecha, n, ahora = new Date()) {
    const r = await tomarUno(db.collection(COL), fecha, n, 'PERSONAL', LEJOS, true, ahora)
    return Boolean(r)
}
export async function liberarDePuerta(db, fecha, n) {
    const r = await db.collection(COL).deleteOne({ _id: id(fecha, n), orden: 'PERSONAL' })
    return r.deletedCount > 0
}
