import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relativa: el sitio compilado funciona en cualquier subcarpeta (por ejemplo GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
})
