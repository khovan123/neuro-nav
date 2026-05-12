import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

// Inline plugin: copy ONNX Runtime WASM files to dist with stable names
// so the extension can load them locally instead of from CDN.
function copyOnnxWasm() {
  return {
    name: 'copy-onnx-wasm',
    writeBundle() {
      const onnxDist = resolve(__dirname, '../../node_modules/onnxruntime-web/dist');
      const outDir = resolve(__dirname, 'dist');

      const files = [
        'ort-wasm-simd-threaded.jsep.mjs',
        'ort-wasm-simd-threaded.jsep.wasm',
      ];

      for (const file of files) {
        const src = resolve(onnxDist, file);
        const dest = resolve(outDir, file);
        if (existsSync(src)) {
          copyFileSync(src, dest);
          console.log(`  ✓ Copied ${file} → dist/`);
        } else {
          console.warn(`  ⚠ ONNX file not found: ${src}`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    copyOnnxWasm(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        'content-scripts/extractor': resolve(__dirname, 'src/content-scripts/extractor.ts'),
        'embedding-worker': resolve(__dirname, 'src/infrastructure/ai/embedding.worker.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js';
          if (chunkInfo.name === 'embedding-worker') return 'embedding-worker.js';
          if (chunkInfo.name.startsWith('content-scripts/')) return '[name].js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
  },
});
