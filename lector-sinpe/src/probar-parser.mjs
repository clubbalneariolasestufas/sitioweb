// Prueba cómo se interpreta un aviso del banco.
// Uso: npm run probar-parser -- "texto completo del SMS o del correo"
import { cargarReglas } from './config.mjs'
import { parsearAviso } from './parsers.mjs'

const texto = process.argv.slice(2).join(' ')
if (!texto) { console.error('Escriba el texto del aviso entre comillas.'); process.exit(1) }
const r = parsearAviso(texto, cargarReglas())
console.log(r ? `Reconocido: monto ₡${r.monto}, comprobante ${r.comprobante} (regla ${r.regla})` : 'NO reconocido. Agregue una regla en reglas.json (vea reglas.ejemplo.json).')
