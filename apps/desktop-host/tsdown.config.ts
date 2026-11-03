import { defineConfig } from 'tsdown'

export default defineConfig(['index', 'cli'].map(name => ({
  entry: ['lib/types/' + name + '.js'],
  define: { 'process.env.DSH_DESKTOP_FORK_FLAVOR': JSON.stringify(process.env.DSH_DESKTOP_FORK_FLAVOR ?? '') },
  outDir: 'lib',
  format: ['esm'] as const,
  outputOptions: { codeSplitting: false },
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})))
