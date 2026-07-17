import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@rdkit/rdkit']
  },
  server: {
    port: 5173,
    open: true
  }
})
