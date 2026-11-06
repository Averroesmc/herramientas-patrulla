import { useState } from 'react'

/**
 * Modo claro u oscuro. Se guarda en la cookie herramientas_tema, que vale para todo
 * averroeshosting.com: lo que se elige aquí lo siguen teatro, sorteos y bingo.
 * Por defecto, claro. index.html lo aplica antes de pintar para que no parpadee.
 */
export type Theme = 'light' | 'dark'

const COOKIE = 'herramientas_tema'

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function saveTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  const shared = /(^|\.)averroeshosting\.com$/.test(location.hostname) ? '; Domain=averroeshosting.com' : ''
  document.cookie = `${COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${shared}${location.protocol === 'https:' ? '; Secure' : ''}`
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    saveTheme(next)
    setTheme(next)
  }
  return { theme, toggle }
}
