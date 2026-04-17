import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, 'src/offscreen/tts.html'),
      },
      external: [
        // These are loaded dynamically from IndexedDB at runtime — never bundle them.
        'onnxruntime-web',
        'onnxruntime-web/wasm',
        'phonemizer',
      ],
      // Ensure CSS files are inlined for content scripts
      output: {
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});

