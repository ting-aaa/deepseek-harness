import { defineConfig } from 'tsdown'

/** The plugin and its private WASI worker ship together. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/wasi-worker.js'], outDir: 'lib',
  format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false,
})
