import { MINUTOS_APARTADO, bloquesTenis, hhmm } from '../../../src/js/precios-tiquetes.js'
import { tomarCupo, LEJOS_2100 } from './ranchos.mjs'

// Agenda de la cancha de tenis: un documento por (fecha, media hora), con _id "AAAA-MM-DD@540"
// (540 = 9:00 en minutos). Igual que los ranchos: el _id único impide que dos clientes tengan la misma media hora.
const COL = 'tenis_reservas'
const id = (fecha, min) => `${fecha}@${min}`

// Aparta (o confirma con firme=true) todos los bloques de una reserva. Todo o nada.
export async function apartarTenis(db, { fecha, inicio, bloques, orden, firme = false, personal = false, minutos = MINUTOS_APARTADO, ahora = new Date() }) {
    const col = db.collection(COL)
    const hasta = firme ? LEJOS_2100 : new Date(ahora.getTime() + minutos * 60_000)
    const tomados = []
    for (const min of bloquesTenis(inicio, bloques)) {
        const r = await tomarCupo(col, id(fecha, min), personal ? { fecha, min, personal: true } : { fecha, min }, orden, hasta, firme, ahora)
        if (!r) {
            for (const t of tomados) await col.deleteOne({ _id: id(fecha, t), orden, firme: false })
            return { ok: false, ocupado: hhmm(min) }
        }
        if (r === 'nuevo') tomados.push(min)
    }
    return { ok: true, hasta }
}

export const liberarTenis = (db, orden) => db.collection(COL).deleteMany({ orden, firme: false })

// Medias horas no disponibles por fecha: { 'AAAA-MM-DD': [540, 570] }
export async function tenisRango(db, desde, hasta, ahora = new Date()) {
    const docs = await db.collection(COL).find({ fecha: { $gte: desde, $lte: hasta } }).toArray()
    const mapa = {}
    for (const d of docs) if (d.firme || new Date(d.hasta) > ahora) (mapa[d.fecha] ??= []).push(d.min)
    for (const k in mapa) mapa[k].sort((a, b) => a - b)
    return mapa
}

// Vista del personal: reservas de cancha del día, en tramos seguidos de una misma orden
export async function tenisDelDia(db, fecha, ahora = new Date()) {
    const docs = (await db.collection(COL).find({ fecha }).toArray())
        .filter(d => d.firme || new Date(d.hasta) > ahora)
        .sort((a, b) => a.min - b.min)
    const tramos = []
    for (const d of docs) {
        const ult = tramos.at(-1)
        if (ult && ult.orden === d.orden && ult.finMin === d.min) { ult.finMin += 30; ult.firme &&= d.firme; continue }
        tramos.push({ orden: d.orden, inicioMin: d.min, finMin: d.min + 30, firme: d.firme })
    }
    const ordenes = db.collection('ordenes')
    const salida = []
    for (const t of tramos) {
        const personal = String(t.orden).startsWith('PERSONAL')
        const o = personal ? null : await ordenes.findOne({ codigo: t.orden })
        salida.push({ orden: personal ? '' : t.orden, nombre: personal ? 'Ocupada en la puerta' : (o?.nombre || ''),
            inicio: hhmm(t.inicioMin), fin: hhmm(t.finMin), inicioMin: t.inicioMin, finMin: t.finMin,
            estado: personal ? 'personal' : t.firme ? 'reservado' : 'apartado' })
    }
    return salida
}

// El personal marca la cancha ocupada (alguien pagó en la entrada) o la libera.
// Cada ocupación lleva su propia marca, para que dos clics no se sumen sobre el mismo horario.
export async function ocuparTenisPuerta(db, fecha, inicio, bloques, ahora = new Date()) {
    return apartarTenis(db, { fecha, inicio, bloques, orden: `PERSONAL-${ahora.getTime()}`, firme: true, personal: true, ahora })
}
export async function liberarTenisPuerta(db, fecha, inicio, fin) {
    const r = await db.collection(COL).deleteMany({ fecha, personal: true, min: { $gte: inicio, $lt: fin } })
    return r.deletedCount > 0
}
