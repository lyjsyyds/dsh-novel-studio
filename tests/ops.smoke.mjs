// dsh-novel-studio — operation layer smoke test.
//
// Exercises lib/ops.js (the shared layer behind the agent tools and extension
// routes) against a throwaway novel root, so the user's real library is never
// touched.
//
//   node tests/ops.smoke.mjs

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = await mkdtemp(join(tmpdir(), 'novel-ops-'))
process.env.DSH_NOVEL_ROOT = ROOT

const LIB = new URL('../lib/', import.meta.url)
const OPS = join(fileURLToPath(LIB), 'ops.js')
const EXT = join(fileURLToPath(LIB), 'extensions')

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

/** Import ops.js with a fresh token so the schema cache is rebuilt. */
const fresh = (tag) => import(`${new URL(`file://${OPS.replace(/\\/g, '/')}`).href}?v=${tag}`)

try {
  const ops = await fresh('t1')

  // ── guide ───────────────────────────────────────────────────────────────
  console.log('\nguide')
  {
    const r = await ops.invoke('guide', {})
    check('guide overview ok', r.ok === true)
    check('guide has text', typeof r.text === 'string' && r.text.length > 40)
    check('guide lists topics', Array.isArray(r.topics) && r.topics.includes('extend'))
    const d = await ops.invoke('guide', { topic: 'data' })
    check('guide data mentions doc kind', d.ok && d.text.includes('doc'))
    const e = await ops.invoke('guide', { topic: 'extend' })
    check('guide extend mentions lib/extensions', e.ok && e.text.includes('lib/extensions'))
  }

  // ── schema ──────────────────────────────────────────────────────────────
  console.log('\nschema')
  {
    const r = await ops.invoke('schema', {})
    check('schema ok', r.ok === true)
    check('schema has 8 built-in sections', r.sections?.length === 8, r.sections?.map((s) => s.key))
    check('schema first is overview', r.sections?.[0]?.key === 'overview')
    check('schema reports extensions', Array.isArray(r.extensions))
    // Underscore-prefixed files are skipped by the loader entirely, so the
    // report covers only what actually loaded. `extensions list` shows both.
    check('_example is skipped by the loader', !r.extensions?.some((x) => x.file === '_example.js'))
  }

  // ── books ───────────────────────────────────────────────────────────────
  console.log('\nbooks')
  let bookId
  {
    const empty = await ops.invoke('books', { action: 'list' })
    check('empty library lists nothing', empty.ok && empty.books.length === 0)
    check('root is the temp dir', empty.root === ROOT)

    const made = await ops.invoke('books', { action: 'create', title: '星海拾遗', meta: { author: '测试', genre: '科幻' } })
    check('create ok', made.ok === true, made)
    bookId = made.book?.id
    check('book id is slugified', bookId === '星海拾遗', bookId)
    check('author stored', made.book?.author === '测试')

    const dir = join(ROOT, '星海拾遗')
    const dirs = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    check('9 top-level book directories created', dirs.length === 9, dirs)
    check('nested world/ and outline/ dirs exist', dirs.includes('world') && dirs.includes('outline') && dirs.includes('panels'))
    check('world/locations seeded', (await stat(join(dir, 'world', 'locations'))).isDirectory())
    check('outline/scenes seeded', (await stat(join(dir, 'outline', 'scenes'))).isDirectory())
    check('seed relationships.yaml exists', (await stat(join(dir, 'relationships.yaml'))).isFile())

    const got = await ops.invoke('books', { action: 'get', book: bookId })
    check('get returns counts', got.ok && typeof got.counts === 'object')
    check('counts.characters is 0', got.counts?.characters === 0)
    check('get returns absolute dir', got.dir === dir)

    const upd = await ops.invoke('books', { action: 'update', book: bookId, patch: { logline: '一句话' } })
    check('update merges', upd.ok && upd.book?.logline === '一句话' && upd.book?.author === '测试')

    const missing = await ops.invoke('books', { action: 'get', book: '不存在' })
    check('unknown book refuses with 404 shape', missing.ok === false, missing)
  }

  // ── records: records kind ───────────────────────────────────────────────
  console.log('\nrecords (kind=records)')
  {
    const w = await ops.invoke('records', {
      action: 'write',
      book: bookId,
      section: 'characters',
      data: { name: '林望', role: '主角', habits: ['咬笔帽'], age: 27 },
    })
    check('write creates a character', w.ok === true, w)
    check('character id from name', w.id === '林望', w.id)
    check('write reports created', w.created === true)
    check('data round-trips', w.data?.habits?.[0] === '咬笔帽')

    const l = await ops.invoke('records', { action: 'list', book: bookId, section: 'characters' })
    check('list returns one item', l.ok && l.count === 1, l)
    check('list infers fields', Array.isArray(l.fields) && l.fields.some((f) => f.k === 'habits'))
    // characters declares its own fields, so they win over inference.
    check('declared habits field served', l.fields?.find((f) => f.k === 'habits')?.type === 'textarea')
    check('declared role field is a select', l.fields?.find((f) => f.k === 'role')?.type === 'select')
    check('kind reported', l.kind === 'records')
    check('titleField reported', l.titleField === 'name')

    const r = await ops.invoke('records', { action: 'read', book: bookId, section: 'characters', entry: '林望' })
    check('read returns the entry', r.ok && r.data?.role === '主角')

    const again = await ops.invoke('records', { action: 'write', book: bookId, section: 'characters', data: { name: '林望', age: 28 } })
    check('same name gets a -2 suffix', again.id === '林望-2', again.id)

    const del = await ops.invoke('records', { action: 'delete', book: bookId, section: 'characters', entry: '林望-2' })
    check('delete ok', del.ok === true, del)
    const after = await ops.invoke('records', { action: 'list', book: bookId, section: 'characters' })
    check('back to one item', after.count === 1)

    const missing = await ops.invoke('records', { action: 'read', book: bookId, section: 'characters', entry: '没有' })
    check('unknown entry refuses', missing.ok === false)
  }

  // ── records: doc kind ───────────────────────────────────────────────────
  console.log('\nrecords (kind=doc)')
  {
    const w = await ops.invoke('records', {
      action: 'write',
      book: bookId,
      section: 'world',
      group: 'rules',
      data: { title: '灵气守恒', detail: '不可创造' },
    })
    check('doc write ok', w.ok === true, w)
    check('doc appends at index 0', w.id === 0, w.id)

    const second = await ops.invoke('records', {
      action: 'write',
      book: bookId,
      section: 'world',
      group: 'rules',
      data: { title: '越阶反噬', detail: '强制' },
    })
    check('doc appends at index 1', second.id === 1, second.id)

    const raw = await readFile(join(ROOT, '星海拾遗', 'world', 'rules.yaml'), 'utf8')
    check('sibling schemaVersion preserved', raw.includes('schemaVersion'))
    check('sibling rules: key preserved', /^rules:/m.test(raw))
    check('both entries written', raw.includes('灵气守恒') && raw.includes('越阶反噬'))

    const upd = await ops.invoke('records', {
      action: 'write',
      book: bookId,
      section: 'world',
      group: 'rules',
      entry: '0',
      data: { title: '灵气守恒', detail: '不可创造，也不可毁灭' },
    })
    check('doc update by index', upd.ok === true, upd)
    const l = await ops.invoke('records', { action: 'list', book: bookId, section: 'world', group: 'rules' })
    check('still two entries after update', l.count === 2, l.count)
    check('update took effect', l.items[0].detail.includes('不可毁灭'))
    check('order preserved', l.items[1].title === '越阶反噬')

    const oob = await ops.invoke('records', { action: 'write', book: bookId, section: 'world', group: 'rules', entry: '9', data: { title: 'x' } })
    check('out-of-range index refuses', oob.ok === false, oob)

    const del = await ops.invoke('records', { action: 'delete', book: bookId, section: 'world', group: 'rules', entry: '1' })
    check('doc delete ok', del.ok === true, del)
  }

  // ── records: chapters ───────────────────────────────────────────────────
  console.log('\nrecords (kind=chapters)')
  {
    const w = await ops.invoke('records', {
      action: 'write',
      book: bookId,
      section: 'chapters',
      data: { title: '第一章 起航', body: '夜里，船离港了。' },
    })
    check('chapter created', w.ok === true, w)
    const l = await ops.invoke('records', { action: 'list', book: bookId, section: 'chapters' })
    check('chapter listed', l.ok && l.count === 1, l)
    check('chapter title preserved', l.items[0]?.title === '第一章 起航', l.items[0])

    const file = await readFile(join(ROOT, '星海拾遗', 'chapters', `${w.id}.md`), 'utf8')
    check('front matter written', file.startsWith('---'))
    check('body written', file.includes('夜里，船离港了。'))
  }

  // ── refusal surface ─────────────────────────────────────────────────────
  console.log('\nrefusals')
  {
    const a = await ops.invoke('records', { action: 'list', book: bookId, section: 'nope' })
    check('unknown section refuses', a.ok === false && a.code === 'unknown-section', a)
    const b = await ops.invoke('records', { action: 'list', book: bookId, section: 'characters', group: 'zzz' })
    check('group on flat section refuses', b.ok === false && b.code === 'unknown-group', b)
    const c = await ops.invoke('records', { action: 'list', book: bookId, section: 'world', group: 'zzz' })
    check('unknown group refuses', c.ok === false && c.code === 'unknown-group', c)
    const d = await ops.invoke('records', { action: 'list' })
    check('missing book refuses', d.ok === false, d)
    const e = await ops.invoke('records', { action: 'write', book: bookId, section: 'characters' })
    check('write without data refuses', e.ok === false && e.code === 'missing-argument', e)
    const f = await ops.invoke('records', { action: 'write', book: bookId, section: 'characters', entry: 'a/b', data: { name: 'x' } })
    check('id with slash refuses', f.ok === false, f)
    const g = await ops.invoke('bogus', {})
    check('unknown operation refuses', g.ok === false && g.code === 'unknown-operation', g)
    const h = await ops.invoke('books', { action: 'nope' })
    check('unknown action refuses', h.ok === false && h.code === 'unknown-action', h)
  }

  // ── extensions ──────────────────────────────────────────────────────────
  console.log('\nextensions')
  {
    const list = await ops.invoke('extensions', { action: 'list' })
    check('extensions list ok', list.ok === true, list)
    check('dir reported', list.dir === EXT)
    check('_example listed as disabled', list.extensions?.some((x) => x.file === '_example.js' && x.enabled === false))

    const sc = await ops.invoke('extensions', { action: 'scaffold', id: 'wordcount', sectionKey: 'stats', zh: '统计', kind: 'doc' })
    check('scaffold returns source', sc.ok === true && typeof sc.source === 'string', sc)
    check('scaffold names the file', sc.name === 'wordcount.js')
    check('scaffold source has the section key', sc.source.includes("key: 'stats'"))

    const badName = await ops.invoke('extensions', { action: 'write', name: '../evil.js', source: 'export const id = 1' })
    check('path-traversal name refuses', badName.ok === false && badName.code === 'bad-name', badName)

    const badSyntax = await ops.invoke('extensions', { action: 'write', name: 'broken.js', source: 'export const id = (' })
    check('syntax error refuses', badSyntax.ok === false && badSyntax.code === 'invalid-extension', badSyntax)
    let left = []
    try {
      left = await readdir(EXT)
    } catch {
      // directory may not exist
    }
    check('rejected extension rolled back', !left.includes('broken.js'), left)

    const thrown = await ops.invoke('extensions', { action: 'write', name: 'throws.js', source: 'throw new Error("boom")' })
    check('top-level throw refuses', thrown.ok === false && thrown.code === 'invalid-extension', thrown)

    const badShape = await ops.invoke('extensions', { action: 'write', name: 'shape.js', source: 'export const sections = "nope"' })
    check('wrong export shape refuses', badShape.ok === false && badShape.code === 'invalid-extension', badShape)

    const good = await ops.invoke('extensions', {
      action: 'write',
      name: 'wordcount.js',
      source: `export const id = 'wordcount'
export const sections = [{ key: 'stats', zh: '统计', en: 'Stats', kind: 'doc', path: 'meta/stats.yaml', listKey: 'rows', titleField: 'label' }]
export const routes = [{ method: 'GET', pattern: '/ext/wordcount/ping', handler: async (req, res, ctx) => ctx.json(res, { ok: true }) }]
`,
    })
    check('valid extension accepted', good.ok === true, good)
    check('reports its section count', good.sections === 1, good.sections)
    check('reports its route count', good.routes === 1, good.routes)
    check('live note returned', typeof good.note === 'string' && good.note.includes('next request'))

    // A fresh token is exactly what the next HTTP request does.
    const ops2 = await fresh('t2')
    const schema2 = await ops2.invoke('schema', {})
    check('new section appears in a fresh schema', schema2.sections?.some((s) => s.key === 'stats'), schema2.sections?.map((s) => s.key))
    check('schema still 8 built-ins + 1', schema2.sections?.length === 9, schema2.sections?.length)
    check('extension report sees it', schema2.extensions?.some((x) => x.file === 'wordcount.js' && x.sections === 1))

    // And the extension's own routes/tools are merged.
    const w2 = await ops2.invoke('records', { action: 'write', book: bookId, section: 'stats', data: { label: '字数', value: 1024 } })
    check('extension section is writable', w2.ok === true, w2)

    const del = await ops2.invoke('extensions', { action: 'delete', name: 'wordcount.js' })
    check('extension delete ok', del.ok === true, del)
    const ops3 = await fresh('t3')
    const schema3 = await ops3.invoke('schema', {})
    check('section gone after delete', !schema3.sections?.some((s) => s.key === 'stats'))

    const delMissing = await ops3.invoke('extensions', { action: 'delete', name: 'ghost.js' })
    check('deleting a missing extension is harmless', delMissing.ok === true)
  }

  // ── path ────────────────────────────────────────────────────────────────
  console.log('\npath')
  {
    const r = await ops.invoke('path', { book: bookId, section: 'world', group: 'rules' })
    check('path returns the yaml file', r.ok === true && r.path.endsWith(join('world', 'rules.yaml')), r)
    const g = await ops.invoke('path', { book: bookId, section: 'characters' })
    check('path returns the directory', g.ok === true && g.path.endsWith('characters'), g)
  }

  // ── root ────────────────────────────────────────────────────────────────
  console.log('\nroot')
  {
    const r = await ops.invoke('root', {})
    check('root reports the pinned library',
      r.ok === true && r.source === 'env' && r.locked === true && r.root === ROOT, JSON.stringify(r))

    const refused = await ops.invoke('root', { action: 'set', root: join(ROOT, 'elsewhere') })
    check('a pinned root cannot be changed', refused.ok === false && refused.code === 'root-locked', JSON.stringify(refused))
    const noArg = await ops.invoke('root', { action: 'set' })
    check('the lock is reported before the argument is read', noArg.ok === false && noArg.code === 'root-locked')

    // The env pin is lifted only to walk the saved path, and the config file is
    // redirected to a throwaway folder so the real ~/.dsh/novel-studio.yaml is
    // never touched. The move below runs from an empty temp folder on purpose:
    // a test must never walk a real library across drives.
    const cfgDir = await mkdtemp(join(tmpdir(), 'novel-ops-cfg-'))
    const savedCfg = process.env.DSH_NOVEL_CONFIG
    process.env.DSH_NOVEL_CONFIG = join(cfgDir, 'novel-studio.yaml')
    delete process.env.DSH_NOVEL_ROOT
    try {
      const plain = await ops.invoke('root', {})
      check('root falls back to the default when nothing is pinned',
        plain.ok === true && plain.source === 'default', JSON.stringify(plain))

      const set = await ops.invoke('root', { action: 'set', root: join(cfgDir, 'shelf') })
      check('root saves a new folder',
        set.ok === true && set.source === 'settings' && set.root === join(cfgDir, 'shelf'), JSON.stringify(set))

      const moved = await ops.invoke('root', { action: 'set', root: join(cfgDir, 'shelf2'), move: true })
      check('root can take the books along',
        moved.ok === true && moved.move && Array.isArray(moved.move.moved), JSON.stringify(moved.move))

      const bad = await ops.invoke('root', { action: 'set', root: 'just-a-name' })
      check('a relative folder is refused', bad.ok === false && bad.code === 'bad-root', JSON.stringify(bad))

      const reset = await ops.invoke('root', { action: 'reset' })
      check('root reset goes back to the default', reset.ok === true && reset.source === 'default', JSON.stringify(reset))

      const unknown = await ops.invoke('root', { action: 'nope' })
      check('root refuses an unknown action', unknown.ok === false && unknown.code === 'unknown-action', JSON.stringify(unknown))
    } finally {
      if (savedCfg === undefined) delete process.env.DSH_NOVEL_CONFIG
      else process.env.DSH_NOVEL_CONFIG = savedCfg
      process.env.DSH_NOVEL_ROOT = ROOT
      await rm(cfgDir, { recursive: true, force: true })
    }
  }

  // ── leftovers ───────────────────────────────────────────────────────────
  console.log('\nfilesystem hygiene')
  {
    let strays = []
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.name.includes('.tmp-')) strays.push(full)
      }
    }
    await walk(ROOT)
    check('no .tmp- leftovers', strays.length === 0, strays)
  }
} finally {
  await rm(ROOT, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) {
  console.log('failed:', failures.join(', '))
  process.exit(1)
}
