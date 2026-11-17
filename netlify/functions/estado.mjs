import { json, leerJson } from './_lib/http.mjs'
import { autorizar } from './_lib/acceso.mjs'
import { calcularEstado } from './_lib/estado.mjs'

// POST /api/estado { pin }: semáforo de conexiones para el panel del personal.
export default async (req, context) => {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    const d = await leerJson(req, 1024)
    if (!d) return json({ error: 'Solicitud inválida' }, 400)
    const acceso = await autorizar(req, context, d.pin)
    if (acceso.error) return acceso.error
    return json({ rol: acceso.rol, ...(await calcularEstado(acceso.db)) })
}

export const config = { path: '/api/estado' }
