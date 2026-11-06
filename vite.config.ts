import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Dos páginas: el panel (index.html) y el overlay de OBS (overlay.html, servido en /o/<clave>).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      input: {
        panel: fileURLToPath(new URL('./index.html', import.meta.url)),
        overlay: fileURLToPath(new URL('./overlay.html', import.meta.url)),
      },
    },
  },
})
