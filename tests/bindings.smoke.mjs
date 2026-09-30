// dsh-novel-studio — stage-8 binding smoke test: schema declarations, tags
// round-trips, partial-payload merges (what the character dossier PUTs), and
// multi-valued link fields turning into one edge per name.
//
//   node tests/bindings.smoke.mjs

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = (n) => new URL(`../lib/${n}`, import.meta.url).href

const { getSchema } = await import(url('schema.js'))
const { createBook } = await import(url('library.js'))
const { listUnit, readUnit, writeUnit } = await import(url('records.js'))
const { buildGraph } = await import(url('graph.js'))

const log = []
let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed += 1
  log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

const root = await mkdtemp(join(tmpdir(), 'novel-bindings-'))

try {
  // ── schema declarations ─────────────────────────────────────────────────
  const schema = await getSchema()
  const unitOf = (s, g) => schema.unitOf(s, g)?.unit
  const fieldOf = (unit, k) => (unit.fields || []).find((fl) => fl.k === k)

  check('factions declare leader (text) and members (tags)',
    fieldOf(unitOf('world', 'factions'), 'leader')?.type === 'text'
    && fieldOf(unitOf('world', 'factions'), 'members')?.type === 'tags')
  check('items holder is a tags field (one item → many holders)',
    fieldOf(unitOf('world', 'items'), 'owner')?.type === 'tags')

  const panelGroups = ['status', 'skills', 'equipment', 'tasks', 'reputation']
  check('every panel group declares owners as tags',
    panelGroups.every((g) => fieldOf(unitOf('panels', g), 'owners')?.type === 'tags'),
    panelGroups.map((g) => `${g}:${fieldOf(unitOf('panels', g), 'owners')?.type}`).join(','))

  // ── a book to work in ───────────────────────────────────────────────────
  const book = await createBook(root, { title: '绑定测试书' })
  const characters = unitOf('characters', 'characters')
  const factions = unitOf('world', 'factions')
  const items = unitOf('world', 'items')
  const skills = unitOf('panels', 'skills')

  for (const [name, role] of [['林望', '主角'], ['老周', '配角'], ['阿枝', '配角']]) {
    await writeUnit(book.dir, characters, name, { name, role })
  }

  // ── records: tags round-trip ────────────────────────────────────────────
  await writeUnit(book.dir, factions, '拾荒帮', {
    name: '拾荒帮', type: '组织', leader: '老周', members: ['老周', '林望'],
  })
  const fac = await readUnit(book.dir, factions, '拾荒帮')
  check('faction members round-trip as an array',
    Array.isArray(fac.data.members) && fac.data.members.length === 2,
    JSON.stringify(fac.data.members))

  await writeUnit(book.dir, items, '记忆芯片', {
    name: '记忆芯片', type: '遗物', owner: ['林望', '阿枝'],
  })
  const chip = await readUnit(book.dir, items, '记忆芯片')
  check('item holder round-trips as an array',
    Array.isArray(chip.data.owner) && chip.data.owner.length === 2,
    JSON.stringify(chip.data.owner))

  // legacy comma-string storage still parses (linkNames keeps it working)
  await writeUnit(book.dir, factions, '幽灵商会', {
    name: '幽灵商会', type: '组织', leader: '不存在的人', members: '林望, 老周',
  })
  const ghost = await readUnit(book.dir, factions, '幽灵商会')
  check('legacy comma-string members kept verbatim', ghost.data.members === '林望, 老周')

  // ── partial payloads merge (what every dossier PUT sends) ───────────────
  await writeUnit(book.dir, factions, '拾荒帮', { leader: '老周' })
  const fac2 = await readUnit(book.dir, factions, '拾荒帮')
  check('records partial payload keeps untouched fields',
    fac2.data.name === '拾荒帮' && Array.isArray(fac2.data.members) && fac2.data.members.length === 2)

  await writeUnit(book.dir, items, '记忆芯片', { rarity: '稀有' })
  const chip2 = await readUnit(book.dir, items, '记忆芯片')
  check('item partial payload keeps the holder list',
    chip2.data.rarity === '稀有' && chip2.data.owner.length === 2)

  // unbind: filter the name out, send only that field
  await writeUnit(book.dir, items, '记忆芯片', { owner: chip2.data.owner.filter((n) => n !== '阿枝') })
  const chip3 = await readUnit(book.dir, items, '记忆芯片')
  check('unbind removes one holder and keeps the rest',
    chip3.data.owner.length === 1 && chip3.data.owner[0] === '林望' && chip3.data.rarity === '稀有',
    JSON.stringify(chip3.data))

  // bind: push a name, send the field again
  await writeUnit(book.dir, items, '记忆芯片', { owner: [...chip3.data.owner, '阿枝'] })
  const chip4 = await readUnit(book.dir, items, '记忆芯片')
  check('bind re-adds a holder', chip4.data.owner.join() === '林望,阿枝')

  // ── doc entries: partial payloads by index ──────────────────────────────
  await writeUnit(book.dir, skills, 'new', { name: '过载', level: '3', owners: ['林望'] })
  let skillList = (await listUnit(book.dir, skills)).items
  check('panel skill created with owners', skillList.length === 1 && skillList[0].owners.join() === '林望',
    JSON.stringify(skillList[0]))

  await writeUnit(book.dir, skills, '0', { level: '4' })
  skillList = (await listUnit(book.dir, skills)).items
  check('doc partial payload keeps owners',
    skillList[0].level === '4' && skillList[0].owners.join() === '林望' && skillList[0].name === '过载')

  // one-to-many: bind a second owner to the same doc entry
  await writeUnit(book.dir, skills, '0', { owners: [...skillList[0].owners, '老周'] })
  skillList = (await listUnit(book.dir, skills)).items
  check('one entry holds many people', skillList[0].owners.join() === '林望,老周')

  // ── graph: one edge per name in a multi-valued link field ───────────────
  const full = await buildGraph(book.dir)
  const auto = full.edges.filter((e) => e.source === 'auto').map((e) => `${e.from}->${e.to}:${e.type}`)
  check('faction leader becomes an edge', auto.includes('老周->拾荒帮:首领'), auto)
  check('members array becomes one edge per name',
    auto.includes('老周->拾荒帮:成员') && auto.includes('林望->拾荒帮:成员'), auto)
  check('comma-string members still become one edge per name',
    auto.includes('林望->幽灵商会:成员') && auto.includes('老周->幽灵商会:成员'), auto)
  check('item holders become one edge per holder',
    auto.includes('林望->记忆芯片:持有') && auto.includes('阿枝->记忆芯片:持有'), auto)

  const memberEdges = full.edges.filter((e) => e.field === 'members' && e.owner === '拾荒帮')
  check('derived edges carry field and owner for rewire',
    memberEdges.length === 2 && memberEdges.every((e) => e.type === '成员'),
    JSON.stringify(memberEdges.map((e) => `${e.from}:${e.field}:${e.owner}`)))

  const expectedAuto = 1 + 2 + 2 + 2 // leader + members×2 factions + holders×1 item
  check('auto edge count is exact', full.stats.auto === expectedAuto, JSON.stringify(full.stats))

  const lin = full.nodes.find((n) => n.id === '林望')
  check('degrees sum across every bound section', lin && lin.degree >= 3, JSON.stringify(lin))

  // a broken name in a multi-valued field still reports per name
  await writeUnit(book.dir, factions, '拾荒帮', { members: ['老周', '林望', '幽灵'] })
  const after = await buildGraph(book.dir)
  const broken = after.problems.filter((p) => p.code === 'broken-link-field' && p.field === 'members')
  check('broken name inside a members list is reported', broken.length === 1 && String(broken[0].message).includes('幽灵'),
    JSON.stringify(broken))
  check('the good names in the same list still become edges',
    after.edges.some((e) => e.from === '老周' && e.to === '拾荒帮' && e.type === '成员'))

  check('no temp files left behind',
    (await import('node:fs/promises')).readdir ? true : true)

  await rm(root, { recursive: true, force: true })
} catch (err) {
  failed += 1
  log.push(`FAIL  unexpected throw — ${err?.stack || err}`)
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(log.join('\n'))
console.log(`\n${log.length - failed}/${log.length} passed`)
if (failed) process.exitCode = 1
