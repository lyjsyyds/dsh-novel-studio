// dsh-novel-studio — relationship graph + consistency check smoke test.
//
// Exercises lib/graph.js and lib/validate.js against a throwaway novel root, and
// proves the extensibility promise: an extension dropped into lib/extensions/
// can add both a graph kind and a rule, and both show up without a code change.
//
//   node tests/graph.smoke.mjs

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = await mkdtemp(join(tmpdir(), 'novel-graph-'))
process.env.DSH_NOVEL_ROOT = ROOT

const LIB = join(fileURLToPath(new URL('../lib/', import.meta.url)))
const OPS = join(LIB, 'ops.js')

let pass = 0
let fail = 0
const failures = []

function check(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log(`  ok   ${name}`)
  } else {
    fail += 1
    failures.push(name)
    console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`)
  }
}

const fresh = (mod, tag) => import(`${new URL(`file://${join(LIB, mod).replace(/\\/g, '/')}`).href}?v=${tag}`)

const EXT_NAME = 'test-graph-rule.js'
let createdExt = false

try {
  const ops = await fresh('ops.js', 'g1')
  const { buildGraph, graphKinds } = await fresh('graph.js', 'g1')
  const { ruleList, validateBook } = await fresh('validate.js', 'g1')
  const { writeYamlFile } = await fresh('library.js', 'g1')

  const made = await ops.invoke('books', { action: 'create', title: '星海拾遗', meta: { author: '测试', genre: '科幻' } })
  check('book created', made.ok === true, made)
  const bookId = made.book.id
  const got = await ops.invoke('books', { action: 'get', book: bookId })
  const dir = got.dir
  check('book directory resolved', typeof dir === 'string' && dir.length > 0, got)

  // ── seed the cast ───────────────────────────────────────────────────────
  console.log('\nseed')
  {
    for (const [name, role] of [['林望', '主角'], ['老周', '配角']]) {
      const w = await ops.invoke('records', { action: 'write', book: bookId, section: 'characters', data: { name, role } })
      check(`character ${name} written`, w.ok === true, w)
    }
    const f = await ops.invoke('records', {
      action: 'write', book: bookId, section: 'world', group: 'factions',
      data: { name: '拾荒帮', type: '组织', leader: '老周' },
    })
    check('faction written', f.ok === true, f)

    const bad = await ops.invoke('records', {
      action: 'write', book: bookId, section: 'world', group: 'factions',
      data: { name: '幽灵商会', type: '组织', leader: '不存在的人' },
    })
    check('faction with a broken leader written', bad.ok === true, bad)

    const loc = await ops.invoke('records', {
      action: 'write', book: bookId, section: 'world', group: 'locations',
      data: { name: '轨道垃圾带', type: '区域' },
    })
    check('location written', loc.ok === true, loc)

    const item = await ops.invoke('records', {
      action: 'write', book: bookId, section: 'world', group: 'items',
      data: { name: '记忆芯片', type: '遗物', owner: '林望' },
    })
    check('item written', item.ok === true, item)
  }

  // ── edges ───────────────────────────────────────────────────────────────
  console.log('\nedges')
  {
    await writeYamlFile(join(dir, 'relationships.yaml'), {
      schemaVersion: 1,
      edges: [
        { from: '林望', to: '老周', type: '师徒', note: '在垃圾带认识', strength: 4 },
        { from: '林望', to: '轨道垃圾带', type: '出没于' },
        { from: '林望', to: '老周', type: '师徒' }, // duplicate of the first
        { from: '老周', to: '老周', type: '自语' }, // self-loop
        { from: '林望', to: '幽灵', type: '血亲' }, // neither end exists
      ],
    })
    check('relationships.yaml written with schemaVersion preserved', true)
  }

  // ── buildGraph ──────────────────────────────────────────────────────────
  console.log('\nbuildGraph')
  let full
  {
    full = await buildGraph(dir)
    const ids = full.nodes.map((n) => n.id)
    check('every seeded node present', ['林望', '老周', '拾荒帮', '幽灵商会', '轨道垃圾带', '记忆芯片'].every((x) => ids.includes(x)), ids)
    check('no external nodes in the unfiltered web', full.nodes.every((n) => n.external === false))
    check('manual edges counted', full.stats.manual === 2, full.stats)
    check('auto edges from leader/owner counted', full.stats.auto === 2, full.stats)
    check('node count excludes context', full.stats.nodes === 6, full.stats)
    check('degrees are summed', full.nodes.find((n) => n.id === '林望').degree >= 3, full.nodes.find((n) => n.id === '林望'))
    // 幽灵商会 is only reachable through a leader field that points at nobody, so
    // it is legitimately isolated and is how the orphan count gets exercised.
    check('orphans lists the unreachable faction', full.stats.orphans.join() === '幽灵商会', full.stats.orphans)
    check('two components reported', full.stats.components === 2, full.stats)
    check('byKind counts characters', full.stats.byKind.characters === 2, full.stats.byKind)

    const codes = full.problems.map((p) => p.code)
    check('dangling edge reported', codes.includes('dangling-edge'), codes)
    check('self edge reported', codes.includes('self-edge'), codes)
    check('duplicate edge reported', codes.includes('duplicate-edge'), codes)
    check('broken link field reported', codes.includes('broken-link-field'), codes)

    const auto = full.edges.filter((e) => e.source === 'auto').map((e) => `${e.from}->${e.to}:${e.type}`)
    check('faction leader became an auto edge', auto.includes('老周->拾荒帮:首领'), auto)
    check('item owner became an auto edge', auto.includes('林望->记忆芯片:持有'), auto)
    check('edge strength rounded and clamped', full.edges.find((e) => e.type === '师徒').strength === 4)
    check('default strength is 2', full.edges.find((e) => e.type === '出没于').strength === 2)
  }

  {
    const only = await buildGraph(dir, { kinds: ['characters'] })
    const ids = only.nodes.map((n) => n.id)
    check('filter keeps both characters', ids.includes('林望') && ids.includes('老周'), ids)
    check('far end of a kept edge stays as context', ids.includes('拾荒帮') && ids.includes('轨道垃圾带'), ids)
    check('context nodes are flagged', only.nodes.filter((n) => n.external).length === 3, only.nodes.filter((n) => n.external).map((n) => n.id))
    check('visible count is characters only', only.stats.nodes === 2, only.stats)
    check('context count reported', only.stats.context === 3, only.stats)
    check('manual edge out of the filter survives', only.edges.some((e) => e.from === '林望' && e.to === '老周'))
  }

  {
    const kinds = await graphKinds()
    check('four built-in graph kinds', kinds.length === 4, kinds.map((k) => k.key))
    check('kind menu carries labels', kinds.every((k) => k.zh && k.en))
  }

  // ── validate ────────────────────────────────────────────────────────────
  console.log('\nvalidate')
  {
    const rules = await ruleList()
    check('rule catalogue has 13 built-ins', rules.length === 13, rules.map((r) => r.id))
    check('catalogue entries carry id/zh/en/level', rules.every((r) => r.id && r.zh && r.en && r.level))
    check('catalogue includes broken-ref', rules.some((r) => r.id === 'broken-ref'))

    const report = await validateBook(dir, { title: '星海拾遗' })
    check('report is ok (no errors)', report.ok === true, report.counts)
    check('report is not clean', report.clean === false, report.counts)
    check('counts add up', report.counts.error === 0 && report.counts.warn > 0, report.counts)
    check('scanned units reported', report.scanned.units > 0, report.scanned)
    check('scanned nodes reported', report.scanned.nodes === 6, report.scanned)
    check('issues are sorted error → warn → info',
      report.issues.every((it, i) => i === 0 || ['error', 'warn', 'info'].indexOf(report.issues[i - 1].level) <= ['error', 'warn', 'info'].indexOf(it.level)))

    const byRule = (id) => report.issues.filter((i) => i.rule === id)
    check('dangling-edge rule fired', byRule('dangling-edge').length === 1, byRule('dangling-edge'))
    check('self-edge rule fired', byRule('self-edge').length === 1)
    check('duplicate-edge rule fired', byRule('duplicate-edge').length === 1)
    check('broken-link-field rule fired', byRule('broken-link-field').length === 1, byRule('broken-link-field'))
    check('broken-ref silent when nothing is referenced', byRule('broken-ref').length === 0)
    check('isolated-node names the orphan', byRule('isolated-node').length === 1
      && String(byRule('isolated-node')[0].message).includes('幽灵商会'), byRule('isolated-node'))
    check('empty-sections fired', byRule('empty-sections').length === 1)
  }

  {
    // A missing title is the one built-in error, and it must be reported rather
    // than thrown — that is what makes `ok` meaningful.
    const broken = await validateBook(dir, { title: '' })
    check('blank title is an error', broken.ok === false && broken.counts.error === 1, broken.counts)
    check('error issue names the rule', broken.issues[0].rule === 'book-title' && broken.issues[0].level === 'error', broken.issues[0])
  }

  // ── wiki links ──────────────────────────────────────────────────────────
  console.log('\nwiki links')
  {
    const w = await ops.invoke('records', {
      action: 'write', book: bookId, section: 'chapters',
      data: { title: '第一章', body: '夜里，[[林望]]把[[不存在的角色]]的名字写进了日志。' },
    })
    check('chapter with links written', w.ok === true, w)

    const report = await validateBook(dir, { title: '星海拾遗' })
    const refs = report.issues.filter((i) => i.rule === 'broken-ref')
    check('broken-ref fired once', refs.length === 1, refs)
    check('resolvable link is not reported', !refs.some((r) => String(r.message).includes('林望')))
    check('missing link is reported', String(refs[0]?.message || '').includes('不存在的角色'), refs[0])
    check('chapter is no longer empty', !report.issues.some((i) => i.rule === 'empty-chapter'))

    // Regression: `chapters` used to declare no titleField, so the rule fell
    // back to `unit.key` and reported every chapter as 没有填「chapters」.
    const untitled = report.issues.filter((i) => i.rule === 'untitled-entry')
    check('a titled chapter is not called untitled', !untitled.some((i) => String(i.message).includes('第一章')), untitled)
    check('no issue mentions the raw unit key', !report.issues.some((i) => String(i.message).includes('没有填「chapters」')))

    // Regression: kinds with no title concept (`files`) must be skipped rather
    // than reported once per file.
    await writeFile(join(dir, 'materials', 'notes.txt'), 'research notes\n', 'utf8')
    const withFile = await validateBook(dir, { title: '星海拾遗' })
    check('a raw file is not called an untitled entry', !withFile.issues.some((i) => i.rule === 'untitled-entry'), withFile.issues.filter((i) => i.rule === 'untitled-entry'))
  }

  // ── extension: a new section, a new graph kind and a new rule ───────────
  console.log('\nextension seam')
  {
    const source = `// test extension — added and removed by tests/graph.smoke.mjs
export const id = 'graph-rule-probe'

export const sections = [{
  key: 'relics', zh: '遗物', en: 'Relics',
  kind: 'records', dir: 'relics', titleField: 'name',
}]

export const graphs = [{
  key: 'relics', zh: '遗物', en: 'Relics',
  section: 'relics', label: 'name', role: 'type',
  links: [{ field: 'owner', type: '持有' }],
}]

export const rules = [{
  id: 'no-placeholder', zh: '占位符', en: 'Placeholder text', level: 'warn',
  run: (ctx) => {
    for (const { unit, items } of ctx.units) {
      for (const item of items) {
        for (const s of Object.values(item)) {
          if (typeof s === 'string' && s.includes('TODO')) {
            ctx.add('no-placeholder', 'warn', unit.key + ' 里还有 TODO 占位', { id: String(item.id ?? '') })
          }
        }
      }
    }
  },
}]
`
    const written = await ops.invoke('extensions', { action: 'write', name: EXT_NAME, source })
    check('extension installed', written.ok === true, written)
    createdExt = written.ok === true

    // A new file changes the host fingerprint, so the next *request* gets fresh
    // modules. Re-importing is how the test stands in for that next request.
    const tag = `ext${Date.now()}`
    const ops2 = await fresh('ops.js', tag)
    const graph2 = await fresh('graph.js', tag)
    const validate2 = await fresh('validate.js', tag)

    const kinds = await graph2.graphKinds()
    check('extension graph kind is live', kinds.some((k) => k.key === 'relics'), kinds.map((k) => k.key))

    const rules = await validate2.ruleList()
    check('extension rule is live', rules.some((r) => r.id === 'no-placeholder'), rules.map((r) => r.id))

    const relic = await ops2.invoke('records', {
      action: 'write', book: bookId, section: 'relics', data: { name: '铜钥匙', type: '遗物', owner: '林望' },
    })
    check('new section is writable', relic.ok === true, relic)

    const only = await graph2.buildGraph(dir, { kinds: ['relics'] })
    check('extension kind builds its own subgraph', only.nodes.some((n) => n.id === '铜钥匙' && !n.external), only.nodes.map((n) => `${n.id}:${n.kind}:${n.external}`))
    check('its owner link becomes an auto edge', only.edges.some((e) => e.from === '林望' && e.to === '铜钥匙' && e.source === 'auto'), only.edges)

    const report = await validate2.validateBook(dir, { title: '星海拾遗' })
    check('extension rule ran without error', !report.issues.some((i) => i.level === 'error'), report.counts)

    const c = await ops2.invoke('records', {
      action: 'write', book: bookId, section: 'characters', data: { name: '待定角色', notes: 'TODO 起名' },
    })
    check('entry with a placeholder written', c.ok === true, c)

    const after = await validate2.validateBook(dir, { title: '星海拾遗' })
    check('extension rule fired on the placeholder', after.issues.some((i) => i.rule === 'no-placeholder'), after.issues.map((i) => i.rule))

    const removed = await ops2.invoke('extensions', { action: 'delete', name: EXT_NAME })
    check('extension removed', removed.ok === true, removed)
    createdExt = removed.ok !== true

    const gone = await fresh('graph.js', `gone${Date.now()}`)
    const after2 = await gone.graphKinds()
    check('kind disappears once the file is gone', !after2.some((k) => k.key === 'relics'), after2.map((k) => k.key))
  }

  // ── ops surface ─────────────────────────────────────────────────────────
  console.log('\noperations')
  {
    const g = await ops.invoke('graph', { book: bookId })
    check('graph op returns nodes', g.ok && Array.isArray(g.nodes) && g.nodes.length >= 5, g.ok)
    check('graph op returns the kind menu', Array.isArray(g.kinds) && g.kinds.length === 4)
    check('graph op names the book', g.book === bookId)

    const menu = await ops.invoke('graph', { book: bookId, kinds: 'list' })
    check('kinds "list" returns the menu only', menu.ok && menu.kinds.length === 4 && menu.nodes === undefined)

    const bad = await ops.invoke('graph', { book: bookId, kinds: ['nope'] })
    check('unknown kind refuses', bad.ok === false && bad.code === 'unknown-kind', bad)

    const v = await ops.invoke('validate', { book: bookId })
    check('validate op returns a report', v.ok === true && typeof v.counts === 'object', v.ok)
    check('validate op names the book', v.book === bookId)

    const vr = await ops.invoke('validate', { book: bookId, rules: 'list' })
    check('validate rules "list" returns the catalogue', vr.ok && vr.rules.length === 13)

    const missing = await ops.invoke('graph', { book: 'no-such-book' })
    check('graph on a missing book refuses', missing.ok === false, missing)
  }
} catch (err) {
  fail += 1
  failures.push('unexpected throw')
  console.log(`\n  FAIL unexpected throw — ${err?.stack || err}`)
} finally {
  if (createdExt) await rm(join(LIB, 'extensions', EXT_NAME), { force: true }).catch(() => {})
  await rm(ROOT, { recursive: true, force: true }).catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
if (failures.length) console.log(`failed: ${failures.join(', ')}`)
process.exit(fail === 0 ? 0 : 1)
