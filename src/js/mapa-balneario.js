// Mapa ilustrado del balneario (mismo diseño aprobado en el lienzo «Boletos y ranchos»).
// crearMapa(contenedor, { escala, ocupados, elegidos, alElegir }) dibuja el mapa y devuelve
// actualizar({ ocupados, elegidos }) para refrescar solo los ranchos.
// Coordenadas en un lienzo de 1280 × 720, escalado con transform.

const FONDO = `  <!-- Bosque del este (cataratas) -->
  <div aria-hidden="true" style="position: absolute; left: 700px; top: 300px; width: 700px; height: 520px; border-radius: 46% 0 0 30%; background: #3f8a34"></div>
  <div aria-hidden="true" style="position: absolute; left: 1080px; top: -60px; width: 300px; height: 420px; border-radius: 50%; background: #4f9a3c"></div>

  <!-- Calle El Gimnasio -->
  <div aria-hidden="true" style="position: absolute; left: -60px; top: 305px; width: 562px; height: 74px; background: #8e989e; box-shadow: inset 0 -6px 0 #b9c1c5; transform-origin: 0 50%; transform: rotate(50.2deg)">
    <div style="position: absolute; left: 0; right: 0; top: 35px; border-top: 4px dashed #f3d36b"></div>
    <span style="position: absolute; left: 150px; top: 8px; font-size: 13px; font-weight: 800; letter-spacing: .12em; color: #ffffff; white-space: nowrap">CALLE EL GIMNASIO</span>
  </div>
`
const DECORADO = `  <!-- Parqueo y plaza -->
  <div aria-hidden="true" style="position: absolute; left: 690px; top: -205px; width: 280px; height: 330px; box-sizing: border-box; border-radius: 18px; border: 5px solid #8d9a7a; background: #b7bd8f; background-image: repeating-linear-gradient(90deg, transparent 0 40px, rgba(255,255,255,.75) 40px 43px); box-shadow: 0 6px 0 #7f8a66; transform: rotate(-31deg)">
    <span style="position: absolute; left: 118px; bottom: 26px; width: 44px; height: 44px; border-radius: 10px; background: #14708f; color: #ffffff; display: grid; place-items: center; font: 900 26px Montserrat, sans-serif; transform: rotate(31deg)">P</span>
  </div>
  <div aria-hidden="true" style="position: absolute; left: 637px; top: 227px; width: 150px; height: 86px; box-sizing: border-box; border-radius: 14px; border: 5px solid #8d9a7a; background: #b7bd8f; background-image: repeating-linear-gradient(90deg, transparent 0 34px, rgba(255,255,255,.75) 34px 37px); box-shadow: 0 6px 0 #7f8a66; transform: rotate(-20deg)">
    <span style="position: absolute; left: 53px; top: 17px; width: 40px; height: 40px; border-radius: 10px; background: #14708f; color: #ffffff; display: grid; place-items: center; font: 900 24px Montserrat, sans-serif; transform: rotate(20deg)">P</span>
  </div>
  <div aria-hidden="true" style="position: absolute; left: 554px; top: 254px; width: 92px; height: 92px; border-radius: 46px; background: #f4e4b8; box-shadow: 0 0 0 4px #e2c98c, 0 6px 0 4px #cdb98c"></div>
  <div aria-hidden="true" style="position: absolute; left: 585px; top: 285px; width: 30px; height: 30px; border-radius: 15px; background: #4f9a3c; box-shadow: 0 4px 0 rgba(20,60,20,.35)"></div>

  <!-- Deck de las piscinas pequeñas -->
  <div aria-hidden="true" style="position: absolute; left: 232px; top: 222px; width: 236px; height: 188px; border-radius: 30px; background: #efe2c4; background-image: repeating-linear-gradient(0deg, transparent 0 22px, #e2d2ad 22px 24px), repeating-linear-gradient(90deg, transparent 0 22px, #e2d2ad 22px 24px); box-shadow: 0 6px 0 #cdb98c"></div>

  <!-- Piscina semiolímpica -->
  <div aria-hidden="true" style="position: absolute; left: 562px; top: 84px; width: 210px; height: 136px; border-radius: 26px; background: #efe2c4; box-shadow: 0 6px 0 #cdb98c; transform: rotate(-19deg)"></div>
  <div aria-hidden="true" style="position: absolute; left: 582px; top: 104px; width: 170px; height: 96px; box-sizing: border-box; border-radius: 12px; border: 7px solid #e3f8ff; background: repeating-linear-gradient(0deg, transparent 0 15px, rgba(255,255,255,.55) 15px 17px), linear-gradient(160deg, #7fdcf6, #1f9bd0); transform: rotate(-19deg)"></div>

  <!-- Piscina del tobogán (la más cercana a la calle) -->
  <div aria-hidden="true" style="position: absolute; left: 244px; top: 262px; width: 107px; height: 62px; box-sizing: border-box; border-radius: 14px; border: 6px solid #e3f8ff; background: linear-gradient(160deg, #8fe2fa, #2aa6d8); transform: rotate(58deg)"></div>
  <div aria-hidden="true" style="position: absolute; left: 258px; top: 244px; width: 34px; height: 13px; border-radius: 8px; background: #e8911d; box-shadow: 0 4px 0 #b86d10; transform-origin: 0 50%; transform: rotate(62deg)"></div>
  <div aria-hidden="true" style="position: absolute; left: 244px; top: 228px; width: 26px; height: 26px; border-radius: 6px; background: #f2b34e; box-shadow: 0 5px 0 #b86d10"></div>

  <!-- Piscina accesible (movilidad limitada) con rampa -->
  <div aria-hidden="true" style="position: absolute; left: 380px; top: 336px; width: 70px; height: 58px; box-sizing: border-box; border-radius: 16px; border: 6px solid #e3f8ff; background: linear-gradient(160deg, #a5ecff, #3db7e2); transform: rotate(-20deg)">
    <div style="position: absolute; left: -6px; top: 12px; width: 24px; height: 22px; background: repeating-linear-gradient(90deg, #efe2c4 0 5px, #dccaa0 5px 7px); border-radius: 4px"></div>
  </div>

  <!-- Edificios -->
  <div aria-hidden="true" style="position: absolute; left: 320px; top: 156px; width: 120px; height: 78px; border-radius: 8px; background: linear-gradient(180deg, #e2694a 0 50%, #c4523a 50% 100%); box-shadow: 0 10px 0 #f3e9d6, 0 12px 0 #c9b791; transform: rotate(-28deg)"></div>
  <div aria-hidden="true" style="position: absolute; left: 460px; top: 236px; width: 120px; height: 64px; border-radius: 6px; background: #c99a63; background-image: repeating-linear-gradient(90deg, transparent 0 14px, #a87a45 14px 18px); box-shadow: 0 10px 0 #8c6a42; transform: rotate(-25deg)"></div>
  <div aria-hidden="true" style="position: absolute; left: 473px; top: 138px; width: 84px; height: 54px; border-radius: 6px; background: linear-gradient(180deg, #d9573b 0 50%, #b84a33 50% 100%); box-shadow: 0 9px 0 #f3e9d6, 0 11px 0 #c9b791; transform: rotate(-20deg)"></div>

  <!-- Cancha de tenis, junto a la entrada -->
  <div aria-hidden="true" style="position: absolute; left: 172px; top: 468px; width: 166px; height: 103px; box-sizing: border-box; border-radius: 6px; background: #2f7f8f; box-shadow: inset 0 0 0 6px #4c9a52, inset 0 0 0 9px #ffffff; transform: rotate(-45deg)">
    <div style="position: absolute; left: 81px; top: 9px; width: 3px; height: 85px; background: #ffffff"></div>
  </div>

  <!-- Portón de entrada -->
  <div aria-hidden="true" style="position: absolute; left: 246px; top: 640px; width: 52px; height: 18px; border-radius: 9px 9px 0 0; background: #051c39; transform: rotate(-42deg)"></div>

  <!-- Cataratas -->
  <div aria-hidden="true" style="position: absolute; left: 1150px; top: 560px; width: 96px; height: 120px; border-radius: 40px 40px 20px 20px; background: #7d8a8f"></div>
  <div aria-hidden="true" style="position: absolute; left: 1178px; top: 566px; width: 38px; height: 118px; border-radius: 12px; background: repeating-linear-gradient(180deg, #e8fbff 0 10px, #7fd6f2 10px 18px)"></div>
  <div aria-hidden="true" style="position: absolute; left: 1150px; top: 672px; width: 110px; height: 40px; border-radius: 50%; background: #4cc3e8; border: 4px solid #e3f8ff"></div>
`
const TITULO = `  <!-- Título y norte -->
  <div style="position: absolute; left: 20px; top: 20px; padding: 10px 16px; border-radius: 14px; background: #051c39; color: #ffffff; display: flex; flex-direction: column; box-shadow: 0 6px 0 rgba(5,28,57,.25)">
    <span style="font-size: 11px; font-weight: 800; letter-spacing: .14em; color: #a8e4c8">CLUB BALNEARIO</span>
    <span style="font-size: 20px; font-weight: 900">Las Estufas</span>
  </div>
  <div aria-hidden="true" style="position: absolute; left: 20px; top: 92px; width: 58px; height: 58px; border-radius: 29px; background: #ffffff; display: grid; place-items: center; box-shadow: 0 4px 0 rgba(5,28,57,.25); font-weight: 900; font-size: 15px; color: #051c39">N ↑</div>
`
const LEYENDA = `  <!-- Leyenda -->
  <div style="position: absolute; left: 660px; top: 668px; height: 40px; padding: 0 14px; border-radius: 20px; background: #ffffff; display: flex; align-items: center; gap: 14px; font-size: 13px; font-weight: 700; color: #051c39; box-shadow: 0 4px 0 rgba(5,28,57,.2)">
    <span style="display: flex; align-items: center; gap: 6px"><span style="width: 14px; height: 14px; border-radius: 7px; border: 4px solid #2e8b3d; box-sizing: border-box"></span>Libre</span>
    <span style="display: flex; align-items: center; gap: 6px"><span style="width: 14px; height: 14px; border-radius: 7px; background: #e8911d"></span>Suyo</span>
    <span style="display: flex; align-items: center; gap: 6px"><span style="width: 14px; height: 14px; border-radius: 7px; background: #9aa5ab"></span>Ocupado</span>
  </div>
</div>`

function dibujar() {
    const POS = [[360, 461], [323, 422], [287, 382], [250, 343], [203, 167], [259, 136], [315, 105]];
    const R = 28;

    // Caminos [x1, y1, x2, y2, ancho]. El ingreso sigue la línea roja: de la calle, junto a la cancha, hasta la plaza bajo la piscina semiolímpica.
    const SEG = [
      [269, 659, 332, 604, 30], [332, 604, 375, 530, 30], [375, 530, 419, 448, 30], [419, 448, 472, 380, 30], [472, 380, 536, 328, 30], [536, 328, 600, 300, 30],
      [795, 175, 770, 212, 18],
      [240, 332, 372, 474, 14], [372, 474, 398, 490, 14],
      [195, 172, 323, 101, 14], [262, 226, 231, 152, 14],
      [604, 258, 636, 214, 20], [560, 295, 540, 290, 16]
    ];
    const tramo = ([x1, y1, x2, y2], w, fondo, borde) => {
      const L = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      return { estilo: `position: absolute; left: ${x1}px; top: ${y1 - w / 2}px; width: ${L + w / 2}px; height: ${w}px; border-radius: ${w}px; background: ${fondo}; box-shadow: ${borde}; transform-origin: 0 50%; transform: rotate(${a}deg)` };
    };
    const caminos = SEG.map(s => tramo(s, s[4], '#f4e4b8', '0 0 0 3px #e2c98c'));
    const SEND = [[610, 340], [700, 410], [820, 450], [950, 510], [1060, 575], [1150, 620]];
    SEND.slice(0, -1).forEach((p, i) => {
      const [x1, y1] = p, [x2, y2] = SEND[i + 1];
      const L = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      caminos.push({ estilo: `position: absolute; left: ${x1}px; top: ${y1 - 7}px; width: ${L}px; height: 14px; background: repeating-linear-gradient(90deg, #d8b97a 0 14px, transparent 14px 24px); transform-origin: 0 50%; transform: rotate(${a}deg)` });
    });

    const dist = (p, q, ax, ay) => { const [x1, y1] = p, [x2, y2] = q; const t = Math.max(0, Math.min(1, ((ax - x1) * (x2 - x1) + (ay - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2))); return Math.hypot(ax - (x1 + t * (x2 - x1)), ay - (y1 + t * (y2 - y1))); };
    const CAJAS = [[555, 70, 780, 235], [300, 130, 460, 260], [455, 120, 575, 215], [445, 205, 595, 330], [232, 222, 468, 410], [150, 420, 395, 645], [554, 254, 646, 346], [15, 15, 200, 150], [1120, 540, 1280, 720], [650, 660, 930, 715]];
    const PARQUEOS = [[830, -40, 280, 330, -31], [712, 270, 150, 86, -20]];
    const enRect = ([cx, cy, w, h, g], x, y, m) => { const r = -g * Math.PI / 180, dx = x - cx, dy = y - cy; return Math.abs(dx * Math.cos(r) - dy * Math.sin(r)) < w / 2 + m && Math.abs(dx * Math.sin(r) + dy * Math.cos(r)) < h / 2 + m; };
    const libre = (x, y) => {
      if (CAJAS.some(([a, b, c, d]) => x > a - 22 && x < c + 22 && y > b - 22 && y < d + 22)) return false;
      if (PARQUEOS.some(p => enRect(p, x, y, 24))) return false;
      if (dist([-60, 342], [300, 774], x, y) < 64) return false;
      if (POS.some(([px, py]) => Math.hypot(px - x, py - y) < 58)) return false;
      if (SEG.some(([a, b, c, d]) => dist([a, b], [c, d], x, y) < 30)) return false;
      if (SEND.slice(0, -1).some((p, i) => dist(p, SEND[i + 1], x, y) < 34)) return false;
      return true;
    };
    const ZONAS = [[0, 0, 640, 40, 52], [0, 40, 70, 330, 52], [0, 440, 200, 720, 56], [700, 330, 1280, 720, 52], [800, 0, 1280, 300, 60], [630, 500, 720, 720, 56], [230, 650, 450, 720, 64], [780, 60, 1000, 260, 96]];
    const arboles = [];
    let k = 11;
    const rnd = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
    ZONAS.forEach(([x0, y0, x1, y1, paso]) => {
      for (let y = y0 + 16; y < y1; y += paso) for (let x = x0 + 16; x < x1; x += paso) {
        const tx = x + (rnd() - .5) * 28, ty = y + (rnd() - .5) * 28;
        if (!libre(tx, ty)) continue;
        const d = 38 + rnd() * 26;
        const verde = ['#3f8f3a', '#4ea23f', '#2f7a33'][Math.floor(rnd() * 3)];
        arboles.push({ estilo: `position: absolute; left: ${tx - d / 2}px; top: ${ty - d / 2}px; width: ${d}px; height: ${d}px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #8fd36a 0 18%, ${verde} 55%); box-shadow: 0 5px 0 rgba(20,60,20,.35)` });
      }
    });

    const pill = (x, y, texto, oscuro) => ({ texto, estilo: `position: absolute; left: ${x}px; top: ${y}px; padding: 6px 12px; border-radius: 16px; font-size: 14px; font-weight: 800; white-space: nowrap; box-shadow: 0 4px 0 rgba(5,28,57,.2); background: ${oscuro ? '#051c39' : '#ffffff'}; color: ${oscuro ? '#ffffff' : '#051c39'}` });
    const rotulos = [
      pill(282, 672, 'Entrada', true), pill(925, 30, 'Parqueo 1'), pill(668, 318, 'Parqueo 2'), pill(186, 506, 'Cancha de tenis'),
      pill(236, 280, 'Tobogán'), pill(366, 352, 'Piscina accesible'), pill(588, 136, 'Piscina semiolímpica'),
      pill(334, 182, 'Restaurante'), pill(490, 158, 'Baños'), pill(466, 256, 'Área techada'), pill(568, 350, 'Plaza'),
      pill(760, 400, 'Sendero a las cataratas', true), pill(1040, 520, 'Cataratas')
    ];

    return { POS, R, caminos, arboles, rotulos }
}

let cache = null

export function crearMapa(contenedor, { escala = 1, ocupados = [], elegidos = [], alElegir = null } = {}) {
    cache ??= dibujar()
    const { POS, R, caminos, arboles, rotulos } = cache
    const ancho = Math.round(1280 * escala), alto = Math.round(720 * escala)
    const marco = document.createElement('div')
    marco.className = 'mapa-balneario'
    marco.style.cssText = `position: relative; width: ${ancho}px; height: ${alto}px; overflow: hidden; border-radius: 14px; font-family: Montserrat, system-ui, sans-serif; flex: none`
    const lienzo = document.createElement('div')
    lienzo.style.cssText = `position: absolute; left: 0; top: 0; width: 1280px; height: 720px; transform: scale(${escala}); transform-origin: 0 0; background: radial-gradient(ellipse 560px 340px at 420px 330px, #b4e27f, #97d065 70%), #97d065; overflow: hidden`
    const capa = estilos => estilos.map(c => `<div aria-hidden="true" style="${c.estilo}"></div>`).join('')
    lienzo.innerHTML = FONDO + capa(caminos) + capa(arboles) + DECORADO
        + rotulos.map(r => `<span aria-hidden="true" style="${r.estilo}">${r.texto}</span>`).join('')
        + TITULO + LEYENDA
    const botones = POS.map(([x, y], i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset.rancho = i + 1
        const num = document.createElement('span')
        num.textContent = i + 1
        num.style.cssText = 'width: 26px; height: 26px; border-radius: 13px; background: #ffffff; color: #051c39; display: grid; place-items: center; font: 900 15px Montserrat, sans-serif; box-shadow: 0 2px 0 rgba(0,0,0,.25); pointer-events: none'
        b.append(num)
        b.addEventListener('click', () => { if (!b.disabled && alElegir) alElegir(i + 1) })
        lienzo.append(b)
        return { b, x, y }
    })
    marco.append(lienzo)
    contenedor.replaceChildren(marco)

    function actualizar({ ocupados: o = ocupados, elegidos: e = elegidos } = {}) {
        ocupados = o; elegidos = e
        botones.forEach(({ b, x, y }, i) => {
            const n = i + 1, ocu = ocupados.includes(n), sel = elegidos.includes(n)
            const borde = sel ? '#e8911d' : ocu ? '#9aa5ab' : '#2e8b3d'
            b.disabled = ocu
            b.setAttribute('aria-pressed', sel ? 'true' : 'false')
            b.setAttribute('aria-label', `Rancho ${n}, ${ocu ? 'ocupado' : sel ? 'elegido' : 'libre'}, hasta 8 personas`)
            b.style.cssText = `position: absolute; left: ${x - R}px; top: ${y - R}px; width: ${2 * R}px; height: ${2 * R}px; border-radius: 50%; padding: 0; display: grid; place-items: center; cursor: ${ocu ? 'not-allowed' : 'pointer'}; border: 5px solid ${borde}; background: repeating-conic-gradient(from 0deg, #c98a3a 0 12deg, #ad6f2a 12deg 24deg); box-shadow: 0 5px 0 rgba(60,35,10,.45)${sel ? ', 0 0 0 5px rgba(232,145,29,.4)' : ''}; filter: ${ocu ? 'grayscale(1) brightness(1.05)' : 'none'}; transform: scale(${sel ? 1.15 : 1}); transition: transform .15s`
        })
    }
    actualizar()
    return { actualizar, elemento: marco }
}
