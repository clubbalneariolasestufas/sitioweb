// Panel de eventos (eventos.html). Archivo aparte para que la política de seguridad (CSP) no permita scripts en línea.
import { ESTADOS, colones, nombreArea, nombreMenu, REGLAS } from './precios-eventos.js'

const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e }
const sesion = { get: () => { try { return sessionStorage.getItem('pin') || '' } catch { return '' } }, set: v => { try { v ? sessionStorage.setItem('pin', v) : sessionStorage.removeItem('pin') } catch {} } }
const COLOR = e => `var(--e-${e})`
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date())
const sumar = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
const fechaLarga = iso => { const d = new Date(iso + 'T12:00:00Z'); return `${SEM[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}` }
const ACCION = { cotizada: 'Enviar cotización', reservada: 'Registrar adelanto', confirmada: 'Confirmar cantidad final', realizada: 'Marcar como realizado', cancelada: 'Cancelar', solicitada: 'Reactivar' }

let pin = sesion.get()
let mes = hoy.slice(0, 7)
let datos = { cotizaciones: [], porAtender: [], proximos: [] }
let elegido = null, diaElegido = null, tab = 'atender'

async function api(cuerpo) {
    const r = await fetch('/api/eventos-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, ...cuerpo }) })
    const d = await r.json().catch(() => ({}))
    if (r.status === 401 || r.status === 403) { salir(d.error || 'PIN incorrecto'); throw new Error(d.error) }
    if (!r.ok) throw new Error(d.error || 'No se pudo completar')
    return d
}
function salir(msg) { pin = ''; sesion.set(''); $('#v-app').hidden = true; $('#v-pin').hidden = false; const e = $('#pin-error'); e.hidden = !msg; e.textContent = msg || '' }
$('#v-pin').addEventListener('submit', async e => {
    e.preventDefault(); pin = $('#pin').value; $('#pin').value = ''
    try { await cargar(); sesion.set(pin); $('#v-pin').hidden = true; $('#v-app').hidden = false } catch {}
})

async function cargar() {
    const ini = mes + '-01'
    const desde = sumar(ini, -7), hasta = sumar(ini, 45)
    const d = await api({ accion: 'listar', desde, hasta })
    datos = d
    pintarTodo()
}

function todas() {
    const m = new Map()
    ;[...datos.cotizaciones, ...datos.porAtender, ...(datos.proximos || [])].forEach(c => m.set(c.codigo, c))
    return [...m.values()]
}
const buscar = codigo => todas().find(c => c.codigo === codigo)

function pintarTodo() {
    pintarAtender(); pintarCalendario(); pintarTareas()
    if (elegido) { const c = buscar(elegido); c ? pintarDetalle(c) : ($('#detalle').hidden = true) }
}

/* ---------- Por atender ---------- */
function tarjetaCot(c) {
    const b = el('button', 'cot'); b.type = 'button'
    const f1 = el('div', 'cot__fila')
    const chip = el('span', 'chip', ESTADOS[c.estado].nombre); chip.style.setProperty('--c', COLOR(c.estado))
    f1.append(el('span', 'cot__nombre', c.nombre), chip)
    const f2 = el('div', 'cot__fila')
    f2.append(el('span', 'cot__meta', `${c.codigo} · ${c.tipoEvento} · ${fechaLarga(c.fechaEvento)} · ${c.calculo.personas} p.`), el('span', 'cot__total', colones(c.totalFinal ?? c.calculo.total)))
    b.append(f1, f2)
    const limite = c.estado === 'solicitada' ? c.apartadoHasta : c.estado === 'cotizada' ? c.validaHasta : null
    if (limite) {
        const horas = Math.round((new Date(limite) - Date.now()) / 3600000)
        b.append(el('span', horas < 24 ? 'urgente' : 'cot__meta', horas > 0 ? `${c.estado === 'solicitada' ? 'Fecha apartada' : 'Cotización vale'} ${horas < 48 ? horas + ' h más' : Math.round(horas / 24) + ' días más'}` : 'Plazo vencido'))
    }
    b.addEventListener('click', () => { elegido = c.codigo; pintarDetalle(c) })
    return b
}
function pintarAtender() {
    const l = $('#lista-atender'); l.replaceChildren()
    const lista = datos.porAtender.filter(c => ['solicitada', 'cotizada'].includes(c.estado))
    $('#cuenta-atender').textContent = datos.porAtender.filter(c => c.estado === 'solicitada').length
    if (!lista.length) l.append(el('p', 'vacio', 'No hay solicitudes pendientes. Las nuevas llegan aquí y a su correo.'))
    lista.forEach(c => l.append(tarjetaCot(c)))
}

/* ---------- Calendario ---------- */
function pintarCalendario() {
    const [a, m] = mes.split('-').map(Number)
    $('#mes-nombre').textContent = `${MESES[m - 1]} ${a}`
    const cal = $('#cal'); cal.replaceChildren()
    ;['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].forEach(d => cal.append(el('span', 'cal__sem', d)))
    const primero = mes + '-01'
    const desfase = (new Date(primero + 'T12:00:00Z').getUTCDay() + 6) % 7
    const ini = sumar(primero, -desfase)
    const cots = datos.cotizaciones.filter(c => !['cancelada', 'vencida'].includes(c.estado))
    for (let i = 0; i < 42; i++) {
        const f = sumar(ini, i)
        const d = el('button', 'dia'); d.type = 'button'
        if (f.slice(0, 7) !== mes) d.classList.add('dia--fuera')
        if (REGLAS.diasCerrado.includes(new Date(f + 'T12:00:00Z').getUTCDay())) d.classList.add('dia--cerrado')
        if (f === hoy) d.classList.add('dia--hoy')
        if (f === diaElegido) d.classList.add('dia--elegido')
        d.append(el('span', 'dia__num', String(Number(f.slice(8)))))
        const delDia = cots.filter(c => c.fechaEvento === f)
        delDia.forEach(c => { const e = el('span', 'dia__ev', `${c.nombre} · ${c.calculo.personas}`); e.style.background = COLOR(c.estado); d.append(e) })
        const tareas = cots.filter(c => ['reservada', 'confirmada'].includes(c.estado)).flatMap(c => c.tareas.filter(t => t.fecha === f && !t.hecha))
        if (tareas.length) d.append(el('span', 'dia__tarea', `☐ ${tareas.length} tarea${tareas.length > 1 ? 's' : ''}`))
        d.setAttribute('aria-label', `${fechaLarga(f)}: ${delDia.length} evento(s), ${tareas.length} tarea(s)`)
        d.addEventListener('click', () => { diaElegido = f; pintarCalendario(); pintarDia(f) })
        cal.append(d)
    }
    if (diaElegido) pintarDia(diaElegido)
}
function pintarDia(f) {
    const l = $('#lista-dia'); l.replaceChildren(el('h3', '', fechaLarga(f)))
    const cots = datos.cotizaciones.filter(c => c.fechaEvento === f)
    if (!cots.length) l.append(el('p', 'cot__meta', 'Sin eventos este día.'))
    cots.forEach(c => l.append(tarjetaCot(c)))
    const tareas = datos.cotizaciones.filter(c => ['reservada', 'confirmada'].includes(c.estado)).flatMap(c => c.tareas.filter(t => t.fecha === f).map(t => ({ ...t, c })))
    if (tareas.length) { l.append(el('h3', 'seccion-titulo', 'Tareas del día')); l.append(listaTareas(tareas)) }
}
$('#mes-ant').addEventListener('click', () => { const [a, m] = mes.split('-').map(Number); mes = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; diaElegido = null; $('#lista-dia').replaceChildren(); cargar().catch(e => aviso(e.message, true)) })
$('#mes-sig').addEventListener('click', () => { const [a, m] = mes.split('-').map(Number); mes = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; diaElegido = null; $('#lista-dia').replaceChildren(); cargar().catch(e => aviso(e.message, true)) })
const leyenda = $('#leyenda')
;['solicitada', 'cotizada', 'reservada', 'confirmada', 'realizada'].forEach(e => { const s = el('span', '', ESTADOS[e].nombre.replace(' (adelanto pagado)', '')); s.style.setProperty('--c', COLOR(e)); leyenda.append(s) })

/* ---------- Tareas ---------- */
function listaTareas(tareas) {
    const ul = el('ul', 'tareas')
    tareas.forEach(t => {
        const li = el('li', (t.hecha ? 'hecha' : '') + (!t.hecha && t.fecha < hoy ? ' vencida' : ''))
        const lab = el('label')
        const ch = el('input'); ch.type = 'checkbox'; ch.checked = t.hecha
        ch.addEventListener('change', async () => {
            ch.disabled = true
            try { const nueva = await api({ accion: 'tarea', codigo: t.c.codigo, tarea: t.id, hecha: ch.checked }); reemplazar(nueva) }
            catch (e) { aviso(e.message, true); ch.checked = !ch.checked }
            ch.disabled = false
        })
        lab.append(ch, el('span', '', `${t.texto} · ${t.c.nombre} (${t.c.codigo})`), el('span', 'fecha', t.fecha === hoy ? 'Hoy' : t.fecha.slice(8) + '/' + t.fecha.slice(5, 7)))
        li.append(lab); ul.append(li)
    })
    return ul
}
function pintarTareas() {
    const caja = $('#lista-tareas'); caja.replaceChildren()
    const hasta = sumar(hoy, 14)
    const tareas = todas().filter(c => ['reservada', 'confirmada'].includes(c.estado))
        .flatMap(c => c.tareas.map(t => ({ ...t, c })))
        .filter(t => (t.fecha <= hasta && t.fecha >= hoy) || (!t.hecha && t.fecha < hoy))
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
    $('#cuenta-tareas').textContent = tareas.filter(t => !t.hecha && t.fecha <= sumar(hoy, 1)).length
    if (!tareas.length) { caja.append(el('p', 'vacio', 'No hay tareas en los próximos 14 días.')); return }
    const porDia = {}
    tareas.forEach(t => (porDia[t.fecha] ??= []).push(t))
    Object.entries(porDia).forEach(([f, ts]) => { const d = el('div', 'dia-tareas'); d.append(el('h3', '', f === hoy ? 'Hoy · ' + fechaLarga(f) : fechaLarga(f)), listaTareas(ts)); caja.append(d) })
}

/* ---------- Detalle ---------- */
function reemplazar(c) {
    ;['cotizaciones', 'porAtender', 'proximos'].forEach(k => { const i = datos[k].findIndex(x => x.codigo === c.codigo); if (i >= 0) datos[k][i] = c })
    if (!buscar(c.codigo)) datos.porAtender.push(c)
    pintarTodo()
}
function mensajeWhatsApp(c) {
    const total = c.totalFinal ?? c.calculo.total, adelanto = c.adelantoFinal ?? c.calculo.adelanto
    const enlace = `${location.origin}/cotizar.html#seguimiento`
    const lineas = c.calculo.lineas.map(l => `• ${l.concepto}${l.cantidad > 1 ? ' × ' + l.cantidad : ''}: ${colones(l.monto)}`).join('\n')
    return `Hola ${c.nombre}, le saluda el Club Balneario Las Estufas. Esta es la cotización ${c.codigo} para el ${fechaLarga(c.fechaEvento)}:\n${lineas}\nTotal: ${colones(total)}\nPara reservar la fecha, haga un SINPE Móvil de ${colones(adelanto)} al 6003-4009 con el detalle ${c.codigo} y envíenos el comprobante. La cotización vale ${REGLAS.diasValidez} días.\nPuede ver el estado aquí: ${enlace}`
}
function pintarDetalle(c) {
    const d = $('#detalle'); d.hidden = false; d.replaceChildren()
    const cab = el('div', 'det__cab')
    const chip = el('span', 'chip', ESTADOS[c.estado].nombre); chip.style.setProperty('--c', COLOR(c.estado))
    cab.append(chip, el('h2', 'det__nombre', c.nombre), el('span', 'cot__meta', `${c.codigo} · ${c.tipoEvento}${c.institucion ? ' · ' + c.institucion : ''}`))
    d.append(cab)

    const dl = el('dl', 'datos')
    const fila = (k, v) => dl.append(el('dt', '', k), typeof v === 'string' ? el('dd', '', v) : (() => { const dd = el('dd'); dd.append(v); return dd })())
    fila('Fecha', `${fechaLarga(c.fechaEvento)}${c.horaInicio ? `, ${c.horaInicio} a ${c.horaFin}` : ''}`)
    fila('Personas', `${c.calculo.personas} (${['adultos', 'ninos', 'mayores'].map(k => c.seleccion.personas[k] ? `${c.seleccion.personas[k]} ${k === 'ninos' ? 'menores de 4' : k === 'adultos' ? 'entradas' : k}` : '').filter(Boolean).join(', ')})`)
    fila('Áreas', (c.seleccion.areas || []).map(nombreArea).join(', ') || '—')
    fila('Comida', nombreMenu(c.seleccion.menu))
    const tel = el('a', '', c.telefono.replace(/(\d{4})(\d{4})$/, '$1-$2')); tel.href = `https://wa.me/${c.telefono.length === 8 ? '506' + c.telefono : c.telefono}`; tel.target = '_blank'; tel.rel = 'noopener'
    fila('WhatsApp', tel)
    if (c.correo) fila('Correo', c.correo)
    if (c.comentarios) fila('Comentarios', c.comentarios)
    if (c.comprobanteAdelanto) fila('Comprobante', c.comprobanteAdelanto)
    d.append(dl)

    const t = el('table', 'desglose'), tb = el('tbody')
    c.calculo.lineas.forEach(l => { const tr = el('tr'); tr.append(el('td', '', l.cantidad > 1 ? `${l.concepto} × ${l.cantidad}` : l.concepto), el('td', '', colones(l.monto))); tb.append(tr) })
    ;[['Servicio 10 %', c.calculo.servicio], ...(c.calculo.iva ? [['IVA', c.calculo.iva]] : []), ['Total calculado', c.calculo.total]].forEach(([k, v]) => { const tr = el('tr'); tr.append(el('td', '', k), el('td', '', colones(v))); tb.append(tr) })
    if (c.totalFinal != null) { const tr = el('tr', 'total'); tr.append(el('td', '', 'Total acordado'), el('td', '', colones(c.totalFinal))); tb.append(tr) }
    else tb.lastChild.className = 'total'
    t.append(tb); d.append(t)

    // Acciones del flujo
    const sig = ESTADOS[c.estado].siguiente
    if (sig.length) {
        const caja = el('div', 'acciones')
        caja.append(el('h3', 'seccion-titulo', 'Siguiente paso'))
        const msg = el('p', 'aviso'); msg.hidden = true
        let total, nota, mensaje, comprobante
        if (c.estado === 'solicitada' || c.estado === 'reservada') {
            total = el('input', 'campo'); total.inputMode = 'numeric'; total.placeholder = c.estado === 'solicitada' ? `Total final (vacío = ${colones(c.calculo.total)})` : 'Total con la cantidad final (opcional)'
            caja.append(total)
        }
        if (c.estado === 'cotizada') {
            comprobante = el('input', 'campo'); comprobante.inputMode = 'numeric'; comprobante.placeholder = `Comprobante del SINPE de ${colones(c.adelantoFinal ?? c.calculo.adelanto)}`
            caja.append(comprobante)
        }
        mensaje = el('textarea', 'campo'); mensaje.rows = 2; mensaje.placeholder = 'Mensaje que verá el cliente al consultar (opcional)'; mensaje.value = c.mensajeCliente || ''
        nota = el('input', 'campo'); nota.placeholder = 'Nota interna (opcional)'
        caja.append(mensaje, nota)
        const botones = el('div', 'acciones__botones')
        sig.forEach(e => {
            const b = el('button', 'boton' + (e === 'cancelada' ? ' boton--rojo' : ''), ACCION[e] || ESTADOS[e].nombre); b.type = 'button'
            let confirmar = false
            b.addEventListener('click', async () => {
                if (e === 'cancelada' && !confirmar) { confirmar = true; b.textContent = '¿Seguro? Toque de nuevo para cancelar'; return }
                b.disabled = true
                try {
                    const nueva = await api({ accion: 'estado', codigo: c.codigo, estado: e, nota: nota.value, mensajeCliente: mensaje.value, totalFinal: total?.value.replace(/\D/g, '') || null, comprobante: comprobante?.value })
                    elegido = nueva.codigo; reemplazar(nueva)
                    aviso(`${nueva.codigo}: ${ESTADOS[nueva.estado].nombre}`)
                } catch (err) { msg.hidden = false; msg.className = 'aviso aviso--error'; msg.textContent = err.message; b.disabled = false }
            })
            botones.append(b)
        })
        caja.append(botones, msg)
        d.append(caja)
    }

    if (['solicitada', 'cotizada'].includes(c.estado)) {
        const w = el('a', 'boton boton--azul', 'Enviar la cotización por WhatsApp')
        w.href = `https://wa.me/${c.telefono.length === 8 ? '506' + c.telefono : c.telefono}?text=${encodeURIComponent(mensajeWhatsApp(c))}`
        w.target = '_blank'; w.rel = 'noopener'
        d.append(w, el('p', 'cot__meta', 'Primero toque «Enviar cotización» para que la fecha quede apartada 15 días; luego envíe el mensaje.'))
    }

    if (['reservada', 'confirmada'].includes(c.estado)) {
        d.append(el('h3', 'seccion-titulo', 'Tareas del evento'), listaTareas(c.tareas.map(t => ({ ...t, c }))))
    }

    const h = el('ol', 'historial')
    ;(c.historial || []).forEach(x => h.append(el('li', '', `${ESTADOS[x.estado]?.nombre || x.estado} · ${new Date(x.en).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' })}${x.nota ? ' · ' + x.nota : ''}`)))
    d.append(el('h3', 'seccion-titulo', 'Historial'), h)
    const cerrar = el('button', 'boton boton--claro', 'Cerrar'); cerrar.type = 'button'; cerrar.onclick = () => { elegido = null; d.hidden = true }
    d.append(cerrar)
    if (matchMedia('(max-width: 999px)').matches) d.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function aviso(texto, error) {
    const a = $('#aviso-general'); a.hidden = false; a.className = 'aviso ' + (error ? 'aviso--error' : 'aviso--ok'); a.textContent = texto
    clearTimeout(aviso.t); aviso.t = setTimeout(() => { a.hidden = true }, 5000)
}

/* ---------- Pestañas ---------- */
$$('.pestana').forEach(p => p.addEventListener('click', async () => {
    tab = p.dataset.tab
    $$('.pestana').forEach(x => x.setAttribute('aria-selected', String(x === p)))
    ;['atender', 'calendario', 'tareas', 'google'].forEach(t => { $('#t-' + t).hidden = t !== tab })
    if (tab === 'google' && !$('#url-cal').value) {
        try { $('#url-cal').value = (await api({ accion: 'calendario' })).url } catch (e) { $('#url-cal').value = ''; aviso(e.message, true) }
    }
}))
$('#copiar-cal').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#url-cal').value); aviso('Enlace copiado') } catch { $('#url-cal').select() }
})

setInterval(() => { if (pin && !$('#v-app').hidden && document.visibilityState === 'visible') cargar().catch(() => {}) }, 120000)
if (pin) cargar().then(() => { $('#v-pin').hidden = true; $('#v-app').hidden = false }).catch(() => {})
