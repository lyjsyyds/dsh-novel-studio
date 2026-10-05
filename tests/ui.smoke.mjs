// dsh-novel-studio — UI contract for lib/client.js (the browser half).
//
// The panel can only show what this file says, and three classes of mistake
// fail silently instead of throwing: a t('key') with no dictionary entry
// renders its raw key, an h(Component) with no definition kills the whole
// panel before it paints, and a className with no rule drops its styling and
// falls back to the browser's own controls. This suite reads the source and
// checks all three, so "the panel looks broken" shows up here first.
//
//   node tests/ui.smoke.mjs

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const log = []
const check = (name, ok, extra = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : ' — ' + extra}`)

const src = await readFile(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

// Brace matching over a slice of source, used to carve the dictionaries out.
const brace = (text, start) => {
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

try {
  // ── dictionaries ──────────────────────────────────────────────────────────
  const dictAt = src.indexOf('const DICT = {')
  const dictEnd = dictAt >= 0 ? brace(src, src.indexOf('{', dictAt)) : -1
  const dict = dictEnd > dictAt ? src.slice(dictAt, dictEnd + 1) : ''
  const sideKeys = (name) => {
    const at = dict.indexOf(`\n      ${name}: {`)
    if (at < 0) return null
    const open = dict.indexOf('{', at)
    const close = brace(dict, open)
    const keys = new Set()
    for (const m of dict.slice(open, close).matchAll(/^\s{8}([A-Za-z0-9_]+):/gm)) keys.add(m[1])
    return keys
  }
  const zh = sideKeys('zh')
  const en = sideKeys('en')
  check('the zh and en dictionaries are both parseable', Boolean(zh && en))
  if (zh && en) {
    check('the dictionaries are the same size', zh.size === en.size, `zh ${zh.size} / en ${en.size}`)
    const onlyZh = [...zh].filter((k) => !en.has(k))
    const onlyEn = [...en].filter((k) => !zh.has(k))
    check('every zh key has an en twin', onlyZh.length === 0, onlyZh.slice(0, 8).join(', '))
    check('every en key has a zh twin', onlyEn.length === 0, onlyEn.slice(0, 8).join(', '))

    // ── t('...') call sites ───────────────────────────────────────────────
    const used = new Set()
    for (const m of src.matchAll(/([^A-Za-z0-9_$]|^)\bt\(\s*(['"])([^'"]+)\2/g)) used.add(m[3])
    const missingZh = [...used].filter((k) => !zh.has(k))
    const missingEn = [...used].filter((k) => !en.has(k))
    check('every literal t() key exists in zh', missingZh.length === 0, missingZh.slice(0, 8).join(', '))
    check('every literal t() key exists in en', missingEn.length === 0, missingEn.slice(0, 8).join(', '))
    // The few t(variable) calls carry their labels in a table next to the
    // component, so those label names are checked too.
    const mAt = src.indexOf('const metrics = [')
    let mBody = ''
    if (mAt >= 0) {
      const open = src.indexOf('[', mAt)
      let depth = 0
      for (let i = open; i < src.length; i += 1) {
        if (src[i] === '[') depth += 1
        else if (src[i] === ']') {
          depth -= 1
          if (depth === 0) { mBody = src.slice(open, i + 1); break }
        }
      }
    }
    const labels = [...mBody.matchAll(/\[\s*'[^']+'\s*,\s*'([A-Za-z0-9_]+)'\s*\]/g)].map((m) => m[1])
    const dynamicMissing = labels.filter((k) => !zh.has(k) || !en.has(k))
    check('the reader curve labels resolve in both languages', labels.length > 0 && dynamicMissing.length === 0, dynamicMissing.join(', '))
  }

  // ── component references ──────────────────────────────────────────────────
  const defined = new Set()
  for (const m of src.matchAll(/(?:function|const|let|var)\s+([A-Za-z0-9_$]+)\s*[=(]/g)) defined.add(m[1])
  const imported = new Set()
  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from/g)) for (const n of m[1].split(',')) imported.add(n.trim())
  const unresolved = new Set()
  for (const m of src.matchAll(/\bh\(\s*([A-Z][A-Za-z0-9_$]*)/g)) {
    if (defined.has(m[1]) || imported.has(m[1]) || m[1] === 'React') continue
    unresolved.add(m[1])
  }
  check('every h(Component) reference resolves', unresolved.size === 0, [...unresolved].slice(0, 8).join(', '))

  // ── markup ↔ stylesheet ───────────────────────────────────────────────────
  const classes = new Set()
  for (const m of src.matchAll(/className:\s*'([^'`]+)'/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(c)
  for (const m of src.matchAll(/className:\s*\[([^\]]+)\]/g)) for (const c of m[1].match(/'([^']+)'/g) || []) classes.add(c.slice(1, -1))
  const styled = (c) => new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[{\\s,~:+>)]`).test(src)
  const bare = [...classes].filter((c) => !styled(c))
  check('every className in the markup has a CSS rule', bare.length === 0, bare.slice(0, 10).join(', '))

  const tokens = new Set()
  for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) tokens.add(m[1])
  const noFallback = [...tokens].filter((tok) => !src.includes(`var(${tok},`))
  check('every css token has a fallback colour', noFallback.length === 0, noFallback.slice(0, 6).join(', '))

  const opens = (src.match(/\{/g) || []).length
  const closes = (src.match(/\}/g) || []).length
  check('brace balance across client.js', opens === closes, `{ ${opens} vs } ${closes}`)
  check('ensureStyle() runs before the panel registers', /apply\(ctx\)\s*\{\s*ensureStyle\(\)/.test(src))

  const cssAttrs = new Set()
  for (const m of src.matchAll(/\[data-([a-z-]+)=[a-z0-9-]+\]/g)) cssAttrs.add(m[1])
  const deadAttr = [...cssAttrs].filter((name) => !src.includes(`'data-${name}'`) && !src.includes(`data-${name}:`))
  check('every data-attribute selector is set by the markup', deadAttr.length === 0, deadAttr.join(', '))

  // ── the views this panel is built from ────────────────────────────────────
  for (const name of ['NovelStudio', 'Shelf', 'Overview', 'GroupPane', 'UnitPane', 'AiPane', 'IssueReport', 'ValidatePane', 'ReaderPane', 'CalendarNote', 'SharedPane']) {
    const usedIt = new RegExp(`\\b${name}\\b`).test(src.replace(new RegExp(`function\\s+${name}\\s*\\(`, 'g'), ''))
    const defIt = new RegExp(`function\\s+${name}\\s*\\(`).test(src)
    check(`${name}: defined ${defIt}`, defIt === usedIt, `used ${usedIt}`)
  }
} catch (err) {
  check(`unexpected throw: ${err?.message}`, false, err?.stack)
}

console.log(log.filter((l) => l.startsWith('FAIL')).join('\n'))
const pass = log.filter((l) => l.startsWith('PASS')).length
const fail = log.filter((l) => l.startsWith('FAIL')).length
console.log(`ui: ${pass} passed${fail ? `, ${fail} FAILED` : ''} (${log.length} checks)`)
if (fail) process.exitCode = 1
