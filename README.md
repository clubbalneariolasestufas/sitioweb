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
- `src/js/datos.js`: precios de los pases, eventos, número de WhatsApp y SINPE, y el interruptor `ventaEnLinea`.
- `netlify/functions/_lib/config.mjs`: precios y reglas que usa el servidor (deben coincidir con `datos.js`).
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

1. En el Back Office de Loyverse cree tres artículos con el mismo precio que el sitio (Pase del día, Pase Cervecero, Pase Económico) y un tipo de pago «SINPE web».
2. Back Office > Tokens de acceso > Agregar token de acceso. Copie el token (da acceso a toda la cuenta: trátelo como una contraseña).
3. Copie `.env.example` como `.env`, pegue el token en `LOYVERSE_TOKEN` y ejecute `node --env-file=.env scripts/loyverse-ids.mjs`. Copie los identificadores a `.env`.
4. Compruebe con `node --env-file=.env scripts/loyverse-prueba.mjs`. Con `--recibo` crea un recibo real de prueba (hay que reembolsarlo en Loyverse).
5. Cargue las seis variables `LOYVERSE_*` en Netlify y vuelva a publicar.
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
| `POST /api/ordenes` | Cliente | Crea la orden pendiente. El monto lo calcula el servidor. |
| `POST /api/verificar-pago` | Cliente | Busca en `pagos_sinpe` un pago libre con el mismo monto y el código de la orden en la descripción del SINPE (respaldo: los últimos 4 dígitos del comprobante), lo consume, crea los boletos y registra el recibo en Loyverse. |
| `POST /api/validar-boleto` | Personal | Marca un boleto como usado. Con `grupo: true` da ingreso a los acompañantes de la misma compra. |
| `POST /api/panel` | Personal | `buscar`, `ingresar` (PIN de puerta); `aprobar`, `boletos`, `reintentar-loyverse` (PIN de administración). |
| `POST /api/estado` | Personal | Semáforo de conexiones: base de datos, lector, módem, correo, Loyverse y recibos pendientes. |
| `POST /api/cotizaciones` | Cliente | Crea una solicitud de cotización de grupo (COT-2026-001). Recalcula el monto y aparta la fecha 2 días. |
| `GET /api/cotizaciones?codigo=&tel=` | Cliente | Seguimiento de la solicitud con el código y los últimos 4 números del teléfono. |
| `GET /api/disponibilidad` | Cliente | Qué áreas exclusivas (rancho, salón) están apartadas cada día. Sin datos de clientes. |
| `POST /api/eventos-admin` | Administración | `listar`, `estado` (Solicitada → Cotizada → Reservada → Confirmada → Realizada, o Cancelada), `tarea`, `calendario`. Solo PIN de administración. |
| `GET /api/calendario.ics?k=` | Administración | Calendario privado para suscribirse desde Google Calendar: eventos y tareas del personal. |
| `tareas-programadas` | Automática | Cada 30 minutos reenvía a Loyverse lo pendiente, vence solicitudes y cotizaciones, manda el resumen diario de eventos y avisa si algo está en rojo. |

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
