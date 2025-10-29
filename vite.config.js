import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true,
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3003',
        changeOrigin: true,
        secure: false
      }
    },
    hmr: {
      overlay: false, // Disable error overlay to reduce console noise
      clientLogLevel: 'silent', // Suppress all HMR client logs including connections
      // CRITICAL FIX: Exclude large files from HMR to prevent corruption
      exclude: [
        '**/AutoScannerService.jsx',
        '**/AutoScannerService.jsx?*',
        'src/components/services/AutoScannerService.jsx',
        'src/components/services/AutoScannerService.jsx?*'
      ],
      // Additional protection
      port: 24678, // Use different port for HMR
      host: 'localhost'
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json']
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
  logLevel: 'error', // Only show errors, suppress all other Vite logs
  clearScreen: false // Don't clear screen on restart to reduce visual noise
}) 