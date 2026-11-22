// Catálogo y cálculo de cotizaciones de grupos y eventos.
// Lo usan el navegador (para mostrar el total en vivo) y el servidor (que recalcula siempre:
// nunca se confía en el monto que manda el navegador). Un solo archivo para los dos.
//
// ⚠ PRECIOS DE EJEMPLO. Lexie define los reales: cambie los montos aquí, ponga
// PRECIOS_DE_EJEMPLO en false y vuelva a publicar. No hay que tocar nada más.

export const PRECIOS_DE_EJEMPLO = true

export const ENTRADAS = [
    { id: 'adultos', nombre: 'Adultos', precio: 6000 },
    { id: 'ninos', nombre: 'Niños de 3 a 12 años', precio: 3000 },
    { id: 'mayores', nombre: 'Adultos mayores', precio: 3000 }
]

// exclusivo: el área se reserva para un solo grupo por día (bloquea la fecha para otros)
export const AREAS = [
    { id: 'rancho', nombre: 'Rancho / área techada', detalle: 'Exclusivo para el grupo', precio: 25000, exclusivo: true },
    { id: 'salon', nombre: 'Salón', detalle: 'Con mesas y sillas', precio: 35000, exclusivo: true },
    { id: 'tenis', nombre: 'Cancha de tenis', detalle: 'Por hora', precio: 8000, porHora: true }
]

export const MENUS = [
    { id: 'ninguno', nombre: 'Sin alimentación', detalle: 'Solo ingreso y áreas', precio: 0 },
    { id: 'casado', nombre: 'Menú A: casado típico', detalle: 'Plato fuerte y fresco natural', precio: 4500 },
    { id: 'parrilla', nombre: 'Menú B: parrillada', detalle: 'Carnes, acompañamientos y fresco', precio: 6500 },
    { id: 'refrigerio', nombre: 'Refrigerio', detalle: 'Bocadillo y bebida', precio: 2000 }
]

export const EXTRAS = [
    { id: 'sonido', nombre: 'Sonido', detalle: 'Parlante y micrófono', precio: 15000 },
    { id: 'decoracion', nombre: 'Decoración básica', detalle: 'Manteles y adornos del rancho', precio: 15000 },
    { id: 'pastel', nombre: 'Pastel', detalle: 'Para 30 personas', precio: 18000 }
]

export const TIPOS_EVENTO = ['Excursión escolar', 'Actividad de empresa', 'Cumpleaños', 'Convivio familiar', 'Baile o música', 'Otro']

export const REGLAS = {
    servicio: 0.10,            // sobre alimentación
    iva: 0.13,                 // sobre todo
    adelanto: 0.50,            // para reservar la fecha
    minPersonas: 10,
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
    const menu = _menus[sel.menu] ? sel.menu : 'ninguno'
    const extras = [...new Set((Array.isArray(sel.extras) ? sel.extras : []).filter(id => _extras[id]))]
    return { personas, areas, horasTenis, menu, extras }
}

export const totalPersonas = p => ENTRADAS.reduce((s, e) => s + (p?.[e.id] || 0), 0)

// Devuelve el desglose completo, redondeado a colones enteros.
export function calcular(selCruda) {
    const sel = normalizar(selCruda)
    const n = totalPersonas(sel.personas)
    const lineas = []
    let entradas = 0, areas = 0, alimentacion = 0, extras = 0

    for (const e of ENTRADAS) {
        const c = sel.personas[e.id]
        if (!c) continue
        const monto = c * e.precio
        entradas += monto
        lineas.push({ grupo: 'Entradas', concepto: e.nombre, cantidad: c, precio: e.precio, monto })
    }
    for (const id of sel.areas) {
        const a = _areas[id]
        const cantidad = a.porHora ? sel.horasTenis : 1
        const monto = cantidad * a.precio
        areas += monto
        lineas.push({ grupo: 'Áreas', concepto: a.nombre + (a.porHora ? ` (${cantidad} h)` : ''), cantidad, precio: a.precio, monto })
    }
    const m = _menus[sel.menu]
    if (m.precio && n) {
        alimentacion = m.precio * n
        lineas.push({ grupo: 'Alimentación', concepto: m.nombre, cantidad: n, precio: m.precio, monto: alimentacion })
    }
    for (const id of sel.extras) {
        const x = _extras[id]
        extras += x.precio
        lineas.push({ grupo: 'Extras', concepto: x.nombre, cantidad: 1, precio: x.precio, monto: x.precio })
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

// Tareas que se generan solas para el personal según la fecha del evento.
// Los encargados por defecto son Lexie; se cambian aquí cuando se defina quién hace qué.
export const PLANTILLA_TAREAS = [
    { id: 'cocina', dias: -7, texto: 'Pedir insumos de cocina según el menú', encargado: 'Lexie', soloConMenu: true },
    { id: 'cantidad', dias: -3, texto: 'Confirmar con el cliente la cantidad final de personas', encargado: 'Lexie' },
    { id: 'saldo', dias: -2, texto: 'Cobrar el saldo por SINPE', encargado: 'Lexie' },
    { id: 'areas', dias: -1, texto: 'Preparar y limpiar las áreas reservadas', encargado: 'Lexie' },
    { id: 'puerta', dias: 0, texto: 'Lista del grupo en la puerta y recibir al encargado', encargado: 'Lexie' }
]

const sumarDias = (iso, d) => {
    const [a, m, dia] = iso.split('-').map(Number)
    return new Date(Date.UTC(a, m - 1, dia + d)).toISOString().slice(0, 10)
}

export function tareasDe(cot) {
    const conMenu = cot.seleccion?.menu && cot.seleccion.menu !== 'ninguno'
    return PLANTILLA_TAREAS
        .filter(t => !t.soloConMenu || conMenu)
        .map(t => ({ id: t.id, fecha: sumarDias(cot.fechaEvento, t.dias), texto: t.texto, encargado: t.encargado, hecha: !!cot.tareasHechas?.includes(t.id) }))
}

export const colones = n => '₡' + Math.round(Number(n) || 0).toLocaleString('es-CR')
