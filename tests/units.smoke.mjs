// Smoke test for the stage-2 data layer: schema resolution plus generic record
// I/O for every unit kind. Runs entirely on a temp root — never touches the real
// book library.
//
//   node tests/units.smoke.mjs

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = (n) => new URL(`../lib/${n}`, import.meta.url).href

const { getSchema } = await import(url('schema.js'))
const { createBook, deleteBook } = await import(url('library.js'))
const { listUnit, readUnit, writeUnit, deleteUnit, inferFields } = await import(url('records.js'))

const log = []
let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed += 1
  log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

/** Assert that an async call rejects, and report the status it carried. */
async function rejects(name, fn, wantStatus) {
  try {
    await fn()
    check(name, false, 'resolved instead of rejecting')
  } catch (err) {
    check(name, wantStatus === undefined || err.status === wantStatus, `status=${err.status} ${err.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'novel-units-'))

try {
  // ── schema ──────────────────────────────────────────────────────────────
  const schema = await getSchema()
  check('schema has 8 sections', schema.sections.length === 8, `n=${schema.sections.length}`)
  check('schema keys are stable', schema.sections.map((s) => s.key).join(',') === 'overview,characters,world,outline,panels,chapters,materials,drafts')
  check('unitOf(flat section) resolves', schema.unitOf('characters', 'characters')?.unit.kind === 'records')
  check('unitOf(grouped section) resolves', schema.unitOf('world', 'locations')?.unit.dir === 'world/locations')
  check('unitOf(unknown group) is null', schema.unitOf('world', 'nope') === null)
  check('unitOf(unknown section) is null', schema.unitOf('nope', 'nope') === null)
  check('unitOf(doc group) resolves', schema.unitOf('panels', 'skills')?.unit.listKey === 'skills')
  check('extensions report is an array', Array.isArray(schema.extensions))

  // ── a book to work in ───────────────────────────────────────────────────
  const book = await createBook(root, { title: '单元测试书' })
  check('book created', !!book.dir, book.id)
  check('book dir exists', (await stat(book.dir)).isDirectory())

  const units = {
    characters: schema.unitOf('characters', 'characters').unit,
    locations: schema.unitOf('world', 'locations').unit,
    rules: schema.unitOf('world', 'rules').unit,
    skills: schema.unitOf('panels', 'skills').unit,
    chapters: schema.unitOf('chapters', 'chapters').unit,
    materials: schema.unitOf('materials', 'materials').unit,
  }

  // ── records ─────────────────────────────────────────────────────────────
  check('records start empty', (await listUnit(book.dir, units.characters)).items.length === 0)

  await writeUnit(book.dir, units.characters, '林澈', { name: '林澈', role: '主角', habits: '转螺丝刀' })
  const chars = (await listUnit(book.dir, units.characters)).items
  check('record created', chars.length === 1 && chars[0].id === '林澈')
  check('record kept its fields', chars[0].role === '主角' && chars[0].habits === '转螺丝刀')
  check('record file landed on disk', (await stat(join(book.dir, 'characters', '林澈.yaml'))).isFile())

  const one = await readUnit(book.dir, units.characters, '林澈')
  check('record read back', one.data.name === '林澈')
  check('record id is not duplicated inside the file', one.data.id === undefined)

  await writeUnit(book.dir, units.characters, '林澈', { age: '17' })
  const merged = await readUnit(book.dir, units.characters, '林澈')
  check('record update merges', merged.data.age === '17' && merged.data.name === '林澈')

  await deleteUnit(book.dir, units.characters, '林澈')
  check('record deleted', (await listUnit(book.dir, units.characters)).items.length === 0)
  await rejects('deleting a missing record 404s', () => deleteUnit(book.dir, units.characters, '林澈'), 404)

  await rejects('record id with a slash is rejected', () => writeUnit(book.dir, units.characters, '../evil', {}), 400)
  await rejects('record id with .. is rejected', () => writeUnit(book.dir, units.characters, '..', {}), 400)
  await rejects('absolute record id is rejected', () => writeUnit(book.dir, units.characters, 'a/b', {}), 400)

  // ── doc (array inside one file) ─────────────────────────────────────────
  check('doc starts empty', (await listUnit(book.dir, units.rules)).items.length === 0)

  await writeUnit(book.dir, units.rules, 'new', { name: '浮空岛不可坠落', scope: '全球' })
  await writeUnit(book.dir, units.rules, 'new', { name: '记忆可被交易' })
  let rules = (await listUnit(book.dir, units.rules)).items
  check('doc appended twice', rules.length === 2, `n=${rules.length}`)
  check('doc keeps declared list key', rules[1].name === '记忆可被交易')

  const rawDoc = await readFile(join(book.dir, 'world', 'rules.yaml'), 'utf8')
  check('doc file keeps schemaVersion', rawDoc.includes('schemaVersion: 1'))
  check('doc file keeps the rules key', rawDoc.includes('rules:'))

  await writeUnit(book.dir, units.rules, '0', { scope: '仅限主城' })
  rules = (await listUnit(book.dir, units.rules)).items
  check('doc item updated by index', rules[0].scope === '仅限主城' && rules[0].name === '浮空岛不可坠落')

  await deleteUnit(book.dir, units.rules, '0')
  rules = (await listUnit(book.dir, units.rules)).items
  check('doc item deleted by index', rules.length === 1 && rules[0].name === '记忆可被交易')
  await rejects('doc index out of range 404s', () => deleteUnit(book.dir, units.rules, '9'), 404)

  // a doc that has a second, untouched key must keep it
  await writeUnit(book.dir, units.skills, 'new', { name: '过载', level: '3' })
  const skillsFile = await readFile(join(book.dir, 'panels', 'skills.yaml'), 'utf8')
  check('doc preserves sibling keys', skillsFile.includes('categories:'))

  // ── chapters (markdown + front matter) ──────────────────────────────────
  await writeUnit(book.dir, units.chapters, '001-启程', {
    title: '启程', status: '草稿', summary: '少年在垃圾带醒来',
    body: '他在轨道垃圾带里醒了。\n\n远处的恒星像一枚烧红的铆钉。',
  })
  const chapterFile = await readFile(join(book.dir, 'chapters', '001-启程.md'), 'utf8')
  check('chapter is front matter + body', chapterFile.startsWith('---\n') && chapterFile.includes('烧红的铆钉'))
  const chapter = await readUnit(book.dir, units.chapters, '001-启程')
  check('chapter meta round-trips', chapter.data.title === '启程' && chapter.data.status === '草稿')
  check('chapter body round-trips', chapter.data.body.includes('烧红的铆钉'))

  await writeUnit(book.dir, units.chapters, '001-启程', { status: '已完成', body: '改过的正文。' })
  const chapter2 = await readUnit(book.dir, units.chapters, '001-启程')
  check('chapter update merges meta', chapter2.data.title === '启程' && chapter2.data.status === '已完成')
  check('chapter update replaces body', chapter2.data.body.trim() === '改过的正文。')

  const chapterList = (await listUnit(book.dir, units.chapters)).items
  check('chapter list exposes words', chapterList.length === 1 && chapterList[0].words > 0, `words=${chapterList[0]?.words}`)

  // ── files (materials) ───────────────────────────────────────────────────
  await writeUnit(book.dir, units.materials, '灵感.md', { text: '# 灵感\n\n一段废铁的味道。' })
  const files = (await listUnit(book.dir, units.materials)).items
  check('material file listed', files.length === 1 && files[0].id === '灵感.md', JSON.stringify(files))
  const mat = await readUnit(book.dir, units.materials, '灵感.md')
  check('material text read', mat.data.text.includes('废铁的味道'))
  check('material marked editable', mat.meta.editable === true)

  // a text extension must go through the same path
  await writeUnit(book.dir, units.materials, 'notes.json', { text: '{"a":1}' })
  check('second material listed', (await listUnit(book.dir, units.materials)).items.length === 2)
  await rejects('material name with two levels is rejected', () => writeUnit(book.dir, units.materials, 'a/b/c.txt', { text: 'x' }), 400)
  await deletes_ok()

  async function deletes_ok() {
    await deleteUnit(book.dir, units.materials, 'notes.json')
    check('material deleted', (await listUnit(book.dir, units.materials)).items.length === 1)
    await rejects('missing material 404s', () => readUnit(book.dir, units.materials, 'nope.md'), 404)
  }

  // ── inferred fields ─────────────────────────────────────────────────────
  const inferred = inferFields([{ a: 'x', n: 3, flag: true, tags: ['p'], long: 'y'.repeat(80) }])
  const byKey = Object.fromEntries(inferred.map((f) => [f.k, f.type]))
  check('inferFields types a string', byKey.a === 'text')
  check('inferFields types a number', byKey.n === 'number')
  check('inferFields types a boolean', byKey.flag === 'boolean')
  check('inferFields types an array as tags', byKey.tags === 'tags')
  check('inferFields types a long string as textarea', byKey.long === 'textarea')
  check('inferFields adds common blanks', inferFields([]).some((f) => f.k === 'summary'))

  // ── housekeeping ────────────────────────────────────────────────────────
  const stray = (await readdir(book.dir)).filter((n) => n.includes('.tmp-'))
  check('no temp files left behind', stray.length === 0, stray.join(','))

  const binned = await deleteBook(root, book.id)
  const top = await readdir(root)
  check('book removed from the shelf', !top.includes(book.id), top.join(','))
  check('deletion lands in the recycle bin', !!(binned && binned.trashed) && top.includes('.trash') &&
    (await readdir(join(root, '.trash'))).length === 1, JSON.stringify(binned))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(log.join('\n'))
console.log(`\n${log.length - failed}/${log.length} passed`)
if (failed) process.exitCode = 1
