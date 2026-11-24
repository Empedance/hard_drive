import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The renderer (the window's UI). Electron loads dist/index.html from disk, so paths are relative.
export default defineConfig({
  root: here('./src/renderer'),
  base: './',
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  build: { outDir: here('./dist'), emptyOutDir: true },
  test: { root: here('.'), include: ['src/**/*.test.ts'], environment: 'node' },
});
