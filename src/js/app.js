import { CONFIG, PASES, EVENTOS, fechaLarga, colones } from './datos.js'

const $ = (sel, ctx = document) => ctx.querySelector(sel)
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)]
const waLink = texto => `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(texto)}`

document.addEventListener('DOMContentLoaded', () => {
    menuMovil()
    resaltarSeccion()
    pintarEventos()
    pintarGaleria()
    modalEntradas()
    formularioReservas()
    enlacesContacto()
    $('#anio').textContent = new Date().getFullYear()
})

/* ---------- Navegación ---------- */
function menuMovil() {
    const boton = $('.nav__boton')
    const lista = $('.nav__lista')
    boton.addEventListener('click', () => {
        const abierto = lista.classList.toggle('nav__lista--abierta')
        boton.setAttribute('aria-expanded', abierto)
    })
    lista.addEventListener('click', e => {
        if (e.target.matches('a')) {
            lista.classList.remove('nav__lista--abierta')
            boton.setAttribute('aria-expanded', 'false')
        }
    })
}

function resaltarSeccion() {
    const enlaces = $$('.nav__enlace')
    const observador = new IntersectionObserver(entradas => {
        entradas.forEach(entrada => {
            if (!entrada.isIntersecting) return
            enlaces.forEach(a => a.classList.toggle('nav__enlace--activo', a.getAttribute('href') === `#${entrada.target.id}`))
        })
    }, { rootMargin: '-45% 0px -50% 0px' })
    $$('main section[id]').forEach(s => observador.observe(s))
}

/* ---------- Eventos (se ocultan los pasados) ---------- */
function pintarEventos() {
    const contenedor = $('#eventos-lista')
    const hoy = new Date().toISOString().slice(0, 10)
    const proximos = EVENTOS.filter(e => e.fecha >= hoy)

    if (!proximos.length) {
        const vacio = document.createElement('div')
        vacio.className = 'eventos__vacio'
        vacio.innerHTML = '<h3>Próximamente nuevas fechas</h3><p>¿Quiere un baile, música con DJ o una fiesta privada? Reserve su evento con nosotros.</p><a class="boton" href="#reservas">Reservar evento</a>'
        contenedor.replaceWith(vacio)
        return
    }

    proximos.forEach(ev => {
        const tarjeta = document.createElement('article')
        tarjeta.className = `evento evento--${ev.color}`

        const cab = document.createElement('div')
        cab.className = 'evento__cabecera'
        const fecha = Object.assign(document.createElement('p'), { className: 'evento__fecha', textContent: fechaLarga(ev.fecha) })
        const nombre = Object.assign(document.createElement('h3'), { className: 'evento__nombre', textContent: ev.nombre })
        cab.append(fecha, nombre)

        const ul = document.createElement('ul')
        ul.className = 'evento__programa'
        ev.programa.forEach(([hora, detalle]) => {
            const li = document.createElement('li')
            const strong = Object.assign(document.createElement('strong'), { textContent: hora })
            li.append(strong, ` | ${detalle}`)
            ul.append(li)
        })

        tarjeta.append(cab, ul)
        contenedor.append(tarjeta)
    })
}

/* ---------- Galería + lightbox ---------- */
function pintarGaleria() {
    const galeria = $('#galeria-lista')
    const visor = $('#visor')
    const imgVisor = $('img', visor)

    for (let i = 1; i <= CONFIG.totalFotos; i++) {
        const boton = document.createElement('button')
        boton.className = 'galeria__item'
        boton.type = 'button'
        boton.setAttribute('aria-label', `Ver foto ${i} ampliada`)

        const img = document.createElement('img')
        img.className = 'galeria__imagen'
        img.src = `build/img/galeria/${i}-t.webp`
        img.alt = `Foto ${i} del ${CONFIG.nombre}`
        img.loading = 'lazy'
        img.width = 640
        img.height = 640

        boton.append(img)
        boton.addEventListener('click', () => {
            imgVisor.src = `build/img/galeria/${i}.webp`
            imgVisor.alt = img.alt
            visor.showModal()
        })
        galeria.append(boton)
    }
    activarCierre(visor)
}

/* ---------- Diálogos ---------- */
function activarCierre(dialogo) {
    $$('[data-cerrar]', dialogo).forEach(b => b.addEventListener('click', () => dialogo.close()))
    dialogo.addEventListener('click', e => { if (e.target === dialogo) dialogo.close() })
    dialogo.addEventListener('close', () => document.body.classList.remove('sin-scroll'))
}

/* ---------- Compra de entradas ---------- */
function modalEntradas() {
    const dialogo = $('#modal-entradas')
    const form = $('#form-entradas')
    const formPago = $('#form-pago')
    const panelBoletos = $('#boletos')
    const selectPase = $('[name=pase]', form)
    const cantidad = $('[name=cantidad]', form)
    const fecha = $('[name=fecha]', form)
    const total = $('#entradas-total')
    const mensaje = $('#entradas-mensaje')
    let orden = null

    PASES.forEach(p => selectPase.append(new Option(`${p.nombre} — ${colones(p.precio)}`, p.id)))
    fecha.min = hoyLocal()
    $$('[data-solo-api]', form).forEach(el => { el.hidden = !CONFIG.ventaEnLinea })

    const avisar = (el, texto, error = true) => {
        el.hidden = false
        el.className = 'formulario__mensaje' + (error ? ' formulario__mensaje--error' : '')
        el.textContent = texto
    }

    const calcular = () => {
        const pase = PASES.find(p => p.id === selectPase.value)
        const n = Math.max(1, Math.min(50, Number(cantidad.value) || 1))
        total.textContent = colones(pase.precio * n)
        return { pase, n, monto: pase.precio * n }
    }
    form.addEventListener('input', calcular)
    calcular()

    const mostrarPaso = paso => {
        form.hidden = paso !== 1
        formPago.hidden = paso !== 2
        panelBoletos.hidden = paso !== 3
    }
    const reiniciar = () => { orden = null; mostrarPaso(1); mensaje.hidden = true; $('#pago-mensaje').hidden = true; formPago.reset() }

    $$('[data-abrir-entradas]').forEach(b => b.addEventListener('click', e => {
        e.preventDefault()
        const id = b.dataset.abrirEntradas
        if (id) selectPase.value = id
        calcular()
        if (!orden) reiniciar()
        dialogo.showModal()
    }))
    activarCierre(dialogo)

    // Paso 1
    form.addEventListener('submit', async e => {
        e.preventDefault()
        const { pase, n, monto } = calcular()
        const nombre = form.nombre.value.trim()
        const telefono = form.telefono.value.trim()

        if (new Date(form.fecha.value + 'T12:00:00').getDay() === 3) {
            avisar(mensaje, 'Los miércoles el balneario permanece cerrado. Escoja otra fecha.')
            return
        }

        // Modo seguro: pedido por WhatsApp
        if (!CONFIG.ventaEnLinea) {
            const texto = `Hola, quiero ${n} entrada(s) "${pase.nombre}" para el ${form.fecha.value} por ${colones(monto)}. Nombre: ${nombre}. Pagaré por SINPE Móvil al ${CONFIG.sinpe}.`
            window.open(waLink(texto), '_blank', 'noopener')
            return
        }

        // Venta en línea: crea la orden en el servidor
        const boton = $('[type=submit]', form)
        boton.disabled = true
        try {
            const resp = await fetch(CONFIG.api.ordenes, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pase: pase.id, cantidad: n, fechaVisita: form.fecha.value, nombre, telefono, correo: form.correo.value.trim() })
            })
            const datos = await resp.json().catch(() => ({}))
            if (!resp.ok) throw new Error(datos.error || 'No se pudo crear la orden.')
            orden = datos
            $('#pago-codigo').textContent = datos.codigo
            $('#pago-monto').textContent = colones(datos.total)
            $('#pago-sinpe').textContent = datos.sinpe
            $('#pago-vence').textContent = `Tiene ${datos.minutosParaPagar} minutos para pagar y confirmar.`
            mostrarPaso(2)
            vigilarPago()
        } catch (err) {
            avisar(mensaje, err.message + ' También puede escribirnos por WhatsApp.')
        } finally {
            boton.disabled = false
        }
    })

    // Paso 2
    const consultarPago = async ultimos4 => {
        const resp = await fetch(CONFIG.api.verificar, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo: orden.codigo, ultimos4 })
        })
        return { ok: resp.ok, datos: await resp.json().catch(() => ({})) }
    }
    const entregar = datos => {
        clearInterval(vigia)
        pintarBoletos(datos)
        mostrarPaso(3)
    }

    // Consulta sola cada 15 segundos durante 10 minutos (el pago se reconoce por el código en el detalle)
    let vigia
    function vigilarPago() {
        clearInterval(vigia)
        const hasta = Date.now() + 10 * 60_000
        vigia = setInterval(async () => {
            if (Date.now() > hasta) return clearInterval(vigia)
            if (document.hidden) return
            try {
                const { ok, datos } = await consultarPago('')
                if (ok) entregar(datos)
                else if (!datos.esperando) { clearInterval(vigia); avisar($('#pago-mensaje'), datos.error || 'No se pudo verificar el pago.') }
            } catch { /* sin conexión: se reintenta en la siguiente vuelta */ }
        }, 15_000)
    }

    formPago.addEventListener('submit', async e => {
        e.preventDefault()
        const msg = $('#pago-mensaje')
        const boton = $('[type=submit]', formPago)
        boton.disabled = true
        try {
            const { ok, datos } = await consultarPago(formPago.ultimos4.value.trim())
            if (!ok) throw new Error(datos.esperando
                ? 'Todavía no vemos su pago. Espere un minuto. Si no escribió el código en el detalle, ponga los últimos 4 dígitos del comprobante.'
                : datos.error || 'No se pudo verificar el pago.')
            entregar(datos)
        } catch (err) {
            avisar(msg, err.message)
        } finally {
            boton.disabled = false
        }
    })

    // Paso 3
    function pintarBoletos({ boletos, correoEnviado }) {
        const lista = $('#boletos-lista')
        lista.replaceChildren()
        boletos.forEach((b, i) => {
            const fig = document.createElement('figure')
            fig.className = 'boleto'
            const img = document.createElement('img')
            img.className = 'boleto__qr'
            img.src = b.qr
            img.alt = `Código QR del boleto ${i + 1}`
            img.width = 220
            img.height = 220
            const cap = document.createElement('figcaption')
            cap.className = 'boleto__datos'
            const titulo = Object.assign(document.createElement('strong'), { textContent: `Boleto ${i + 1} de ${boletos.length}: ${b.nombrePase}` })
            const dia = Object.assign(document.createElement('span'), { textContent: `Válido el ${b.fechaVisita}` })
            const bajar = Object.assign(document.createElement('a'), { className: 'boleto__descarga', href: b.qr, download: `boleto-${orden.codigo}-${i + 1}.png`, textContent: 'Descargar imagen' })
            cap.append(titulo, dia, bajar)
            fig.append(img, cap)
            lista.append(fig)
        })
        $('#boletos-correo').hidden = !correoEnviado
    }
}

function hoyLocal() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ---------- Reservas (ranchos, eventos, tenis) ---------- */
function formularioReservas() {
    const form = $('#form-reservas')
    const mensaje = $('#reservas-mensaje')
    const fecha = $('[name=fecha]', form)
    fecha.min = new Date().toISOString().slice(0, 10)

    const actualizarCampos = () => {
        const tipo = form.tipo.value
        $$('[data-solo]', form).forEach(campo => {
            const visible = campo.dataset.solo.split(' ').includes(tipo)
            campo.hidden = !visible
            $$('input, select', campo).forEach(c => { c.disabled = !visible })
        })
    }
    form.addEventListener('change', e => { if (e.target.name === 'tipo') actualizarCampos() })
    actualizarCampos()

    form.addEventListener('submit', async e => {
        e.preventDefault()
        mensaje.hidden = true
        try {
            const datos = new URLSearchParams(new FormData(form))
            const resp = await fetch('/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: datos.toString()
            })
            if (!resp.ok) throw new Error()
            mensaje.className = 'formulario__mensaje'
            mensaje.textContent = '¡Solicitud enviada! Le confirmaremos por WhatsApp o correo.'
            form.reset()
            actualizarCampos()
        } catch {
            mensaje.className = 'formulario__mensaje formulario__mensaje--error'
            mensaje.textContent = 'No se pudo enviar. Escríbanos por WhatsApp e indique su fecha.'
        }
        mensaje.hidden = false
    })
}

/* ---------- Enlaces de contacto ---------- */
function enlacesContacto() {
    $$('[data-whatsapp]').forEach(a => {
        a.href = waLink(a.dataset.whatsapp || 'Hola, quisiera información del Club Balneario Las Estufas.')
        a.target = '_blank'
        a.rel = 'noopener'
    })
    $$('[data-sinpe]').forEach(el => { el.textContent = CONFIG.sinpe })
    $$('[data-telefono]').forEach(el => { el.textContent = CONFIG.whatsappVisible })
}
