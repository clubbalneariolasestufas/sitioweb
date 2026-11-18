import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, writeFile, rename } from 'node:fs/promises'

// Puente con Asterisk (central telefónica). Cuando Asterisk maneja el módem con chan_quectel,
// el lector ya no puede abrir el puerto serie: Asterisk le entrega cada SMS por HTTP local
// y el lector consulta el estado del módem con la consola de Asterisk.

const igual = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b))
    return x.length === y.length && timingSafeEqual(x, y)
}

// Servidor que solo escucha en el mismo equipo (127.0.0.1). Asterisk envía:
//   POST /sms   token=...&de=<remitente>&txt=<texto>   (application/x-www-form-urlencoded)
export function crearServidorSms({ token, onSms, log = console }) {
    if (!token || token.length < 16) throw new Error('ASTERISK_TOKEN debe tener al menos 16 caracteres')
    return createServer((req, res) => {
        const fin = (codigo, texto) => { res.writeHead(codigo, { 'Content-Type': 'text/plain' }); res.end(texto) }
        if (req.method !== 'POST' || req.url !== '/sms') return fin(404, 'no')
        let cuerpo = ''
        req.setEncoding('utf8')
        req.on('data', d => { cuerpo += d; if (cuerpo.length > 8192) { fin(413, 'grande'); req.destroy() } })
        req.on('end', async () => {
            if (res.writableEnded) return
            const p = new URLSearchParams(cuerpo)
            if (!igual(p.get('token') || '', token)) return fin(403, 'token')
            const remitente = (p.get('de') || '').slice(0, 40)
            const texto = (p.get('txt') || '').slice(0, 2000)
            if (!texto) return fin(400, 'vacio')
            try {
                await onSms({ remitente, texto, fecha: new Date() })
                fin(200, 'ok')
            } catch (e) {
                log.error('SMS de Asterisk no guardado:', e.message)
                fin(500, 'error')       // Asterisk lo deja en el archivo de pendientes
            }
        })
    })
}

// Respaldo: si el lector no respondía, el plan de marcado de Asterisk agrega una línea al archivo
//   <segundos epoch>|<remitente en base64>|<texto en base64>
// Esta función procesa esas líneas y deja en el archivo solo las que no se pudieron guardar.
export async function procesarPendientes(ruta, onSms, log = console) {
    let contenido
    try { contenido = await readFile(ruta, 'utf8') } catch { return 0 }
    if (!contenido.trim()) return 0
    const enProceso = ruta + '.procesando'
    await rename(ruta, enProceso)          // lo que llegue mientras tanto va a un archivo nuevo
    const fallidas = []
    let hechas = 0
    for (const linea of contenido.split('\n').map(l => l.trim()).filter(Boolean)) {
        const [epoch, de64, txt64] = linea.split('|')
        if (!txt64) continue
        try {
            const remitente = Buffer.from(de64, 'base64').toString('utf8')
            const texto = Buffer.from(txt64, 'base64').toString('utf8')
            await onSms({ remitente, texto, fecha: new Date(Number(epoch) * 1000 || Date.now()) })
            hechas++
        } catch (e) { log.error('Pendiente no procesado:', e.message); fallidas.push(linea) }
    }
    if (fallidas.length) {
        let nuevo = ''
        try { nuevo = await readFile(ruta, 'utf8') } catch {}
        await writeFile(ruta, fallidas.join('\n') + '\n' + nuevo)
    }
    await writeFile(enProceso, '')
    return hechas
}

// Interpreta la salida de «quectel show devices». Ejemplo:
//   ID           Group State      RSSI Mode Submode Provider Name  Model ...
//   quectel0     0     Free       24   0    0       kolbi          ...
// El formato exacto depende de la versión de chan_quectel: verificar en el equipo con
//   sudo asterisk -rx "quectel show devices"
export function parsearDispositivos(salida, nombre = 'quectel0') {
    const linea = String(salida).split('\n').find(l => l.trim().split(/\s+/)[0] === nombre)
    if (!linea) return { conectado: false, registrado: false, senal: 0, estadoCentral: 'no encontrado' }
    const partes = linea.trim().split(/\s+/)
    const sinConexion = /not connected|not initialized|not init/i.test(linea)
    const sinRed = /not registered|no service|searching/i.test(linea)
    const estadoCentral = sinConexion ? 'sin conexión' : partes[2]
    const rssi = sinConexion ? 0 : Number(partes[3]) || 0
    return {
        conectado: !sinConexion,
        registrado: !sinConexion && !sinRed && rssi > 0 && rssi < 99,
        senal: rssi >= 99 ? 0 : rssi,
        estadoCentral,
        enLlamada: /ring|dialing|active|incoming|outgoing|held/i.test(estadoCentral)
    }
}

export function consultarAsterisk(comando, ejecutar = execFile) {
    return new Promise((ok, mal) => ejecutar('asterisk', ['-rx', comando], { timeout: 8000 }, (e, salida) => e ? mal(e) : ok(String(salida))))
}
