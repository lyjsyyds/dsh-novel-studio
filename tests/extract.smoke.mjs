// Reading a passage back into the record regions: the model proposes, the
// author keeps, and applying only ever fills a gap.
//
// Offline — a fake llm stands in, so nothing is called and nothing is billed.
//
// Run: node tests/extract.smoke.mjs

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = resolve(HERE, '..', 'lib')

const ROOT = await mkdtemp(join(tmpdir(), 'novel-extract-'))
process.env.DSH_NOVEL_ROOT = ROOT

let passed = 0
const failures = []

function check(name, condition, extra) {
  if (condition) {
    passed += 1
    return
  }
  failures.push(extra === undefined ? name : `${name} — ${JSON.stringify(extra)}`)
}

async function rejectsWith(name, fn, code) {
  try {
    await fn()
    check(name, false, 'did not reject')
  } catch (err) {
    check(name, err && err.code === code, { code: err && err.code, message: String(err && err.message) })
  }
}

const fresh = (mod, tag) => import(`${pathToFileURL(resolve(LIB, mod)).href}?v=${tag}`)

/** A stand-in for `ctx.llm`: scripted chunks, and a record of what it was asked. */
function fakeLlm(chunks, seen) {
  return {
    stream(options) {
      if (seen) seen.push(options)
      return (async function* () {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
}

const TEXT = (text) => ({ type: 'text-delta', index: 0, text })

const tag = `x${Date.now()}`
const extract = await fresh('extract.js', tag)
const { invoke } = await fresh('ops.js', tag)
const { listUnit } = await fresh('records.js', tag)
const { readBook } = await fresh('library.js', tag)
const { readUsage } = await fresh('usage.js', tag)
// `getSchema()` is async, so the resolved schema is fetched once and reused.
const SCHEMA = await (await fresh('schema.js', tag)).getSchema()

let bookId = ''
let bookDir = ''
let created = false

/** Everything in one unit, straight off the disk — no caching in between. */
async function items(section, group) {
  const resolved = SCHEMA.unitOf(section, group)
  const { items: rows } = await listUnit(bookDir, resolved.unit)
  return rows
}

const find = (rows, name) => rows.find((row) => String(row.name ?? row.title ?? '') === name)

try {
  const made = await invoke('books', { action: 'create', title: 'extract-book', meta: { author: 'test' } })
  if (!made.ok) throw new Error(`could not create the test book: ${JSON.stringify(made)}`)
  created = true
  bookId = made.book.id
  bookDir = (await readBook(ROOT, bookId)).dir

  // ── extractTargets: where an entry may go ─────────────────────────────
  const targets = extract.extractTargets(SCHEMA)
  const keys = targets.map((t) => t.key)
  const targetOf = (key) => targets.find((t) => t.key === key)

  check('characters is a target', keys.includes('characters'))
  check('a grouped section is addressed by group', keys.includes('world/items') && keys.includes('world/factions'))
  check('a doc list is a target', keys.includes('world/rules') && keys.includes('outline/beats'))
  check('a panel list is a target', keys.includes('panels/status'))
  check('chapters is never a target', !keys.includes('chapters'))
  check('materials is never a target', !keys.includes('materials'))
  check('drafts is never a target', !keys.includes('drafts'))
  check('overview is never a target', !keys.includes('overview'))
  check('a grouped target carries its group key', targetOf('world/items').group === 'items')
  check('an ungrouped target has no group', targetOf('characters').group === null)
  check('a target reports the section it lives in', targetOf('world/items').section === 'world')
  check('every target names a title field', targets.every((t) => typeof t.titleField === 'string' && t.titleField))
  check('every target has a chinese label', targets.every((t) => typeof t.zh === 'string' && t.zh.length))
  check('field labels come through', targetOf('world/items').fields.some((f) => f.k === 'type' && f.zh === '类型'))
  check('select options come through', (targetOf('world/items').fields.find((f) => f.k === 'type').options || []).includes('武器'))
  check('a textarea keeps its type', targetOf('world/items').fields.find((f) => f.k === 'description').type === 'textarea')
  check('no key is repeated', new Set(keys).size === keys.length)
  check('the chapter section is left out even though it is records-like', !targets.some((t) => t.kind === 'chapters'))

  // A book's own declared fields are the allow-list for the model's answer.
  const itemFields = targetOf('world/items').fields.map((f) => f.k)
  const charFields = targetOf('characters').fields.map((f) => f.k)
  const charTitle = targetOf('characters').titleField
  const charText = targetOf('characters').fields.find((f) => f.k !== charTitle && (f.type === 'text' || f.type === 'textarea')).k
  check('characters declares fields', charFields.length > 0, charFields)

  // ── parseExtract: the answer is checked before anyone sees it ──────────
  const withExisting = new Map([
    ['world/items', [{ id: '青玉符', index: 0, name: '青玉符', data: { name: '青玉符', type: '法宝', rarity: '', owner: ['阿枝'] } }]],
  ])

  const good = extract.parseExtract(
    JSON.stringify({
      entries: [
        { target: 'world/items', name: '青玉符', fields: { type: '法宝', rarity: '稀有', owner: '阿枝、顾云舟', description: '船头挂着的旧符。' }, reason: '本段第一次出现' },
      ],
    }),
    targets,
    withExisting,
  )
  check('a valid answer parses', good.entries.length === 1, good)
  check('the entry keeps its region', good.entries[0].key === 'world/items')
  check('an existing name is marked as existing', good.entries[0].exists === true)
  check('an existing name keeps the book’s spelling', good.entries[0].name === '青玉符')
  check('the existing id comes back', good.entries[0].id === '青玉符')
  check('an empty field is listed as fillable', good.entries[0].filled.includes('rarity'))
  check('a field set to the value the book already holds is kept', good.entries[0].kept.includes('type'))
  check('growing a tag list counts as fillable, not kept', good.entries[0].filled.includes('owner') && !good.entries[0].kept.includes('owner'))
  check('a field the answer never mentioned is neither filled nor kept', !good.entries[0].filled.includes('notes') && !good.entries[0].kept.includes('notes'))
  check('a string of tags becomes an array', Array.isArray(good.entries[0].fields.owner))
  check('the tag separator is understood', good.entries[0].fields.owner.join('|') === '阿枝|顾云舟', good.entries[0].fields.owner)
  check('field labels are ready for the panel', good.entries[0].fieldLabels.description === '详述')
  check('the reason is kept', good.entries[0].reason === '本段第一次出现')
  check('counts summarise the plan', good.counts.entries === 1 && good.counts.known === 1 && good.counts.fresh === 0, good.counts)

  const fenced = extract.parseExtract('```json\n{"entries":[{"target":"characters","name":"顾云舟","fields":{"' + charFields[1] + '":"主角"}}]}\n```', targets, new Map())
  check('a fenced answer is read', fenced.entries.length === 1 && fenced.entries[0].name === '顾云舟')
  check('a new name is not marked as existing', fenced.entries[0].exists === false)
  check('a fresh entry has nothing to keep', fenced.entries[0].kept.length === 0)

  const chatty = extract.parseExtract('好的，这是结果：\n{"entries":[{"target":"world/items","name":"潮汐罗盘","fields":{}}]}\n希望有帮助。', targets, new Map())
  check('prose around the json is tolerated', chatty.entries.length === 1 && chatty.entries[0].name === '潮汐罗盘')

  const unknownTarget = extract.parseExtract('{"entries":[{"target":"nowhere","name":"虚无","fields":{}}]}', targets, new Map())
  check('an unknown region is dropped', unknownTarget.entries.length === 0 && unknownTarget.dropped[0].reason === 'unknown-target')

  const noName = extract.parseExtract('{"entries":[{"target":"world/items","fields":{"type":"武器"}}]}', targets, new Map())
  check('an entry without a name is dropped', noName.entries.length === 0 && noName.dropped[0].reason === 'missing-name')

  const unknownField = extract.parseExtract('{"entries":[{"target":"world/items","name":"玉简","fields":{"invented":"不该有"}}]}', targets, new Map())
  check('a field the schema does not declare is dropped', Object.keys(unknownField.entries[0].fields).length === 0, unknownField.entries[0].fields)

  const badSelect = extract.parseExtract('{"entries":[{"target":"world/items","name":"玉简","fields":{"type":"仙器","description":"一枚玉简。"}}]}', targets, new Map())
  check('a select value outside its options is refused', badSelect.entries[0].fields.type === undefined, badSelect.entries[0].fields)
  check('the rest of the entry survives the bad value', badSelect.entries[0].fields.description === '一枚玉简。')

  const sameSelect = extract.parseExtract('{"entries":[{"target":"world/items","name":"玉简","fields":{"type":"武器"}}]}', targets, new Map())
  check('a select value inside its options is kept as declared', sameSelect.entries[0].fields.type === '武器')

  const tagged = extract.parseExtract('{"entries":[{"target":"world/factions","name":"拾荒帮","fields":{"members":["老周","老周","阿枝"]}}]}', targets, new Map())
  check('a tag array is de-duplicated', tagged.entries[0].fields.members.join('|') === '老周|阿枝', tagged.entries[0].fields.members)

  const merged = extract.parseExtract(
    '{"entries":[{"target":"world/items","name":"青玉符","fields":{"rarity":"稀有"}},{"target":"world/items","name":"青玉符","fields":{"notes":"船尾也有"}}]}',
    targets,
    withExisting,
  )
  check('the same name twice becomes one row', merged.entries.length === 1, merged.entries)
  check('the second mention contributes its own fields', merged.entries[0].fields.notes === '船尾也有')
  check('the first mention keeps its fields', merged.entries[0].fields.rarity === '稀有')

  const withSection = extract.parseExtract('{"entries":[{"section":"world","group":"items","name":"断桅刀","fields":{"type":"武器"}}]}', targets, new Map())
  check('section and group work as well as target', withSection.entries.length === 1 && withSection.entries[0].key === 'world/items', withSection.entries)

  const empty = extract.parseExtract('{"entries":[]}', targets, new Map())
  check('an empty answer is an empty plan', empty.entries.length === 0 && empty.counts.entries === 0)

  const bare = extract.parseExtract('{"entries":[{"target":"world/items","name":"空物","fields":{"type":"武器"}}],"dropped":"whatever"}', targets, new Map())
  check('an unexpected extra key is ignored', bare.entries.length === 1)

  await rejectsWith('a non-json answer is refused', async () => extract.parseExtract('我读完了，但我不打算给 JSON。', targets, new Map()), 'bad-extract-answer')
  await rejectsWith('a truncated answer is refused', async () => extract.parseExtract('{"entries":[{"target":"world/items"', targets, new Map()), 'bad-extract-answer')

  const overLong = extract.parseExtract(
    JSON.stringify({ entries: Array.from({ length: 200 }, (_, i) => ({ target: 'world/items', name: `物${i}`, fields: { type: '武器' } })) }),
    targets,
    new Map(),
  )
  check('one answer cannot file unbounded entries', overLong.entries.length <= extract.ENTRY_MAX, overLong.entries.length)

  // ── applyExtract: filling gaps, never overwriting ─────────────────────
  const first = await extract.applyExtract({
    bookDir,
    entries: [{ key: 'world/items', name: '青玉符', fields: { type: '法宝', owner: '阿枝、顾云舟', description: '船头挂着的旧符。', invented: '不该写进去' } }],
  })
  check('a new entry is written', first.written.length === 1 && first.written[0].created === true, first)
  check('nothing is skipped on the first pass', first.skipped.length === 0, first.skipped)

  let rows = await items('world', 'items')
  let item = find(rows, '青玉符')
  check('the record exists on disk', !!item, rows)
  check('the title field is written', item.name === '青玉符')
  check('the declared fields are written', item.type === '法宝' && item.description === '船头挂着的旧符。')
  check('a string of tags is stored as an array', Array.isArray(item.owner) && item.owner.join('|') === '阿枝|顾云舟', item.owner)
  check('an undeclared field never reaches the file', item.invented === undefined)
  check('the file name is the slug of the name', first.written[0].id === '青玉符', first.written[0].id)

  const second = await extract.applyExtract({
    bookDir,
    entries: [{ key: 'world/items', name: '青玉符', fields: { type: '武器', rarity: '稀有', description: '改写过的句子' } }],
  })
  check('the second pass updates instead of creating', second.written.length === 0 && second.updated.length === 1, second)
  check('the report names the filled fields', second.updated[0].filled.includes('rarity'), second.updated[0])
  check('the report names the kept fields', second.updated[0].kept.includes('description') && second.updated[0].kept.includes('type'), second.updated[0])

  rows = await items('world', 'items')
  item = find(rows, '青玉符')
  check('an existing name is never duplicated', rows.filter((r) => r.name === '青玉符').length === 1, rows.map((r) => r.name))
  check('an empty field is filled', item.rarity === '稀有')
  check('a field the author wrote is untouched', item.description === '船头挂着的旧符。')
  check('a select the author set is not overwritten by a different one', item.type === '法宝', item.type)

  const third = await extract.applyExtract({
    bookDir,
    entries: [{ key: 'world/items', name: '青玉符', fields: { type: '武器' } }],
  })
  check('nothing left to add is skipped, not written', third.updated.length === 0 && third.skipped[0].reason === 'nothing-to-add', third)

  const blank = await extract.applyExtract({ bookDir, entries: [{ key: 'world/items', name: '无名之物', fields: {} }] })
  check('a new name with no usable field is still filed by name', blank.written.length === 1 && blank.written[0].filled.length === 0, blank)
  check('a title-only record carries just the name', find(await items('world', 'items'), '无名之物').name === '无名之物')

  const bad = await extract.applyExtract({
    bookDir,
    entries: [
      { key: 'nowhere', name: '虚无', fields: {} },
      { key: 'world/items', fields: { type: '武器' } },
      { key: 'world/items', name: '只有未知字段', fields: { invented: 'x' } },
    ],
  })
  check('an unknown region is skipped', bad.skipped.some((s) => s.reason === 'unknown-target'), bad.skipped)
  check('an entry without a name is skipped', bad.skipped.some((s) => s.reason === 'missing-name'), bad.skipped)
  check('an entry with only unknown fields keeps its name', bad.written.some((w) => w.name === '只有未知字段'), bad)

  await rejectsWith('entries that are not an array are refused', async () => extract.applyExtract({ bookDir, entries: 'nope' }), 'bad-request')

  // ── tags union on a merge ─────────────────────────────────────────────
  await extract.applyExtract({ bookDir, entries: [{ key: 'world/factions', name: '拾荒帮', fields: { members: ['老周'] } }] })
  const grown = await extract.applyExtract({ bookDir, entries: [{ key: 'world/factions', name: '拾荒帮', fields: { members: ['老周', '阿枝'] } }] })
  check('new tags are appended to an existing list', grown.updated.length === 1 && grown.updated[0].filled.includes('members'), grown)
  check('the older tags are kept in the union', (find(await items('world', 'factions'), '拾荒帮').members || []).join('|') === '老周|阿枝')
  const same = await extract.applyExtract({ bookDir, entries: [{ key: 'world/factions', name: '拾荒帮', fields: { members: ['老周'] } }] })
  check('a tag list that adds nothing is skipped', same.skipped[0].reason === 'nothing-to-add', same)

  // ── a doc list: appended by listKey, merged by index ──────────────────
  const rulesBefore = (await items('world', 'rules')).length
  const docNew = await extract.applyExtract({ bookDir, entries: [{ key: 'world/rules', name: '潮汐律', fields: { scope: '整片海域' } }] })
  check('a doc list gains exactly one entry', (await items('world', 'rules')).length === rulesBefore + 1, docNew)
  check('a doc entry carries its own title field', find(await items('world', 'rules'), '潮汐律').name === '潮汐律')
  check('a doc entry keeps an empty field empty', find(await items('world', 'rules'), '潮汐律').description === undefined)

  const docMerge = await extract.applyExtract({ bookDir, entries: [{ key: 'world/rules', name: '潮汐律', fields: { scope: '别的地方', description: '每月朔日潮水倒灌。' } }] })
  check('a doc entry is merged in place', docMerge.updated.length === 1 && docMerge.written.length === 0, docMerge)
  const rule = find(await items('world', 'rules'), '潮汐律')
  check('the doc merge fills only the empty field', rule.description === '每月朔日潮水倒灌。')
  check('the doc merge leaves the written field alone', rule.scope === '整片海域')
  check('a doc merge does not duplicate the list', (await items('world', 'rules')).filter((r) => r.name === '潮汐律').length === 1)

  // ── recognizeExtract: one billed call that writes nothing ─────────────
  const seen = []
  const answer = JSON.stringify({
    entries: [
      { target: 'world/items', name: '灯芯砂', fields: { type: '材料', description: '点灯时垫在底下的细砂。' } },
      { target: 'world/items', name: '灯芯砂', fields: { notes: '重复的一条应并进上一条' } },
    ],
  })
  const llm = fakeLlm([TEXT(answer), { type: 'usage', usage: { inputTokens: 500, outputTokens: 80, totalTokens: 580 } }, { type: 'finish', reason: { kind: 'stop' } }], seen)
  const run = await extract.recognizeExtract({
    llm,
    selection: () => ({ provider: 'harness', model: 'default-model' }),
    bookDir,
    book: {},
    chapter: '第三章',
    passage: '顾云舟从怀里摸出一撮灯芯砂，撒进灯座里。',
  })
  check('the plan holds the model’s entries', run.plan.entries.length === 1, run.plan.entries)
  check('a duplicate inside one answer merges', Object.keys(run.plan.entries[0].fields).length === 3, run.plan.entries[0].fields)
  check('the plan names the chapter it read', run.plan.chapter === '第三章')
  check('the plan counts the passage', run.plan.words === 18, run.plan.words)
  check('the passage reached the model', JSON.stringify(seen[0].messages).includes('灯芯砂'))
  check('the catalogue reached the model', JSON.stringify(seen[0].messages).includes('world/items'))
  check('the existing names reached the model', JSON.stringify(seen[0].messages).includes('青玉符'))
  check('the system instruction is separate', typeof seen[0].system === 'string' && seen[0].system.includes('JSON'), seen[0].system)
  check('the call runs on the book’s route', seen[0].provider === 'harness' && seen[0].model === 'default-model', seen[0])
  check('the call is capped', seen[0].maxTokens === extract.EXTRACT_MAX_TOKENS)
  check('usage comes back', run.usage.totalTokens === 580, run.usage)
  check('recognising writes nothing', (await items('world', 'items')).every((r) => r.name !== '灯芯砂'), (await items('world', 'items')).map((r) => r.name))

  const ledger = await readUsage(bookDir)
  check('the pass is billed to the book', ledger.runs === 1, ledger)
  check('the pass adds its tokens', ledger.input === 500 && ledger.output === 80 && ledger.total === 580, ledger)

  const long = '正文'.repeat(6000)
  const longSeen = []
  await extract.recognizeExtract({
    llm: fakeLlm([TEXT('{"entries":[]}'), { type: 'finish', reason: { kind: 'stop' } }], longSeen),
    selection: () => ({ provider: 'harness', model: 'default-model' }),
    bookDir,
    book: {},
    passage: long,
  })
  const sent = String(longSeen[0].messages[0].content[0].text)
  check('an over-long passage is cut before it is sent', sent.length < long.length, { sent: sent.length, raw: long.length })
  check('the cut is announced to the model', sent.includes('只保留前'), sent.slice(-80))

  await rejectsWith('an empty passage is refused', async () => extract.recognizeExtract({ llm, selection: () => ({ provider: 'p', model: 'm' }), bookDir, passage: '   ' }), 'missing-argument')
  await rejectsWith('no llm is refused', async () => extract.recognizeExtract({ llm: null, selection: () => ({ provider: 'p', model: 'm' }), bookDir, passage: '有正文' }), 'no-llm')
  await rejectsWith('no route at all is refused', async () => extract.recognizeExtract({ llm, selection: () => null, bookDir, passage: '有正文' }), 'no-model')

  const failed = []
  await rejectsWith(
    'a failed round still refuses',
    async () =>
      extract.recognizeExtract({
        llm: fakeLlm([TEXT('{'), { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }], failed),
        selection: () => ({ provider: 'p', model: 'm' }),
        bookDir,
        passage: '有正文',
      }),
    'llm-error',
  )

  // ── the ops route behind the tool ─────────────────────────────────────
  const viaOps = await invoke('extract', {
    action: 'apply',
    book: bookId,
    entries: [{ key: 'characters', name: '顾云舟', fields: { [charText]: '主角' } }],
  })
  check('the ops route files entries too', viaOps.ok === true && viaOps.written.length === 1, viaOps)
  check('the ops route reaches the right section', find(await items('characters'), '顾云舟')?.[charText] === '主角')
  check('the ops route reports the book', viaOps.book === bookId)

  const opsNoModel = await invoke('extract', { action: 'recognize', book: bookId, passage: '有正文' })
  check('recognize without an llm service is refused cleanly', opsNoModel.ok === false && opsNoModel.code === 'no-llm', opsNoModel)

  const opsUnknown = await invoke('extract', { action: 'mystery', book: bookId })
  check('an unknown action is refused', opsUnknown.ok === false && opsUnknown.code === 'unknown-action', opsUnknown)
} finally {
  if (created) {
    try {
      await invoke('books', { action: 'delete', book: bookId })
    } catch {
      /* best effort */
    }
  }
  try {
    await rm(ROOT, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

for (const line of failures) console.log(`FAIL  ${line}`)
console.log(`\nextract.smoke: ${passed} passed, ${failures.length} failed`)
if (failures.length) process.exitCode = 1
