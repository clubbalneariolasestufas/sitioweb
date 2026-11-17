import { getDb } from './_lib/db.mjs'
import { calcularEstado } from './_lib/estado.mjs'
import { reintentarPendientes } from './_lib/loyverse.mjs'
import { enviarAlerta } from './_lib/correo.mjs'

// Cada 30 minutos: envía a Loyverse las ventas pendientes y avisa por correo si algo está en rojo
// (como máximo un correo cada 6 horas).
export default async () => {
    const db = await getDb()
    await reintentarPendientes(db, 20)
    const estado = await calcularEstado(db)
    const rojos = estado.items.filter(i => i.estado === 'rojo')
    if (rojos.length) {
        const col = db.collection('estado_sistema')
        const previa = await col.findOne({ _id: 'alerta' })
        if (!previa || Date.now() - new Date(previa.en).getTime() > 6 * 3600_000) {
            const texto = rojos.map(i => `${i.nombre}: ${i.detalle}\nQué hacer: ${i.queHacer}`).join('\n\n')
            if (await enviarAlerta('Club Las Estufas: hay un problema en el sistema de boletos', texto + '\n\nVea el detalle en el panel del personal.'))
                await col.updateOne({ _id: 'alerta' }, { $set: { en: new Date() } }, { upsert: true })
        }
    }
    return new Response('ok')
}

export const config = { schedule: '*/30 * * * *' }
