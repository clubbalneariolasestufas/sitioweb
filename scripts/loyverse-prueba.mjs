// Prueba la conexión con Loyverse usando las mismas variables que usará Netlify.
// Uso (con las variables LOYVERSE_* en el archivo .env):
//   node --env-file=.env scripts/loyverse-prueba.mjs            -> solo revisa, no crea nada
//   node --env-file=.env scripts/loyverse-prueba.mjs --recibo   -> además crea UN recibo real de prueba
// El recibo de prueba es una venta real en el POS: después hay que reembolsarlo desde Loyverse.
import { PRECIO_ENTRADA, PRECIO_RANCHO_FINDE } from '../src/js/precios-tiquetes.js'
const e = process.env
const faltan = ['LOYVERSE_TOKEN', 'LOYVERSE_STORE_ID', 'LOYVERSE_PAYMENT_TYPE_ID', 'LOYVERSE_VARIANT_GENERAL', 'LOYVERSE_VARIANT_RANCHO'].filter(v => !e[v])
if (faltan.length) { console.error('Faltan variables en .env:\n  ' + faltan.join('\n  ')); process.exit(1) }

const api = async (ruta, cuerpo) => {
    const r = await fetch('https://api.loyverse.com/v1.0' + ruta, {
        method: cuerpo ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${e.LOYVERSE_TOKEN}`, 'Content-Type': 'application/json' },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
    })
    const texto = await r.text()
    if (!r.ok) throw new Error(`${ruta} respondió ${r.status}: ${texto.slice(0, 400)}`)
    return texto ? JSON.parse(texto) : {}
}
const ok = t => console.log('  OK    ' + t)
const mal = t => { console.log('  FALLA ' + t); process.exitCode = 1 }

try {
    const comercio = await api('/merchant')
    ok(`Token válido. Comercio: ${comercio.business_name || comercio.name || '(sin nombre)'}`)

    const tiendas = (await api('/stores')).stores || []
    const tienda = tiendas.find(s => s.id === e.LOYVERSE_STORE_ID)
    tienda ? ok(`Tienda: ${tienda.name}`) : mal('LOYVERSE_STORE_ID no coincide con ninguna tienda')

    const tipos = (await api('/payment_types')).payment_types || []
    const tipo = tipos.find(p => p.id === e.LOYVERSE_PAYMENT_TYPE_ID)
    tipo ? ok(`Tipo de pago: ${tipo.name}`) : mal('LOYVERSE_PAYMENT_TYPE_ID no coincide con ningún tipo de pago')

    const items = (await api('/items?limit=250')).items || []
    const variantes = new Map(items.flatMap(i => (i.variants || []).map(v => [v.variant_id, { ...v, nombre: i.item_name }])))
    const precios = { GENERAL: PRECIO_ENTRADA, RANCHO: PRECIO_RANCHO_FINDE }   // salen de src/js/precios-tiquetes.js
    for (const [clave, precioSitio] of Object.entries(precios)) {
        const v = variantes.get(e['LOYVERSE_VARIANT_' + clave])
        if (!v) { mal(`LOYVERSE_VARIANT_${clave} no coincide con ningún artículo`); continue }
        const precio = v.stores?.find(s => s.store_id === e.LOYVERSE_STORE_ID)?.price ?? v.default_price
        Number(precio) === precioSitio
            ? ok(`${clave}: "${v.nombre}" a ₡${precio}`)
            : mal(`${clave}: "${v.nombre}" cuesta ₡${precio} en Loyverse y ₡${precioSitio} en el sitio`)
    }

    if (process.argv.includes('--recibo') && !process.exitCode) {
        const ahora = new Date().toISOString()
        const recibo = await api('/receipts', {
            store_id: e.LOYVERSE_STORE_ID,
            source: 'Sitio web',
            receipt_date: ahora,
            note: 'PRUEBA de integración del sitio web. Reembolsar.',
            line_items: [{ variant_id: e.LOYVERSE_VARIANT_GENERAL, quantity: 1, price: precios.GENERAL }],
            payments: [{ payment_type_id: e.LOYVERSE_PAYMENT_TYPE_ID, paid_at: ahora }]
        })
        ok(`Recibo de prueba creado: ${recibo.receipt_number} por ₡${recibo.total_money}. Búsquelo en Loyverse y reembólselo.`)
    } else if (!process.exitCode) {
        console.log('\nTodo coincide. Para crear un recibo real de prueba agregue --recibo al comando.')
    }
} catch (err) {
    console.error('\nNo se pudo completar la prueba:', err.message)
    process.exit(1)
}
