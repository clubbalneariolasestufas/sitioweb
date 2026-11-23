// Base de datos mínima en memoria que imita lo que usan las funciones (solo para pruebas).
const val = x => (x instanceof Date ? x.getTime() : x)

function coincide(doc, filtro) {
    return Object.entries(filtro).every(([k, v]) => {
        const x = doc[k]
        if (v && typeof v === 'object' && !(v instanceof Date)) {
            return Object.entries(v).every(([op, arg]) => {
                const a = val(x), b = val(arg)
                switch (op) {
                    case '$lt': return a < b
                    case '$lte': return a <= b
                    case '$gt': return a > b
                    case '$gte': return a >= b
                    case '$ne': return a !== b
                    case '$in': return arg.map(val).includes(a)
                    case '$regex': return new RegExp(arg).test(String(x ?? ''))
                    default: throw new Error('Operador no soportado: ' + op)
                }
            })
        }
        return val(x) === val(v)
    })
}

function aplicar(doc, upd) {
    for (const [k, v] of Object.entries(upd.$set || {})) doc[k] = v
    for (const [k, v] of Object.entries(upd.$inc || {})) doc[k] = (doc[k] || 0) + v
    for (const k of Object.keys(upd.$unset || {})) delete doc[k]
    for (const [k, v] of Object.entries(upd.$addToSet || {})) { doc[k] ??= []; if (!doc[k].includes(v)) doc[k].push(v) }
    for (const [k, v] of Object.entries(upd.$push || {})) { doc[k] ??= []; doc[k].push(v) }
    for (const [k, v] of Object.entries(upd.$pull || {})) { if (Array.isArray(doc[k])) doc[k] = doc[k].filter(x => x !== v) }
}

const UNICOS = { ordenes: 'codigo', pagos_sinpe: 'comprobante', boletos: 'id', cotizaciones: 'codigo', ranchos_reservas: '_id' }

export function crearDbFalsa() {
    const datos = {}
    const col = nombre => {
        const filas = (datos[nombre] ??= [])
        return {
            filas,
            async insertOne(doc) {
                const u = UNICOS[nombre]
                if (u && filas.some(f => f[u] === doc[u])) throw Object.assign(new Error('duplicado'), { code: 11000 })
                filas.push(structuredClone(doc))
                return { acknowledged: true }
            },
            async findOne(f) { const r = filas.find(d => coincide(d, f)); return r ? structuredClone(r) : null },
            find(f) {
                let r = filas.filter(d => coincide(d, f)).map(d => structuredClone(d))
                const cursor = {
                    sort(orden) { const [[k, dir]] = Object.entries(orden); r.sort((a, b) => (val(a[k]) > val(b[k]) ? 1 : -1) * dir); return cursor },
                    limit(n) { r = r.slice(0, n); return cursor },
                    toArray: async () => r
                }
                return cursor
            },
            async countDocuments(f) { return filas.filter(d => coincide(d, f)).length },
            async findOneAndUpdate(f, upd, opciones = {}) {
                let d = filas.find(x => coincide(x, f))
                if (!d && opciones.upsert) { d = { ...f }; filas.push(d) }
                if (!d) return null
                aplicar(d, upd)
                return structuredClone(d)
            },
            async updateOne(f, upd, opciones = {}) {
                let d = filas.find(x => coincide(x, f))
                if (!d && opciones.upsert) { d = { ...f }; filas.push(d) }
                if (d) aplicar(d, upd)
                return { modifiedCount: d ? 1 : 0 }
            },
            async updateMany(f, upd) {
                const lista = filas.filter(x => coincide(x, f))
                lista.forEach(d => aplicar(d, upd))
                return { modifiedCount: lista.length }
            },
            async deleteOne(f) {
                const i = filas.findIndex(x => coincide(x, f))
                if (i >= 0) filas.splice(i, 1)
                return { deletedCount: i >= 0 ? 1 : 0 }
            },
            async deleteMany(f) {
                let n = 0
                for (let i = filas.length - 1; i >= 0; i--) if (coincide(filas[i], f)) { filas.splice(i, 1); n++ }
                return { deletedCount: n }
            },
            async createIndex() {}
        }
    }
    return { collection: col, datos, command: async () => ({ ok: 1 }) }
}
