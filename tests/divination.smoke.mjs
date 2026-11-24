import assert from 'node:assert/strict'
import { castInput, crossInput, getMeta, recognizeInput } from '../standalone/src/divination/engine.js'

// Golden results from the original offline Python engine. Full comparisons are
// available via scripts/import-divination-core.py and scripts/compare-divination.mjs.
const expected = [
  ['liuyao', 'coin', [0, 1, 0, 0, 1, 0], [], -1.066, '坎', null, 0.6478],
  ['liuyao', 'time', [1, 0, 0, 1, 0, 1], [1], -1.597, '噬嗑', '睽', 0.7412],
  ['liuyao', 'number', [0, 1, 1, 0, 0, 0], [0], 0.81, '升', '泰', 0.5608],
  ['meihua', 'time', [1, 0, 0, 1, 0, 1], [1], 1.899, '噬嗑', '睽', 0.7497],
  ['meihua', 'number', [0, 1, 1, 0, 0, 0], [5], 1.49, '升', '蛊', 0.6946],
  ['meihua', 'random', [0, 0, 1, 0, 0, 1], [1], 0.099, '艮', '蛊', 0.3092],
  ['zhouyi', 'dayan', [1, 1, 1, 1, 0, 0], [0], 2.079, '大壮', '恒', 0.7699],
  ['zhouyi', 'coin', [0, 1, 0, 0, 1, 0], [], 0.676, '坎', null, 0.5252],
  ['xiaoliuren', 'palm', null, null, 3, '坎', null, 0.8468],
  ['qimen', 'hour', null, null, 2.431, '坎', null, 0.8039],
  ['daliuren', 'monthhour', null, null, 1, '坎', null, 0.6052],
]
const methods = getMeta().manifests.flatMap(({ key, methods }) => methods.map((method) => [key, method.key]))
assert.deepEqual(methods, expected.map(([shushu, method]) => [shushu, method]))

for (const [shushu, method, ...golden] of expected) {
  const result = castInput({ question: '角色是否应在明天离开邮局？', shushu, method,
    timestamp: '2026-11-25T23:10:05', seed: 'studio-reference', numbers: [8, 5, 12] })
  const { qigua_process: cast, gua_interpret, formula, raw_score: score, probabilities, steps } = result
  assert.deepEqual([cast.lines ?? null, cast.moving ?? null, score, gua_interpret.base?.name ?? null,
    gua_interpret.changed?.name ?? null, probabilities[0].prob], golden, `${shushu}:${method}`)
  assert.ok(formula.cast.lines.length > 1 && steps.length >= 3)
  assert.deepEqual(castInput(result.studioInput), result)
}

assert.equal(recognizeInput({ question: '梅花报数 8 5 12' }).recognition.method, 'number')
const cross = crossInput({ question: '是否换一条路线？', timestamp: '2026-11-25T18:00:00', seed: 'cross' })
assert.equal(cross._agreement.avg_js_divergence, 0.2718)
assert.throws(() => crossInput({ timestamp: '2023-02-29T01:02:03' }), /有效的起卦时间/)
console.log('Guaji: 11 deterministic methods, replay, calendar validation, recognition and cross-system agreement passed.')
