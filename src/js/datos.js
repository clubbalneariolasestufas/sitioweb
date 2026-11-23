// Datos editables del sitio: eventos y contacto. Los precios de entradas y ranchos están en precios-tiquetes.js.

export const CONFIG = {
    nombre: 'Club Balneario Las Estufas',
    whatsapp: '50688509393',        // formato internacional, sin + ni guiones
    whatsappVisible: '8850-9393',   // cómo se muestra el número de WhatsApp en el sitio
    sinpe: '6003-4009',             // SINPE Móvil de la ENTRADA (cocina/restaurante usa otro y no va en el sitio)
    totalFotos: 17,
    // Entradas con QR. false = el formulario arma un pedido por WhatsApp (modo seguro, sin backend).
    // true = usa las funciones de Netlify (/api/...). Active solo cuando estén configuradas las
    // variables de entorno y la colección pagos_sinpe reciba pagos (ver README).
    ventaEnLinea: false,
    api: { ordenes: '/api/ordenes', verificar: '/api/verificar-pago' }
}


// fecha en formato AAAA-MM-DD; los eventos pasados se ocultan solos.
export const EVENTOS = [
    {
        fecha: '2026-02-22',
        nombre: 'POOL PARTY',
        color: 'verde',
        programa: [
            ['10:00 a.m.', 'Música ambiente (Spotify Playlist)'],
            ['11:00 a.m.', 'DJ Vargas'],
            ['1:00 p.m.', 'DJ Albert'],
            ['3:00 p.m.', 'DJ Rafa'],
            ['4:00 p.m.', 'After / Sarpe en el Bar']
        ]
    },
    {
        fecha: '2026-03-01',
        nombre: 'Tarde Bailable',
        color: 'naranja',
        // OJO: estas horas vienen del sitio anterior y no coinciden con el horario (8:00 a.m. a 5:00 p.m.). Confirmar.
        programa: [
            ['24:00', 'Salsa'],
            ['22:00', 'Merengue'],
            ['20:00', 'Cumbia'],
            ['19:00', 'Swing Criollo']
        ]
    }
]

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','setiembre','octubre','noviembre','diciembre']
const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']

export function fechaLarga(iso) {
    const [a, m, d] = iso.split('-').map(Number)
    const f = new Date(a, m - 1, d)
    return `${DIAS[f.getDay()]} ${d} de ${MESES[m - 1]}`
}

export const colones = n => '₡' + n.toLocaleString('es-CR')
