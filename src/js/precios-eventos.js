// Catálogo y cálculo de cotizaciones de grupos y eventos.
// Lo usan el navegador (para mostrar el total en vivo) y el servidor (que recalcula siempre:
// nunca se confía en el monto que manda el navegador). Un solo archivo para los dos.
//
// Precios reales (noviembre 2026): entrada, ranchos y cancha salen de precios-tiquetes.js.
// Comida, DJ, música y el área techada quedan «por cotizar»: Lexie fija el monto al cotizar.

import { PRECIO_ENTRADA, PRECIO_GRUPO, GRUPO_DESDE, PRECIO_TENIS_MEDIA_HORA, RANCHOS, precioRancho } from './precios-tiquetes.js'

export const PRECIOS_DE_EJEMPLO = false

export const ENTRADAS = [
    { id: 'adultos', nombre: 'Entrada general', precio: PRECIO_ENTRADA },
    { id: 'ninos', nombre: 'Menores de 4 años', precio: 0 }
]

// exclusivo: el área se reserva para un solo grupo por día (bloquea la fecha para otros)
// porCotizar: se registra en la solicitud y la administración pone el monto
export const AREAS = [
    // ₡50 000 hasta 40 personas; desde la persona 41, ₡1 000 más por persona (41 = ₡51 000).
    // Se entrega con mesas y sillas hasta 100 personas; grupos mayores se coordinan con la administración.
    { id: 'techada', nombre: 'Área techada para eventos', detalle: 'Con mesas y sillas hasta 100 personas · ₡50 000 hasta 40 personas, ₡1 000 más por persona adicional', precio: 50000, exclusivo: true, porPersonas: { incluye: 40, adicional: 1000, capacidad: 100 } },
    { id: 'ranchos', nombre: 'Ranchos de bambú', detalle: 'Hasta 8 personas cada uno', precio: 0, porRancho: true },
    { id: 'tenis', nombre: 'Cancha de tenis', detalle: '₡3 000 la hora', precio: PRECIO_TENIS_MEDIA_HORA * 2, porHora: true }
]

export const MENUS = [
    { id: 'ninguno', nombre: 'Sin alimentación', detalle: 'Solo ingreso y áreas', precio: 0 },
    { id: 'comida', nombre: 'Comida del restaurante', detalle: 'Menú y precio los define Lexie', precio: 0, porCotizar: true }
]

export const EXTRAS = [
    { id: 'dj', nombre: 'DJ', detalle: 'Por cotizar', precio: 0, porCotizar: true },
    { id: 'musica', nombre: 'Música y sonido', detalle: 'Por cotizar', precio: 0, porCotizar: true },
    { id: 'decoracion', nombre: 'Decoración', detalle: 'Por cotizar; en cumpleaños incluye rótulo con el nombre', precio: 0, porCotizar: true }
]

export const TIPOS_EVENTO = ['Excursión escolar', 'Actividad de empresa', 'Cumpleaños', 'Convivio familiar', 'Baile o música', 'Otro']

export const REGLAS = {
    servicio: 0.10,            // sobre alimentación
    iva: 0,                    // los precios publicados ya incluyen impuestos (Lexie ajusta el total final si hace falta)
    adelanto: 0.50,            // para reservar la fecha
    minPersonas: 10,
    grupoDesde: GRUPO_DESDE,   // desde aquí la entrada general baja a precioGrupo
    precioGrupo: PRECIO_GRUPO,
    maxPersonas: 300,          // más de esto, Lexie revisa
    diasApartado: 2,           // la solicitud aparta la fecha este tiempo
    diasValidez: 15,           // la cotización enviada vale este tiempo
    horasCantidadFinal: 72,    // la cantidad final de personas se confirma antes de esto
    minDiasAnticipacion: 3,
    maxDiasAdelante: 365,
    diasCerrado: [3]           // miércoles
}

const porId = lista => Object.fromEntries(lista.map(x => [x.id, x]))
const _areas = porId(AREAS), _menus = porId(MENUS), _extras = porId(EXTRAS)

const entero = (v, max) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0
}

// Normaliza lo que manda el cliente: descarta lo desconocido y recorta cantidades.
export function normalizar(sel = {}) {
    const personas = {}
    for (const e of ENTRADAS) personas[e.id] = entero(sel.personas?.[e.id], 1000)
    const areas = [...new Set((Array.isArray(sel.areas) ? sel.areas : []).filter(id => _areas[id]))]
    const horasTenis = areas.includes('tenis') ? Math.max(1, entero(sel.horasTenis, 8)) : 0
    const ranchos = areas.includes('ranchos') ? Math.max(1, entero(sel.ranchos, RANCHOS.length)) : 0
    const menu = _menus[sel.menu] ? sel.menu : 'ninguno'
    const extras = [...new Set((Array.isArray(sel.extras) ? sel.extras : []).filter(id => _extras[id]))]
    return { personas, areas, horasTenis, ranchos, menu, extras }
}

export const totalPersonas = p => ENTRADAS.reduce((s, e) => s + (p?.[e.id] || 0), 0)

// Devuelve el desglose completo, redondeado a colones enteros.
export function calcular(selCruda, fecha = null) {
    const sel = normalizar(selCruda)
    const n = totalPersonas(sel.personas)
    const lineas = []
    let entradas = 0, areas = 0, alimentacion = 0, extras = 0, porCotizar = false, coordinar = false
    const grupo = (sel.personas.adultos || 0) >= REGLAS.grupoDesde

    for (const e of ENTRADAS) {
        const c = sel.personas[e.id]
        if (!c) continue
        const precio = e.id === 'adultos' && grupo ? REGLAS.precioGrupo : e.precio
        const monto = c * precio
        entradas += monto
        lineas.push({ grupo: 'Entradas', concepto: e.nombre + (e.id === 'adultos' && grupo ? ' (precio de grupo)' : ''), cantidad: c, precio, monto })
    }
    for (const id of sel.areas) {
        const a = _areas[id]
        if (a.porPersonas && n > a.porPersonas.capacidad) {
            porCotizar = true; coordinar = true
            lineas.push({ grupo: 'Áreas', concepto: `${a.nombre} (más de ${a.porPersonas.capacidad} personas: se coordina con la administración)`, cantidad: 1, precio: 0, monto: 0, porCotizar: true })
            continue
        }
        if (a.porPersonas) {
            const extra = Math.max(0, n - a.porPersonas.incluye)
            const monto = a.precio + extra * a.porPersonas.adicional
            areas += monto
            lineas.push({ grupo: 'Áreas', concepto: a.nombre + (extra ? ` (${n} personas: ${extra} sobre ${a.porPersonas.incluye})` : ''), cantidad: 1, precio: monto, monto })
            continue
        }
        if (a.porCotizar) { porCotizar = true; lineas.push({ grupo: 'Áreas', concepto: a.nombre + ' (por cotizar)', cantidad: 1, precio: 0, monto: 0, porCotizar: true }); continue }
        const cantidad = a.porHora ? sel.horasTenis : a.porRancho ? sel.ranchos : 1
        const precio = a.porRancho ? (fecha ? precioRancho(fecha) : 0) : a.precio
        const monto = cantidad * precio
        areas += monto
        lineas.push({ grupo: 'Áreas', concepto: a.nombre + (a.porHora ? ` (${cantidad} h)` : ''), cantidad, precio, monto })
    }
    const m = _menus[sel.menu]
    if (m.porCotizar && n) { porCotizar = true; lineas.push({ grupo: 'Alimentación', concepto: m.nombre + ' (por cotizar)', cantidad: n, precio: 0, monto: 0, porCotizar: true }) }
    else if (m.precio && n) {
        alimentacion = m.precio * n
        lineas.push({ grupo: 'Alimentación', concepto: m.nombre, cantidad: n, precio: m.precio, monto: alimentacion })
    }
    for (const id of sel.extras) {
        const x = _extras[id]
        if (x.porCotizar) porCotizar = true
        extras += x.precio
        lineas.push({ grupo: 'Extras', concepto: x.nombre + (x.porCotizar ? ' (por cotizar)' : ''), cantidad: 1, precio: x.precio, monto: x.precio, porCotizar: !!x.porCotizar })
    }

    const subtotal = entradas + areas + alimentacion + extras
    const servicio = Math.round(alimentacion * REGLAS.servicio)
    const iva = Math.round((subtotal + servicio) * REGLAS.iva)
    const total = subtotal + servicio + iva
    const adelanto = Math.round(total * REGLAS.adelanto)
    return {
        seleccion: sel, personas: n, lineas,
        entradas, areas, alimentacion, extras, subtotal, servicio, iva, total, adelanto,
        saldo: total - adelanto,
        revisionManual: n > REGLAS.maxPersonas,
        grupo, porCotizar, coordinar,
        preciosDeEjemplo: PRECIOS_DE_EJEMPLO
    }
}

export const areasExclusivas = areas => (areas || []).filter(id => _areas[id]?.exclusivo)
export const nombreArea = id => _areas[id]?.nombre || id
export const nombreMenu = id => _menus[id]?.nombre || id

// ---------- Estados y tareas ----------

export const ESTADOS = {
    solicitada: { nombre: 'Solicitada', siguiente: ['cotizada', 'cancelada'], apartaFecha: true },
    cotizada: { nombre: 'Cotizada', siguiente: ['reservada', 'cancelada'], apartaFecha: true },
    reservada: { nombre: 'Reservada (adelanto pagado)', siguiente: ['confirmada', 'cancelada'], apartaFecha: true },
    confirmada: { nombre: 'Confirmada', siguiente: ['realizada', 'cancelada'], apartaFecha: true },
    realizada: { nombre: 'Realizada', siguiente: [], apartaFecha: false },
    cancelada: { nombre: 'Cancelada', siguiente: [], apartaFecha: false },
    vencida: { nombre: 'Vencida', siguiente: ['solicitada'], apartaFecha: false }
}

// Tareas que se generan solas para el personal según la fecha y lo que pidió el evento.
// dias = días antes (−) o el mismo día (0) del evento. cuando = qué del evento la activa.
// Se ven en el panel de eventos, en el calendario y en el bot de Telegram (los tres marcan la misma lista).
const conComida = c => c.seleccion?.menu && c.seleccion.menu !== 'ninguno'
const conArea = id => c => (c.seleccion?.areas || []).includes(id)
const conExtra = (...ids) => c => (c.seleccion?.extras || []).some(x => ids.includes(x))
const esCumple = c => /cumplea/i.test(c.tipoEvento || '')
export const PLANTILLA_TAREAS = [
    { id: 'cocina', dias: -7, texto: 'Pedir insumos de cocina según los platillos pedidos', encargado: 'Lexie', cuando: conComida },
    { id: 'decoracion', dias: -5, texto: 'Coordinar la decoración contratada: tema, colores y hora de montaje', encargado: 'Lexie', cuando: conExtra('decoracion') },
    { id: 'cantidad', dias: -3, texto: 'Confirmaciones del evento: cantidad final de personas, hora de llegada y encargado del grupo', encargado: 'Lexie' },
    { id: 'platillos', dias: -3, texto: 'Confirmar con el cliente los platillos y cantidades de cada día', encargado: 'Lexie', cuando: conComida },
    { id: 'rotulo', dias: -3, texto: 'Rotulación de cumpleaños: nombre, edad y frase del cumpleañero', encargado: 'Lexie', cuando: c => esCumple(c) && conExtra('decoracion')(c) },
    { id: 'saldo', dias: -2, texto: 'Asegurar los pagos: el saldo del evento debe estar recibido (revisar en el panel de eventos)', encargado: 'Lexie' },
    { id: 'musica', dias: -2, texto: 'Confirmar DJ o música y probar el sonido y la electricidad', encargado: 'Alejandro', cuando: conExtra('dj', 'musica') },
    { id: 'salon', dias: -1, texto: 'Lavar el salón (área techada) y los baños', encargado: 'Limpieza', cuando: conArea('techada') },
    { id: 'ranchos', dias: -1, texto: 'Limpiar los ranchos del grupo y revisar agua y basureros', encargado: 'Limpieza', cuando: conArea('ranchos') },
    { id: 'cancha', dias: -1, texto: 'Barrer la cancha de tenis y revisar la red', encargado: 'Limpieza', cuando: conArea('tenis') },
    { id: 'sillas', dias: 0, texto: 'Secar y acomodar sillas y mesas del salón antes de las 8:00', encargado: 'Limpieza', cuando: conArea('techada') },
    { id: 'montaje', dias: 0, texto: 'Montar la decoración y el rótulo antes de que llegue el grupo', encargado: 'Lexie', cuando: conExtra('decoracion') },
    { id: 'comida-dia', dias: 0, texto: 'Preparar los platillos confirmados para el grupo', encargado: 'Lexie', cuando: conComida },
    { id: 'puerta', dias: 0, texto: 'Lista del grupo en la puerta y recibir al encargado', encargado: 'Lexie' }
]

const sumarDias = (iso, d) => {
    const [a, m, dia] = iso.split('-').map(Number)
    return new Date(Date.UTC(a, m - 1, dia + d)).toISOString().slice(0, 10)
}

export function tareasDe(cot) {
    return PLANTILLA_TAREAS
        .filter(t => !t.cuando || t.cuando(cot))
        .map(t => ({ id: t.id, fecha: sumarDias(cot.fechaEvento, t.dias), texto: t.texto, encargado: t.encargado, hecha: !!cot.tareasHechas?.includes(t.id) }))
}

export const colones = n => '₡' + Math.round(Number(n) || 0).toLocaleString('es-CR')
