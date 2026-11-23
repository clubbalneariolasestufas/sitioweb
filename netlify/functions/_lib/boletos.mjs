import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { getDb } from './db.mjs'
import { firmar } from './tokens.mjs'

const esDuplicado = e => e?.code === 11000

// Crea los boletos de una orden pagada. Es idempotente: si ya existen (o existen algunos
// por un fallo a medias), solo crea los que faltan.
export async function asegurarBoletos(orden) {
    const db = await getDb()
    const col = db.collection('boletos')
    let existentes = await col.find({ ordenCodigo: orden.codigo }).toArray()
    // Un boleto por persona: primero las entradas generales, luego los menores (gratis)
    const general = orden.general ?? orden.cantidad
    for (let i = existentes.length; i < orden.cantidad; i++) {
        const esMenor = i >= general
        const paseId = esMenor ? 'menor' : orden.paseId
        const nombrePase = esMenor ? 'Menor de 4 años' : (orden.general != null ? 'Entrada general' : orden.nombrePase)
        const id = randomUUID()
        const token = firmar({ v: 1, b: id, o: orden.codigo, f: orden.fechaVisita })
        try {
            await col.insertOne({
                id, ordenCodigo: orden.codigo, paseId, nombrePase, ranchos: orden.ranchos || [],
                fechaVisita: orden.fechaVisita, token, estado: 'valido', usadoEn: null, creadoEn: new Date()
            })
        } catch (e) { if (!esDuplicado(e)) throw e }
    }
    existentes = await col.find({ ordenCodigo: orden.codigo }).toArray()
    return existentes.slice(0, orden.cantidad)
}

export async function boletosConQr(orden) {
    const boletos = await asegurarBoletos(orden)
    return Promise.all(boletos.map(async b => ({
        id: b.id,
        nombrePase: b.nombrePase,
        fechaVisita: b.fechaVisita,
        ranchos: b.ranchos || [],
        token: b.token,
        qr: await QRCode.toDataURL(b.token, { errorCorrectionLevel: 'M', margin: 2, width: 360 })
    })))
}
