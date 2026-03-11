import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  publicDir: resolve(__dirname, 'public'),
  base: './',  // Use relative paths for embedding in macOS app
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // IIFE format works with file:// URLs in WKWebView (no CORS issues)
    modulePreload: false,
    rollupOptions: {
      input: {
        editor: resolve(__dirname, 'src/index.html'),
      },
      output: {
        // Keep filenames predictable for bundling into macOS app
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        // Use IIFE format for WKWebView compatibility
        format: 'iife',
        // Ensure window.proof is accessible globally
        name: 'ProofEditor',
        inlineDynamicImports: true
      }
    },
  },
  server: {
    port: 3000,
    strictPort: true,  // Fail if port in use instead of auto-incrementing
    open: false,
    host: 'localhost',
    proxy: {
      '/assets': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/dashboard': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/library': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/d': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/new': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/get-started': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/agent-docs': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/open': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/logout': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/proof.SKILL.md': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/snapshots': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
});
