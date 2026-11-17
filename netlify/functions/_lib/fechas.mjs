const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' })

// Fecha de hoy en Costa Rica, formato AAAA-MM-DD
export const hoyCR = (ahora = new Date()) => fmt.format(ahora)

export function fechaValida(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
    const [a, m, d] = iso.split('-').map(Number)
    const f = new Date(Date.UTC(a, m - 1, d))
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null
    return f
}

export const diaSemana = iso => fechaValida(iso).getUTCDay()
export const diasEntre = (desde, hasta) => Math.round((fechaValida(hasta) - fechaValida(desde)) / 86400000)
