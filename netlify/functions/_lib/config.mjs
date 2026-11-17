// Fuente de verdad de precios y reglas. El servidor calcula siempre el monto:
// nunca se confía en el precio que manda el navegador.
// Mantener sincronizado con src/js/datos.js (que solo muestra precios en pantalla).

export const PASES = {
    dia: { nombre: 'Pase del día', precio: 6000 },
    cervecero: { nombre: 'Pase Cervecero', precio: 6000 },
    economico: { nombre: 'Pase Económico', precio: 3000 }
}

export const DIAS_CERRADO = [3]              // 0 = domingo ... 3 = miércoles
export const MAX_PERSONAS = 50
export const MAX_DIAS_ADELANTE = 90
export const ORDEN_VENCE_MIN = Number(process.env.ORDEN_VENCE_MIN || 120)
export const MAX_INTENTOS = 5                // intentos de verificar un pago por orden
export const TOLERANCIA_PAGO_MIN = 10        // el aviso del banco puede llegar antes de crear la orden
export const MAX_ORDENES_POR_HORA = 20       // por cliente (huella de IP)
export const MAX_FALLOS_PIN = 10             // por cliente cada 10 minutos

export const MIN_LATIDO_LECTOR = 3           // minutos sin señal del lector antes de marcarlo en rojo

export const sinpe = () => process.env.SINPE_NUMBER || '6003-4009'
