// Cuenta de cada orden (pagos parciales). Montos en colones enteros.
//   D = total de la orden, P = suma de los pagos unidos a la orden, S = D − P (saldo)
//   pendiente: P = 0 · parcial: 0 < P < D · pagada: P ≥ D (si P > D hay sobrepago)
// P se calcula siempre desde pagos_sinpe (estado 'usado' y ordenCodigo = la orden): nunca se suma a mano,
// así una falla a mitad de camino no puede descuadrar la cuenta. Cada comprobante es único en la base,
// por eso un mismo pago no puede contar para dos órdenes.
import { boletosConQr } from './boletos.mjs'
import { completarPago } from './pagos.mjs'
import { apartarRanchos } from './ranchos.mjs'
import { apartarTenis } from './tenis.mjs'
import { colones } from '../../../src/js/precios-tiquetes.js'

export const CREDITO_MINIMO = 1000          // un sobrepago mayor a esto se entrega como crédito el mismo día
export const MINUTOS_EXTRA_PARCIAL = 30     // un pago parcial alarga una vez el apartado de rancho y cancha
const MAX_PAGOS_POR_ORDEN = 10

const suma = pagos => pagos.reduce((s, p) => s + (Number.isInteger(p.monto) ? p.monto : 0), 0)

// Sugerencia cuando un monto se parece al pedido pero con un error típico de digitación
export function pistaMonto(pedido, pagado) {
    if (!pagado || pagado === pedido) return ''
    if (pagado * 10 === pedido) return 'Parece que faltó un cero en el monto.'
    if (pagado * 100 === pedido) return 'Parece que faltaron dos ceros en el monto.'
    if (pagado === pedido * 10) return 'Parece que sobró un cero en el monto.'
    const digitos = n => String(n).split('').sort().join('')
    if (digitos(pagado) === digitos(pedido)) return 'Parece que se cambiaron de lugar números del monto.'
    return ''
}

export async function pagosDeOrden(db, codigo) {
    return db.collection('pagos_sinpe').find({ ordenCodigo: codigo, estado: 'usado' }).toArray()
}

// Une a la orden los pagos libres que cumplan el filtro (por ejemplo, los que traen su código).
// Cada pago se toma de forma atómica (libre -> usado): dos órdenes nunca se quedan con el mismo.
export async function tomarPagos(db, codigo, filtro, max = MAX_PAGOS_POR_ORDEN) {
    const col = db.collection('pagos_sinpe')
    const tomados = []
    while (tomados.length < max) {
        const p = await col.findOneAndUpdate(
            { estado: 'libre', ...filtro },
            { $set: { estado: 'usado', usadoEn: new Date(), ordenCodigo: codigo } },
            { returnDocument: 'after' }
        )
        if (!p) break
        tomados.push(p)
    }
    return tomados
}

// Rancho y cancha durante un pago parcial: quedan firmes si lo pagado ya cubre los complementos;
// si no, el apartado se alarga una vez para dar tiempo a completar.
async function reservasEnParcial(db, orden, recibido) {
    const complementos = (orden.lineas || []).filter(l => l.id === 'rancho' || l.id === 'tenis').reduce((s, l) => s + l.monto, 0)
    if (!orden.ranchos?.length && !orden.tenis) return { garantizadas: true }
    const firme = recibido >= complementos
    const opciones = firme ? { firme: true } : { minutos: MINUTOS_EXTRA_PARCIAL }
    let conflicto = null
    if (orden.ranchos?.length) {
        const r = await apartarRanchos(db, { fecha: orden.fechaVisita, ranchos: orden.ranchos, orden: orden.codigo, ...opciones })
        if (!r.ok) conflicto = `rancho ${r.ocupado}`
    }
    if (orden.tenis) {
        const t = await apartarTenis(db, { fecha: orden.fechaVisita, inicio: orden.tenis.inicio, bloques: orden.tenis.bloques, orden: orden.codigo, ...opciones })
        if (!t.ok) conflicto = conflicto || `cancha a las ${t.ocupado}`
    }
    return { garantizadas: firme && !conflicto, faltaParaGarantizar: firme ? 0 : complementos - recibido, conflicto }
}

// Revisa la cuenta y mueve la orden al estado que corresponde. Es idempotente: se puede llamar cuantas veces sea.
export async function evaluarOrden(db, codigo, extra = {}) {
    const ordenes = db.collection('ordenes')
    const orden = await ordenes.findOne({ codigo })
    if (!orden) return null
    const pagos = await pagosDeOrden(db, codigo)
    const total = orden.total, recibido = suma(pagos), saldo = total - recibido
    const base = { total, recibido, saldo: Math.max(0, saldo), pagos: pagos.length }

    if (orden.estado === 'pagada') return { tipo: 'pagada', orden, ...base, sobrepago: orden.sobrepago || 0, credito: orden.credito || 0, yaEstaba: true }
    if (orden.estado === 'anulada') return { tipo: 'anulada', orden, ...base }
    if (recibido === 0) return { tipo: 'pendiente', orden, ...base }

    if (saldo <= 0) {
        const sobrepago = -saldo
        const credito = sobrepago > CREDITO_MINIMO ? sobrepago : 0
        // Lo que se registra en caja: el total de la venta, repartido por forma de pago real
        const cobros = []
        let porCubrir = total
        for (const p of [...pagos].sort((a, b) => new Date(a.usadoEn || a.fecha) - new Date(b.usadoEn || b.fecha))) {
            const parte = Math.min(p.monto, porCubrir)
            if (parte > 0) cobros.push({ metodo: p.metodo === 'efectivo' ? 'efectivo' : 'sinpe', monto: parte, comprobante: p.comprobante })
            porCubrir -= parte
        }
        const sinpe = pagos.find(p => p.metodo !== 'efectivo')
        const cierre = await completarPago(db, codigo, {
            comprobante: pagos.map(p => p.comprobante).join(' + '),
            ultimos4: sinpe?.ultimos4 || orden.ultimos4Usado || ''
        }, { recibido, saldo: 0, sobrepago, credito, cobros, ...extra })
        if (!cierre) return evaluarOrden(db, codigo)   // otra ejecución la cerró al mismo tiempo
        return { tipo: 'pagada', ...cierre, ...base, sobrepago, credito }
    }

    const primera = orden.estado === 'pendiente'
    const parcial = await ordenes.findOneAndUpdate(
        { codigo, estado: { $in: ['pendiente', 'parcial'] } },
        { $set: { estado: 'parcial', recibido, saldo, ...(primera ? { parcialEn: new Date() } : {}), ...extra } },
        { returnDocument: 'after' }
    )
    if (!parcial) return evaluarOrden(db, codigo)
    const reservas = await reservasEnParcial(db, parcial, recibido)
    if (reservas.conflicto) await ordenes.updateOne({ codigo }, { $set: { ranchoConflicto: reservas.conflicto } })
    const pista = pagos.length === 1 ? pistaMonto(total, recibido) : ''
    return {
        tipo: 'parcial', orden: parcial, ...base, pista, reservas,
        boletos: await boletosConQr(parcial),
        mensaje: `Recibimos ${colones(recibido)} de ${colones(total)}. Faltan ${colones(saldo)}.${pista ? ' ' + pista : ''}`
    }
}

// Tarea programada: une los SINPE que traen el código de una orden aunque el cliente haya cerrado la página
export async function aplicarPagosConCodigo(db, max = 50) {
    const libres = await db.collection('pagos_sinpe').find({ estado: 'libre' }).toArray()
    const codigos = [...new Set(libres.map(p => p.codigoOrden).filter(c => /^[A-Z0-9]{6}$/.test(c || '')))].slice(0, max)
    let aplicados = 0
    for (const codigo of codigos) {
        const o = await db.collection('ordenes').findOne({ codigo })
        if (!o || !['pendiente', 'parcial'].includes(o.estado)) continue
        const desde = new Date(new Date(o.creadaEn).getTime() - 10 * 60_000)
        const t = await tomarPagos(db, codigo, { codigoOrden: codigo, fecha: { $gte: desde } })
        if (t.length) { aplicados += t.length; await evaluarOrden(db, codigo) }
    }
    return aplicados
}

// Tarea programada: avisa por correo a quien dejó un faltante (si dio correo).
//   1. Primer aviso 10 minutos después del pago parcial (da tiempo a que complete con otro SINPE).
//   2. Recordatorio la víspera de la visita (desde las 16:00) o la misma mañana (desde las 6:00).
// Cada aviso sale una sola vez: la marca se pone antes de enviar, para que dos ejecuciones no dupliquen.
export async function avisarSaldos(db, { ahora = new Date(), enviar } = {}) {
    if (!enviar) enviar = (await import('./correo.mjs')).enviarCorreo
    const { hoyCR } = await import('./fechas.mjs')
    const ordenes = db.collection('ordenes')
    const hoy = hoyCR(ahora), manana = hoyCR(new Date(ahora.getTime() + 86400000))
    const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Costa_Rica', hour: '2-digit', hour12: false }).format(ahora))
    const sitio = (process.env.SITE_URL || '').replace(/\/$/, '')
    const sinpe = process.env.SINPE_NUMBER || ''
    let enviados = 0
    for (const o of await ordenes.find({ estado: 'parcial' }).toArray()) {
        if (!o.correo || o.fechaVisita < hoy) continue
        const primero = !o.avisoSaldoEn && new Date(o.parcialEn) <= new Date(ahora.getTime() - 10 * 60_000)
        const recordar = o.avisoSaldoEn && !o.recordatorioSaldoEn && ((o.fechaVisita === manana && hora >= 16) || (o.fechaVisita === hoy && hora >= 6))
        if (!primero && !recordar) continue
        const marca = primero ? 'avisoSaldo' : 'recordatorioSaldo'
        const tomada = await ordenes.findOneAndUpdate({ codigo: o.codigo, estado: 'parcial', [marca]: { $ne: true } }, { $set: { [marca]: true, [marca + 'En']: ahora } }, { returnDocument: 'after' })
        if (!tomada) continue
        const r = await evaluarOrden(db, o.codigo)
        if (r?.tipo !== 'parcial') continue
        const texto = [
            `Hola ${o.nombre}:`,
            '',
            `Recibimos ${colones(r.recibido)} de su compra ${o.codigo} por ${colones(r.total)} para el ${o.fechaVisita}. Faltan ${colones(r.saldo)}.${r.pista ? ' ' + r.pista : ''}`,
            '',
            'Puede completar el pago de dos formas:',
            `  1. Por SINPE Móvil${sinpe ? ' al ' + sinpe : ''}: monto exacto ${colones(r.saldo)} y en la descripción el código ${o.codigo}. Sus boletos se confirman solos.`,
            `  2. En la entrada del balneario, el mismo día de su visita (efectivo o SINPE).`,
            '',
            sitio ? `Ver el estado de su compra y sus boletos: ${sitio}/tiquetes.html?orden=${o.codigo}${o.llave ? '&llave=' + o.llave : ''}` : '',
            r.reservas?.faltaParaGarantizar ? `Importante: su rancho o cancha queda garantizado cuando el pago cubra ${colones(r.reservas.faltaParaGarantizar)} más.` : '',
            '',
            'Club Balneario Las Estufas'
        ].filter(l => l !== '').join('\n')
        if (await enviar({ para: o.correo, asunto: `Falta ${colones(r.saldo)} para completar su compra ${o.codigo}`, texto })) enviados++
    }
    return enviados
}
