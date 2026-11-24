import assert from 'node:assert/strict'
import { freeIdentifier, modelCatalog, readModelProfiles } from '../standalone/src/model-profiles.js'

const candidate = (id, prompt, completion, output = ['text']) => ({
  id, pricing: { prompt, completion }, architecture: { output_modalities: output },
})
const rows = [
  candidate('example/reader:free', '0', '0'),
  candidate('example/paid-name:free', '0', '1'),
  candidate('example/free-price', 0, 0),
  candidate('example/missing-price:free', null, 0),
  candidate('example/image:free', 0, 0, ['image']),
]
assert.deepEqual(modelCatalog(rows, 'openrouter', () => []).map(({ id }) => id), ['openrouter/free', 'example/reader:free'])
assert.equal(freeIdentifier('example/reader:free?paid=1'), false)
assert.deepEqual(modelCatalog([{ id: 'local:3b' }, { id: 'local:cloud' }, { id: 'local:3b-cloud' }], 'ollama', () => [])
  .map(({ id }) => id), ['local:3b'])
const legacy = { base: 'https://example.test', model: 'old', deepseek: false }
assert.deepEqual(readModelProfiles(legacy), { active: 'manual', profiles: { manual: { ...legacy, profile: 'compatible' } } })
console.log('Free text filters, local model selection and legacy model profile migration')
