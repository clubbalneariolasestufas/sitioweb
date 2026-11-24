// Precios y reglas de la compra de tiquetes en línea. Lo usan el navegador (total en vivo)
// y el servidor (que recalcula siempre: nunca se confía en el monto que manda el navegador).
// Para cambiar un precio, cámbielo aquí, corra `npx gulp js` y publique.

export const PRECIO_ENTRADA = 3500          // entrada general, todos los días
export const EDAD_GRATIS = 4                // menores de esta edad no pagan
export const DIAS_CERRADO = [3]             // 0 = domingo ... 3 = miércoles (cerrado todo el día)
export const HORARIO = { abre: '08:00', cierra: '17:00', texto: '8:00 a 17:00' }
export const MAX_PERSONAS = 50
export const MAX_DIAS_ADELANTE = 90

// Ranchos de bambú, con agua propia y basurero (sin parrilla por ahora)
export const RANCHOS = [1, 2, 3, 4, 5, 6, 7]
export const CAPACIDAD_RANCHO = 8
export const PRECIO_RANCHO_FINDE = 10000    // sábado y domingo; entre semana se aparta sin costo
export const MINUTOS_APARTADO = 15          // rancho y cancha quedan apartados mientras llega el pago

// Cancha de tenis: se alquila por bloques de media hora, siempre junto con al menos una entrada
export const PRECIO_TENIS_MEDIA_HORA = 1500 // ₡1 500 la media hora, ₡3 000 la hora
export const TENIS_ABRE = 8 * 60            // minutos desde medianoche
export const TENIS_CIERRA = 17 * 60
export const TENIS_MAX_BLOQUES = 6          // hasta 3 horas por compra

// Grupos: de 51 personas en adelante es un evento (solicitud que confirma la administración)
export const GRUPO_DESDE = 51
export const PRECIO_GRUPO = 3000

export const hhmm = min => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
export const duracionTexto = bloques => bloques === 1 ? '30 min' : bloques % 2 ? `${Math.floor(bloques / 2)} h 30 min` : `${bloques / 2} ${bloques === 2 ? 'hora' : 'horas'}`
// Inicios de cada media hora que ocupa una reserva de cancha
export const bloquesTenis = (inicio, bloques) => Array.from({ length: bloques }, (_, i) => inicio + i * 30)

export function diaSemana(iso) {
    const [a, m, d] = iso.split('-').map(Number)
    return new Date(Date.UTC(a, m - 1, d)).getUTCDay()
}
export const esFinDeSemana = iso => [0, 6].includes(diaSemana(iso))
export const estaCerrado = iso => DIAS_CERRADO.includes(diaSemana(iso))
export const precioRancho = iso => (esFinDeSemana(iso) ? PRECIO_RANCHO_FINDE : 0)

const entero = (v, max) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0
}

function normalizarTenis(t) {
    const inicio = Number(t?.inicio), bloques = Number(t?.bloques)
    if (!Number.isInteger(bloques) || bloques < 1 || bloques > TENIS_MAX_BLOQUES || !Number.isInteger(inicio) || inicio % 30 || inicio < TENIS_ABRE || inicio + bloques * 30 > TENIS_CIERRA) return null
    return { inicio, bloques, fin: inicio + bloques * 30 }
}

// Normaliza la selección y calcula el total. No valida disponibilidad (eso lo hace el servidor).
// tenis: { inicio: minutos desde medianoche (múltiplo de 30), bloques: medias horas }
export function calcularCompra({ general, menores, ranchos, fecha, tenis } = {}) {
    const g = entero(general, MAX_PERSONAS)
    const m = entero(menores, MAX_PERSONAS)
    const lista = [...new Set((Array.isArray(ranchos) ? ranchos : []).map(Number).filter(n => RANCHOS.includes(n)))].sort((a, b) => a - b)
    const pRancho = fecha ? precioRancho(fecha) : 0
    const lineas = []
    if (g) lineas.push({ id: 'general', nombre: 'Entrada general', cantidad: g, precio: PRECIO_ENTRADA, monto: g * PRECIO_ENTRADA })
    if (m) lineas.push({ id: 'menor', nombre: `Menor de ${EDAD_GRATIS} años`, cantidad: m, precio: 0, monto: 0 })
    lista.forEach(n => lineas.push({ id: 'rancho', rancho: n, nombre: `Rancho ${n}`, cantidad: 1, precio: pRancho, monto: pRancho }))
    const t = normalizarTenis(tenis)
    if (t) lineas.push({ id: 'tenis', nombre: `Cancha de tenis ${hhmm(t.inicio)} a ${hhmm(t.fin)}`, cantidad: t.bloques, precio: PRECIO_TENIS_MEDIA_HORA, monto: t.bloques * PRECIO_TENIS_MEDIA_HORA })
    const total = lineas.reduce((s, l) => s + l.monto, 0)
    const personas = g + m
    return {
        general: g, menores: m, personas, ranchos: lista, tenis: t, lineas, total,
        precioRancho: pRancho,
        capacidad: lista.length * CAPACIDAD_RANCHO,
        caben: lista.length === 0 || personas <= lista.length * CAPACIDAD_RANCHO,
        ranchosNecesarios: Math.ceil(personas / CAPACIDAD_RANCHO)
    }
}

export function resumenCompra(c) {
    const partes = []
    if (c.general) partes.push(`${c.general} entrada${c.general > 1 ? 's' : ''} general${c.general > 1 ? 'es' : ''}`)
    if (c.menores) partes.push(`${c.menores} menor${c.menores > 1 ? 'es' : ''} de ${EDAD_GRATIS} años`)
    if (c.ranchos?.length) partes.push(`rancho${c.ranchos.length > 1 ? 's' : ''} ${c.ranchos.join(' y ')}`)
    if (c.tenis) partes.push(`tenis ${hhmm(c.tenis.inicio)} a ${hhmm(c.tenis.fin)}`)
    return partes.join(' + ')
}

export const colones = n => '₡' + Math.round(Number(n) || 0).toLocaleString('es-CR')
