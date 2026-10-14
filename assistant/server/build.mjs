// Bundle del server in un unico file ESM per l'add-on: niente npm sul dispositivo.
// La versione arriva da claude_assistant/config.yaml (unica fonte), passata da scripts/release.mjs.
import { build } from 'esbuild'

const version = process.env.ASSISTANT_VERSION || 'dev'
const outfile = process.env.ASSISTANT_SERVER_OUT || 'dist/server.mjs'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile,
  sourcemap: false,
  legalComments: 'none',
  define: { __VERSION__: JSON.stringify(version) },
  // Alcune dipendenze CommonJS usano require() dinamico: in un bundle ESM serve un require reale.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
})
