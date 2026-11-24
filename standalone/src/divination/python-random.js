import { sha256 } from '@noble/hashes/sha2.js'

// CPython Random(int) initialization and getrandbits rejection sampling.
// Guaji seeds this generator with the first 64 bits of SHA-256.
export function pythonRandom(seed) {
  const hash = new DataView(sha256(new TextEncoder().encode(seed)).buffer)
  const key = [hash.getUint32(4), hash.getUint32(0)]
  if (key[1] === 0) key.pop()
  const state = new Uint32Array(624)
  state[0] = 19650218
  for (let i = 1; i < 624; i++) {
    const previous = state[i - 1]
    state[i] = Math.imul(1812433253, previous ^ (previous >>> 30)) + i
  }
  let i = 1
  let j = 0
  for (let n = 0; n < 624; n++) {
    const previous = state[i - 1]
    state[i] = (state[i] ^ Math.imul(previous ^ (previous >>> 30), 1664525)) + key[j] + j
    if (++i >= 624) { state[0] = state[623]; i = 1 }
    if (++j >= key.length) j = 0
  }
  for (let n = 0; n < 623; n++) {
    const previous = state[i - 1]
    state[i] = (state[i] ^ Math.imul(previous ^ (previous >>> 30), 1566083941)) - i
    if (++i >= 624) { state[0] = state[623]; i = 1 }
  }
  state[0] = 0x80000000
  let index = state.length
  function uint32() {
    if (index === 624) {
      for (let k = 0; k < 624; k++) {
        const combined = (state[k] & 0x80000000) | (state[(k + 1) % 624] & 0x7fffffff)
        state[k] = state[(k + 397) % 624] ^ (combined >>> 1) ^ (combined & 1 ? 0x9908b0df : 0)
      }
      index = 0
    }
    let value = state[index++]
    value ^= value >>> 11
    value ^= (value << 7) & 0x9d2c5680
    value ^= (value << 15) & 0xefc60000
    return (value ^ (value >>> 18)) >>> 0
  }
  function below(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 0xffffffff) throw new RangeError('起卦随机数区间有误。')
    const shift = Math.clz32(limit)
    let value
    do { value = uint32() >>> shift } while (value >= limit)
    return value
  }
  return { choice: (values) => values[below(values.length)], randint: (start, end) => start + below(end - start + 1) }
}
