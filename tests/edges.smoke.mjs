// dsh-novel-studio — edge writer smoke test.
//
// lib/graph.js only reads; lib/edges.js is the way back. This suite proves the
// promise the panel makes to the reader: a relation can be created, relabelled,
// rewired and cut — and when it is derived from a field, the *field* is what
// changes, so the section the reader is looking at agrees with the drawing.
//
//   node tests/edges.smoke.mjs

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = await mkdtemp(join(tmpdir(), 'novel-edges-'))
process.env.DSH_NOVEL_ROOT = ROOT

const LIB = join(fileURLToPath(new URL('../lib/', import.meta.url)))

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

/** Every refusal in this module is a thrown Error carrying a `.code`. */
async function refuses(name, code, fn) {
  try {
    await fn()
    check(name, false, { expected: code, got: 'no error' })
  } catch (err) {
    check(name, err?.code === code, { expected: code, got: err?.code, message: err?.message })
  }
}

let created = false

try {
  const ops = await fresh('ops.js', 'e1')
  const { createEdge, deleteEdge, updateEdge } = await fresh('edges.js', 'e1')
  const { buildGraph } = await fresh('graph.js', 'e1')
  const { readYamlFile } = await fresh('library.js', 'e1')
  const { validateBook } = await fresh('validate.js', 'e1')

  const made = await ops.invoke('books', { action: 'create', title: '星海拾遗', meta: { author: '测试' } })
  check('book created', made.ok === true, made)
  const book = made.book.id
  created = true
  const dir = (await ops.invoke('books', { action: 'get', book })).dir

  const write = (section, group, data) =>
    ops.invoke('records', { action: 'write', book, section, group, data })
  const edgeFile = () => readYamlFile(join(dir, 'relationships.yaml'), {})
  const itemFile = (id) => readYamlFile(join(dir, 'world', 'items', `${id}.yaml`), {})

  // ── seed ────────────────────────────────────────────────────────────────
  console.log('\nseed')
  {
    check('character 林望', (await write('characters', undefined, { name: '林望', role: '主角' })).ok === true)
    check('character 老周', (await write('characters', undefined, { name: '老周', role: '配角' })).ok === true)
    check('character 阿枝', (await write('characters', undefined, { name: '阿枝', role: '配角' })).ok === true)
    // Two field-derived edges to exercise: 老周 leads 拾荒帮, 林望 owns 记忆芯片.
    check('faction 拾荒帮', (await write('world', 'factions', { name: '拾荒帮', type: '帮派', leader: '老周' })).ok === true)
    check('item 记忆芯片', (await write('world', 'items', { name: '记忆芯片', type: '道具', owner: '林望' })).ok === true)

    const seeded = await buildGraph(dir)
    check('two derived edges after seeding', seeded.stats.auto === 2, seeded.stats)
    check('no manual edges yet', seeded.stats.manual === 0, seeded.stats)
    const derived = seeded.edges.find((e) => e.source === 'auto')
    check('a derived edge names its field and owner', Boolean(derived?.field && derived?.owner), derived)
  }

  // ── create ──────────────────────────────────────────────────────────────
  console.log('\ncreate')
  {
    const res = await createEdge(dir, { from: '林望', to: '老周', type: '师徒', note: '垃圾带认识', strength: 4 })
    check('edge created', res.ok !== false && res.action === 'create', res)
    check('edge reports its file', res.file === 'relationships.yaml', res)
    check('edge stored with schemaVersion intact', (await edgeFile()).schemaVersion === 1, await edgeFile())
    const row = (await edgeFile()).edges.at(-1)
    check('row holds from/to/type/note/strength', row.from === '林望' && row.to === '老周' && row.type === '师徒' && row.note === '垃圾带认识' && row.strength === 4, row)

    const g = await buildGraph(dir)
    check('graph reports one manual edge', g.stats.manual === 1, g.stats)
    check('graph still reports two derived edges', g.stats.auto === 2, g.stats)

    await refuses('unknown node refused', 'unknown-node', () => createEdge(dir, { from: '林望', to: '幽灵' }))
    await refuses('self edge refused', 'self-edge', () => createEdge(dir, { from: '林望', to: '林望' }))
    await refuses('duplicate refused', 'duplicate-edge', () => createEdge(dir, { from: '林望', to: '老周', type: '师徒' }))
    await refuses('reversed duplicate refused', 'duplicate-edge', () => createEdge(dir, { from: '老周', to: '林望', type: '师徒' }))
    await refuses('collision with a derived edge refused', 'duplicate-edge', () => createEdge(dir, { from: '老周', to: '拾荒帮', type: '首领' }))
    await refuses('missing endpoint refused', 'missing-argument', () => createEdge(dir, { from: '林望' }))

    const plain = await createEdge(dir, { from: '老周', to: '阿枝' })
    check('edge without a type is allowed', plain.edge.type === undefined, plain.edge)
    const strong = await createEdge(dir, { from: '阿枝', to: '拾荒帮', type: '成员', strength: 99 })
    check('strength is clamped to 5', strong.edge.strength === 5, strong.edge)
    const weak = await createEdge(dir, { from: '林望', to: '拾荒帮', type: '混迹', strength: 0 })
    check('strength is clamped up to 1', weak.edge.strength === 1, weak.edge)
  }

  // ── update a stored row ─────────────────────────────────────────────────
  console.log('\nupdate (stored)')
  {
    const res = await updateEdge(dir, {
      from: '林望', to: '老周', type: '师徒', source: 'manual',
      patch: { type: '忘年交', note: '救过一命', strength: 1 },
    })
    check('update reports action=update', res.action === 'update' && res.source === 'manual', res)
    const row = (await edgeFile()).edges.find((e) => e.to === '老周' && e.from === '林望' && e.type === '忘年交')
    check('row relabelled in place', Boolean(row), (await edgeFile()).edges)
    check('row note updated', row?.note === '救过一命', row)
    check('row strength updated', row?.strength === 1, row)
    check('row count unchanged', (await edgeFile()).edges.length === 4, (await edgeFile()).edges)

    await updateEdge(dir, {
      from: '林望', to: '老周', type: '忘年交', source: 'manual',
      patch: { to: '阿枝' },
    })
    const moved = (await edgeFile()).edges.find((e) => e.from === '林望' && e.to === '阿枝' && e.type === '忘年交')
    check('row can be repointed', Boolean(moved), (await edgeFile()).edges)

    // Two edges sharing both endpoints: without a type there is no honest answer.
    await createEdge(dir, { from: '林望', to: '阿枝', type: '邻里' })
    await refuses('ambiguous match refused', 'ambiguous-edge', () => updateEdge(dir, { from: '林望', to: '阿枝' }))
    await deleteEdge(dir, { from: '林望', to: '阿枝', type: '邻里', source: 'manual' })
    await refuses('missing edge refused', 'no-such-edge', () =>
      updateEdge(dir, { from: '林望', to: '老周', type: '不存在', source: 'manual', patch: { note: 'x' } }))
    await refuses('repoint to self refused', 'self-edge', () =>
      updateEdge(dir, { from: '林望', to: '拾荒帮', type: '混迹', source: 'manual', patch: { to: '林望' } }))
    await refuses('repoint onto an existing edge refused', 'duplicate-edge', () =>
      updateEdge(dir, { from: '林望', to: '阿枝', type: '忘年交', source: 'manual', patch: { to: '拾荒帮', type: '混迹' } }))

    const empty = await updateEdge(dir, { from: '林望', to: '阿枝', type: '忘年交', source: 'manual', patch: {} })
    check('empty patch still resolves the edge', empty.action === 'update', empty)
  }

  // ── update a derived edge ───────────────────────────────────────────────
  console.log('\nupdate (derived)')
  {
    await refuses('relabelling a derived edge is refused by name', 'locked-field-link', () =>
      updateEdge(dir, { from: '林望', to: '记忆芯片', type: '持有', source: 'auto', patch: { type: '拥有' } }))
    await refuses('restyling a derived edge is refused too', 'locked-field-link', () =>
      updateEdge(dir, { from: '林望', to: '记忆芯片', type: '持有', source: 'auto', patch: { strength: 5 } }))

    const same = await updateEdge(dir, { from: '林望', to: '记忆芯片', type: '持有', source: 'auto', patch: { from: '林望' } })
    check('rewiring to the same node is a no-op', same.changed === false, same)

    const res = await updateEdge(dir, { from: '林望', to: '记忆芯片', type: '持有', source: 'auto', patch: { from: '阿枝' } })
    check('rewire names the unit and field that moved', res.changed === true && res.field === 'owner' && res.unit === 'items', res)

    // The whole point: the section now says 阿枝, because that is where the edge lives.
    check('the item record now reads 阿枝', (await itemFile('记忆芯片')).owner === '阿枝', await itemFile('记忆芯片'))
    const g = await buildGraph(dir)
    check('graph moved the edge with it', g.edges.some((e) => e.source === 'auto' && e.from === '阿枝' && e.to === '记忆芯片'))
    check('old endpoint is gone from the graph', !g.edges.some((e) => e.source === 'auto' && e.from === '林望' && e.to === '记忆芯片'))

    // Everything the reader typed by hand survives the rewrite.
    check('other item fields survive the rewrite', (await itemFile('记忆芯片')).type === '道具', await itemFile('记忆芯片'))

    await refuses('rewiring onto the owner itself refused', 'self-edge', () =>
      updateEdge(dir, { from: '阿枝', to: '记忆芯片', type: '持有', source: 'auto', patch: { from: '记忆芯片' } }))
  }

  // ── delete ──────────────────────────────────────────────────────────────
  console.log('\ndelete')
  {
    const before = (await edgeFile()).edges.length
    const res = await deleteEdge(dir, { from: '林望', to: '拾荒帮', type: '混迹', source: 'manual' })
    check('delete reports action=delete', res.action === 'delete' && res.source === 'manual', res)
    check('row actually removed', (await edgeFile()).edges.length === before - 1, (await edgeFile()).edges.length)

    await refuses('deleting a missing edge refused', 'no-such-edge', () =>
      deleteEdge(dir, { from: '林望', to: '拾荒帮', type: '混迹', source: 'manual' }))

    const derived = await deleteEdge(dir, { from: '阿枝', to: '记忆芯片', type: '持有', source: 'auto' })
    check('cutting a derived edge reports the field', derived.owner === '记忆芯片' && derived.field === 'owner', derived)
    // Cleared means the key is gone — an empty string would linger in the file.
    check('the field is removed, not blanked', !('owner' in (await itemFile('记忆芯片'))), await itemFile('记忆芯片'))
    const g = await buildGraph(dir)
    check('derived edge left the graph', !g.edges.some((e) => e.to === '记忆芯片' && e.type === '持有'), g.edges)
    check('one derived edge remains', g.stats.auto === 1, g.stats)

    // Restoring it puts the edge straight back — the field is the single source of truth.
    // Note `entry` is what makes this an update; without it the op treats the write
    // as a new record and dedupes the id out from under you.
    const restored = await ops.invoke('records', {
      action: 'write', book, section: 'world', group: 'items', entry: '记忆芯片',
      data: { name: '记忆芯片', type: '道具', owner: '林望' },
    })
    check('restoring the owner field is accepted', restored.ok === true, restored)
    check('the write landed on the existing record', restored.id === '记忆芯片', restored)
    check('the field is back in the file', (await itemFile('记忆芯片')).owner === '林望', await itemFile('记忆芯片'))
    const back = await buildGraph(dir)
    check('restoring the field restores the edge', back.edges.some((e) => e.source === 'auto' && e.from === '林望' && e.to === '记忆芯片'), back.edges.filter((e) => e.to === '记忆芯片'))
  }

  // ── the book is still coherent ──────────────────────────────────────────
  console.log('\nconsistency')
  {
    const detail = (await ops.invoke('books', { action: 'get', book })).book
    const report = await validateBook(dir, detail)
    check('validate still reports no errors', report.counts.error === 0, report.counts)
    const codes = report.issues.filter((i) => i.level === 'error').map((i) => i.rule)
    check('no rule was tripped by the edits', codes.length === 0, codes)

    // ...and the ops layer exposes the same surface the panel uses.
    const viaOps = await ops.invoke('edges', { action: 'create', book, from: '老周', to: '阿枝', type: '旧识' })
    check('ops exposes edges/create', viaOps.ok === true && viaOps.action === 'create', viaOps)
    const unknown = await ops.invoke('edges', { action: 'nope', book })
    check('ops refuses an unknown action', unknown.ok === false && unknown.code === 'unknown-action', unknown)
  }
} finally {
  if (created) await rm(join(ROOT, '..'), { recursive: true, force: true }).catch(() => {})
  await rm(ROOT, { recursive: true, force: true }).catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
if (failures.length) console.log(`failed: ${failures.join(' | ')}`)
process.exit(fail ? 1 : 0)
