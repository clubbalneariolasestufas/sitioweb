import { CONFIG, EVENTOS, fechaLarga } from './datos.js'
import { iniciarTaquilla } from './taquilla.js'

const $ = (sel, ctx = document) => ctx.querySelector(sel)
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)]
const waLink = texto => `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(texto)}`

// Modo de prueba interna: con ?prueba=ventas en la dirección se activa la compra en línea
// solo en ese navegador, para que el personal pruebe antes de abrirla al público.
try {
    const p = new URLSearchParams(location.search).get('prueba')
    if (p === 'ventas') sessionStorage.setItem('pruebaVentas', '1')
    if (p === 'no') sessionStorage.removeItem('pruebaVentas')
    if (sessionStorage.getItem('pruebaVentas') === '1') CONFIG.ventaEnLinea = true
} catch { /* sin almacenamiento: solo vale el parámetro de esta carga */ }

document.addEventListener('DOMContentLoaded', () => {
    menuMovil()
    resaltarSeccion()
    pintarEventos()
    pintarGaleria()
    iniciarTaquilla()
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
