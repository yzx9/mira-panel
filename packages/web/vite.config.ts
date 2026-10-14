import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // features.vapor: force every <script setup> SFC in this package to compile
    // in Vapor mode (no virtual DOM, direct DOM + fine-grained effects).
    vue({ features: { vapor: true } }),
  ],
  resolve: {
    // The workspace package resolves to .ts source (Node strip-types on the
    // server, bundled source here) — one alias covers dev SSR, client build
    // and the SSR build alike.
    alias: {
      '@mira-panel/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  // The SSR bundle must carry the whole Vue runtime: @vue/runtime-vapor ships
  // esm-bundler sources only, and vue's node entry (index.mjs) is a pre-bundled
  // single file without the vapor exports — externals would give Node an
  // unrunnable mix. Dropping the 'node' condition routes every @vue/* import
  // to its esm-bundler build so the bundle has exactly one runtime copy.
  ssr: {
    noExternal: true,
    resolve: { conditions: [] },
  },
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: { outDir: 'dist/client' },
});
