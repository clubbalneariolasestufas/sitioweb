import { json, leerJson } from './_lib/http.mjs'
import { autorizar } from './_lib/acceso.mjs'
import { hoyCR } from './_lib/fechas.mjs'
import { verificar } from './_lib/tokens.mjs'

// POST /api/validar-boleto { pin, token, grupo? }
// Marca el boleto como usado la primera vez que se escanea. Con grupo: true da ingreso también
// a los acompañantes de la misma compra (útil en eventos masivos: un escaneo por familia).
export default async (req, context) => {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    const d = await leerJson(req, 2048)
    if (!d) return json({ error: 'Solicitud inválida' }, 400)
    const acceso = await autorizar(req, context, d.pin)
    if (acceso.error) return acceso.error

    const payload = verificar(d.token)
    if (!payload?.b) return json({ resultado: 'falso', mensaje: 'Código QR no válido' })

    const boletos = acceso.db.collection('boletos')
    const boleto = await boletos.findOne({ id: payload.b })
    if (!boleto || boleto.token !== d.token) return json({ resultado: 'falso', mensaje: 'Código QR no válido' })

    const hoy = hoyCR()
    const info = { nombrePase: boleto.nombrePase, fechaVisita: boleto.fechaVisita, orden: boleto.ordenCodigo }
    if (boleto.fechaVisita !== hoy)
        return json({ resultado: 'otra_fecha', mensaje: `Este boleto es para el ${boleto.fechaVisita}`, ...info })

    const delGrupo = { ordenCodigo: boleto.ordenCodigo, fechaVisita: hoy, estado: 'valido' }

    if (d.grupo === true) {
        const r = await boletos.updateMany(delGrupo, { $set: { estado: 'usado', usadoEn: new Date(), via: 'grupo' } })
        return json({ resultado: 'grupo', mensaje: `Ingresaron ${r.modifiedCount} acompañante(s)`, ingresados: r.modifiedCount, restantesGrupo: 0, ...info })
    }

    const marcado = await boletos.findOneAndUpdate(
        { id: boleto.id, estado: 'valido' },
        { $set: { estado: 'usado', usadoEn: new Date(), via: 'qr' } },
        { returnDocument: 'after' }
    )
    const restantesGrupo = await boletos.countDocuments(delGrupo)
    if (!marcado) {
        const otra = await boletos.findOne({ id: boleto.id })
        return json({ resultado: 'usado', mensaje: 'Este boleto ya fue usado', usadoEn: otra?.usadoEn, restantesGrupo, ...info })
    }
    return json({ resultado: 'ok', mensaje: 'Boleto válido: puede pasar', restantesGrupo, ...info })
}

export const config = { path: '/api/validar-boleto' }
