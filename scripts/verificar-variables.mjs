// Uso: node --env-file=.env scripts/verificar-variables.mjs
// Revisa el .env local con las mismas reglas que el panel (Estado del sistema > Revisar variables de Netlify).
// Nunca imprime valores: solo si existe, si el formato es correcto y su huella (8 caracteres del SHA-256).
// Si la huella de una variable es igual aquí y en el panel, el contenido en Netlify es idéntico al del .env.
import { revisarVariables } from '../netlify/functions/_lib/variables.mjs'

const MARCA = { ok: 'OK     ', aviso: 'OPCION ', formato: 'REVISAR', falta: 'FALTA  ' }
const { filas, obsoletas, resumen } = revisarVariables(process.env)
let grupo = ''
for (const f of filas) {
    if (f.grupo !== grupo) { grupo = f.grupo; console.log(`\n${grupo}`) }
    console.log(`  ${MARCA[f.estado]} ${f.nombre.padEnd(31)} ${(f.huella || '--------')}  ${f.nota}`)
}
if (obsoletas.length) console.log(`\nObsoletas (puede borrarlas): ${obsoletas.join(', ')}`)
console.log(`\n${resumen.ok}/${resumen.total} correctas · ${resumen.falta} faltan · ${resumen.formato} por revisar`)
process.exitCode = resumen.falta || resumen.formato ? 1 : 0
