import test from 'node:test'
import assert from 'node:assert/strict'
import { revisarVariables, huella } from '../netlify/functions/_lib/variables.mjs'
import { hashPin } from '../netlify/functions/_lib/pin.mjs'

const base = () => ({
    MONGODB_URI: 'mongodb+srv://sitio:clave@cluster0.abc.mongodb.net/?retryWrites=true', MONGODB_DB: 'las_estufas',
    QR_SIGNING_SECRET: 'x'.repeat(48), GATE_PIN_HASH: hashPin('111111'), ADMIN_PIN_HASH: hashPin('222222'),
    SITE_URL: 'https://lasestufas.netlify.app', SINPE_NUMBER: '60034009'
})
const fila = (r, n) => r.filas.find(f => f.nombre === n)

test('variables: faltantes, opcionales y nunca devuelve valores', () => {
    const env = base(), r = revisarVariables(env)
    assert.equal(fila(r, 'MONGODB_URI').estado, 'ok')
    assert.equal(fila(r, 'TELEGRAM_BOT_TOKEN').estado, 'falta')
    assert.equal(fila(r, 'LOYVERSE_PAYMENT_TYPE_EFECTIVO').estado, 'aviso')
    assert.equal(fila(r, 'SITE_URL').huella, huella(env.SITE_URL))
    assert.ok(!JSON.stringify(r).includes('clave@'), 'no expone valores')
})

test('variables: comillas, espacios, PIN repetidos y obsoletas', () => {
    const env = { ...base(), SINPE_NUMBER: '"60034009"', MONGODB_DB: ' las_estufas', LOYVERSE_VARIANT_DIA: 'x' }
    env.ADMIN_PIN_HASH = env.GATE_PIN_HASH
    const r = revisarVariables(env)
    assert.match(fila(r, 'SINPE_NUMBER').nota, /comillas/)
    assert.match(fila(r, 'MONGODB_DB').nota, /espacios/)
    assert.match(fila(r, 'ADMIN_PIN_HASH').nota, /distintos/)
    assert.deepEqual(r.obsoletas, ['LOYVERSE_VARIANT_DIA'])
})
