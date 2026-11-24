import { ENTRADAS, AREAS, MENUS, EXTRAS, TIPOS_EVENTO, REGLAS, PRECIOS_DE_EJEMPLO, calcular, colones, nombreArea } from './precios-eventos.js'

const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const el = (tag, clase, texto) => { const e = document.createElement(tag); if (clase) e.className = clase; if (texto != null) e.textContent = texto; return e }
const memoria = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
}

const ICONOS = { 'Excursión escolar': '🎒', 'Actividad de empresa': '💼', 'Cumpleaños': '🎂', 'Convivio familiar': '👨‍👩‍👧', 'Baile o música': '🎶', 'Otro': '✨' }
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const TOTAL_PASOS = 6

const estado = {
    paso: 1,
    tipoEvento: '',
    fechaEvento: '',
    personas: { adultos: 0, ninos: 0, mayores: 0 },
    areas: ['techada'],
    horasTenis: 1,
    menu: 'ninguno',
    extras: [],
    disponibilidad: {},
    inicioVentana: null
}

const hoyIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date())
const sumar = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
const diaDe = iso => new Date(iso + 'T12:00:00Z').getUTCDay()
const fechaLarga = iso => { const d = new Date(iso + 'T12:00:00Z'); return `${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}` }
const seleccion = () => ({ personas: estado.personas, areas: estado.areas, horasTenis: estado.horasTenis, menu: estado.menu, extras: estado.extras })

/* ---------- Paso 1: tipo ---------- */
function pintarTipos() {
    const caja = $('#tipos')
    TIPOS_EVENTO.forEach(t => {
        const b = el('button', 'cot-tarjeta'); b.type = 'button'
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false')
        b.append(el('span', 'cot-tarjeta__icono', ICONOS[t] || '•'), el('span', 'cot-tarjeta__texto', t))
        b.addEventListener('click', () => {
            estado.tipoEvento = t
            $$('#tipos .cot-tarjeta').forEach(x => x.setAttribute('aria-checked', String(x === b)))
            if (t === 'Excursión escolar' && !totalPersonas()) { estado.personas = { adultos: 4, ninos: 30, mayores: 0 }; pintarContadores() }
            actualizar()
        })
        caja.append(b)
    })
}

/* ---------- Paso 2: calendario ---------- */
async function cargarDisponibilidad(desde) {
    try {
        const r = await fetch(`/api/disponibilidad?desde=${desde}&dias=42`)
        if (!r.ok) throw new Error()
        const d = await r.json()
        d.dias.forEach(x => { estado.disponibilidad[x.fecha] = x })
    } catch { /* sin conexión: el servidor revisa igual al enviar */ }
}

async function pintarCalendario() {
    const hoy = hoyIso()
    const minimo = sumar(hoy, REGLAS.minDiasAnticipacion)
    estado.inicioVentana ??= minimo
    // La cuadrícula empieza en lunes
    const ini = sumar(estado.inicioVentana, -((diaDe(estado.inicioVentana) + 6) % 7))
    await cargarDisponibilidad(ini < hoy ? hoy : ini)
    const caja = $('#calendario'); caja.replaceChildren()
    ;['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].forEach(d => caja.append(el('span', 'cot-calendario__dia-semana', d)))
    const fin = sumar(ini, 41)
    const m1 = new Date(ini + 'T12:00:00Z').getUTCMonth(), m2 = new Date(fin + 'T12:00:00Z').getUTCMonth()
    $('#mes-nombre').textContent = m1 === m2 ? MESES[m1] : `${MESES[m1]} – ${MESES[m2]}`
    $('#mes-ant').disabled = ini <= minimo

    for (let i = 0; i < 42; i++) {
        const f = sumar(ini, i)
        const info = estado.disponibilidad[f] || {}
        const cerrado = REGLAS.diasCerrado.includes(diaDe(f))
        const antes = f < minimo
        const lleno = info.lleno
        const b = el('button', 'cot-dia'); b.type = 'button'
        b.dataset.fecha = f
        const num = el('span', 'cot-dia__num', String(Number(f.slice(8))))
        let etiqueta = ''
        if (cerrado) etiqueta = 'Cerrado'
        else if (antes) etiqueta = ''
        else if (lleno) etiqueta = 'Lleno'
        else if (info.ocupadas?.length) etiqueta = 'Parcial'
        else etiqueta = 'Libre'
        b.append(num, el('span', 'cot-dia__estado', etiqueta))
        if (cerrado || antes || lleno) { b.disabled = true; b.classList.add('cot-dia--no') }
        if (info.ocupadas?.length && !lleno) b.classList.add('cot-dia--parcial')
        if (f === estado.fechaEvento) b.classList.add('cot-dia--elegido')
        b.setAttribute('aria-label', `${fechaLarga(f)}: ${etiqueta || 'no disponible'}`)
        b.addEventListener('click', () => { estado.fechaEvento = f; pintarCalendario(); actualizar() })
        caja.append(b)
    }
    describirFecha()
}

function describirFecha() {
    const f = estado.fechaEvento, nota = $('#fecha-elegida')
    if (!f) { nota.textContent = ''; return }
    const ocupadas = estado.disponibilidad[f]?.ocupadas || []
    nota.textContent = `Eligió el ${fechaLarga(f)}.` + (ocupadas.length ? ` Ese día ya está apartado: ${ocupadas.map(nombreArea).join(' y ')}.` : '')
    // Si el área que tenía elegida ya está tomada, se cambia por la que queda libre
    estado.areas = estado.areas.filter(a => !ocupadas.includes(a))
    if (!estado.areas.some(a => AREAS.find(x => x.id === a)?.exclusivo)) {
        const libre = AREAS.find(a => a.exclusivo && !ocupadas.includes(a.id))
        if (libre) estado.areas.unshift(libre.id)
    }
    pintarAreas()
}

$('#mes-sig').addEventListener('click', () => { estado.inicioVentana = sumar(estado.inicioVentana, 28); pintarCalendario() })
$('#mes-ant').addEventListener('click', () => {
    const minimo = sumar(hoyIso(), REGLAS.minDiasAnticipacion)
    const nuevo = sumar(estado.inicioVentana, -28)
    estado.inicioVentana = nuevo < minimo ? minimo : nuevo
    pintarCalendario()
})

/* ---------- Paso 3: personas ---------- */
const totalPersonas = () => ENTRADAS.reduce((s, e) => s + (estado.personas[e.id] || 0), 0)
function pintarContadores() {
    const caja = $('#contadores'); caja.replaceChildren()
    ENTRADAS.forEach(e => {
        const fila = el('div', 'cot-contador')
        const info = el('div', 'cot-contador__info')
        info.append(el('span', 'cot-contador__nombre', e.nombre), el('span', 'cot-contador__precio', colones(e.precio) + ' c/u'))
        const ctl = el('div', 'cot-contador__control')
        const menos = el('button', 'cot-contador__btn', '−'); menos.type = 'button'; menos.setAttribute('aria-label', 'Menos ' + e.nombre)
        const campo = el('input', 'cot-contador__num'); campo.type = 'number'; campo.inputMode = 'numeric'; campo.min = 0; campo.max = 1000
        campo.value = estado.personas[e.id]; campo.setAttribute('aria-label', e.nombre)
        const mas = el('button', 'cot-contador__btn cot-contador__btn--mas', '+'); mas.type = 'button'; mas.setAttribute('aria-label', 'Más ' + e.nombre)
        const fijar = v => { estado.personas[e.id] = Math.max(0, Math.min(1000, Math.floor(Number(v) || 0))); campo.value = estado.personas[e.id]; actualizar() }
        menos.onclick = () => fijar(estado.personas[e.id] - 1)
        mas.onclick = () => fijar(estado.personas[e.id] + 1)
        campo.oninput = () => fijar(campo.value)
        ctl.append(menos, campo, mas)
        fila.append(info, ctl)
        caja.append(fila)
    })
    const pie = el('p', 'cot-contadores__total'); pie.id = 'personas-total'
    caja.append(pie)
}

/* ---------- Paso 4: áreas, menú y extras ---------- */
function opcion({ tipo, nombre, valor, titulo, detalle, precio, marcado, deshabilitado, alCambiar }) {
    const l = el('label', 'cot-opcion' + (deshabilitado ? ' cot-opcion--no' : ''))
    const i = el('input'); i.type = tipo; i.name = nombre; i.value = valor; i.checked = marcado; i.disabled = !!deshabilitado
    i.addEventListener('change', alCambiar)
    const t = el('span', 'cot-opcion__textos')
    t.append(el('span', 'cot-opcion__titulo', titulo), el('span', 'cot-opcion__detalle', detalle))
    l.append(i, t, el('span', 'cot-opcion__precio', precio))
    return l
}

function pintarAreas() {
    const ocupadas = estado.disponibilidad[estado.fechaEvento]?.ocupadas || []
    const caja = $('#areas'); caja.replaceChildren()
    AREAS.forEach(a => {
        const tomada = ocupadas.includes(a.id)
        caja.append(opcion({
            tipo: 'checkbox', nombre: 'areas', valor: a.id, titulo: a.nombre,
            detalle: tomada ? 'Ya apartada ese día' : a.detalle,
            precio: colones(a.precio) + (a.porHora ? ' / h' : ''),
            marcado: estado.areas.includes(a.id), deshabilitado: tomada,
            alCambiar: e => {
                estado.areas = e.target.checked ? [...estado.areas, a.id] : estado.areas.filter(x => x !== a.id)
                $('#campo-horas-tenis').hidden = !estado.areas.includes('tenis')
                actualizar()
            }
        }))
    })
    $('#campo-horas-tenis').hidden = !estado.areas.includes('tenis')
}
['#nombre', '#telefono', '#correo', '#hora-inicio', '#hora-fin'].forEach(s => $(s).addEventListener('input', () => actualizar()))
$('#horas-tenis').addEventListener('input', e => { estado.horasTenis = Math.max(1, Math.min(8, Number(e.target.value) || 1)); actualizar() })

function pintarMenusYExtras() {
    const m = $('#menus'); m.replaceChildren()
    MENUS.forEach(x => m.append(opcion({
        tipo: 'radio', nombre: 'menu', valor: x.id, titulo: x.nombre, detalle: x.detalle,
        precio: x.precio ? colones(x.precio) + ' p/p' : '—', marcado: estado.menu === x.id,
        alCambiar: () => { estado.menu = x.id; actualizar() }
    })))
    const ex = $('#extras'); ex.replaceChildren()
    EXTRAS.forEach(x => ex.append(opcion({
        tipo: 'checkbox', nombre: 'extras', valor: x.id, titulo: x.nombre, detalle: x.detalle,
        precio: colones(x.precio), marcado: estado.extras.includes(x.id),
        alCambiar: e => { estado.extras = e.target.checked ? [...estado.extras, x.id] : estado.extras.filter(y => y !== x.id); actualizar() }
    })))
}

/* ---------- Resumen ---------- */
function pintarResumen(c) {
    const caja = $('#resumen'); caja.replaceChildren()
    const datos = el('dl', 'cot-resumen__datos')
    const fila = (k, v) => { datos.append(el('dt', '', k), el('dd', '', v)) }
    fila('Actividad', estado.tipoEvento + ($('#institucion').value.trim() ? ` · ${$('#institucion').value.trim()}` : ''))
    fila('Fecha', estado.fechaEvento ? `${fechaLarga(estado.fechaEvento)}, ${$('#hora-inicio').value} a ${$('#hora-fin').value}` : '—')
    fila('Personas', String(c.personas))
    fila('Encargado', `${$('#nombre').value.trim()} · ${$('#telefono').value.trim()}`)
    caja.append(datos)

    const tabla = el('table', 'cot-desglose')
    const cuerpo = el('tbody')
    c.lineas.forEach(l => {
        const tr = el('tr')
        tr.append(el('td', '', l.cantidad > 1 ? `${l.concepto} × ${l.cantidad}` : l.concepto), el('td', 'cot-desglose__monto', colones(l.monto)))
        cuerpo.append(tr)
    })
    const pie = el('tfoot')
    ;[['Subtotal', c.subtotal], ['Servicio 10 % (alimentación)', c.servicio], ...(c.iva ? [['IVA', c.iva]] : []), ['Total', c.total], ['Adelanto 50 % para reservar', c.adelanto]].forEach(([k, v], i) => {
        if (!v && i === 1) return
        const tr = el('tr', i === 3 ? 'cot-desglose__total' : '')
        tr.append(el('td', '', k), el('td', 'cot-desglose__monto', colones(v)))
        pie.append(tr)
    })
    tabla.append(cuerpo, pie)
    caja.append(tabla)
}

/* ---------- Navegación y total en vivo ---------- */
function validarPaso(p) {
    if (p === 1 && !estado.tipoEvento) return 'Elija el tipo de actividad'
    if (p === 2) {
        if (!estado.fechaEvento) return 'Elija una fecha en el calendario'
        if ($('#hora-fin').value <= $('#hora-inicio').value) return 'La hora de salida debe ser después de la de llegada'
    }
    if (p === 3 && totalPersonas() < REGLAS.minPersonas) return `Las cotizaciones de grupo son a partir de ${REGLAS.minPersonas} personas. Para menos, compre las entradas en línea.`
    if (p === 5) {
        if ($('#nombre').value.trim().length < 2) return 'Escriba el nombre de la persona encargada'
        const tel = $('#telefono').value.replace(/\D/g, '')
        if (tel.length < 8 || tel.length > 15) return 'Escriba un número de WhatsApp válido'
        const correo = $('#correo').value.trim()
        if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return 'Revise el correo'
    }
    return ''
}

function actualizar() {
    const c = calcular(seleccion(), estado.fechaEvento || null)
    $('#barra-total').textContent = colones(c.total)
    $('#barra-adelanto').textContent = c.total ? `Adelanto para reservar: ${colones(c.adelanto)}` : 'Arme su día y vea el precio'
    $('#barra-personas').textContent = c.personas ? `Total · ${c.personas} personas` : 'Total estimado'
    const pt = $('#personas-total')
    if (pt) pt.textContent = `${totalPersonas()} personas en total` + (c.revisionManual ? ' · grupos tan grandes los revisa la administración' : '')
    const falta = validarPaso(estado.paso)
    $('#btn-siguiente').setAttribute('aria-disabled', String(!!falta))
    if (estado.paso === TOTAL_PASOS) pintarResumen(c)
    return c
}

function irPaso(n) {
    estado.paso = n
    $$('.cot-paso').forEach(s => { s.hidden = Number(s.dataset.paso) !== n })
    const actual = $(`.cot-paso[data-paso="${n}"]`)
    $('#titulo-paso').textContent = actual.dataset.titulo
    $('#progreso-barra').style.width = `${(n / TOTAL_PASOS) * 100}%`
    $('#btn-atras').hidden = n === 1
    $('#btn-siguiente').textContent = n === TOTAL_PASOS ? 'Enviar' : 'Siguiente'
    $('#cot-error').hidden = true
    if (n === 2) pintarCalendario()
    actualizar()
    window.scrollTo({ top: 0 })
    actual.querySelector('button, input')?.focus({ preventScroll: true })
}

function avisar(texto) {
    let t = $('.cot-aviso')
    if (!t) { t = el('div', 'cot-aviso'); t.setAttribute('role', 'alert'); document.body.append(t) }
    t.textContent = texto; t.hidden = false
    clearTimeout(avisar.t); avisar.t = setTimeout(() => { t.hidden = true }, 4000)
}

$('#btn-siguiente').addEventListener('click', async () => {
    const falta = validarPaso(estado.paso)
    if (falta) { avisar(falta); return }
    if (estado.paso < TOTAL_PASOS) { irPaso(estado.paso + 1); return }
    await enviar()
})
$('#btn-atras').addEventListener('click', () => { if (estado.paso > 1) irPaso(estado.paso - 1) })

async function enviar() {
    const btn = $('#btn-siguiente'), error = $('#cot-error')
    btn.disabled = true; btn.textContent = 'Enviando…'; error.hidden = true
    try {
        const r = await fetch('/api/cotizaciones', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipoEvento: estado.tipoEvento, institucion: $('#institucion').value,
                fechaEvento: estado.fechaEvento, horaInicio: $('#hora-inicio').value, horaFin: $('#hora-fin').value,
                seleccion: seleccion(),
                nombre: $('#nombre').value, telefono: $('#telefono').value, correo: $('#correo').value,
                comentarios: $('#comentarios').value, web: $('[name=web]').value
            })
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
            if (r.status === 409) { estado.disponibilidad = {}; }
            throw new Error(d.error || 'No se pudo enviar. Revise su conexión e intente de nuevo.')
        }
        const tel4 = $('#telefono').value.replace(/\D/g, '').slice(-4)
        memoria.set('cotizacion', { codigo: d.codigo, tel: tel4 })
        $('#listo-codigo').textContent = d.codigo
        $('#listo-texto').textContent = `Total estimado ${colones(d.total)}. La administración le escribe al WhatsApp con la cotización final en menos de 24 horas. El ${fechaLarga(d.fechaEvento)} queda apartado por 2 días.`
        ver('listo')
    } catch (e) {
        error.textContent = e.message; error.hidden = false
    } finally {
        btn.disabled = false; btn.textContent = 'Enviar'
    }
}

$('#copiar-codigo').addEventListener('click', async e => {
    const codigo = $('#listo-codigo').textContent
    try { await navigator.clipboard.writeText(codigo); e.target.textContent = 'Código copiado ✓' }
    catch { const r = document.createRange(); r.selectNodeContents($('#listo-codigo')); getSelection().removeAllRanges(); getSelection().addRange(r) }
})

/* ---------- Vistas: asistente, listo, seguimiento ---------- */
function ver(vista) {
    $('#form-cot').hidden = vista !== 'asistente'
    $('#listo').hidden = vista !== 'listo'
    $('#seguimiento').hidden = vista !== 'seguimiento'
    $('#barra').hidden = vista !== 'asistente'
    $('.cot-progreso').hidden = vista !== 'asistente'
    if (vista === 'asistente') irPaso(estado.paso)
    else $('#titulo-paso').textContent = vista === 'listo' ? 'Solicitud enviada' : 'Mi solicitud'
    if (vista === 'seguimiento') {
        const g = memoria.get('cotizacion')
        if (g && !$('#seg-codigo').value) { $('#seg-codigo').value = g.codigo; $('#seg-tel').value = g.tel; consultar() }
    }
    window.scrollTo({ top: 0 })
}
$$('[data-ver]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const v = a.dataset.ver; history.replaceState(null, '', v === 'seguimiento' ? '#seguimiento' : location.pathname); ver(v) }))

const PASOS_FLUJO = ['solicitada', 'cotizada', 'reservada', 'confirmada', 'realizada']
const EXPLICA = {
    solicitada: 'Recibimos su solicitud. Le enviamos la cotización final por WhatsApp en menos de 24 horas.',
    cotizada: 'Su cotización está lista. Para reservar la fecha, pague el adelanto por SINPE Móvil y envíe el comprobante por WhatsApp.',
    reservada: 'Su fecha está reservada. Tres días antes le pedimos la cantidad final de personas.',
    confirmada: '¡Todo listo! Les esperamos.',
    realizada: 'Gracias por visitarnos.',
    cancelada: 'Esta solicitud fue cancelada. Si fue un error, escríbanos por WhatsApp.',
    vencida: 'El plazo de esta solicitud venció y la fecha se liberó. Puede hacer una nueva cotización.'
}

async function consultar() {
    const err = $('#seg-error'), res = $('#seg-resultado')
    err.hidden = true; res.hidden = true
    const codigo = $('#seg-codigo').value.trim().toUpperCase(), tel = $('#seg-tel').value.replace(/\D/g, '')
    try {
        const r = await fetch(`/api/cotizaciones?codigo=${encodeURIComponent(codigo)}&tel=${tel}`)
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'No se pudo consultar')
        memoria.set('cotizacion', { codigo, tel })
        res.replaceChildren()
        res.append(el('p', 'cot-estado__codigo', `${d.codigo} · ${d.tipoEvento}`), el('p', 'cot-estado__fecha', `${fechaLarga(d.fechaEvento)} · ${d.personas} personas`))
        const linea = el('ol', 'cot-linea')
        const idx = PASOS_FLUJO.indexOf(d.estado)
        PASOS_FLUJO.forEach((p, i) => {
            const li = el('li', 'cot-linea__paso' + (idx >= 0 && i < idx ? ' cot-linea__paso--hecho' : '') + (i === idx ? ' cot-linea__paso--actual' : ''), p[0].toUpperCase() + p.slice(1))
            linea.append(li)
        })
        res.append(linea)
        if (idx < 0) res.append(el('p', 'cot-estado__alerta', d.nombreEstado))
        res.append(el('p', '', EXPLICA[d.estado] || ''))
        if (d.mensaje) res.append(el('p', 'cot-estado__mensaje', 'Mensaje de la administración: ' + d.mensaje))
        const tot = el('dl', 'cot-resumen__datos')
        tot.append(el('dt', '', 'Total'), el('dd', '', colones(d.total)), el('dt', '', 'Adelanto 50 %'), el('dd', '', colones(d.adelanto)))
        if (d.validaHasta && d.estado === 'cotizada') tot.append(el('dt', '', 'Vale hasta'), el('dd', '', new Date(d.validaHasta).toLocaleDateString('es-CR')))
        res.append(tot)
        res.hidden = false
    } catch (e) { err.textContent = e.message; err.hidden = false }
}
$('#form-seguimiento').addEventListener('submit', e => { e.preventDefault(); consultar() })

/* ---------- Inicio ---------- */
$('#aviso-ejemplo').hidden = !PRECIOS_DE_EJEMPLO
// Preselección desde el sitio: cotizar.html?area=salon
const pre = new URLSearchParams(location.search).get('area')
if (pre && AREAS.some(a => a.id === pre)) estado.areas = [pre]
pintarTipos(); pintarContadores(); pintarAreas(); pintarMenusYExtras()
ver(location.hash === '#seguimiento' ? 'seguimiento' : 'asistente')
