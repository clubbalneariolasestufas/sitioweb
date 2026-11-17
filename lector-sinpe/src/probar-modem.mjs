// Prueba el módem sin tocar la base de datos ni borrar mensajes.
// Uso: npm run probar-modem
import { cfg, cargarReglas } from './config.mjs'
import { Modem, abrirPuerto } from './modem.mjs'
import { parsearAviso } from './parsers.mjs'

try {
    const puerto = await abrirPuerto(cfg.modemPuerto, cfg.modemBaud)
    const modem = new Modem(puerto, { simPin: cfg.simPin })
    await modem.iniciar()
    const e = await modem.estado()
    console.log(`Módem en ${cfg.modemPuerto}: señal ${e.senal} de 31, ${e.registrado ? 'registrado en ' + (e.operador || 'la red') : 'SIN registro en la red'}`)
    const mensajes = await modem.leerMensajes()
    console.log(`Mensajes en la SIM: ${mensajes.length}`)
    const reglas = cargarReglas()
    for (const m of mensajes) {
        console.log(`\n[${m.indice}] De: ${m.remitente}  Fecha: ${m.fecha.toISOString()}\n${m.texto}`)
        console.log('  ->', parsearAviso(m.texto, reglas) || 'NO reconocido como pago recibido')
    }
    await puerto.cerrar()
} catch (e) {
    console.error('No se pudo usar el módem:', e.message)
    console.error('Revise MODEM_PORT (ls /dev/serial/by-id/), que ModemManager esté desactivado y que el usuario esté en el grupo dialout.')
    process.exit(1)
}
