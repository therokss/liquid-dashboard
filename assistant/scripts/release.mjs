// Build completa dell'add-on: la versione si legge SOLO da claude_assistant/config.yaml
// e finisce nel server (log di avvio, /healthz) e nell'interfaccia.
//   node scripts/release.mjs   → claude_assistant/app/server.mjs + claude_assistant/www/
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const addonDir = resolve(root, '../claude_assistant')

const config = readFileSync(resolve(addonDir, 'config.yaml'), 'utf8')
const version = config.match(/^version:\s*"?([^"\s]+)"?/m)?.[1]
if (!version) throw new Error('version non trovata in claude_assistant/config.yaml')

const changelog = readFileSync(resolve(addonDir, 'CHANGELOG.md'), 'utf8')
if (!changelog.includes(`## [${version}]`)) {
  throw new Error(`CHANGELOG.md non ha la voce ## [${version}]: aggiungila prima del rilascio`)
}

const env = { ...process.env, ASSISTANT_VERSION: version }
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit' })

console.log(`\n▸ Assistente Claude ${version}`)
run('npm', ['test'], resolve(root, 'server'))
run('npm', ['run', 'typecheck'], resolve(root, 'server'))
run('npm', ['run', 'typecheck'], resolve(root, 'web'))

const appDir = resolve(addonDir, 'app')
if (existsSync(appDir)) rmSync(appDir, { recursive: true })
execFileSync('node', ['build.mjs'], {
  cwd: resolve(root, 'server'),
  env: { ...env, ASSISTANT_SERVER_OUT: resolve(appDir, 'server.mjs') },
  stdio: 'inherit',
})
execFileSync('npx', ['vite', 'build'], {
  cwd: resolve(root, 'web'),
  env: { ...env, ASSISTANT_WEB_OUT: resolve(addonDir, 'www') },
  stdio: 'inherit',
})
console.log(`\n✓ Build ${version} pronta in claude_assistant/app e claude_assistant/www`)
