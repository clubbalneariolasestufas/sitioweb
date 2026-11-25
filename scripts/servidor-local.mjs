// Servidor local para probar las páginas con las funciones reales y una base de datos en memoria.
// Uso: node scripts/servidor-local.mjs  →  http://localhost:8888
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

process.env.QR_SIGNING_SECRET ||= 'x'.repeat(48)
const { hashPin } = await import('../netlify/functions/_lib/pin.mjs')
process.env.GATE_PIN_HASH ||= hashPin('111111')
process.env.ADMIN_PIN_HASH ||= hashPin('222222')
process.env.CALENDARIO_TOKEN ||= 'local-' + 'k'.repeat(30)
const { setDbParaPruebas } = await import('../netlify/functions/_lib/db.mjs')
const { crearDbFalsa } = await import('../tests/fake-db.mjs')
const db = crearDbFalsa()
setDbParaPruebas(db)

const rutas = {}
for (const f of ['cotizaciones', 'disponibilidad', 'eventos-admin', 'calendario', 'ordenes', 'panel', 'estado', 'verificar-pago', 'validar-boleto', 'ranchos', 'telegram']) {
    const m = await import(`../netlify/functions/${f}.mjs`)
    rutas[m.config.path] = m.default
}
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.map': 'application/json' }

http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost:8888')
    // Solo local: simula que el lector recibió el SINPE de una orden (POST /__simular-pago?codigo=XXXXXX)
    if (u.pathname === '/__simular-pago') {
        const o = (await db.collection('ordenes').find({ codigo: u.searchParams.get('codigo') }).toArray())[0]
        // ?monto= simula un pago distinto al total (por ejemplo, un cero de menos)
        if (o) db.collection('pagos_sinpe').filas.push({ comprobante: 'SIM-' + Date.now(), ultimos4: '4821', monto: Number(u.searchParams.get('monto')) || o.total, fecha: new Date(), estado: 'libre', codigoOrden: o.codigo })
        res.writeHead(o ? 200 : 404); res.end(o ? 'ok' : 'no'); return
    }
    const h = rutas[u.pathname]
    if (h) {
        const cuerpo = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)) })
        const r = await h(new Request(u, { method: req.method, headers: req.headers, body: cuerpo }), { ip: '127.0.0.1' })
        res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return
    }
    let ruta = u.pathname === '/' ? '/index.html' : u.pathname
    if (ruta === '/panel' || ruta === '/eventos') ruta += '.html'
    try { const d = await readFile(join('public', ruta)); res.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream' }); res.end(d) }
    catch { res.writeHead(404); res.end('no') }
}).listen(8888, () => console.log('http://localhost:8888  (PIN puerta 111111, admin 222222)'))
