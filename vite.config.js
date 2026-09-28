import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cada publicación tiene un número de versión distinto. La app lo compara con
// /version.json para avisar "hay una versión nueva".
const VERSION = String(Date.now())

function archivoVersion() {
  return {
    name: 'archivo-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION }) })
    },
  }
}

export default defineConfig({
  plugins: [react(), archivoVersion()],
  define: { __VERSION_APP__: JSON.stringify(VERSION) },
  // host: true → también se puede abrir desde el celular, si está en el mismo WiFi.
  server: { port: 5173, host: true },
})
