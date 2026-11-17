// MODO PRÁCTICA: levanta el sitio completo en esta computadora, con una base de datos de mentira.
// Sirve para probar y para capacitar al personal sin tocar nada real.
//   npm run demo      ->  http://localhost:8888
// PIN de puerta: 111111    PIN de administración: 222222
// Simular que el banco avisó de un pago:  http://localhost:8888/demo/pago?monto=12000&comprobante=12345678
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('../public/', import.meta.url))
process.env.QR_SIGNING_SECRET ||= 'solo-para-practica-'.repeat(3)
const { hashPin } = await import('../netlify/functions/_lib/pin.mjs')
process.env.GATE_PIN_HASH = hashPin('111111')
process.env.ADMIN_PIN_HASH = hashPin('222222')

const { crearDbFalsa } = await import('../tests/fake-db.mjs')
const { setDbParaPruebas } = await import('../netlify/functions/_lib/db.mjs')
const db = crearDbFalsa()
setDbParaPruebas(db)

// El "lector" de práctica siempre está encendido
const latido = () => db.collection('estado_sistema').updateOne({ _id: 'lector' },
    { $set: { en: new Date(), modem: { activo: true, conectado: true, registrado: true, senal: 22, operador: 'práctica', ultimoSms: new Date() }, correo: { activo: true, conectado: true, ultimoCorreo: new Date() } } }, { upsert: true })
await latido(); setInterval(latido, 30000)

const rutas = {
    '/api/ordenes': (await import('../netlify/functions/ordenes.mjs')).default,
    '/api/verificar-pago': (await import('../netlify/functions/verificar-pago.mjs')).default,
    '/api/validar-boleto': (await import('../netlify/functions/validar-boleto.mjs')).default,
    '/api/panel': (await import('../netlify/functions/panel.mjs')).default,
    '/api/estado': (await import('../netlify/functions/estado.mjs')).default
}
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.map': 'application/json' }

const puerto = Number(process.env.PORT || 8888)
createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${puerto}`)
    try {
        if (rutas[url.pathname]) {
            const trozos = []; for await (const t of req) trozos.push(t)
            const r = await rutas[url.pathname](new Request(url, { method: req.method, body: req.method === 'POST' ? Buffer.concat(trozos) : undefined }), { ip: '127.0.0.1' })
            res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return
        }
        if (url.pathname === '/demo/pago') {
            const comprobante = url.searchParams.get('comprobante') || String(Date.now())
            const monto = Number(url.searchParams.get('monto'))
            db.collection('pagos_sinpe').filas.push({ comprobante, ultimos4: comprobante.slice(-4), monto, fecha: new Date(), estado: 'libre', fuentes: ['practica'], codigoOrden: (url.searchParams.get('codigo') || '').toUpperCase() })
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`Pago de práctica registrado: ₡${monto}, comprobante ${comprobante} (últimos 4: ${comprobante.slice(-4)})`); return
        }
        let ruta = url.pathname === '/' ? '/index.html' : ['/panel', '/puerta'].includes(url.pathname) ? '/panel.html' : url.pathname
        const archivo = join(raiz, normalize(ruta))
        if (!archivo.startsWith(raiz)) { res.writeHead(403); res.end(); return }
        let datos = await readFile(archivo)
        // En práctica la venta en línea siempre está encendida
        if (ruta.endsWith('/build/js/datos.js')) datos = String(datos).replace('ventaEnLinea:!1', 'ventaEnLinea:!0')
        res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(datos)
    } catch (e) {
        res.writeHead(e.code === 'ENOENT' ? 404 : 500); res.end(e.code === 'ENOENT' ? 'No existe' : 'Error: ' + e.message)
    }
}).listen(puerto, () => console.log(`Modo práctica listo:\n  Sitio:  http://localhost:${puerto}\n  Panel:  http://localhost:${puerto}/panel   (PIN puerta 111111, administración 222222)\n  Simular pago: http://localhost:${puerto}/demo/pago?monto=12000&comprobante=12345678`))
