import { CONFIG } from './datos.js'
import { crearMapa } from './mapa-balneario.js'
import {
    PRECIO_ENTRADA, EDAD_GRATIS, RANCHOS, CAPACIDAD_RANCHO, MINUTOS_APARTADO, MAX_DIAS_ADELANTE, MAX_PERSONAS, HORARIO,
    PRECIO_TENIS_MEDIA_HORA, TENIS_ABRE, TENIS_CIERRA, TENIS_MAX_BLOQUES, hhmm, duracionTexto, bloquesTenis,
    calcularCompra, resumenCompra, estaCerrado, esFinDeSemana, precioRancho, colones
} from './precios-tiquetes.js'

const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const el = (tag, clase, texto) => { const e = document.createElement(tag); if (clase) e.className = clase; if (texto != null) e.textContent = texto; return e }
const memoria = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) } catch {} }
}

// Modo de prueba interna (?prueba=ventas), igual que en la página principal
try {
    const p = new URLSearchParams(location.search).get('prueba')
    if (p === 'ventas') sessionStorage.setItem('pruebaVentas', '1')
    if (p === 'no') sessionStorage.removeItem('pruebaVentas')
    if (sessionStorage.getItem('pruebaVentas') === '1') CONFIG.ventaEnLinea = true
} catch {}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']
const NOMBRES_PASO = ['Fecha', 'Tiquetes', 'Extras', 'Carrito', 'Pago', 'Listo']
const hoyIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date())
const horaCR = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
const sumar = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
const dow = iso => new Date(iso + 'T12:00:00Z').getUTCDay()
const fechaLarga = iso => { const d = new Date(iso + 'T12:00:00Z'); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}` }

const estado = {
    paso: 1, fecha: '', general: 0, menores: 0, ranchos: [],
    tenisBloques: 0, tenisInicio: null,   // cancha de tenis: medias horas y minuto de inicio
    ranchosPedidos: 0,        // cuántos ranchos pidió en la página principal (se eligen en el mapa)
    disponibilidad: {},       // fecha -> [ranchos ocupados]
    tenisOcupado: {},         // fecha -> [minutos de inicio de cada media hora tomada]
    inicioVentana: null,
    orden: null,              // respuesta de /api/ordenes
    copiados: []
}
const tenisElegido = () => estado.tenisBloques && estado.tenisInicio != null ? { inicio: estado.tenisInicio, bloques: estado.tenisBloques } : null
const compra = () => calcularCompra({ general: estado.general, menores: estado.menores, ranchos: estado.ranchos, fecha: estado.fecha, tenis: tenisElegido() })
const ocupadosDia = () => estado.disponibilidad[estado.fecha] || []

/* ---------- Disponibilidad de ranchos ---------- */
async function cargarDisponibilidad(desde, dias) {
    try {
        const r = await fetch(`/api/ranchos?desde=${desde}&dias=${dias}`, { cache: 'no-store' })
        if (!r.ok) throw new Error()
        const d = await r.json()
        d.dias.forEach(x => { estado.disponibilidad[x.fecha] = x.ocupados; estado.tenisOcupado[x.fecha] = x.tenis || [] })
    } catch { /* sin conexión: el servidor revisa igual al crear la orden */ }
}

/* ---------- Paso 1: calendario ---------- */
function primerDia() {
    const hoy = hoyIso()
    return horaCR() >= HORARIO.cierra ? sumar(hoy, 1) : hoy
}
async function pintarCalendario() {
    const minimo = primerDia(), maximo = sumar(hoyIso(), MAX_DIAS_ADELANTE)
    estado.inicioVentana ??= minimo
    const ini = sumar(estado.inicioVentana, -((dow(estado.inicioVentana) + 6) % 7))
    await cargarDisponibilidad(ini < minimo ? minimo : ini, 42)
    const caja = $('#calendario'); caja.replaceChildren()
    ;['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].forEach(d => caja.append(el('span', 'cot-calendario__dia-semana', d)))
    const fin = sumar(ini, 41)
    const m1 = new Date(ini + 'T12:00:00Z').getUTCMonth(), m2 = new Date(fin + 'T12:00:00Z').getUTCMonth()
    $('#mes-nombre').textContent = m1 === m2 ? MESES[m1] : `${MESES[m1]} – ${MESES[m2]}`
    $('#mes-ant').disabled = ini <= minimo
    $('#mes-sig').disabled = fin >= maximo
    for (let i = 0; i < 42; i++) {
        const f = sumar(ini, i)
        const cerrado = estaCerrado(f), fuera = f < minimo || f > maximo
        const libres = RANCHOS.length - (estado.disponibilidad[f] || []).length
        const b = el('button', 'cot-dia'); b.type = 'button'
        b.append(el('span', 'cot-dia__num', String(Number(f.slice(8)))),
            el('span', 'cot-dia__estado', cerrado ? 'Cerrado' : fuera ? '' : `${libres} ranchos`))
        if (cerrado || fuera) { b.disabled = true; b.classList.add('cot-dia--no') }
        else if (!libres) b.classList.add('cot-dia--parcial')
        if (esFinDeSemana(f) && !cerrado && !fuera) b.classList.add('cot-dia--finde')
        if (f === estado.fecha) b.classList.add('cot-dia--elegido')
        b.setAttribute('aria-label', `${fechaLarga(f)}: ${cerrado ? 'cerrado' : fuera ? 'no disponible' : libres + ' ranchos libres'}`)
        b.addEventListener('click', () => {
            estado.fecha = f
            estado.ranchos = estado.ranchos.filter(n => !(estado.disponibilidad[f] || []).includes(n))
            estado.tenisInicio = null
            pintarCalendario(); actualizar()
        })
        caja.append(b)
    }
    if (estado.fecha) {
        const libres = RANCHOS.length - ocupadosDia().length
        $('#dia-nota').textContent = `Eligió el ${fechaLarga(estado.fecha)}. Hay ${libres} de ${RANCHOS.length} ranchos libres${precioRancho(estado.fecha) ? ' (₡10 000 cada uno)' : ', y entre semana se apartan sin costo'}.`
    }
}
$('#mes-sig').addEventListener('click', () => { estado.inicioVentana = sumar(estado.inicioVentana, 28); pintarCalendario() })
$('#mes-ant').addEventListener('click', () => {
    const nuevo = sumar(estado.inicioVentana, -28), minimo = primerDia()
    estado.inicioVentana = nuevo < minimo ? minimo : nuevo
    pintarCalendario()
})

/* ---------- Paso 2: tiquetes como boletos ---------- */
function pintarContadores() {
    const caja = $('#contadores'); caja.replaceChildren()
    ;[
        { id: 'general', etiqueta: 'TODOS LOS DÍAS', nombre: 'Entrada general', precio: colones(PRECIO_ENTRADA) + ' por persona', oscuro: false },
        { id: 'menores', etiqueta: 'NIÑOS', nombre: `Menores de ${EDAD_GRATIS} años`, precio: 'Gratis', oscuro: true }
    ].forEach(t => {
        const b = el('div', 'tq-boleto' + (t.oscuro ? ' tq-boleto--oscuro' : ''))
        const info = el('div', 'tq-boleto__info')
        info.append(el('small', '', t.etiqueta), el('strong', '', t.nombre), el('span', '', t.precio))
        const talon = el('div', 'tq-boleto__talon')
        const menos = el('button', 'tq-boleto__btn', '−'); menos.type = 'button'; menos.setAttribute('aria-label', 'Menos ' + t.nombre)
        const num = el('span', 'tq-boleto__num', String(estado[t.id]))
        const mas = el('button', 'tq-boleto__btn', '+'); mas.type = 'button'; mas.setAttribute('aria-label', 'Más ' + t.nombre)
        menos.onclick = () => { estado[t.id] = Math.max(0, estado[t.id] - 1); num.textContent = estado[t.id]; actualizar() }
        mas.onclick = () => { estado[t.id] = Math.min(50, estado[t.id] + 1); num.textContent = estado[t.id]; actualizar() }
        talon.append(menos, num, mas)
        b.append(info, talon)
        caja.append(b)
    })
}

/* ---------- Paso 3: mapa ---------- */
let mapa = null
function avisoRanchos() {
    const c = compra(), libres = RANCHOS.length - ocupadosDia().length
    const aviso = $('#rancho-aviso')
    aviso.className = 'tq-aviso'
    if (!c.ranchos.length && estado.ranchosPedidos) aviso.textContent = `Pidió ${estado.ranchosPedidos} rancho${estado.ranchosPedidos > 1 ? 's' : ''}: tóquelo${estado.ranchosPedidos > 1 ? 's' : ''} en el mapa. Hay ${libres} libre${libres === 1 ? '' : 's'} este día.`
    else if (!c.ranchos.length) aviso.textContent = `Para ${c.personas} persona${c.personas === 1 ? '' : 's'} ${c.ranchosNecesarios > 1 ? 'necesita ' + c.ranchosNecesarios + ' ranchos' : 'alcanza con 1 rancho'}. Hay ${libres} libre${libres === 1 ? '' : 's'} este día.`
    else if (!c.caben) { aviso.textContent = `${c.personas} personas no caben en ${c.ranchos.length} rancho${c.ranchos.length > 1 ? 's' : ''}: elija ${c.ranchosNecesarios - c.ranchos.length} más o quite personas.`; aviso.classList.add('tq-aviso--error') }
    else { aviso.textContent = `Rancho${c.ranchos.length > 1 ? 's' : ''} ${c.ranchos.join(' y ')}: caben hasta ${c.capacidad} personas. Su grupo: ${c.personas}.`; aviso.classList.add('tq-aviso--ok') }
    $('#rancho-condicion').textContent = (precioRancho(estado.fecha)
        ? `Opcional. ₡10 000 cada uno los fines de semana, máximo ${CAPACIDAD_RANCHO} personas.`
        : `Opcional y sin costo entre semana: se aparta si hay disponibilidad. Máximo ${CAPACIDAD_RANCHO} personas por rancho.`)
        + ' Ranchos de bambú con agua propia y basurero; aún no tienen parrilla.'
}
async function pintarMapa() {
    await cargarDisponibilidad(estado.fecha, 1)
    estado.ranchos = estado.ranchos.filter(n => !ocupadosDia().includes(n))
    const ancho = $('#mapa').clientWidth || 358
    const escala = Math.max(0.7, Math.min(1, ancho / 1280))
    mapa = crearMapa($('#mapa'), {
        escala, ocupados: ocupadosDia(), elegidos: estado.ranchos,
        alElegir: n => {
            estado.ranchos = estado.ranchos.includes(n) ? estado.ranchos.filter(x => x !== n) : [...estado.ranchos, n].sort((a, b) => a - b)
            mapa.actualizar({ elegidos: estado.ranchos })
            actualizar()
        }
    })
    pintarTenis()
    actualizar()
}
$('#sin-rancho').addEventListener('click', () => { estado.ranchos = []; irPaso(4) })

/* ---------- Paso 3: cancha de tenis por medias horas ---------- */
function inicioLibre(min, bloques) {
    const tomadas = estado.tenisOcupado[estado.fecha] || []
    if (min + bloques * 30 > TENIS_CIERRA) return false
    if (estado.fecha === hoyIso()) { const [h, m] = horaCR().split(':').map(Number); if (min < h * 60 + m) return false }
    return bloquesTenis(min, bloques).every(x => !tomadas.includes(x))
}
function pintarTenis() {
    const b = estado.tenisBloques
    if (estado.tenisInicio != null && (!b || !inicioLibre(estado.tenisInicio, b))) estado.tenisInicio = null
    $('#tenis-duracion').textContent = b ? duracionTexto(b) : 'No'
    $('#tenis-menos').disabled = !b
    $('#tenis-mas').disabled = b >= TENIS_MAX_BLOQUES
    $('#tenis-horario').hidden = !b
    const caja = $('#tenis-horas'); caja.replaceChildren()
    const tomadas = estado.tenisOcupado[estado.fecha] || []
    for (let m = TENIS_ABRE; m < TENIS_CIERRA; m += 30) {
        const sel = estado.tenisInicio != null && m >= estado.tenisInicio && m < estado.tenisInicio + b * 30
        const tomado = tomadas.includes(m), libre = inicioLibre(m, Math.max(1, b))
        const btn = el('button', 'tq-hora' + (tomado ? ' tq-hora--tomada' : sel ? ' tq-hora--elegida' : ''), hhmm(m)); btn.type = 'button'
        btn.disabled = !libre && !sel
        btn.setAttribute('aria-pressed', String(m === estado.tenisInicio))
        btn.setAttribute('aria-label', `Empezar a las ${hhmm(m)}${tomado ? ', reservada' : !libre ? ', no alcanza' : ''}`)
        btn.onclick = () => { if (libre) { estado.tenisInicio = m; pintarTenis(); actualizar() } }
        caja.append(btn)
    }
    const t = tenisElegido()
    $('#tenis-nota').textContent = t ? `${hhmm(t.inicio)} a ${hhmm(t.inicio + t.bloques * 30)} · ${colones(t.bloques * PRECIO_TENIS_MEDIA_HORA)}` : b ? 'Toque la hora de inicio' : ''
}
$('#tenis-menos').addEventListener('click', () => { estado.tenisBloques = Math.max(0, estado.tenisBloques - 1); pintarTenis(); actualizar() })
$('#tenis-mas').addEventListener('click', () => { estado.tenisBloques = Math.min(TENIS_MAX_BLOQUES, estado.tenisBloques + 1); pintarTenis(); actualizar() })

/* ---------- Paso 4: carrito ---------- */
function pintarCarrito() {
    const c = compra(), caja = $('#carrito')
    caja.replaceChildren()
    const fila = (titulo, detalle, monto, quitar, contador) => {
        const f = el('div', 'tq-linea')
        const t = el('span', 'tq-linea__texto'); t.append(el('strong', '', titulo), el('small', '', detalle))
        f.append(t, el('span', 'tq-linea__monto', monto))
        const acc = el('span', 'tq-linea__acciones')
        const q = el('button', 'tq-linea__quitar'); q.type = 'button'; q.setAttribute('aria-label', 'Quitar ' + titulo)
        q.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>'
        q.onclick = quitar
        acc.append(q)
        if (contador) {
            const menos = el('button', 'tq-linea__btn', '−'); menos.type = 'button'; menos.setAttribute('aria-label', 'Menos')
            const mas = el('button', 'tq-linea__btn', '+'); mas.type = 'button'; mas.setAttribute('aria-label', 'Más')
            menos.onclick = () => contador(-1); mas.onclick = () => contador(1)
            acc.append(menos, el('span', 'tq-linea__num', String(contador.n)), mas)
        }
        f.append(acc)
        caja.append(f)
    }
    const cont = (k) => Object.assign(d => { estado[k] = Math.max(0, Math.min(50, estado[k] + d)); pintarCarrito(); actualizar() }, { n: estado[k] })
    if (c.general) fila('ENTRADA GENERAL', `${colones(PRECIO_ENTRADA)} × ${c.general}`, colones(c.general * PRECIO_ENTRADA), () => { estado.general = 0; pintarCarrito(); actualizar() }, cont('general'))
    if (c.menores) fila(`MENORES DE ${EDAD_GRATIS} AÑOS`, `Gratis × ${c.menores}`, '₡0', () => { estado.menores = 0; pintarCarrito(); actualizar() }, cont('menores'))
    c.ranchos.forEach(n => fila(`RANCHO ${n}`, c.precioRancho ? `Bambú · hasta ${CAPACIDAD_RANCHO} personas · agua y basurero` : 'Bambú · apartado sin costo entre semana', c.precioRancho ? colones(c.precioRancho) : 'Gratis',
        () => { estado.ranchos = estado.ranchos.filter(x => x !== n); pintarCarrito(); actualizar() }))
    if (c.tenis) fila('CANCHA DE TENIS', `${hhmm(c.tenis.inicio)} a ${hhmm(c.tenis.fin)} · ${duracionTexto(c.tenis.bloques)}`, colones(c.tenis.bloques * PRECIO_TENIS_MEDIA_HORA),
        () => { estado.tenisBloques = 0; estado.tenisInicio = null; pintarCarrito(); actualizar() })
    if (!c.lineas.length) caja.append(el('p', 'formulario__nota', 'Su carrito está vacío. Vuelva al paso 2 para agregar tiquetes.'))
    const libres = RANCHOS.length - ocupadosDia().length
    $('#oferta-rancho').hidden = c.ranchos.length > 0 || libres === 0
    $('#oferta-texto').textContent = c.precioRancho ? `Rancho para hasta ${CAPACIDAD_RANCHO} personas · ₡10 000 (${libres} libres)` : `Aparte un rancho sin costo · ${libres} libres este día`
}
$('#ir-rancho').addEventListener('click', () => irPaso(3))

/* ---------- Paso 5: pago asistido ---------- */
function pintarCopias() {
    const o = estado.orden
    const datos = [
        { id: 'num', etiqueta: '1 · Número SINPE', valor: o.sinpe, copia: o.sinpe.replace(/\D/g, ''), nota: 'Club Balneario Las Estufas' },
        { id: 'monto', etiqueta: '2 · Monto exacto', valor: colones(o.total), copia: String(o.total), nota: 'Sin redondear' },
        { id: 'cod', etiqueta: '3 · Descripción', valor: o.codigo, copia: o.codigo, nota: 'Péguelo en «Descripción» o «Detalle»' }
    ]
    const caja = $('#copias'); caja.replaceChildren()
    datos.forEach((d, i) => {
        const ok = estado.copiados.includes(d.id)
        const f = el('div', 'tq-copia' + (ok ? ' tq-copia--ok' : i === estado.copiados.length ? ' tq-copia--actual' : ''))
        f.append(el('span', 'tq-copia__marca', ok ? '✓' : String(i + 1)))
        const t = el('span', 'tq-copia__texto'); t.append(el('small', '', d.etiqueta), el('strong', '', d.valor), el('small', d.id === 'cod' ? 'tq-copia__clave' : '', d.nota))
        const b = el('button', 'tq-copia__btn', ok ? 'Copiado ✓' : 'Copiar'); b.type = 'button'
        b.onclick = async () => {
            try { await navigator.clipboard.writeText(d.copia) } catch { /* el dato queda visible para escribirlo a mano */ }
            if (!estado.copiados.includes(d.id)) estado.copiados.push(d.id)
            pintarCopias(); actualizar()
        }
        f.append(t, b)
        caja.append(f)
    })
    $('#banco-numero').textContent = o.sinpe.replace('-', ' ')
    $('#banco-monto').textContent = Number(o.total).toLocaleString('es-CR')
    $('#banco-codigo').textContent = o.codigo
}

async function crearOrden() {
    const c = compra()
    const r = await fetch(CONFIG.api.ordenes, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            general: c.general, menores: c.menores, ranchos: c.ranchos, tenis: c.tenis, fechaVisita: estado.fecha,
            nombre: $('#nombre').value, telefono: $('#telefono').value, correo: $('#correo').value, web: $('[name=web]').value
        })
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) {
        if (d.ranchoOcupado) {
            estado.disponibilidad[estado.fecha] = [...new Set([...ocupadosDia(), d.ranchoOcupado])]
            estado.ranchos = estado.ranchos.filter(n => n !== d.ranchoOcupado)
        }
        if (d.tenisOcupado) { estado.tenisInicio = null; cargarDisponibilidad(estado.fecha, 1) }
        throw Object.assign(new Error(d.error || 'No se pudo crear la orden. Revise su conexión.'), { rancho: d.ranchoOcupado || d.tenisOcupado })
    }
    return d
}

let vigia = null, reloj = null
function vigilarPago() {
    clearInterval(vigia); clearInterval(reloj)
    const hasta = Date.now() + 30 * 60_000
    vigia = setInterval(async () => {
        if (Date.now() > hasta) return clearInterval(vigia)
        if (document.hidden) return
        try {
            const { ok, datos } = await consultarPago('')
            if (ok) entregar(datos)
            else if (!datos.esperando) { clearInterval(vigia); mostrarError('#pago-error', datos.error || 'No se pudo verificar el pago.') }
        } catch {}
    }, 15_000)
    const pintarReloj = () => {
        const o = estado.orden
        if (!o?.ranchoHastaEn) return
        const seg = Math.max(0, Math.round((new Date(o.ranchoHastaEn) - Date.now()) / 1000))
        $('#espera-texto').textContent = seg
            ? `${o.ranchos?.length ? (o.ranchos.length > 1 ? 'Ranchos apartados' : 'Rancho apartado') + (o.tenis ? ' y cancha apartada' : '') : 'Cancha apartada'} por ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')} min más mientras llega su pago.`
            : 'El apartado terminó. Si ya pagó, igual le confirmamos; el personal le ayuda si alguien más tomó su rancho o su hora de cancha.'
    }
    pintarReloj()
    reloj = setInterval(pintarReloj, 1000)
}
async function consultarPago(ultimos4) {
    const r = await fetch(CONFIG.api.verificar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: estado.orden.codigo, ultimos4 }) })
    return { ok: r.ok, datos: await r.json().catch(() => ({})) }
}
function mostrarError(sel, texto) { const e = $(sel); e.textContent = texto; e.hidden = false }

function entregar(datos) {
    clearInterval(vigia); clearInterval(reloj)
    memoria.set('ordenTiquetes', null)
    const lista = $('#boletos-lista'); lista.replaceChildren()
    datos.boletos.forEach((b, i) => {
        const fig = el('figure', 'boleto')
        const img = el('img', 'boleto__qr'); img.src = b.qr; img.alt = `Código QR del boleto ${i + 1}`; img.width = 220; img.height = 220
        const cap = el('figcaption', 'boleto__datos')
        cap.append(el('strong', '', `Boleto ${i + 1} de ${datos.boletos.length}: ${b.nombrePase}`), el('span', '', `Válido el ${fechaLarga(b.fechaVisita)}`))
        if (b.ranchos?.length) cap.append(el('span', '', `Rancho${b.ranchos.length > 1 ? 's' : ''} ${b.ranchos.join(' y ')}`))
        if (b.tenis) cap.append(el('span', '', b.tenis))
        const bajar = el('a', 'boleto__descarga', 'Descargar imagen'); bajar.href = b.qr; bajar.download = `boleto-${datos.codigo}-${i + 1}.png`
        cap.append(bajar)
        fig.append(img, cap)
        lista.append(fig)
    })
    $('#listo-texto').textContent = `Pago confirmado. Presente cada código QR en la entrada (guarde una captura).${datos.ranchos?.length ? ` Su rancho: ${datos.ranchos.join(' y ')}.` : ''}${datos.tenis ? ` Cancha de tenis de ${hhmm(datos.tenis.inicio)} a ${hhmm(datos.tenis.fin)}.` : ''}`
    const conflictos = []
    if (datos.ranchoConflicto) conflictos.push(`Su pago llegó después de que se liberó el rancho ${datos.ranchoConflicto} y otra persona lo tomó. Al llegar, el personal le asigna otro rancho libre; si no hay, le devolvemos ese monto.`)
    if (datos.tenisConflicto) conflictos.push(`Su pago llegó después de que se liberó la cancha y otra persona la tomó a las ${datos.tenisConflicto}. Al llegar, el personal le ofrece otra hora libre o le devuelve lo de la cancha.`)
    $('#listo-conflicto').hidden = !conflictos.length
    $('#listo-conflicto').textContent = conflictos.join(' ')
    $('#listo-correo').hidden = !datos.correoEnviado
    irPaso(6)
}
$('#cancelar-orden').addEventListener('click', () => {
    clearInterval(vigia); clearInterval(reloj)
    estado.orden = null; estado.copiados = []
    memoria.set('ordenTiquetes', null)
    irPaso(4)
})

/* ---------- Navegación y total ---------- */
function validarPaso(p) {
    const c = compra()
    if (p === 1 && !estado.fecha) return 'Elija una fecha'
    if (p === 2 && !c.general) return 'Agregue un tiquete'
    if (p === 3 && !c.caben) return 'Faltan ranchos'
    if (p === 3 && estado.tenisBloques && estado.tenisInicio == null) return 'Elija la hora de cancha'
    if (p === 4) {
        if (!c.general) return 'Agregue un tiquete'
        if (!c.caben) return 'Faltan ranchos'
        if ($('#nombre').value.trim().length < 2) return 'Escriba su nombre'
        const tel = $('#telefono').value.replace(/\D/g, '')
        if (tel.length < 8 || tel.length > 15) return 'Revise su WhatsApp'
        const correo = $('#correo').value.trim()
        if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return 'Revise el correo'
    }
    if (p === 5 && estado.copiados.length < 3) return `Faltan ${3 - estado.copiados.length} paso${3 - estado.copiados.length === 1 ? '' : 's'}`
    return ''
}

function actualizar() {
    const c = compra()
    $('#barra-total').textContent = colones(estado.orden ? estado.orden.total : c.total)
    $('#barra-resumen').textContent = estado.fecha ? `${c.personas} persona${c.personas === 1 ? '' : 's'}${c.ranchos.length ? ' · ' + c.ranchos.length + ' rancho' + (c.ranchos.length > 1 ? 's' : '') : ''}${c.tenis ? ' · tenis' : ''} · ${fechaLarga(estado.fecha)}` : `Entrada general ${colones(PRECIO_ENTRADA)}`
    if (estado.paso === 3) avisoRanchos()
    const falta = validarPaso(estado.paso)
    const btn = $('#btn-siguiente')
    const textos = { 1: 'Continuar', 2: 'Continuar', 3: c.ranchos.length || c.tenis ? 'Continuar' : 'Sin extras, continuar', 4: CONFIG.ventaEnLinea ? 'Pagar' : 'Pedir por WhatsApp', 5: 'Ya pagué' }
    btn.textContent = falta || textos[estado.paso] || 'Continuar'
    btn.setAttribute('aria-disabled', String(!!falta))
}

function irPaso(n) {
    estado.paso = n
    $$('.cot-paso').forEach(s => { s.hidden = Number(s.dataset.paso) !== n })
    $('#titulo-paso').textContent = $(`.cot-paso[data-paso="${n}"]`).dataset.titulo
    $('#paso-num').textContent = n < 6 ? `${n} de 5` : 'Listo'
    const pasos = $('#pasos'); pasos.replaceChildren()
    NOMBRES_PASO.forEach((t, i) => pasos.append(el('li', 'tq-pasos__item' + (i + 1 === n ? ' tq-pasos__item--actual' : i + 1 < n ? ' tq-pasos__item--hecho' : ''), t)))
    $('#tq-fecha').hidden = !estado.fecha || n === 1 || n === 6
    $('#tq-fecha-texto').textContent = estado.fecha ? fechaLarga(estado.fecha) : ''
    $('#cambiar-fecha').hidden = n >= 5
    $('#btn-atras').hidden = n === 1 || n >= 5
    $('#barra').hidden = n === 6
    if (n === 1) pintarCalendario()
    if (n === 2) pintarContadores()
    if (n === 3) pintarMapa()
    if (n === 4) pintarCarrito()
    if (n === 5) pintarCopias()
    actualizar()
    window.scrollTo({ top: 0 })
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
    const btn = $('#btn-siguiente')
    if (estado.paso === 4) {
        const c = compra()
        if (!CONFIG.ventaEnLinea) {
            const texto = `Hola, quiero comprar para el ${fechaLarga(estado.fecha)}: ${resumenCompra(c)}. Total ${colones(c.total)}. Nombre: ${$('#nombre').value.trim()}. Pagaré por SINPE Móvil al ${CONFIG.sinpe}.`
            window.open(`https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
            return
        }
        btn.disabled = true; btn.textContent = 'Creando su orden…'
        $('#carrito-error').hidden = true
        try {
            estado.orden = { ...(await crearOrden()), ranchos: c.ranchos, tenis: c.tenis }
            estado.copiados = []
            memoria.set('ordenTiquetes', { orden: estado.orden, fecha: estado.fecha })
            irPaso(5)
            vigilarPago()
        } catch (e) {
            mostrarError('#carrito-error', e.message)
            if (e.rancho) pintarCarrito()
        } finally { btn.disabled = false; actualizar() }
        return
    }
    if (estado.paso === 5) {
        btn.disabled = true; btn.textContent = 'Buscando su pago…'
        $('#pago-error').hidden = true
        try {
            const { ok, datos } = await consultarPago($('#ultimos4').value.replace(/\D/g, '').slice(0, 4))
            if (ok) entregar(datos)
            else mostrarError('#pago-error', datos.esperando
                ? 'Todavía no vemos su pago. Normalmente llega en menos de un minuto; deje esta pantalla abierta. Si no escribió el código, ponga los últimos 4 números del comprobante.'
                : datos.error || 'No se pudo verificar el pago.')
        } catch { mostrarError('#pago-error', 'Sin conexión. Intente de nuevo en un momento.') }
        finally { btn.disabled = false; actualizar() }
        return
    }
    irPaso(estado.paso + 1)
})
$('#btn-atras').addEventListener('click', () => { if (estado.paso > 1 && estado.paso < 5) irPaso(estado.paso - 1) })
$('#cambiar-fecha').addEventListener('click', () => irPaso(1))
;['#nombre', '#telefono', '#correo'].forEach(s => $(s).addEventListener('input', actualizar))

/* ---------- Inicio ---------- */
const guardada = memoria.get('ordenTiquetes')
if (guardada?.orden && new Date(guardada.orden.venceEn) > new Date()) {
    // Volvió a la página con una orden sin pagar: se retoma el paso de pago
    estado.orden = guardada.orden; estado.fecha = guardada.fecha; estado.copiados = ['num', 'monto', 'cod']
    irPaso(5)
    vigilarPago()
} else {
    memoria.set('ordenTiquetes', null)
    irPaso(desdeInicio())
}

// Selección armada en la página principal: tiquetes.html?f=2026-12-05&g=2&m=1&r=1&tb=2&ti=540
function desdeInicio() {
    const q = new URLSearchParams(location.search)
    const f = q.get('f'), n = (k, max) => Math.max(0, Math.min(max, Math.floor(Number(q.get(k))) || 0))
    if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f) || f < primerDia() || f > sumar(hoyIso(), MAX_DIAS_ADELANTE) || estaCerrado(f)) return 1
    estado.fecha = f
    estado.general = n('g', MAX_PERSONAS); estado.menores = n('m', MAX_PERSONAS)
    estado.ranchosPedidos = n('r', RANCHOS.length)
    estado.tenisBloques = n('tb', TENIS_MAX_BLOQUES)
    const ti = Number(q.get('ti'))
    estado.tenisInicio = estado.tenisBloques && Number.isInteger(ti) && ti % 30 === 0 && ti >= TENIS_ABRE && ti < TENIS_CIERRA ? ti : null
    if (!estado.general) return 2
    return estado.ranchosPedidos || estado.tenisBloques ? 3 : 4
}
