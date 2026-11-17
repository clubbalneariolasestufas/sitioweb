// Uso: node scripts/hash-pin.mjs 482913
// Imprime el valor para la variable GATE_PIN_HASH (el PIN en claro no se guarda en ningún lado).
import { hashPin } from '../netlify/functions/_lib/pin.mjs'

const pin = process.argv[2]
if (!pin || pin.length < 6) {
    console.error('Escriba un PIN de al menos 6 caracteres: node scripts/hash-pin.mjs 482913')
    process.exit(1)
}
console.log(`GATE_PIN_HASH="${hashPin(pin)}"`)
