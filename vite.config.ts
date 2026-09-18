import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Solo en desarrollo: permite que la herramienta interna /tools/extractor/
// guarde sus resultados dentro del proyecto. No existe en el build.
const ALLOWED_SAVE = new Set([
  'tools/extractor/out/raw_frames.json',
  'tools/extractor/out/raw_frames_mirror.json',
  'tools/extractor/out/raw_frames_full.json',
  'tools/extractor/out/segments.json',
]);

function extractorSave(): Plugin {
  return {
    name: 'extractor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const file = url.searchParams.get('file') ?? '';
        if (req.method !== 'POST' || !ALLOWED_SAVE.has(file)) {
          res.statusCode = 400;
          res.end('ruta no permitida');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const target = resolve(import.meta.dirname, file);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Rutas relativas: el build funciona en cualquier subruta (GitHub Pages).
  base: './',
  plugins: [react(), extractorSave(), ...(mode === 'https' ? [basicSsl()] : [])],
  build: {
    outDir: 'dist',
    // MediaPipe tasks-vision pesa ~0,5 MB por sí solo
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: join(import.meta.dirname, 'index.html') },
  },
  // EXTRACTOR=1: servidor sin HMR para el extractor (una recarga cortaría la extracción).
  server: process.env.EXTRACTOR
    ? { port: 5174, hmr: false, watch: null }
    : { port: 5173 },
}));
