export const json = (datos, estado = 200) =>
    new Response(JSON.stringify(datos), {
        status: estado,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    })

export async function leerJson(req, maxBytes = 4096) {
    try {
        const texto = await req.text()
        if (texto.length > maxBytes) return null
        const datos = JSON.parse(texto)
        return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : null
    } catch {
        return null
    }
}

export const ipDe = (req, context) =>
    context?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'desconocida'

export const limpiar = (valor, max) =>
    String(valor ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max)
