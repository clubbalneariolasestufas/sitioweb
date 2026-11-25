import { json, leerJson, limpiar } from './_lib/http.mjs'
import { autorizar } from './_lib/acceso.mjs'
import { hoyCR } from './_lib/fechas.mjs'
import { boletosConQr } from './_lib/boletos.mjs'
import { tomarPagos, evaluarOrden, pagosDeOrden } from './_lib/cuenta.mjs'
import { reintentarPendientes } from './_lib/loyverse.mjs'
import { revisarVariables } from './_lib/variables.mjs'
import { ranchosDelDia, ocuparEnPuerta, liberarDePuerta } from './_lib/ranchos.mjs'
import { ocuparTenisPuerta, liberarTenisPuerta, tenisDelDia } from './_lib/tenis.mjs'
import { RANCHOS, TENIS_ABRE, TENIS_CIERRA, colones } from '../../src/js/precios-tiquetes.js'

const SOLO_ADMIN = ['aprobar', 'boletos', 'reintentar-loyverse', 'variables']

// POST /api/panel { pin, accion, ... }: acciones del personal desde el panel.
//   buscar    (puerta): busca una compra por código o por teléfono
//   ingresar  (puerta): da ingreso a toda una compra sin escanear (cliente sin celular o sin QR)
//   aprobar   (admin):  registra a mano un SINPE { comprobante, monto }: suma a la cuenta; si cubre el total, entrega boletos
//   cobrar-saldo (puerta): el día de la visita, cobra el faltante { metodo: efectivo|sinpe, monto = saldo exacto, comprobante? }
//   credito-entregado (puerta): marca entregado el crédito de un sobrepago (mayor a ₡1 000, solo el día de la visita)
//   boletos   (admin):  vuelve a mostrar los boletos de una compra pagada
//   reintentar-loyverse (admin): envía a Loyverse las ventas pendientes
//   variables (admin): revisa las variables de entorno (existe, formato y huella; nunca el valor)
//   ranchos (puerta): estado de los 7 ranchos hoy
//   rancho-ocupar / rancho-liberar (puerta): llegó alguien sin reserva / se fue
//   tenis-ocupar { inicio, bloques } / tenis-liberar { inicio, fin } (puerta): cancha pagada en la entrada
export default async (req, context) => {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    const d = await leerJson(req, 2048)
    if (!d || typeof d.accion !== 'string') return json({ error: 'Solicitud inválida' }, 400)
    const acceso = await autorizar(req, context, d.pin, SOLO_ADMIN.includes(d.accion) ? ['admin'] : ['puerta', 'admin'])
    if (acceso.error) return acceso.error
    const { db } = acceso
    const ordenes = db.collection('ordenes')
    const boletos = db.collection('boletos')
    const codigo = String(d.codigo ?? '').toUpperCase().trim()
    const hoy = hoyCR()

    if (d.accion === 'buscar') {
        const texto = String(d.texto ?? '').toUpperCase().trim()
        const digitos = texto.replace(/\D/g, '')
        let filtro
        if (/^[A-Z0-9]{6}$/.test(texto) && !/^\d{6}$/.test(texto)) filtro = { codigo: texto }
        else if (digitos.length >= 4 && digitos.length <= 15) filtro = { telefono: { $regex: digitos + '$' } }
        else return json({ error: 'Escriba el código de la compra (6 letras y números) o el teléfono del cliente' }, 400)
        const lista = await ordenes.find(filtro).sort({ creadaEn: -1 }).limit(10).toArray()
        const resultados = []
        for (const o of lista) {
            resultados.push({
                codigo: o.codigo, estado: o.estado, nombre: o.nombre, nombrePase: o.nombrePase, resumen: o.general != null ? o.nombrePase : `${o.cantidad} × ${o.nombrePase}`,
                ranchoConflicto: o.ranchoConflicto || null,
                recibido: o.recibido || (o.estado === 'pagada' ? o.total : 0), saldo: o.estado === 'parcial' ? o.saldo : 0,
                credito: o.credito || 0, creditoEntregado: Boolean(o.creditoEntregadoEn),
                tenisConflicto: o.tenisConflicto || null,
                cantidad: o.cantidad, total: o.total, fechaVisita: o.fechaVisita, esHoy: o.fechaVisita === hoy,
                vencida: o.estado === 'pendiente' && new Date(o.venceEn) < new Date(),
                ingresados: await boletos.countDocuments({ ordenCodigo: o.codigo, estado: 'usado' })
            })
        }
        return json({ resultados })
    }

    const vistaHoy = async () => ({ fecha: hoy, ranchos: await ranchosDelDia(db, hoy), tenis: await tenisDelDia(db, hoy) })
    if (d.accion === 'variables') return json(revisarVariables())
    if (d.accion === 'ranchos') return json(await vistaHoy())
    if (d.accion === 'tenis-ocupar' || d.accion === 'tenis-liberar') {
        const inicio = Number(d.inicio), bloques = Number(d.bloques ?? 1), fin = Number(d.fin)
        if (!Number.isInteger(inicio) || inicio % 30 || inicio < TENIS_ABRE || inicio >= TENIS_CIERRA) return json({ error: 'Hora no válida' }, 400)
        if (d.accion === 'tenis-ocupar') {
            if (!Number.isInteger(bloques) || bloques < 1 || inicio + bloques * 30 > TENIS_CIERRA) return json({ error: 'Duración no válida' }, 400)
            const r = await ocuparTenisPuerta(db, hoy, inicio, bloques)
            if (!r.ok) return json({ error: `La cancha ya está reservada a las ${r.ocupado}` }, 409)
        } else {
            if (!Number.isInteger(fin) || fin <= inicio) return json({ error: 'Hora no válida' }, 400)
            if (!(await liberarTenisPuerta(db, hoy, inicio, fin))) return json({ error: 'Ese horario no estaba ocupado en la puerta' }, 409)
        }
        return json(await vistaHoy())
    }
    if (d.accion === 'rancho-ocupar' || d.accion === 'rancho-liberar') {
        const n = Number(d.rancho)
        if (!RANCHOS.includes(n)) return json({ error: 'Rancho no válido' }, 400)
        const ok = d.accion === 'rancho-ocupar' ? await ocuparEnPuerta(db, hoy, n) : await liberarDePuerta(db, hoy, n)
        if (!ok) return json({ error: d.accion === 'rancho-ocupar' ? `El rancho ${n} ya está reservado o apartado` : `El rancho ${n} no estaba ocupado en la puerta` }, 409)
        return json(await vistaHoy())
    }

    if (!/^[A-Z0-9]{6}$/.test(codigo) && d.accion !== 'reintentar-loyverse') return json({ error: 'Código de compra no válido' }, 400)

    if (d.accion === 'ingresar') {
        const o = await ordenes.findOne({ codigo })
        if (!o) return json({ error: 'Compra no encontrada' }, 404)
        if (o.estado === 'parcial') return json({ error: `Falta cobrar ${colones(o.saldo)} antes de dar ingreso`, saldo: o.saldo }, 409)
        if (o.estado !== 'pagada') return json({ error: 'Esta compra todavía no está pagada' }, 409)
        if (o.fechaVisita !== hoy) return json({ error: `Esta compra es para el ${o.fechaVisita}` }, 409)
        const r = await boletos.updateMany({ ordenCodigo: codigo, fechaVisita: hoy, estado: 'valido' }, { $set: { estado: 'usado', usadoEn: new Date(), via: 'panel' } })
        return json({ ingresados: r.modifiedCount, mensaje: r.modifiedCount ? `Ingresaron ${r.modifiedCount} persona(s)` : 'Todas las personas de esta compra ya habían ingresado' })
    }

    if (d.accion === 'boletos') {
        const o = await ordenes.findOne({ codigo })
        if (!o) return json({ error: 'Compra no encontrada' }, 404)
        if (o.estado !== 'pagada') return json({ error: 'Esta compra todavía no está pagada' }, 409)
        return json({ codigo, boletos: await boletosConQr(o) })
    }

    // Respuesta común después de mover dinero: estado de la cuenta y, si quedó pagada, los boletos
    const respuestaCuenta = r => r.tipo === 'pagada'
        ? { codigo, estado: 'pagada', total: r.total, recibido: r.recibido, saldo: 0, sobrepago: r.sobrepago || 0, credito: r.credito || 0, boletos: r.boletos || [], correoEnviado: r.correoEnviado }
        : { codigo, estado: r.tipo, total: r.total, recibido: r.recibido, saldo: r.saldo, mensaje: r.mensaje || '' }

    if (d.accion === 'aprobar') {
        const comprobante = String(d.comprobante ?? '').replace(/\D/g, '')
        if (comprobante.length < 4 || comprobante.length > 30) return json({ error: 'Escriba el número de comprobante que muestra el cliente' }, 400)
        const monto = Number(d.monto)
        if (!Number.isInteger(monto) || monto <= 0 || monto > 10_000_000) return json({ error: 'Escriba el monto exacto que dice el comprobante, sin puntos ni comas' }, 400)
        const o = await ordenes.findOne({ codigo })
        if (!o) return json({ error: 'Compra no encontrada' }, 404)
        if (o.estado === 'pagada') return json({ codigo, estado: 'pagada', boletos: await boletosConQr(o), yaEstabaPagada: true })
        if (!['pendiente', 'parcial'].includes(o.estado)) return json({ error: 'Esta compra fue anulada' }, 409)

        // El comprobante es único: un mismo SINPE no puede pagar dos compras. Si el lector ya lo registró,
        // manda el monto que dijo el banco; si no coincide con el que se escribió, no se acepta.
        const pagos = db.collection('pagos_sinpe')
        try {
            await pagos.insertOne({ comprobante, ultimos4: comprobante.slice(-4), monto, fecha: new Date(), estado: 'libre', fuentes: ['manual'], metodo: 'sinpe', notaAprobacion: limpiar(d.nota, 120) })
        } catch (e) {
            if (e?.code !== 11000) throw e
            const previo = await pagos.findOne({ comprobante })
            if (previo.estado !== 'libre') return json({ error: 'Ese comprobante ya se usó en otra compra. No lo acepte sin revisar el celular del cliente.' }, 409)
            if (previo.monto !== monto) return json({ error: `El banco registró ese comprobante por ${colones(previo.monto)}, no por ${colones(monto)}. Revise el comprobante.` }, 409)
        }
        await tomarPagos(db, codigo, { comprobante }, 1)
        return json(respuestaCuenta(await evaluarOrden(db, codigo, { aprobacion: 'manual' })))
    }

    if (d.accion === 'cobrar-saldo') {
        const o = await ordenes.findOne({ codigo })
        if (!o) return json({ error: 'Compra no encontrada' }, 404)
        if (o.estado !== 'parcial') return json({ error: o.estado === 'pagada' ? 'Esta compra ya está pagada completa' : 'Esta compra no tiene un pago parcial: cóbrela completa en caja' }, 409)
        if (o.fechaVisita !== hoy) return json({ error: `El faltante solo se cobra el día de la visita (${o.fechaVisita})` }, 409)
        const r0 = await evaluarOrden(db, codigo)
        const monto = Number(d.monto)
        if (monto !== r0.saldo) return json({ error: `Cobre exactamente el faltante: ${colones(r0.saldo)}`, saldo: r0.saldo }, 400)
        const metodo = d.metodo === 'sinpe' ? 'sinpe' : d.metodo === 'efectivo' ? 'efectivo' : null
        if (!metodo) return json({ error: 'Indique si cobró en efectivo o por SINPE' }, 400)
        const comprobante = metodo === 'sinpe' ? String(d.comprobante ?? '').replace(/\D/g, '') : `EFECTIVO-${codigo}-${Date.now()}`
        if (metodo === 'sinpe' && (comprobante.length < 4 || comprobante.length > 30)) return json({ error: 'Escriba el número de comprobante del SINPE' }, 400)
        try {
            await db.collection('pagos_sinpe').insertOne({ comprobante, ultimos4: comprobante.slice(-4), monto, fecha: new Date(), estado: 'libre', fuentes: ['puerta'], metodo })
        } catch (e) {
            if (e?.code !== 11000) throw e
            return json({ error: 'Ese comprobante ya está registrado. Revíselo con el cliente.' }, 409)
        }
        await tomarPagos(db, codigo, { comprobante }, 1)
        return json(respuestaCuenta(await evaluarOrden(db, codigo, { saldoCobradoEnPuerta: metodo })))
    }

    if (d.accion === 'credito-entregado') {
        const o = await ordenes.findOneAndUpdate(
            { codigo, estado: 'pagada', fechaVisita: hoy, credito: { $gt: 0 }, creditoEntregado: { $ne: true } },
            { $set: { creditoEntregado: true, creditoEntregadoEn: new Date() } }, { returnDocument: 'after' })
        if (!o) return json({ error: 'No hay crédito por entregar hoy en esta compra' }, 409)
        return json({ codigo, credito: o.credito, mensaje: `Crédito de ${colones(o.credito)} entregado` })
    }

    if (d.accion === 'cuenta') {
        const r = await evaluarOrden(db, codigo)
        if (!r) return json({ error: 'Compra no encontrada' }, 404)
        const pagos = (await pagosDeOrden(db, codigo)).map(p => ({ comprobante: p.comprobante, monto: p.monto, metodo: p.metodo || 'sinpe', fuentes: p.fuentes || [], en: p.usadoEn || p.fecha }))
        return json({ ...respuestaCuenta(r), pagos })
    }

    if (d.accion === 'reintentar-loyverse') return json(await reintentarPendientes(db, 20))

    return json({ error: 'Acción no reconocida' }, 400)
}

export const config = { path: '/api/panel' }
