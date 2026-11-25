// Panel del personal (panel.html). Script clásico: usa jsQR, que se carga antes como global.
// Archivo aparte para que la política de seguridad (CSP) no permita scripts en línea.
(() => {
    const $ = s => document.querySelector(s)
    const $$ = s => [...document.querySelectorAll(s)]
    const el = (etiqueta, clase, texto) => { const e = document.createElement(etiqueta); if (clase) e.className = clase; if (texto != null) e.textContent = texto; return e }
    const colones = n => '₡' + Number(n).toLocaleString('es-CR')
    const guardar = { get: () => { try { return sessionStorage.getItem('pin') || '' } catch { return '' } }, set: v => { try { v ? sessionStorage.setItem('pin', v) : sessionStorage.removeItem('pin') } catch {} } }

    let pin = guardar.get()
    let rol = ''
    let ultimoToken = ''
    let ocupado = false
    let flujo = null

    async function api(ruta, cuerpo) {
        const resp = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, ...cuerpo }) })
        const datos = await resp.json().catch(() => ({}))
        if (resp.status === 401) { cerrarSesion('PIN incorrecto. Escríbalo de nuevo.'); throw new Error('PIN incorrecto') }
        if (!resp.ok) throw new Error(datos.error || 'No se pudo completar. Intente de nuevo.')
        return datos
    }

    /* ---------- Sesión ---------- */
    function cerrarSesion(mensaje) {
        pin = ''; guardar.set(''); apagarCamara()
        $('#v-app').hidden = true; $('#v-pin').hidden = false
        const e = $('#pin-error'); e.hidden = !mensaje; e.textContent = mensaje || ''
    }
    $('#v-pin').addEventListener('submit', async e => {
        e.preventDefault()
        pin = $('#pin').value; $('#pin').value = ''
        try { await cargarEstado(); guardar.set(pin); $('#v-pin').hidden = true; $('#v-app').hidden = false; ir('menu') }
        catch (err) { if (pin) { const m = $('#pin-error'); m.hidden = false; m.textContent = err.message } }
    })
    $('#salir').addEventListener('click', () => cerrarSesion())

    /* ---------- Navegación ---------- */
    function ir(vista) {
        ['menu', 'escanear', 'buscar', 'estado', 'ranchos'].forEach(v => { $('#v-' + v).hidden = v !== vista })
        if (vista === 'ranchos') cargarRanchos()
        if (vista !== 'escanear') apagarCamara()
        if (vista === 'estado') cargarEstado()
        window.scrollTo(0, 0)
    }
    $$('[data-ir]').forEach(b => b.addEventListener('click', () => ir(b.dataset.ir)))
    $('#barra').addEventListener('click', () => ir('estado'))

    /* ---------- Ranchos hoy ---------- */
    const ESTADO_RANCHO = { libre: 'LIBRE', apartado: 'APARTADO (esperando pago)', reservado: 'RESERVADO', personal: 'OCUPADO (sin reserva)' }
    const ESTADO_TENIS = { reservado: 'Pagada en la web', apartado: 'Esperando pago', personal: 'Pagada en la entrada' }
    const hhmm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
    for (let m = 8 * 60; m < 17 * 60; m += 30) { const o = el('option', '', hhmm(m)); o.value = m; $('#tenis-inicio').append(o) }
    function pintarHoy(datos) { pintarRanchos(datos.ranchos); pintarTenis(datos.tenis || []) }
    function pintarTenis(lista) {
        const caja = $('#tenis-lista'); caja.replaceChildren()
        if (!lista.length) caja.append(el('span', 'panel__sub', 'Libre todo el día.'))
        lista.forEach(t => {
            const f = el('div', 'compra')
            f.append(el('span', 'compra__estado compra__estado--pendiente', ESTADO_TENIS[t.estado]))
            f.append(el('strong', '', `${t.inicio} a ${t.fin}`))
            f.append(el('span', '', t.orden ? `${t.nombre} · compra ${t.orden}` : t.nombre))
            if (t.estado === 'personal') {
                const b = el('button', 'boton boton--claro', 'Liberar este horario'); b.type = 'button'
                b.onclick = async () => { b.disabled = true; try { pintarHoy(await api('/api/panel', { accion: 'tenis-liberar', inicio: t.inicioMin, fin: t.finMin })) } catch (e) { alertar(caja, e.message, true); b.disabled = false } }
                f.append(b)
            }
            caja.append(f)
        })
    }
    $('#tenis-ocupar').onclick = async () => {
        const b = $('#tenis-ocupar'); b.disabled = true
        try { pintarHoy(await api('/api/panel', { accion: 'tenis-ocupar', inicio: Number($('#tenis-inicio').value), bloques: Number($('#tenis-bloques').value) })) }
        catch (e) { alertar($('#tenis-lista'), e.message, true) }
        b.disabled = false
    }
    function pintarRanchos(lista) {
        const caja = $('#ranchos-lista'); caja.replaceChildren()
        lista.forEach(r => {
            const t = el('div', 'compra')
            t.append(el('span', 'compra__estado compra__estado--' + (r.estado === 'libre' ? 'pagada' : 'pendiente'), ESTADO_RANCHO[r.estado]))
            t.append(el('strong', '', 'Rancho ' + r.rancho))
            if (r.orden) t.append(el('span', '', `${r.nombre} · ${r.personas} persona(s) · compra ${r.orden}`))
            if (r.estado === 'apartado' && r.hasta) t.append(el('span', '', 'Se libera solo a las ' + new Date(r.hasta).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) + ' si no llega el pago'))
            const accion = r.estado === 'libre' ? ['rancho-ocupar', 'Llegó alguien sin reserva: marcar ocupado'] : r.estado === 'personal' ? ['rancho-liberar', 'Ya se fueron: marcar libre'] : null
            if (accion) {
                const b = el('button', 'boton boton--claro', accion[1]); b.type = 'button'
                b.onclick = async () => { b.disabled = true; try { pintarHoy(await api('/api/panel', { accion: accion[0], rancho: r.rancho })) } catch (e) { alertar(caja, e.message, true); b.disabled = false } }
                t.append(b)
            }
            caja.append(t)
        })
    }
    async function cargarRanchos() {
        try { pintarHoy(await api('/api/panel', { accion: 'ranchos' })) } catch (e) { alertar($('#ranchos-lista'), e.message, true) }
    }

    /* ---------- Semáforo ---------- */
    const TEXTO_BARRA = { verde: 'Todo funciona', amarillo: 'Funciona, con avisos. Toque para ver', rojo: 'HAY UN PROBLEMA. Toque para ver qué hacer', gris: 'Revisando conexiones…' }
    async function cargarEstado() {
        const d = await api('/api/estado', {})
        rol = d.rol
        $('#barra').className = 'barra barra--' + d.global
        $('#barra-texto').textContent = TEXTO_BARRA[d.global]
        $('#contador').textContent = `${d.hoy.ingresados} de ${d.hoy.vendidos} boletos en línea`
        const lista = $('#estado-lista'); lista.replaceChildren()
        d.items.forEach(i => {
            const fila = el('div', 'luz')
            const cuerpo = el('div')
            cuerpo.append(el('div', 'luz__nombre', i.nombre), el('div', '', i.detalle))
            if (i.queHacer) cuerpo.append(el('div', 'luz__hacer', 'Qué hacer: ' + i.queHacer))
            fila.append(el('span', 'luz__punto luz__punto--' + i.estado), cuerpo)
            lista.append(fila)
        })
        $('#ir-eventos').hidden = rol !== 'admin'
        $('#btn-loyverse').hidden = !(rol === 'admin' && d.items.some(i => i.id === 'recibos' && i.estado !== 'verde'))
        $('#btn-variables').hidden = rol !== 'admin'
        return d
    }
    $('#btn-revisar').addEventListener('click', () => cargarEstado().catch(() => {}))
    $('#btn-loyverse').addEventListener('click', async () => {
        try { const r = await api('/api/panel', { accion: 'reintentar-loyverse' }); alertar($('#estado-lista'), `Se enviaron ${r.registrados} de ${r.reintentados} venta(s).`) } catch (e) { alertar($('#estado-lista'), e.message, true) }
        cargarEstado().catch(() => {})
    })
    // Variables: nunca muestra valores, solo si existe, si el formato es correcto y su huella
    $('#btn-variables').addEventListener('click', async () => {
        const caja = $('#variables-lista'); caja.hidden = false; caja.replaceChildren(el('p', '', 'Revisando…'))
        try {
            const r = await api('/api/panel', { accion: 'variables' })
            const COLOR = { ok: 'verde', aviso: 'gris', formato: 'amarillo', falta: 'rojo' }
            caja.replaceChildren(el('p', 'panel__sub', `${r.resumen.ok} de ${r.resumen.total} correctas · ${r.resumen.falta} faltan · ${r.resumen.formato} con formato raro. La huella sirve para comparar con el .env local (node --env-file=.env scripts/verificar-variables.mjs).`))
            r.filas.forEach(f => {
                const fila = el('div', 'luz'), cuerpo = el('div')
                cuerpo.append(el('div', 'luz__nombre', f.nombre), el('div', '', f.huella ? 'Huella ' + f.huella : 'Sin valor'))
                if (f.nota) cuerpo.append(el('div', 'luz__hacer', f.nota))
                fila.append(el('span', 'luz__punto luz__punto--' + COLOR[f.estado], ''), cuerpo); caja.append(fila)
            })
            if (r.obsoletas.length) caja.prepend(el('p', 'aviso', 'Puede borrar en Netlify: ' + r.obsoletas.join(', ')))
        } catch (e) { caja.replaceChildren(el('p', 'aviso aviso--error', e.message)) }
    })
    function alertar(antesDe, texto, error) { const a = el('p', 'aviso' + (error ? ' aviso--error' : ''), texto); antesDe.prepend(a) }
    setInterval(() => { if (pin && !$('#v-app').hidden) cargarEstado().catch(() => {}) }, 60000)

    const red = () => { $('#sinred').hidden = navigator.onLine }
    addEventListener('online', red); addEventListener('offline', red); red()

    /* ---------- Escáner ---------- */
    function sonar(bien) {
        try {
            const ctx = sonar.ctx ||= new (window.AudioContext || window.webkitAudioContext)()
            const o = ctx.createOscillator(), g = ctx.createGain()
            o.frequency.value = bien ? 880 : 220; g.gain.value = 0.2
            o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (bien ? 0.15 : 0.5))
        } catch {}
        if (navigator.vibrate) navigator.vibrate(bien ? 80 : [150, 80, 150])
    }
    function mostrar(clase, titulo, detalle) {
        const r = $('#resultado'); r.hidden = false; r.className = 'resultado resultado--' + clase
        r.textContent = titulo; if (detalle) r.append(el('small', '', detalle))
        sonar(clase === 'ok')
    }
    function ofrecerGrupo(n, token) {
        const b = $('#btn-grupo'); b.hidden = !n
        if (!n) return
        b.textContent = n === 1 ? 'Dar ingreso también a 1 acompañante' : `Dar ingreso también a los ${n} acompañantes`
        b.onclick = async () => {
            b.hidden = true
            try { const d = await api('/api/validar-boleto', { token, grupo: true }); mostrar('ok', 'PUEDEN PASAR', d.mensaje); cargarEstado().catch(() => {}) }
            catch (e) { mostrar('malo', 'Error', e.message) }
        }
    }
    async function validar(token) {
        if (ocupado || !token) return
        ocupado = true
        try {
            const d = await api('/api/validar-boleto', { token })
            const detalle = [d.nombrePase, d.orden ? 'Compra ' + d.orden : ''].filter(Boolean).join(' · ')
            if (d.resultado === 'saldo') {
                mostrar('aviso', `COBRAR ${colones(d.saldo)}`, `Pagó ${colones(d.recibido)} de ${colones(d.total)}. Cobre el faltante para dar ingreso.`)
                $('#texto').value = d.orden; setTimeout(() => { ir('buscar'); buscar() }, 1500)
            }
            else if (d.resultado === 'ok') mostrar('ok', 'PUEDE PASAR', detalle + (d.credito ? ` · Tiene crédito de ${colones(d.credito)}: búsquela para entregarlo` : ''))
            else if (d.resultado === 'usado') mostrar('malo', 'YA FUE USADO', d.usadoEn ? 'Entró a las ' + new Date(d.usadoEn).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) : detalle)
            else if (d.resultado === 'otra_fecha') mostrar('aviso', 'ES PARA OTRO DÍA', d.mensaje)
            else mostrar('malo', 'BOLETO NO VÁLIDO', 'No deje pasar. Busque la compra por teléfono.')
            ofrecerGrupo(['ok', 'usado'].includes(d.resultado) ? d.restantesGrupo : 0, token)
            if (d.resultado === 'ok') cargarEstado().catch(() => {})
        } catch (e) {
            mostrar('malo', navigator.onLine ? 'Error' : 'SIN INTERNET', e.message)
        } finally {
            setTimeout(() => { ocupado = false }, 1200)
        }
    }
    function apagarCamara() {
        if (flujo) { flujo.getTracks().forEach(t => t.stop()); flujo = null }
        $('#btn-camara').hidden = false; $('#resultado').hidden = true; $('#btn-grupo').hidden = true
    }
    $('#btn-camara').addEventListener('click', async () => {
        try { flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }) }
        catch { mostrar('aviso', 'No se pudo usar la cámara', 'Acepte el permiso de cámara o escriba el código de la compra'); return }
        const video = $('#video'); video.srcObject = flujo; await video.play()
        $('#btn-camara').hidden = true
        try { await navigator.wakeLock?.request('screen') } catch {}
        const detector = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null
        const lienzo = $('#lienzo'), ctx = lienzo.getContext('2d', { willReadFrequently: true })
        const leer = async () => {
            if (detector) return (await detector.detect(video))[0]?.rawValue
            if (!video.videoWidth || typeof jsQR !== 'function') return null
            const escala = Math.min(1, 640 / video.videoWidth)
            lienzo.width = video.videoWidth * escala; lienzo.height = video.videoHeight * escala
            ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height)
            const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height)
            return jsQR(img.data, img.width, img.height)?.data
        }
        const ciclo = async () => {
            if (!flujo) return
            try {
                const valor = await leer()
                if (valor && valor !== ultimoToken) { ultimoToken = valor; await validar(valor) }
                if (!valor) ultimoToken = ''
            } catch {}
            setTimeout(ciclo, 200)
        }
        ciclo()
    })
    $('#btn-manual').addEventListener('click', () => { $('#texto').value = $('#manual').value; $('#manual').value = ''; ir('buscar'); buscar() })

    /* ---------- Buscar compras ---------- */
    const ESTADO = { pagada: 'PAGADA', pendiente: 'SIN PAGAR', parcial: 'PAGO PARCIAL', anulada: 'ANULADA' }
    async function buscar() {
        const aviso = $('#buscar-aviso'), lista = $('#buscar-lista')
        aviso.hidden = true; lista.replaceChildren(); $('#buscar-boletos').replaceChildren()
        let d
        try { d = await api('/api/panel', { accion: 'buscar', texto: $('#texto').value.trim() }) }
        catch (e) { aviso.hidden = false; aviso.className = 'aviso aviso--error'; aviso.textContent = e.message; return }
        if (!d.resultados.length) { aviso.hidden = false; aviso.className = 'aviso'; aviso.textContent = 'No se encontró ninguna compra con ese dato.'; return }
        d.resultados.forEach(c => {
            const t = el('div', 'compra')
            t.append(el('span', 'compra__estado compra__estado--' + c.estado, c.vencida ? 'SIN PAGAR (VENCIDA)' : ESTADO[c.estado] || c.estado))
            t.append(el('strong', '', `${c.nombre} · compra ${c.codigo}`))
            t.append(el('span', '', `${c.resumen || c.cantidad + ' × ' + c.nombrePase} · ${colones(c.total)}`))
            if (c.tenisConflicto) t.append(el('span', 'aviso aviso--error', `El pago llegó tarde y la cancha a las ${c.tenisConflicto} ya la tenía otra persona: ofrézcale otra hora libre o devuelva lo de la cancha.`))
            if (c.ranchoConflicto) t.append(el('span', 'aviso aviso--error', `El pago llegó tarde y el rancho ${c.ranchoConflicto} ya lo tenía otra persona: ofrézcale otro rancho libre.`))
            t.append(el('span', '', `Día de visita: ${c.fechaVisita}${c.esHoy ? ' (HOY)' : ''} · Ya ingresaron: ${c.ingresados} de ${c.cantidad}`))
            const acciones = el('div', 'compra__acciones')
            const msg = el('p', 'aviso'); msg.hidden = true
            const decir = (texto, error) => { msg.hidden = false; msg.className = 'aviso' + (error ? ' aviso--error' : ''); msg.textContent = texto }

            if (c.estado === 'parcial') {
                const cuenta = el('div', 'compra__cuenta')
                cuenta.append(el('span', '', `Pagó ${colones(c.recibido)} de ${colones(c.total)} · Falta ${colones(c.saldo)}`))
                if (c.esHoy) {
                    const metodo = el('select', 'campo')
                    ;[['efectivo', 'Cobré en efectivo'], ['sinpe', 'Pagó por SINPE en la entrada']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; metodo.append(o) })
                    const comp = el('input', 'campo'); comp.placeholder = 'Número de comprobante del SINPE'; comp.inputMode = 'numeric'; comp.hidden = true
                    metodo.onchange = () => { comp.hidden = metodo.value !== 'sinpe' }
                    const b = el('button', 'boton', `Cobré ${colones(c.saldo)}: dar por pagada`); b.type = 'button'
                    b.onclick = async () => {
                        b.disabled = true
                        try {
                            const r = await api('/api/panel', { accion: 'cobrar-saldo', codigo: c.codigo, metodo: metodo.value, monto: c.saldo, comprobante: comp.value })
                            decir(r.estado === 'pagada' ? 'Cuenta completa. Ya puede dar ingreso.' : r.mensaje); sonar(true); buscar()
                        } catch (e) { decir(e.message, true); b.disabled = false }
                    }
                    cuenta.append(metodo, comp, b)
                } else cuenta.append(el('span', '', 'El faltante se cobra en la entrada el día de la visita.'))
                t.append(cuenta)
            }
            if (c.estado === 'pagada' && c.credito > 0 && !c.creditoEntregado) {
                const cuenta = el('div', 'compra__cuenta')
                cuenta.append(el('span', '', `Pagó de más: crédito de ${colones(c.credito)} para usar hoy (restaurante o caja).`))
                if (c.esHoy) {
                    const b = el('button', 'boton boton--claro', `Entregué el crédito de ${colones(c.credito)}`); b.type = 'button'
                    b.onclick = async () => { b.disabled = true; try { decir((await api('/api/panel', { accion: 'credito-entregado', codigo: c.codigo })).mensaje); b.hidden = true } catch (e) { decir(e.message, true); b.disabled = false } }
                    cuenta.append(b)
                } else cuenta.append(el('span', '', 'Se entrega el día de la visita.'))
                t.append(cuenta)
            }

            if (c.estado === 'pagada' && c.esHoy && c.ingresados < c.cantidad) {
                const b = el('button', 'boton', `Dar ingreso a ${c.cantidad - c.ingresados} persona(s)`); b.type = 'button'
                b.onclick = async () => { b.disabled = true; try { const r = await api('/api/panel', { accion: 'ingresar', codigo: c.codigo }); decir(r.mensaje); sonar(true); cargarEstado().catch(() => {}) } catch (e) { decir(e.message, true); b.disabled = false } }
                acciones.append(b)
            }
            if (c.estado === 'pagada' && rol === 'admin') {
                const b = el('button', 'boton boton--claro', 'Mostrar los boletos (QR)'); b.type = 'button'
                b.onclick = async () => { try { pintarBoletos((await api('/api/panel', { accion: 'boletos', codigo: c.codigo })).boletos) } catch (e) { decir(e.message, true) } }
                acciones.append(b)
            }
            if (c.estado === 'pendiente' || c.estado === 'parcial') {
                if (rol === 'admin') {
                    const campo = el('input', 'campo'); campo.placeholder = 'Número de comprobante del SINPE'; campo.inputMode = 'numeric'
                    const monto = el('input', 'campo'); monto.placeholder = 'Monto exacto del comprobante (ej. 17500)'; monto.inputMode = 'numeric'
                    const b = el('button', 'boton', 'Registrar el SINPE a mano'); b.type = 'button'
                    b.onclick = async () => {
                        const m = Number(monto.value.replace(/\D/g, ''))
                        if (!confirm(`¿Vio en el celular del cliente un SINPE de ${colones(m)} a nombre del balneario?`)) return
                        b.disabled = true
                        try {
                            const r = await api('/api/panel', { accion: 'aprobar', codigo: c.codigo, comprobante: campo.value, monto: m })
                            if (r.estado === 'pagada') { decir(`Cuenta completa${r.credito ? ` (crédito de ${colones(r.credito)} para usar el día de la visita)` : ''}. Estos son los boletos.`); pintarBoletos(r.boletos) }
                            else decir(`Registrado. ${r.mensaje} Queda como pago parcial.`)
                            cargarEstado().catch(() => {})
                        }
                        catch (e) { decir(e.message, true); b.disabled = false }
                    }
                    acciones.append(el('span', '', 'Solo si el pago no se registró solo: copie el número y el monto tal como dice el comprobante del cliente.'), campo, monto, b)
                } else {
                    acciones.append(el('span', '', 'Esta compra no está pagada. Si el cliente muestra el comprobante, llame a la persona encargada para aprobarla.'))
                }
            }
            t.append(acciones, msg); lista.append(t)
        })
    }
    function pintarBoletos(boletos) {
        const caja = $('#buscar-boletos'); caja.replaceChildren()
        boletos.forEach((b, i) => {
            const f = el('figure'); const img = el('img'); img.src = b.qr; img.alt = `QR del boleto ${i + 1}`
            f.append(img, el('figcaption', '', `Boleto ${i + 1} de ${boletos.length}: ${b.nombrePase} · ${b.fechaVisita}`)); caja.append(f)
        })
        caja.scrollIntoView({ behavior: 'smooth' })
    }
    $('#btn-buscar').addEventListener('click', buscar)
    $('#texto').addEventListener('keydown', e => { if (e.key === 'Enter') buscar() })

    /* ---------- Inicio ---------- */
    if (pin) cargarEstado().then(() => { $('#v-pin').hidden = true; $('#v-app').hidden = false; ir('menu') }).catch(() => {})
})()
