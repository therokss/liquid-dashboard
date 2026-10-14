import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@ld/variables.css'
import '@ld/glass.css'
import '@ld/animations.css'
import './app.css'
import { App } from './App'

// Il tema segue quello del sistema (come HA), anche se cambia mentre la pagina è aperta.
const media = matchMedia('(prefers-color-scheme: light)')
const applyTheme = () => {
  document.documentElement.dataset.theme = media.matches ? 'light' : 'dark'
}
applyTheme()
media.addEventListener('change', applyTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
