// Runs every tests/*.smoke.mjs suite, one after another, and reports the
// overall exit code.
//
//   npm test            (this file)
//   node tests/<name>.smoke.mjs   (one suite, when iterating)
//
// Sequential on purpose: the suites build fixtures under the OS temp directory,
// so running them in parallel lets them fight over the same paths. Output is
// inherited, not captured — the suites print their own per-check lines.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const suites = readdirSync(join(ROOT, 'tests'))
  .filter((file) => file.endsWith('.smoke.mjs'))
  .sort()

if (suites.length === 0) {
  console.error('no tests/*.smoke.mjs suites found')
  process.exit(1)
}

const failed = []
const started = Date.now()
console.log(`\nNovel Studio — ${suites.length} smoke suites\n`)
for (const suite of suites) {
  console.log(`── ${suite} ${'─'.repeat(Math.max(0, 58 - suite.length))}`)
  const run = spawnSync(process.execPath, [join(ROOT, 'tests', suite)], { stdio: ['ignore', 'inherit', 'inherit'] })
  if (run.status !== 0) failed.push(suite)
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(`\n${suites.length - failed.length}/${suites.length} suites passed in ${seconds}s`)
if (failed.length > 0) {
  for (const suite of failed) console.log(`  - ${suite}`)
  process.exitCode = 1
}
