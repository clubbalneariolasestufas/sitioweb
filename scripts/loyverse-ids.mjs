// Uso: LOYVERSE_TOKEN=xxxx node scripts/loyverse-ids.mjs
// Lista las tiendas, los tipos de pago y los artículos de Loyverse con sus identificadores,
// para copiarlos a las variables de entorno de Netlify.
const token = process.env.LOYVERSE_TOKEN
if (!token) { console.error('Falta LOYVERSE_TOKEN. Ejemplo: LOYVERSE_TOKEN=xxxx node scripts/loyverse-ids.mjs'); process.exit(1) }

const api = async ruta => {
    const r = await fetch('https://api.loyverse.com/v1.0' + ruta, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) throw new Error(`${ruta} respondió ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return r.json()
}

try {
    const comercio = await api('/merchant')
    console.log(`Conectado con: ${comercio.business_name || comercio.name || '(sin nombre)'}\n`)

    console.log('TIENDAS  ->  LOYVERSE_STORE_ID')
    for (const s of (await api('/stores')).stores || []) console.log(`  ${s.id}   ${s.name}`)

    console.log('\nTIPOS DE PAGO  ->  LOYVERSE_PAYMENT_TYPE_ID  (cree uno llamado "SINPE web")')
    for (const p of (await api('/payment_types')).payment_types || []) console.log(`  ${p.id}   ${p.name} (${p.type})`)

    console.log('\nARTÍCULOS  ->  LOYVERSE_VARIANT_GENERAL (Entrada general), LOYVERSE_VARIANT_RANCHO (Rancho fin de semana), LOYVERSE_VARIANT_TENIS (Cancha de tenis, media hora)')
    for (const i of (await api('/items?limit=250')).items || [])
        for (const v of i.variants || []) console.log(`  ${v.variant_id}   ${i.item_name}${v.option1_value ? ' / ' + v.option1_value : ''}   precio: ${v.default_price ?? 'variable'}`)
} catch (e) {
    console.error('No se pudo consultar Loyverse:', e.message)
    process.exit(1)
}
