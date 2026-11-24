// Taquilla y reservaciones de la página principal (propuesta «Arme su visita»):
// día, personas, rancho, cancha de tenis y, si es un evento, la solicitud para la administración.
// La compra se termina en tiquetes.html (mapa de ranchos y pago SINPE); el evento se envía desde aquí.
import { CONFIG } from './datos.js'
import {
    PRECIO_ENTRADA, MAX_PERSONAS, MAX_DIAS_ADELANTE, HORARIO, RANCHOS, CAPACIDAD_RANCHO,
    PRECIO_TENIS_MEDIA_HORA, TENIS_ABRE, TENIS_CIERRA, TENIS_MAX_BLOQUES, GRUPO_DESDE, PRECIO_GRUPO,
    calcularCompra, estaCerrado, esFinDeSemana, precioRancho, hhmm, duracionTexto, bloquesTenis, colones
} from './precios-tiquetes.js'
import { calcular as calcularEvento, TIPOS_EVENTO, REGLAS } from './precios-eventos.js'

const $ = (s, c = document) => c.querySelector(s)
const $$ = (s, c = document) => [...c.querySelectorAll(s)]
const el = (tag, clase, texto) => { const e = document.createElement(tag); if (clase) e.className = clase; if (texto != null) e.textContent = texto; return e }

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const CORTO = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']
const hoyIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date())
const horaCR = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
const sumar = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
const dow = iso => new Date(iso + 'T12:00:00Z').getUTCDay()
const fechaLarga = iso => { const d = new Date(iso + 'T12:00:00Z'); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}` }
const primerDia = () => (horaCR() >= HORARIO.cierra ? sumar(hoyIso(), 1) : hoyIso())

const SERVICIOS = [['comida', 'Comida del restaurante'], ['dj', 'DJ'], ['musica', 'Música y sonido']]
const ESPACIOS = [['techada', 'Área techada para eventos'], ['ambos', 'Área techada y ranchos'], ['ranchos', 'Solo ranchos libres']]

const e = {
    fecha: '', general: 2, menores: 0, ranchos: 0, tenis: 0, inicio: null,
    evento: false, tipo: '', servicios: [], espacio: 'techada',
    ocupados: {}, tenisTomado: {}, enviando: false, enviado: null
}
const grupo = () => e.general >= GRUPO_DESDE
const esEvento = () => e.evento || grupo()
const libres = () => RANCHOS.length - (e.ocupados[e.fecha] || []).length

async function cargar(desde, dias) {
    try {
        const r = await fetch(`/api/ranchos?desde=${desde}&dias=${dias}`, { cache: 'no-store' })
        if (!r.ok) return
        const d = await r.json()
        d.dias.forEach(x => { e.ocupados[x.fecha] = x.ocupados; e.tenisTomado[x.fecha] = x.tenis || [] })
    } catch { /* sin conexión: el servidor revisa igual al comprar */ }
}

/* ---------- Días ---------- */
function pintarDias() {
    const caja = $('#tq-dias'); caja.replaceChildren()
    const ini = primerDia()
    for (let i = 0; i < 14; i++) {
        const f = sumar(ini, i), cerrado = estaCerrado(f), sel = f === e.fecha
        const b = el('button', 'taquilla__dia' + (sel ? ' taquilla__dia--elegido' : '') + (esFinDeSemana(f) ? ' taquilla__dia--finde' : ''))
        b.type = 'button'
        b.disabled = cerrado
        b.setAttribute('aria-pressed', String(sel))
        const l = RANCHOS.length - (e.ocupados[f] || []).length
        b.setAttribute('aria-label', `${fechaLarga(f)}${cerrado ? ', cerrado' : `, ${l} ranchos libres`}`)
        b.append(el('span', 'taquilla__dia-sem', i === 0 && f === hoyIso() ? 'HOY' : CORTO[dow(f)]),
            el('span', 'taquilla__dia-num', String(Number(f.slice(8)))),
            el('span', 'taquilla__dia-nota', cerrado ? 'Cerrado' : esFinDeSemana(f) ? 'Rancho ₡10 000' : 'Rancho gratis'))
        b.onclick = () => elegirFecha(f)
        caja.append(b)
    }
    const otra = $('#tq-otra-fecha')
    otra.min = ini; otra.max = sumar(hoyIso(), MAX_DIAS_ADELANTE)
}
async function elegirFecha(f) {
    if (!f || f < primerDia() || f > sumar(hoyIso(), MAX_DIAS_ADELANTE)) return mensaje('Elija una fecha dentro de los próximos 3 meses.', true)
    if (estaCerrado(f)) return mensaje('Los miércoles el balneario permanece cerrado. Elija otro día.', true)
    e.fecha = f; e.inicio = null
    if (!(f in e.ocupados)) await cargar(f, 1)
    e.ranchos = Math.min(e.ranchos, libres())
    mensaje('')
    pintar()
}
$('#tq-otra-fecha').addEventListener('change', ev => elegirFecha(ev.target.value))

/* ---------- Contadores ---------- */
const LIMITES = { general: [1, 300], menores: [0, 100], ranchos: [0, RANCHOS.length], tenis: [0, TENIS_MAX_BLOQUES] }
$$('.taquilla__mas').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.campo, [min, max] = LIMITES[k]
    const tope = k === 'ranchos' && e.fecha ? Math.min(max, libres()) : max
    e[k] = Math.max(min, Math.min(tope, e[k] + Number(b.dataset.paso)))
    if (k === 'tenis' && e.inicio != null && !inicioLibre(e.inicio, e.tenis)) e.inicio = null
    if (k === 'ranchos' && e.fecha && e[k] === tope && Number(b.dataset.paso) > 0 && tope < max) mensaje(`Solo quedan ${tope} rancho${tope === 1 ? '' : 's'} libre${tope === 1 ? '' : 's'} ese día.`)
    pintar()
}))
$$('.taquilla__atajo').forEach(b => b.addEventListener('click', () => {
    const [g, m] = b.dataset.atajo.split(',').map(Number)
    e.general = g; e.menores = m
    if (g >= GRUPO_DESDE) { e.evento = true; e.ranchos = Math.max(e.ranchos, 0) }
    pintar()
}))

/* ---------- Cancha de tenis ---------- */
function inicioLibre(min, bloques) {
    if (min + bloques * 30 > TENIS_CIERRA) return false
    if (e.fecha === hoyIso()) { const [h, m] = horaCR().split(':').map(Number); if (min < h * 60 + m) return false }
    const tomadas = e.tenisTomado[e.fecha] || []
    return bloquesTenis(min, bloques).every(x => !tomadas.includes(x))
}
function pintarTenis() {
    $('#tq-tenis').textContent = e.tenis ? duracionTexto(e.tenis) : 'No'
    $('#tq-tenis-horario').hidden = !e.tenis
    if (!e.tenis) return
    const caja = $('#tq-horas'); caja.replaceChildren()
    const tomadas = e.tenisTomado[e.fecha] || []
    for (let m = TENIS_ABRE; m < TENIS_CIERRA; m += 30) {
        const sel = e.inicio != null && m >= e.inicio && m < e.inicio + e.tenis * 30
        const tomada = tomadas.includes(m), libre = !!e.fecha && inicioLibre(m, e.tenis)
        const b = el('button', 'tq-hora' + (tomada ? ' tq-hora--tomada' : sel ? ' tq-hora--elegida' : ''), hhmm(m)); b.type = 'button'
        b.disabled = !libre && !sel
        b.setAttribute('aria-pressed', String(m === e.inicio))
        b.setAttribute('aria-label', `Empezar a las ${hhmm(m)}${tomada ? ', reservada' : !libre ? ', no disponible' : ''}`)
        b.onclick = () => { if (libre) { e.inicio = m; pintar() } }
        caja.append(b)
    }
    $('#tq-tenis-rango').textContent = !e.fecha ? 'Primero elija el día'
        : e.inicio != null ? `${hhmm(e.inicio)} a ${hhmm(e.inicio + e.tenis * 30)} · ${colones(e.tenis * PRECIO_TENIS_MEDIA_HORA)}` : 'Toque una hora libre'
}

/* ---------- Evento ---------- */
function chips(caja, lista, activo, alElegir) {
    caja.replaceChildren()
    lista.forEach(([id, nombre]) => {
        const on = activo(id)
        const b = el('button', 'taquilla__chip' + (on ? ' taquilla__chip--on' : ''), nombre); b.type = 'button'
        b.setAttribute('aria-pressed', String(on))
        b.onclick = () => { alElegir(id); pintar() }
        caja.append(b)
    })
}
$('#tq-evento').addEventListener('click', () => { if (!grupo()) { e.evento = !e.evento; pintar() } })

/* ---------- Resumen ---------- */
function lineasCompra() {
    const pr = e.fecha ? precioRancho(e.fecha) : 0
    const lineas = [[`Entrada general × ${e.general}`, `${colones(PRECIO_ENTRADA)} c/u`, colones(e.general * PRECIO_ENTRADA)]]
    if (e.menores) lineas.push([`Menores de 4 × ${e.menores}`, 'Gratis', '₡0'])
    if (e.ranchos) lineas.push([`${e.ranchos === 1 ? 'Rancho' : 'Ranchos'} × ${e.ranchos}`, pr ? '₡10 000 c/u · lo elige en el mapa' : 'Sin costo entre semana', colones(e.ranchos * pr)])
    if (e.tenis) lineas.push([`Cancha de tenis · ${duracionTexto(e.tenis)}`, e.inicio != null ? `${hhmm(e.inicio)} a ${hhmm(e.inicio + e.tenis * 30)}` : 'Elija la hora de inicio', colones(e.tenis * PRECIO_TENIS_MEDIA_HORA)])
    // El servidor recalcula todo al crear la orden; aquí es el mismo cálculo con los ranchos aún sin número
    const total = calcularCompra({ general: e.general, fecha: e.fecha }).total + e.ranchos * pr + e.tenis * PRECIO_TENIS_MEDIA_HORA
    return { lineas, total }
}
function seleccionEvento() {
    const areas = e.espacio === 'techada' ? ['techada'] : e.espacio === 'ambos' ? ['techada', 'ranchos'] : ['ranchos']
    if (e.tenis) areas.push('tenis')
    return {
        personas: { adultos: e.general, ninos: e.menores }, areas,
        ranchos: Math.max(1, e.ranchos), horasTenis: Math.ceil(e.tenis / 2),
        menu: e.servicios.includes('comida') ? 'comida' : 'ninguno',
        extras: e.servicios.filter(s => s !== 'comida')
    }
}
function lineasEvento() {
    const c = calcularEvento(seleccionEvento(), e.fecha || null)
    return { lineas: c.lineas.map(l => [l.cantidad > 1 && !l.porCotizar ? `${l.concepto} × ${l.cantidad}` : l.concepto, l.porCotizar ? 'Lo cotiza Lexie' : l.precio ? `${colones(l.precio)} c/u` : 'Gratis', l.porCotizar ? '—' : colones(l.monto)]), total: c.total }
}

function falta() {
    if (!e.fecha) return 'Elija el día'
    const personas = e.general + e.menores
    if (e.tenis && e.inicio == null) return 'Elija la hora de cancha'
    if (esEvento()) {
        if (personas < REGLAS.minPersonas) return `Eventos desde ${REGLAS.minPersonas} personas`
        if (!e.tipo) return 'Elija el tipo de actividad'
        if ($('#tq-nombre').value.trim().length < 2) return 'Escriba su nombre'
        const tel = $('#tq-telefono').value.replace(/\D/g, '')
        if (tel.length < 8 || tel.length > 15) return 'Revise su WhatsApp'
        const correo = $('#tq-correo').value.trim()
        if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return 'Revise el correo'
        return ''
    }
    if (personas > MAX_PERSONAS) return `Más de ${MAX_PERSONAS} personas: márquelo como evento`
    if (e.ranchos && personas > e.ranchos * CAPACIDAD_RANCHO) return `Para ${personas} personas elija ${Math.ceil(personas / CAPACIDAD_RANCHO)} ranchos`
    return ''
}

function pintar() {
    pintarDias()
    $('#tq-general').textContent = e.general
    $('#tq-menores').textContent = e.menores
    $('#tq-general-precio').textContent = grupo() ? `${colones(PRECIO_GRUPO)} por persona · precio de grupo` : `${colones(PRECIO_ENTRADA)} por persona`
    const aviso = $('#tq-aviso-grupo')
    aviso.hidden = !(grupo() || e.general >= GRUPO_DESDE - 10)
    aviso.className = 'taquilla__aviso' + (grupo() ? ' taquilla__aviso--ok' : '')
    aviso.textContent = grupo() ? `Precio de grupo aplicado: ${colones(PRECIO_GRUPO)} por entrada desde ${GRUPO_DESDE} personas.` : `Con ${GRUPO_DESDE - e.general} entradas más su grupo pasa a ${colones(PRECIO_GRUPO)} por entrada.`

    $('#tq-ranchos').textContent = e.ranchos ? `${e.ranchos} rancho${e.ranchos > 1 ? 's' : ''}` : 'Ninguno'
    const personas = e.general + e.menores
    $('#tq-ranchos-detalle').textContent = !e.fecha ? 'Hasta 8 personas, con agua y basurero'
        : `${precioRancho(e.fecha) ? '₡10 000 c/u este día' : 'Gratis entre semana'} · ${libres()} libre${libres() === 1 ? '' : 's'}${!esEvento() && personas > 8 && e.ranchos ? ` · para ${personas} necesita ${Math.ceil(personas / 8)}` : ''}`
    pintarTenis()

    const ev = esEvento()
    $('#reservas').classList.toggle('taquilla__bloque--activo', ev)
    const sw = $('#tq-evento')
    sw.setAttribute('aria-pressed', String(ev))
    sw.textContent = grupo() ? `Sí, grupo de más de ${GRUPO_DESDE - 1}` : e.evento ? 'Sí, es un evento' : 'No, solo pasear'
    $('#tq-evento-detalle').hidden = !ev
    if (ev) {
        chips($('#tq-tipos'), TIPOS_EVENTO.map(t => [t, t]), id => e.tipo === id, id => { e.tipo = id })
        chips($('#tq-servicios'), SERVICIOS, id => e.servicios.includes(id), id => { e.servicios = e.servicios.includes(id) ? e.servicios.filter(x => x !== id) : [...e.servicios, id] })
        chips($('#tq-espacios'), ESPACIOS, id => e.espacio === id, id => { e.espacio = id })
    }

    $('#tq-fecha-texto').textContent = e.fecha ? `${fechaLarga(e.fecha).replace(/^./, x => x.toUpperCase())} · ${personas} persona${personas === 1 ? '' : 's'}` : 'Elija el día'
    const { lineas, total } = ev ? lineasEvento() : lineasCompra()
    const ul = $('#tq-lineas'); ul.replaceChildren()
    if (e.fecha) lineas.forEach(([n, d, m]) => {
        const li = el('li', 'taquilla__linea')
        const t = el('span', 'taquilla__linea-texto'); t.append(el('span', '', n), el('small', '', d))
        li.append(t, el('strong', '', m))
        ul.append(li)
    })
    $('#tq-total-etiqueta').textContent = ev ? 'Estimado de entradas y áreas' : 'Total a pagar'
    $('#tq-total').textContent = colones(total)
    const f = falta(), btn = $('#tq-accion')
    btn.textContent = e.enviando ? 'Enviando…' : f || (ev ? 'Enviar solicitud de evento' : CONFIG.ventaEnLinea ? 'Continuar al pago SINPE' : 'Continuar')
    btn.setAttribute('aria-disabled', String(!!f || e.enviando))
}
;['#tq-nombre', '#tq-telefono', '#tq-correo'].forEach(s => $(s).addEventListener('input', () => pintar()))

function mensaje(texto, error) {
    const m = $('#tq-mensaje')
    m.hidden = !texto
    m.textContent = texto
    m.className = 'taquilla__mensaje' + (error ? ' taquilla__mensaje--error' : '')
}

/* ---------- Acción ---------- */
$('#tq-accion').addEventListener('click', async () => {
    const f = falta()
    if (f) { mensaje(f, true); return }
    if (e.enviando) return
    if (!esEvento()) {
        const q = new URLSearchParams({ f: e.fecha, g: e.general, m: e.menores })
        if (e.ranchos) q.set('r', e.ranchos)
        if (e.tenis) { q.set('tb', e.tenis); q.set('ti', e.inicio) }
        location.href = 'tiquetes.html?' + q
        return
    }
    e.enviando = true; mensaje(''); pintar()
    try {
        const r = await fetch('/api/cotizaciones', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipoEvento: e.tipo, fechaEvento: e.fecha, seleccion: seleccionEvento(),
                nombre: $('#tq-nombre').value, telefono: $('#tq-telefono').value, correo: $('#tq-correo').value,
                comentarios: e.tenis && e.inicio != null ? `Cancha de tenis desde las ${hhmm(e.inicio)} (${duracionTexto(e.tenis)})` : '',
                web: $('#tq-form-evento [name=web]').value
            })
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'No se pudo enviar. Escríbanos por WhatsApp.')
        e.enviado = d
        mensaje(`¡Solicitud ${d.codigo} enviada! Lexie le escribe al WhatsApp con la cotización. La fecha queda apartada ${REGLAS.diasApartado} días. Guarde su código para ver el estado.`)
    } catch (err) {
        mensaje(err.message, true)
    } finally { e.enviando = false; pintar() }
})

/* ---------- Inicio ---------- */
export async function iniciarTaquilla() {
    if (!$('#tq-dias')) return
    pintar()
    await cargar(primerDia(), 14)
    pintar()
}
