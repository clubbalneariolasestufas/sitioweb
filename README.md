# Club Balneario Las Estufas: sitio de una sola página

Stack: HTML + SCSS (BEM, flexbox y grid) + JavaScript (módulos ES) + Gulp. Hosting: Netlify desde GitHub.

## Uso

    npm install
    npm run dev      # compila y vigila cambios
    npm run build    # compila SCSS, minifica JS y genera WebP

La carpeta `public/` (con `public/build/`) se sube al repositorio: Netlify solo publica esa carpeta, sin comando de build.
El código de las funciones, el lector y las pruebas no se publican.

## Dónde editar

- `src/img/logo.png`: logo con fondo transparente (de aquí salen el menú, la portada y el favicon).
- `src/js/precios-tiquetes.js`: precio de la entrada (₡3 500), menores gratis, horario, miércoles cerrado, ranchos (7, máx. 8 personas, ₡10 000 sábado y domingo) y minutos de apartado. Lo usan la página y el servidor: no hay que tocarlo en dos lugares.
- `src/js/datos.js`: eventos, número de WhatsApp y SINPE, y el interruptor `ventaEnLinea`.
- `src/js/mapa-balneario.js`: mapa ilustrado con los ranchos (sale del lienzo de diseño «Boletos y ranchos»).
- `src/scss/`: estilos por bloque BEM (`components/` y `layout/`).
- `public/index.html`: textos y secciones. `public/panel.html`: panel del personal.

## Pendiente por completar

- Fotos de las cataratas/senderos y de la cancha de tenis (la tarjeta de tenis usa un ícono por ahora).
- Confirmar horario del evento "Tarde Bailable" (`datos.js`).
- Confirmar con el dueño los servicios listados y la ubicación exacta del mapa.
- Reservas: en Netlify activar *Forms* y las notificaciones por correo al desplegar.
- Entradas con QR: poner `CONFIG.api.ordenes` en `datos.js` cuando exista la función de Netlify.

## Sincronizar con GitHub y Netlify

Primera vez (desde la terminal de VS Code, en la carpeta del proyecto):

    git init
    git add .
    git commit -m "Sitio v2"
    git branch -M main
    git remote add origin https://github.com/USUARIO/REPOSITORIO.git
    git push -u origin main

Si el repositorio ya existe, solo: `git add .`, `git commit -m "Actualización"`, `git push`.

En Netlify:

- Sitio nuevo: Add new project > Import an existing project > GitHub > autorizar > elegir el repositorio.
- Sitio ya creado sin repositorio: Project configuration > Build & deploy > Continuous deployment > Link repository.
- Rama `main`, sin comando de build, directorio de publicación `public` y funciones en `netlify/functions` (ya lo fija `netlify.toml`).

Desde ahí, cada `git push` a `main` publica el sitio solo. El sitio se compila en su computadora
(`npm run build`) antes de subir: Netlify publica `public/` tal cual.

## Base de datos (MongoDB Atlas)

La base no vive en Netlify ni en GitHub: es un servicio externo, MongoDB Atlas (nivel gratuito M0).
No hay que crear tablas: las colecciones y los índices se crean solos la primera vez que el sitio se conecta.

1. Cree la cuenta en mongodb.com/atlas y un clúster gratuito (M0).
2. Database Access: cree dos usuarios con contraseña larga, `sitio` y `lector`, con permiso de lectura y escritura sobre la base `las_estufas`.
3. Network Access: permita `0.0.0.0/0` (las funciones de Netlify no tienen IP fija; la protección es el usuario y la contraseña).
4. Connect > Drivers: copie la cadena `mongodb+srv://...`, ponga el usuario y la contraseña.
5. En Netlify: `MONGODB_URI` (usuario `sitio`, marcada como secreta) y `MONGODB_DB=las_estufas`.
6. En el Raspberry: la cadena con el usuario `lector` va en `lector-sinpe/.env`.

## Conexión con Loyverse

1. En el Back Office de Loyverse cree tres artículos con el mismo precio que el sitio («Entrada general» ₡3 500, «Rancho (fin de semana)» ₡10 000 y «Cancha de tenis (media hora)» ₡1 500; los menores y los ranchos entre semana van en ₡0 y no se envían) y un tipo de pago «SINPE web».
2. Back Office > Tokens de acceso > Agregar token de acceso. Copie el token (da acceso a toda la cuenta: trátelo como una contraseña).
3. Copie `.env.example` como `.env`, pegue el token en `LOYVERSE_TOKEN` y ejecute `node --env-file=.env scripts/loyverse-ids.mjs`. Copie los identificadores a `.env`.
4. Compruebe con `node --env-file=.env scripts/loyverse-prueba.mjs`. Con `--recibo` crea un recibo real de prueba (hay que reembolsarlo en Loyverse).
5. Cargue las seis variables `LOYVERSE_*` (token, tienda, tipo de pago, `LOYVERSE_VARIANT_GENERAL`, `LOYVERSE_VARIANT_RANCHO` y `LOYVERSE_VARIANT_TENIS`) en Netlify y vuelva a publicar.
6. En `/panel` el semáforo de Loyverse debe quedar en verde.

## Correo y variables de entorno

Hay dos usos distintos del correo clubbalneariolasestufas@gmail.com:

1. **Avisos de reservas (Netlify Forms).** No usan variables: en Netlify abra
   Project configuration > Notifications > Emails and webhooks > Form submission notifications,
   agregue un aviso por correo para el formulario `reservas` y escriba esa dirección.
   Verifique en su plan que los avisos por correo estén incluidos y cuántos envíos al mes permite.
2. **Funciones de Node (entradas con QR y confirmaciones).** Usan las variables del archivo
   `.env.example`, sección A, que se cargan en Netlify > Project configuration > Environment variables.

El lector de pagos (módem y correo del banco) corre en el equipo del balneario y usa la sección B,
en un `.env` local. Gmail personal ya no acepta la contraseña normal en aplicaciones: hay que activar
la verificación en 2 pasos y crear una contraseña de aplicación. En cuentas de Google Workspace no se
permiten contraseñas de aplicación y se necesita OAuth.


## Cómo encajan las piezas

    Cliente (celular) ──> Sitio en Netlify ──> Funciones /api ──> MongoDB Atlas <── Lector SINPE (Raspberry)
                                                   │                                  ├─ módem USB: SMS del banco
                                                   └──> Loyverse (recibo de cada venta)  └─ correo dedicado (confirmación)
    Personal (celular de la puerta) ──> /panel ──> Funciones /api

- **Loyverse es el centro**: cada venta en línea queda como recibo en el POS con el tipo de pago «SINPE web». La venta en ventanilla se sigue cobrando directo en Loyverse.
- **MongoDB Atlas** guarda órdenes, boletos y los pagos que reporta el lector.
- **El lector** (`lector-sinpe/`) corre en el Raspberry: lee los SMS del banco con el módem y los confirma con el correo dedicado.
- **El panel** (`/panel`) es la herramienta del personal: escanear, buscar compras, aprobar pagos a mano y ver el semáforo de conexiones.

## Funciones (carpeta `netlify/functions`)

| Endpoint | Quién | Qué hace |
|---|---|---|
| `POST /api/ordenes` | Cliente | Crea la orden pendiente `{ general, menores, ranchos, fechaVisita, … }`. El monto lo calcula el servidor y aparta los ranchos 15 minutos (409 si otro cliente lo tomó). |
| `GET /api/ranchos?desde=&dias=` | Cliente | Ranchos ocupados por día (pagados, del personal o con apartado vigente) y su precio. Sin datos de clientes. |
| `POST /api/verificar-pago` | Cliente | Busca en `pagos_sinpe` un pago libre con el mismo monto y el código de la orden en la descripción del SINPE (respaldo: los últimos 4 dígitos del comprobante), lo consume, crea los boletos y registra el recibo en Loyverse. |
| `POST /api/validar-boleto` | Personal | Marca un boleto como usado. Con `grupo: true` da ingreso a los acompañantes de la misma compra. |
| `POST /api/panel` | Personal | `buscar`, `ingresar`, `ranchos`, `rancho-ocupar`, `rancho-liberar` (PIN de puerta); `aprobar`, `boletos`, `reintentar-loyverse` (PIN de administración). |
| `POST /api/estado` | Personal | Semáforo de conexiones: base de datos, lector, módem, correo, Loyverse y recibos pendientes. |
| `POST /api/cotizaciones` | Cliente | Crea una solicitud de cotización de grupo (COT-2026-001). Recalcula el monto y aparta la fecha 2 días. |
| `GET /api/cotizaciones?codigo=&tel=` | Cliente | Seguimiento de la solicitud con el código y los últimos 4 números del teléfono. |
| `GET /api/disponibilidad` | Cliente | Qué áreas exclusivas (rancho, salón) están apartadas cada día. Sin datos de clientes. |
| `POST /api/eventos-admin` | Administración | `listar`, `estado` (Solicitada → Cotizada → Reservada → Confirmada → Realizada, o Cancelada), `tarea`, `calendario`. Solo PIN de administración. |
| `GET /api/calendario.ics?k=` | Administración | Calendario privado para suscribirse desde Google Calendar: eventos y tareas del personal. |
| `tareas-programadas` | Automática | Cada 30 minutos reenvía a Loyverse lo pendiente, vence solicitudes y cotizaciones, manda el resumen diario de eventos y avisa si algo está en rojo. |

## Pagos parciales: la cuenta de cada orden (Propuesta A)

Regla: **lo que se cobra en la web es exactamente lo que se recibe.** Montos en colones enteros.

- **Cuenta:** D = total, P = suma de los pagos unidos a la orden (colección `pagos_sinpe`, `estado: 'usado'`, `ordenCodigo`), S = D − P. Estados: `pendiente` (P = 0), `parcial` (0 < P < D), `pagada` (P ≥ D). P siempre se calcula desde los pagos, nunca se suma a mano (`netlify/functions/_lib/cuenta.mjs`).
- **SINPE con el código y otro monto:** se une a la orden igual. El cliente ve en 15–45 s «Recibimos ₡1 750 de ₡17 500. Faltan ₡15 750», con pista si faltó un cero o se invirtieron números. Puede hacer otro SINPE por el faltante (se suma solo) o pagar en la entrada.
- **Faltante en la entrada:** solo el día de la visita. El escáner muestra «COBRAR ₡X» y no deja pasar; en el panel se marca «Cobré» (efectivo o SINPE, monto exacto del faltante) y la orden queda pagada.
- **Rancho y cancha:** quedan firmes si lo pagado cubre esos complementos; si no, el apartado se alarga una vez 30 minutos.
- **Sobrepago:** si pasa de ₡1 000 se entrega como crédito el día de la visita (botón en el panel, una sola vez); si es de ₡1 000 o menos no se devuelve.
- **Rescate sin código:** últimos 4 números del comprobante + monto pagado.
- **Llave de la compra:** los códigos QR solo se entregan al celular que compró o por el enlace del correo (`tiquetes.html?orden=CODIGO&llave=...`). Con solo el código se ven montos, no QR.
- **Aprobación manual:** exige el monto exacto del comprobante; si el lector ya registró ese comprobante con otro monto, se rechaza.
- **Correo programado** (cada 30 min, `tareas-programadas.mjs`): une los SINPE con código aunque el cliente cerró la página; avisa el faltante 10 min después del pago parcial y lo recuerda la víspera (desde las 16:00) o la mañana de la visita.
- **Loyverse:** un solo recibo cuando la cuenta se completa, con las formas de pago reales (SINPE web y efectivo). Variable opcional `LOYVERSE_PAYMENT_TYPE_EFECTIVO`.
- **Cuadre de pagos** en el semáforo del panel: rojo si alguna compra no cuadra o si el banco reportó otro monto para un comprobante ya usado (el lector marca `conflictoMonto`); amarillo si quedó un faltante sin cobrar o un SINPE con código suelto.
- **Probar en local:** `curl -X POST "http://localhost:8888/__simular-pago?codigo=CODIGO&monto=1750"`.

## Área techada para eventos

₡50 000 hasta 40 personas; desde la persona 41, ₡1 000 más por persona (41 = ₡51 000). Incluye mesas y sillas hasta 100 personas; más de 100 se coordina con la administración (la solicitud queda «por cotizar»). Las personas incluyen a los menores.

## Taquilla y reservaciones en la página principal (Fusión B)

- Una sola sección (`#tiquetes`, con `#reservas` apuntando al bloque de eventos): día, personas, rancho, cancha de tenis y evento, con el total en un boleto a la derecha. Código en `src/js/taquilla.js`, estilos en `layout/_taquilla.scss`.
- **Compra** (hasta 50 personas): el botón lleva la selección a `tiquetes.html?f=&g=&m=&r=&tb=&ti=`, donde se elige el rancho en el mapa y se paga por SINPE.
- **Cancha de tenis**: ₡1 500 la media hora (₡3 000 la hora), de 8:00 a 17:00, hasta 3 horas, siempre con al menos una entrada. Agenda `tenis_reservas` (un documento por media hora, `_id` «2026-12-05@540»), apartado de 15 minutos y firme al pagar, igual que los ranchos. En el panel, «Ranchos y cancha hoy» permite marcar la cancha pagada en la entrada.
- **Eventos** (más de 50 personas, o quien lo marque desde 10): no se paga en línea. Se envía a `/api/cotizaciones` y aparece en `/eventos` para Lexie. Entrada ₡3 000 desde 51 personas; área techada, comida, DJ y música quedan «por cotizar». Precios con impuestos incluidos.

## Compra de tiquetes y ranchos (compra v2, diciembre 2026)

- **Página** `tiquetes.html`: fecha → tiquetes (entrada general y menores de 4) → rancho en el mapa (opcional) → carrito y datos → SINPE en tres toques (copiar número, monto exacto y código) → boletos con QR, uno por persona.
- **Ranchos**: colección `ranchos_reservas`, un documento por fecha y rancho (`_id` «2026-12-05#3»), así que dos clientes nunca reciben el mismo. El apartado dura 15 minutos; al pagar queda firme. Si un pago llega después de vencido y otro cliente ya lo tomó, la venta se completa y el panel muestra el aviso «rancho en conflicto» para resolverlo con el cliente.
- **En la puerta**: `/panel` → «Ranchos hoy» muestra cada rancho (libre, apartado, reservado o del personal) y permite marcar uno como ocupado cuando llega alguien sin reserva.
- **Probar**: `node scripts/servidor-local.mjs`, abrir http://localhost:8888/tiquetes.html?prueba=ventas y simular la llegada del SINPE con `curl -X POST "http://localhost:8888/__simular-pago?codigo=CODIGO"`.

## Cotizador de grupos y eventos (etapa 3, CAM-008)

- **Página pública** `cotizar.html`: asistente de 6 pasos pensado para celular, con el total en vivo abajo. Se llega desde «Reservaciones» del sitio.
- **Panel de eventos** `/eventos` (PIN de administración; también hay un botón en `/panel`): solicitudes por atender, calendario del mes, tareas de los próximos 14 días, envío de la cotización por WhatsApp y enlace para Google Calendar.
- **Precios**: todos en `src/js/precios-eventos.js`. Hoy son **de ejemplo** (`PRECIOS_DE_EJEMPLO = true` muestra un aviso en la página). Cuando Lexie entregue la lista real, se cambian ahí, se pone `false`, se corre `npx gulp js` y se publica. El servidor usa el mismo archivo, así que el precio nunca se desincroniza.
- **Tareas automáticas** por evento reservado: cocina 7 días antes (si hay menú), cantidad final 3 días, saldo 2 días, preparar áreas 1 día y puerta el día del evento. Encargada por ahora: Lexie (se cambia en `PLANTILLA_TAREAS`).
- **Variables nuevas en Netlify**: `EVENTOS_EMAIL` (correo de Lexie para solicitudes nuevas y el resumen diario; si falta, usa `CLUB_EMAIL`) y `CALENDARIO_TOKEN` (texto aleatorio de 24 caracteres o más para el enlace de Google Calendar). Generar el token: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
- **Probar en la computadora**: `node scripts/servidor-local.mjs` y abrir http://localhost:8888/cotizar.html (PIN de administración de prueba: 222222). Usa una base de datos en memoria.

## Puesta en marcha (resumen; el detalle está en la guía de integración)

1. **MongoDB Atlas**: cree la base `las_estufas` y dos usuarios: uno para Netlify y otro para el lector.
2. **Loyverse**: cree los tres artículos de pases y el tipo de pago «SINPE web»; cree un token de acceso; ejecute `LOYVERSE_TOKEN=xxxx node scripts/loyverse-ids.mjs` y copie los identificadores.
3. **Netlify**: cargue las variables de la sección A de `.env.example`. Genere los dos PIN con `node scripts/hash-pin.mjs`.
4. **Raspberry**: siga `lector-sinpe/README.md`.
5. Abra `/panel`, entre con el PIN y revise que el semáforo esté en verde.
6. Haga una compra real de prueba con un SINPE pequeño.
7. Ponga `ventaEnLinea: true` en `src/js/datos.js`, ejecute `npm run build` y suba el cambio.

Mientras `ventaEnLinea` sea `false`, el formulario de entradas arma un pedido por WhatsApp y nada depende del backend.

Prueba interna sin abrir la venta al público: abra el sitio con `?prueba=ventas` al final de la dirección. La compra en línea se activa solo en ese navegador hasta cerrar la pestaña; `?prueba=no` la apaga.

## Modo práctica (para probar y capacitar al personal)

    npm install
    npm run demo

Abre el sitio completo en `http://localhost:8888` con una base de datos de mentira. PIN de puerta `111111`, de administración `222222`.
Para simular el aviso del banco: `http://localhost:8888/demo/pago?monto=12000&comprobante=12345678`.

## Pruebas

    npm test                      # 29 pruebas: entradas, pagos, panel y cotizador
    cd lector-sinpe && npm test   # 10 pruebas del lector

Usan una base de datos simulada. Cubren montos distintos, pagos reutilizados, límite de intentos, órdenes vencidas, boletos falsos,
ingreso por grupo, aprobación manual, recibos de Loyverse con reintento y el semáforo de conexiones.

## Revisar las variables de entorno

- En el sitio: `/panel` con PIN de administración > Estado del sistema > **Revisar variables de Netlify**.
- En la computadora: `node --env-file=.env scripts/verificar-variables.mjs`.

Ninguno de los dos muestra valores: dicen si la variable existe, si el formato es correcto y su **huella** (8 caracteres del SHA-256). Si la huella es igual en el panel y en la computadora, el valor en Netlify es idéntico al del `.env`.

## Seguridad (auditoría del 25/11/2026)

- Encabezados en `netlify.toml`: CSP sin scripts en línea, HSTS, `X-Frame-Options: DENY`, `Permissions-Policy` (cámara solo para el propio sitio).
  Los scripts del panel y de eventos viven en `src/js/panel.js` y `src/js/eventos-admin.js`. **No agregue `<script>` en línea**: el navegador lo bloquea.
- Frenos por cliente (`_lib/limite.mjs`, colección `limites`): códigos de orden inexistentes, dígitos equivocados y seguimiento de cotizaciones (10 fallos cada 10 minutos).
- Una orden pagada permite 5 intentos con los 4 dígitos; después solo el dueño (con su llave) ve los boletos.
- nodemailer 10 (sin avisos de `npm audit`) y validación estricta de correos.
