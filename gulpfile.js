import { src, dest, watch, series, parallel } from 'gulp'
import * as dartSass from 'sass'
import gulpSass from 'gulp-sass'
import terser from 'gulp-terser'
import { optimizarImagenes } from './scripts/imagenes.mjs'

const sass = gulpSass(dartSass)

export function css() {
    return src('src/scss/app.scss', { sourcemaps: true })
        .pipe(sass({ outputStyle: 'compressed' }).on('error', sass.logError))
        .pipe(dest('public/build/css', { sourcemaps: '.' }))
}

export function js() {
    return src('src/js/**/*.js')
        .pipe(terser({ module: true }))
        .pipe(dest('public/build/js'))
}

export function imagenes() {
    return optimizarImagenes()
}

// Lector de QR para navegadores sin BarcodeDetector (iPhone)
export function vendor() {
    return src('node_modules/jsqr/dist/jsQR.js').pipe(dest('public/build/vendor'))
}

export function dev() {
    watch('src/scss/**/*.scss', css)
    watch('src/js/**/*.js', js)
}

export const build = parallel(css, js, imagenes, vendor)
export default series(build, dev)
