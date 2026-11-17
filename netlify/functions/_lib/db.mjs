import { MongoClient } from 'mongodb'

let promesa = null
let dbFalsa = null

// Solo para pruebas automáticas
export const setDbParaPruebas = db => { dbFalsa = db }

export async function getDb() {
    if (dbFalsa) return dbFalsa
    if (!promesa) {
        const uri = process.env.MONGODB_URI
        if (!uri) throw new Error('Falta la variable MONGODB_URI')
        const cliente = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000 })
        promesa = cliente.connect()
            .then(async c => {
                const db = c.db(process.env.MONGODB_DB || 'las_estufas')
                await asegurarIndices(db)
                return db
            })
            .catch(e => { promesa = null; throw e })
    }
    return promesa
}

async function asegurarIndices(db) {
    await Promise.all([
        db.collection('ordenes').createIndex({ codigo: 1 }, { unique: true }),
        db.collection('ordenes').createIndex({ huella: 1, creadaEn: 1 }),
        db.collection('pagos_sinpe').createIndex({ comprobante: 1 }, { unique: true }),
        db.collection('pagos_sinpe').createIndex({ estado: 1, monto: 1, ultimos4: 1 }),
        db.collection('pagos_sinpe').createIndex({ codigoOrden: 1, estado: 1 }),
        db.collection('boletos').createIndex({ id: 1 }, { unique: true }),
        db.collection('boletos').createIndex({ ordenCodigo: 1 }),
        db.collection('ordenes').createIndex({ telefono: 1 }),
        db.collection('ordenes').createIndex({ loyverseEstado: 1 }),
        db.collection('boletos').createIndex({ fechaVisita: 1, estado: 1 }),
        db.collection('avisos_banco').createIndex({ en: 1 }, { expireAfterSeconds: 30 * 86400 }),
        db.collection('puerta_fallos').createIndex({ en: 1 }, { expireAfterSeconds: 3600 })
    ])
}
