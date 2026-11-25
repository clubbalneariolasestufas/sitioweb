// Fuente de verdad de precios y reglas. El servidor calcula siempre el monto:
// nunca se confía en el precio que manda el navegador.

// Los precios de entradas y ranchos viven en src/js/precios-tiquetes.js (un solo archivo para sitio y servidor).
export { DIAS_CERRADO, MAX_PERSONAS, MAX_DIAS_ADELANTE, PRECIO_ENTRADA, PRECIO_RANCHO_FINDE } from '../../../src/js/precios-tiquetes.js'
import { PRECIO_ENTRADA, PRECIO_RANCHO_FINDE, PRECIO_TENIS_MEDIA_HORA } from '../../../src/js/precios-tiquetes.js'

// Artículos que se registran en Loyverse (variable LOYVERSE_VARIANT_<ID> con el variant_id de cada uno)
export const PRODUCTOS_LOYVERSE = {
    general: { nombre: 'Entrada general', precio: PRECIO_ENTRADA },
    rancho: { nombre: 'Rancho (fin de semana)', precio: PRECIO_RANCHO_FINDE },
    tenis: { nombre: 'Cancha de tenis (media hora)', precio: PRECIO_TENIS_MEDIA_HORA }
}
export const ORDEN_VENCE_MIN = Number(process.env.ORDEN_VENCE_MIN || 120)
export const MAX_INTENTOS = 5                // intentos de verificar un pago por orden
export const TOLERANCIA_PAGO_MIN = 10        // el aviso del banco puede llegar antes de crear la orden
export const MAX_ORDENES_POR_HORA = 20       // por cliente (huella de IP)
export const MAX_FALLOS_PIN = 10             // por cliente cada 10 minutos
export const MAX_FALLOS_CODIGO = 10          // códigos inexistentes o dígitos equivocados, por cliente cada 10 minutos
export const MAX_INTENTOS_VER = 5            // intentos de ver los boletos de una orden pagada con los 4 dígitos

export const MIN_LATIDO_LECTOR = 3           // minutos sin señal del lector antes de marcarlo en rojo

export const sinpe = () => process.env.SINPE_NUMBER || '6003-4009'
