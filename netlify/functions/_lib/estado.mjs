import { MIN_LATIDO_LECTOR } from './config.mjs'
import { hoyCR } from './fechas.mjs'
import { loyverseConfigurado, probarLoyverse } from './loyverse.mjs'

const hace = fecha => {
    if (!fecha) return 'nunca'
    const min = Math.round((Date.now() - new Date(fecha).getTime()) / 60000)
    if (min < 1) return 'hace menos de un minuto'
    if (min < 60) return `hace ${min} min`
    if (min < 1440) return `hace ${Math.round(min / 60)} h`
    return `hace ${Math.round(min / 1440)} días`
}
const item = (id, nombre, estado, detalle, queHacer = '') => ({ id, nombre, estado, detalle, queHacer })

// Semáforo de conexiones: verde = funciona, amarillo = atención, rojo = no funciona, gris = sin configurar.
// Los textos están pensados para personal sin conocimientos técnicos.
export async function calcularEstado(db, { conLoyverse = true } = {}) {
    const items = []

    // 1. Base de datos (si esto falla, la función ni siquiera llega aquí; se deja como confirmación)
    try {
        await db.command({ ping: 1 })
        items.push(item('db', 'Sistema de boletos', 'verde', 'El sistema de boletos responde.'))
    } catch {
        items.push(item('db', 'Sistema de boletos', 'rojo', 'No hay conexión con la base de datos.', 'Avise al técnico. Mientras tanto cobre en caja con Loyverse.'))
    }

    // 2. Equipo lector de pagos (Raspberry con módem y correo)
    const lector = await db.collection('estado_sistema').findOne({ _id: 'lector' })
    const minutos = lector ? (Date.now() - new Date(lector.en).getTime()) / 60000 : Infinity
    if (!lector) {
        items.push(item('lector', 'Equipo lector de pagos', 'gris', 'Todavía no se ha conectado nunca.', 'Falta instalar el equipo lector (Raspberry).'))
    } else if (minutos > MIN_LATIDO_LECTOR) {
        items.push(item('lector', 'Equipo lector de pagos', 'rojo', `No da señales ${hace(lector.en)}.`,
            'Revise que la cajita (Raspberry) esté enchufada y con internet. Desenchúfela 10 segundos y vuelva a conectarla. Mientras tanto apruebe los pagos a mano.'))
    } else {
        items.push(item('lector', 'Equipo lector de pagos', 'verde', `Encendido y conectado (${hace(lector.en)}).`))
        const m = lector.modem || {}
        const central = m.via === 'asterisk'
        if (central && m.estadoCentral === 'la central no responde') items.push(item('modem', 'Central telefónica y módem', 'rojo', 'La central telefónica no responde: no entran llamadas ni avisos de SINPE por SMS.', 'Desconecte la cajita de la corriente, espere 10 segundos y conéctela. Si sigue igual, avise al técnico. Los pagos se pueden aprobar a mano.'))
        else if (!m.conectado) items.push(item('modem', central ? 'Central telefónica y módem' : 'Módem de mensajes del banco', 'rojo', 'El módem USB no responde.', 'Revise que el módem USB esté bien conectado a la cajita. Desconéctelo y conéctelo de nuevo.'))
        else if (!m.registrado) items.push(item('modem', 'Módem de mensajes del banco', 'rojo', 'El módem no tiene señal celular.', 'Revise que el chip (SIM) esté activo y con saldo o plan, y mueva el módem a un lugar con mejor señal.'))
        else if ((m.senal ?? 0) < 10) items.push(item('modem', 'Módem de mensajes del banco', 'amarillo', `Señal celular débil (${m.senal} de 31). Último mensaje: ${hace(m.ultimoSms)}.`, 'Mueva el módem cerca de una ventana o use un cable extensor USB.'))
        else items.push(item('modem', central ? 'Central telefónica y módem' : 'Módem de mensajes del banco', 'verde', `Con señal (${m.senal} de 31${m.operador ? ', ' + m.operador : ''})${m.enLlamada ? ', en una llamada ahora' : ''}. Último mensaje: ${hace(m.ultimoSms)}.`))

        const c = lector.correo || {}
        if (!c.activo) items.push(item('correo', 'Correo de confirmación del banco', 'gris', 'La lectura del correo no está configurada.'))
        else if (!c.conectado) items.push(item('correo', 'Correo de confirmación del banco', 'amarillo', 'No se puede leer el correo de confirmación.', 'Los mensajes de texto siguen funcionando. Avise al técnico: puede haber cambiado la contraseña del correo.'))
        else items.push(item('correo', 'Correo de confirmación del banco', 'verde', `Leyendo el correo. Último aviso: ${hace(c.ultimoCorreo)}.`))
    }

    // 3. Loyverse (punto central de venta)
    if (!loyverseConfigurado()) {
        items.push(item('loyverse', 'Loyverse (caja)', 'gris', 'La conexión con Loyverse no está configurada.', 'Las ventas en línea no aparecerán en Loyverse hasta que el técnico la configure.'))
    } else if (conLoyverse) {
        try {
            const { comercio, avisos } = await probarLoyverse()
            if (avisos.length) items.push(item('loyverse', 'Loyverse (caja)', 'amarillo', avisos.join('. ') + '.', 'Avise al técnico para igualar los precios del sitio con los de Loyverse.'))
            else items.push(item('loyverse', 'Loyverse (caja)', 'verde', `Conectado${comercio ? ' con ' + comercio : ''}. Precios iguales a los del sitio.`))
        } catch (e) {
            items.push(item('loyverse', 'Loyverse (caja)', 'rojo', 'No hay conexión con Loyverse.', 'Las ventas en línea se guardan y se enviarán solas a Loyverse cuando vuelva la conexión. Si sigue así una hora, avise al técnico.'))
        }
    }

    // 4. Recibos pendientes de pasar a Loyverse
    const ordenes = db.collection('ordenes')
    const pendientes = await ordenes.countDocuments({ estado: 'pagada', loyverseEstado: 'pendiente' })
    const revisar = await ordenes.countDocuments({ estado: 'pagada', loyverseEstado: 'revisar' })
    const atascadas = await ordenes.countDocuments({ estado: 'pagada', loyverseEstado: 'enviando', loyverseDesde: { $lt: new Date(Date.now() - 600_000) } })
    if (revisar + atascadas) items.push(item('recibos', 'Ventas en línea en Loyverse', 'amarillo', `${revisar + atascadas} venta(s) en línea por revisar a mano en Loyverse.`, 'Avise al técnico: hay que confirmar en Loyverse si el recibo existe antes de volver a enviarlo.'))
    else if (pendientes) items.push(item('recibos', 'Ventas en línea en Loyverse', 'amarillo', `${pendientes} venta(s) en línea esperando pasar a Loyverse.`, 'Se envían solas cada media hora. También puede tocar «Enviar ahora».'))
    else if (loyverseConfigurado()) items.push(item('recibos', 'Ventas en línea en Loyverse', 'verde', 'Todas las ventas en línea están en Loyverse.'))

    // 5. Avisos del banco que el sistema no entendió (últimas 24 horas)
    const raros = await db.collection('avisos_banco').countDocuments({ reconocido: false, en: { $gte: new Date(Date.now() - 86400_000) } })
    if (raros) items.push(item('avisos', 'Avisos del banco sin reconocer', 'amarillo', `${raros} mensaje(s) del banco que el sistema no entendió en las últimas 24 horas.`, 'Si un cliente dice que pagó y el sistema no lo ve, apruebe el pago a mano y avise al técnico.'))

    const orden = ['verde', 'gris', 'amarillo', 'rojo']
    const global = items.reduce((peor, i) => (orden.indexOf(i.estado) > orden.indexOf(peor) ? i.estado : peor), 'verde')
    const hoy = hoyCR()
    const boletos = db.collection('boletos')
    return {
        global: global === 'gris' ? 'amarillo' : global,
        items,
        hoy: {
            fecha: hoy,
            vendidos: await boletos.countDocuments({ fechaVisita: hoy }),
            ingresados: await boletos.countDocuments({ fechaVisita: hoy, estado: 'usado' })
        },
        revisadoEn: new Date().toISOString()
    }
}
