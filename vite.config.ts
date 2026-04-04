import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Ensure CSS files are inlined for content scripts
      output: {
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
