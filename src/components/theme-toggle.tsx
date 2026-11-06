import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? 'Modo claro' : 'Modo oscuro'
  return (
    <button type="button" className="icon-button theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  )
}
