import { readFile } from 'node:fs/promises'
import { castInput, crossInput, getMeta, recognizeInput } from '../standalone/src/divination/engine.js'

const oracle = JSON.parse(await readFile(process.argv[2] || new URL('../standalone/.build-cache/divination-oracle.json', import.meta.url)))
let failed = 0

function differences(actual, expected, trail = '') {
  if (actual === expected || (typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) < 1e-10)) return []
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object' && Array.isArray(actual) === Array.isArray(expected)) {
    return [...new Set([...Object.keys(actual), ...Object.keys(expected)])]
      .flatMap((key) => differences(actual[key], expected[key], trail + '/' + key))
  }
  return [{ field: trail, actual, expected }]
}

function check(label, run, expected) {
  try {
    const mismatches = differences(run(), expected)
    if (!mismatches.length) return
    failed++
    console.error(label, mismatches.length, JSON.stringify(mismatches.slice(0, 6)).slice(0, 2600))
  } catch (error) {
    failed++
    console.error(label, String(error.stack || error).split('\n').slice(0, 5).join('\n'))
  }
}

for (const { input, result } of oracle.cases) {
  check(`${input.shushu}/${input.method} @ ${input.timestamp}`, () => {
    const { studioInput, ...cast } = castInput(input)
    return cast
  }, result)
}
for (const { input, result } of oracle.recognize) check(input, () => recognizeInput({ question: input }).recognition, result)
check('manifests', () => getMeta().manifests, oracle.manifests)
check('cross', () => crossInput(oracle.cross.input), oracle.cross.result)
console.log(`${oracle.cases.length + oracle.recognize.length + 2 - failed}/${oracle.cases.length + oracle.recognize.length + 2} original Python cases match.`)
process.exitCode = failed ? 1 : 0
