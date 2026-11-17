// Convierte las fotos originales a WebP en dos tamaños (miniatura y completa).
// Se ejecuta con `npm run build`. Los originales quedan en src/img/gallery.
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const TOTAL = 17

export async function optimizarImagenes() {
    await mkdir('public/build/img/galeria', { recursive: true })
    const tareas = []

    for (let i = 1; i <= TOTAL; i++) {
        const origen = `src/img/gallery/${i}.jpg`
        tareas.push(
            sharp(origen).rotate().resize({ width: 1400, withoutEnlargement: true })
                .webp({ quality: 72 }).toFile(`public/build/img/galeria/${i}.webp`),
            sharp(origen).rotate().resize({ width: 640, withoutEnlargement: true })
                .webp({ quality: 70 }).toFile(`public/build/img/galeria/${i}-t.webp`)
        )
    }

    // Portada (foto 3) en dos anchos para <picture>
    for (const ancho of [800, 1600]) {
        tareas.push(
            sharp('src/img/gallery/3.jpg').rotate().resize({ width: ancho, withoutEnlargement: true })
                .webp({ quality: 70 }).toFile(`public/build/img/hero-${ancho}.webp`)
        )
    }
    // Cancha de tenis (tarjeta de servicios)
    tareas.push(
        sharp('src/img/tenis.jpg').resize({ width: 640, withoutEnlargement: true })
            .webp({ quality: 78 }).toFile('public/build/img/tenis-t.webp')
    )
    // Logo (PNG con fondo transparente) para menú, portada y favicon
    tareas.push(
        sharp('src/img/logo.png').resize({ height: 130 }).webp({ quality: 90 }).toFile('public/build/img/logo-130.webp'),
        sharp('src/img/logo.png').resize({ width: 360 }).webp({ quality: 90 }).toFile('public/build/img/logo-360.webp')
    )
    for (const lado of [64, 180]) {
        tareas.push(
            sharp('src/img/logo.png')
                .resize(lado, lado, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png().toFile(`public/build/img/favicon-${lado}.png`)
        )
    }
    await Promise.all(tareas)
}
