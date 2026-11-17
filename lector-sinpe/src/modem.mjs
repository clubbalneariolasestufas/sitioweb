import { EventEmitter } from 'node:events'
import { parsearCMGL } from './parsers.mjs'

// Maneja el módem por comandos AT. Recibe un "puerto" con write(texto) y eventos 'linea' y 'cerrado',
// para poder probarlo sin hardware (ver abrirPuerto más abajo para el puerto real).
export class Modem extends EventEmitter {
    constructor(puerto, { simPin = '' } = {}) {
        super()
        this.puerto = puerto
        this.simPin = simPin
        this.cola = Promise.resolve()
        this.pendiente = null
        puerto.on('linea', l => this.#linea(l))
    }

    #linea(cruda) {
        const linea = cruda.trim()
        if (!linea) return
        if (linea.startsWith('+CMTI:')) { this.emit('sms-nuevo'); return }     // aviso espontáneo de SMS nuevo
        const p = this.pendiente
        if (!p) return
        if (linea === 'OK') { this.pendiente = null; clearTimeout(p.reloj); p.ok(p.lineas) }
        else if (linea === 'ERROR' || linea.startsWith('+CME ERROR') || linea.startsWith('+CMS ERROR')) {
            this.pendiente = null; clearTimeout(p.reloj); p.error(new Error(`${p.cmd} -> ${linea}`))
        } else if (linea !== p.cmd) p.lineas.push(linea)
    }

    // Envía un comando y espera OK o ERROR. Los comandos van uno a la vez.
    at(cmd, esperaMs = 10000) {
        const tarea = () => new Promise((ok, error) => {
            const reloj = setTimeout(() => { this.pendiente = null; error(new Error(`${cmd} -> sin respuesta`)) }, esperaMs)
            this.pendiente = { cmd, lineas: [], ok, error, reloj }
            this.puerto.write(cmd + '\r')
        })
        const r = this.cola.then(tarea, tarea)
        this.cola = r.catch(() => {})
        return r
    }

    async iniciar() {
        await this.at('AT')
        await this.at('ATE0')                         // sin eco
        await this.at('AT+CMEE=1').catch(() => {})
        const pin = await this.at('AT+CPIN?')
        if (pin.some(l => l.includes('SIM PIN'))) {
            if (!this.simPin) throw new Error('La SIM pide PIN: configure SIM_PIN')
            await this.at(`AT+CPIN="${this.simPin}"`, 20000)
        }
        await this.at('AT+CMGF=1')                    // SMS en modo texto
        await this.at('AT+CSCS="GSM"').catch(() => {})
        await this.at('AT+CNMI=2,1,0,0,0').catch(() => {})   // avisar cuando llega un SMS
    }

    async estado() {
        const csq = (await this.at('AT+CSQ')).join(' ').match(/\+CSQ:\s*(\d+)/)
        const creg = (await this.at('AT+CREG?')).join(' ').match(/\+CREG:\s*\d+,(\d+)/)
        const cops = (await this.at('AT+COPS?').catch(() => [])).join(' ').match(/"([^"]+)"/)
        const senal = csq ? Number(csq[1]) : 99
        return {
            senal: senal === 99 ? 0 : senal,                       // 0 a 31
            registrado: creg ? ['1', '5'].includes(creg[1]) : false, // 1 = red propia, 5 = roaming
            operador: cops?.[1] || ''
        }
    }

    async leerMensajes() { return parsearCMGL(await this.at('AT+CMGL="ALL"', 20000)) }
    async borrar(indice) { await this.at(`AT+CMGD=${indice}`) }
}

// Abre el puerto serie real del módem USB.
export async function abrirPuerto(ruta, baudios) {
    const { SerialPort, ReadlineParser } = await import('serialport')
    const serie = new SerialPort({ path: ruta, baudRate: baudios, autoOpen: false })
    await new Promise((ok, error) => serie.open(e => (e ? error(e) : ok())))
    const lector = serie.pipe(new ReadlineParser({ delimiter: '\n' }))
    const puerto = new EventEmitter()
    puerto.write = texto => serie.write(texto)
    puerto.cerrar = () => new Promise(ok => serie.close(() => ok()))
    lector.on('data', l => puerto.emit('linea', String(l)))
    serie.on('close', () => puerto.emit('cerrado'))
    serie.on('error', () => puerto.emit('cerrado'))
    return puerto
}
