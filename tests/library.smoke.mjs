// Standalone smoke test for the data layer — runs outside DSH against a
// throwaway root so the filesystem contract is proven without the app running.
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const lib = await import(new URL('../lib/library.js', import.meta.url).href)

const root = await mkdtemp(join(tmpdir(), 'novel-smoke-'))
const log = []
const check = (name, ok, extra = '') => {
  log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) process.exitCode = 1
}

try {
  // empty root
  check('listBooks on empty root', (await lib.listBooks(root)).length === 0)

  // create
  const a = await lib.createBook(root, { title: '星海拾遗', author: '我', genre: '科幻', logline: '一个捡垃圾的少年' })
  check('createBook returns id', a.id === '星海拾遗', `id=${a.id}`)
  check('createBook sets schemaVersion', a.schemaVersion === lib.SCHEMA_VERSION)

  // scaffold on disk
  for (const d of ['characters', 'world/locations', 'outline/scenes', 'panels/custom', 'chapters', 'materials']) {
    const s = await stat(join(root, a.id, d)).catch(() => null)
    check(`dir ${d}`, !!(s && s.isDirectory()))
  }
  const bookYaml = await readFile(join(root, a.id, 'book.yaml'), 'utf8')
  check('book.yaml has title', bookYaml.includes('星海拾遗'))
  check('seed world/rules.yaml exists', !!(await stat(join(root, a.id, 'world', 'rules.yaml')).catch(() => null)))

  // a second book must not collide with the first
  const b = await lib.createBook(root, { title: '星海拾遗' })
  check('duplicate title gets unique id', b.id === '星海拾遗-2', `id=${b.id}`)

  // illegal path characters are stripped
  const c = await lib.createBook(root, { title: 'a/b:c*d?' })
  check('illegal chars stripped', !/[\\/:*?"<>|]/.test(c.id), `id=${c.id}`)

  // missing title rejected
  const err = await lib.createBook(root, { title: '   ' }).then(() => null, (e) => e)
  check('empty title rejected 400', err && err.status === 400)

  // list
  const list = await lib.listBooks(root)
  check('listBooks count', list.length === 3, `n=${list.length}`)
  check('listBooks carries title', list.some((x) => x.title === '星海拾遗'))

  // detail + counts against hand-planted files
  await lib.atomicWrite(join(root, a.id, 'characters', 'hero.yaml'), 'name: 主角\n')
  await lib.atomicWrite(join(root, a.id, 'chapters', '0001-开端.md'), '# 开端\n')
  await lib.atomicWrite(join(root, a.id, 'chapters', '0002-中段.md'), '# 中段\n')
  const counts = await lib.bookCounts(join(root, a.id))
  check('counts characters', counts.characters === 1, JSON.stringify(counts))
  check('counts chapters', counts.chapters === 2, JSON.stringify(counts))

  // update
  const upd = await lib.updateBook(root, a.id, { genre: '软科幻', id: 'hacked' })
  check('update merges', upd.genre === '软科幻')
  check('update cannot rename id', upd.id === a.id)
  check('update bumps updatedAt', !!upd.updatedAt && upd.updatedAt !== a.updatedAt)
  const reread = await lib.readBook(root, a.id)
  check('update persisted', reread.genre === '软科幻')

  // atomic write leaves no temp files behind
  const leftovers = (await readdir(root)).filter((n) => n.includes('.tmp-'))
  check('no temp files left', leftovers.length === 0, leftovers.join(','))

  // traversal guard
  const bad = await lib.readBook(root, '../etc').then(() => null, (e) => e)
  check('path traversal rejected', bad && bad.status === 400, bad && bad.message)

  // delete — a book leaves the shelf but waits in the recycle bin
  await lib.deleteBook(root, b.id)
  check('delete removes dir', !(await stat(join(root, b.id)).catch(() => null)))
  check('delete leaves others', (await lib.listBooks(root)).length === 2)
  const bin = await lib.listTrash(root)
  check('delete lands in recycle bin', bin.length === 1 && bin[0].id.startsWith(`${b.id}__ts`) && !!bin[0].deletedAt, JSON.stringify(bin))
  check('bin entry carries the original name', bin[0] && bin[0].name === b.id, JSON.stringify(bin[0]))
  check('the bin is not listed as a book', !(await lib.listBooks(root)).some((x) => x.id === '.trash'))
  const badEntry = await lib.purgeTrash(root, '.hack').then(() => null, (e) => e)
  check('bad recycle entry rejected', badEntry && badEntry.status === 400, badEntry && badEntry.message)
  const ghost = await lib.restoreTrash(root, 'ghost__ts1').then(() => null, (e) => e)
  check('unknown recycle entry 404', ghost && ghost.status === 404, ghost && ghost.message)

  // the id was taken again while the book waited in the bin
  await mkdir(join(root, b.id), { recursive: true })
  const restored = await lib.restoreTrash(root, bin[0].id)
  check('restore onto a taken id lands beside it', restored.restored && restored.id === `${b.id}-2`, JSON.stringify(restored))
  check('restored book is back on disk', !!(await stat(join(root, restored.id)).catch(() => null)))
  check('restored book.yaml id follows the folder', (await lib.readBook(root, restored.id)).id === restored.id)
  await rm(join(root, b.id), { recursive: true, force: true })

  // purge for good
  await lib.deleteBook(root, restored.id)
  const bin2 = await lib.listTrash(root)
  check('second delete lands in bin', bin2.length === 1 && bin2[0].name === restored.id, JSON.stringify(bin2))
  const purged = await lib.purgeTrash(root, bin2[0].id)
  check('purge destroys the book', purged.purged && !(await readdir(join(root, '.trash'))).length, JSON.stringify(purged))
  check('purge leaves others', (await lib.listBooks(root)).length === 2)

  // unknown book
  const missing = await lib.readBook(root, 'no-such-book').then(() => null, (e) => e)
  check('unknown book 404', missing && missing.status === 404)

  // ── where the library lives ───────────────────────────────────────────
  // The config file is redirected to a throwaway path so a test run can never
  // repoint the real ~/.dsh/novel-studio.yaml, and the env var is restored
  // afterwards for the same reason.
  const cfgDir = await mkdtemp(join(tmpdir(), 'novel-cfg-'))
  const cfg = join(cfgDir, 'novel-studio.yaml')
  const savedEnv = { root: process.env.DSH_NOVEL_ROOT, cfg: process.env.DSH_NOVEL_CONFIG }
  process.env.DSH_NOVEL_CONFIG = cfg
  delete process.env.DSH_NOVEL_ROOT
  try {
    const info = lib.rootInfo()
    check('rootInfo starts at the default', info.source === 'default' && info.root === info.defaultRoot, info.root)
    check('rootInfo is not locked', info.locked === false)

    const refused = await lib.writeRoot('relative/folder').then(() => null, (e) => e)
    check('relative root refused 400', refused && refused.status === 400, refused && refused.message)
    check('a refusal writes nothing', !(await stat(cfg).catch(() => null)))

    const next = join(cfgDir, 'shelf')
    const after = await lib.writeRoot(next)
    check('writeRoot saves the path', after.source === 'settings' && after.root === next, JSON.stringify(after))
    check('resolveRoot follows the saved path', lib.resolveRoot() === next)
    check('the config file holds it', (await readFile(cfg, 'utf8')).includes('shelf'))

    const nested = await lib.writeRoot(join(next, 'inner')).then(() => null, (e) => e)
    check('a root inside the current one is refused', nested && nested.status === 400, nested && nested.message)
    const parent = await lib.writeRoot(cfgDir).then(() => null, (e) => e)
    check('a root above the current one is refused', parent && parent.status === 400)

    const cleared = await lib.writeRoot(null)
    check('writeRoot(null) clears', cleared.source === 'default' && cleared.root === cleared.defaultRoot, JSON.stringify(cleared))

    process.env.DSH_NOVEL_ROOT = join(cfgDir, 'env-root')
    await lib.writeRoot(next)
    const envInfo = lib.rootInfo()
    check('the env var outranks the saved path',
      envInfo.root === join(cfgDir, 'env-root') && envInfo.source === 'env' && envInfo.locked === true,
      JSON.stringify(envInfo))
    delete process.env.DSH_NOVEL_ROOT

    // moving the books themselves
    const from = join(cfgDir, 'from')
    const to = join(cfgDir, 'to')
    await lib.createBook(from, { title: '搬家测试' })
    await lib.atomicWrite(join(from, 'loose.txt'), 'not a book\n')
    const report = await lib.moveRoot(from, to)
    check('moveRoot takes the book', report.moved.includes('搬家测试') && report.skipped.length === 1, JSON.stringify(report))
    check('moved book landed', !!(await stat(join(to, '搬家测试', 'book.yaml')).catch(() => null)))
    check('moved book left the old root', !(await stat(join(from, '搬家测试')).catch(() => null)))
    check('a stray file is skipped, not moved',
      report.skipped.some((s) => s.reason === 'not-a-directory') && !!(await stat(join(from, 'loose.txt')).catch(() => null)))

    const from2 = join(cfgDir, 'from2')
    const to2 = join(cfgDir, 'to2')
    await lib.createBook(from2, { title: '撞名' })
    await lib.atomicWrite(join(to2, '撞名', 'keep.txt'), 'mine\n')
    const clash = await lib.moveRoot(from2, to2)
    check('a name already there is skipped',
      clash.skipped.some((s) => s.name === '撞名' && s.reason === 'target-exists'), JSON.stringify(clash.skipped))
    check('the folder already there is untouched', (await readFile(join(to2, '撞名', 'keep.txt'), 'utf8')) === 'mine\n')
    check('the skipped book stays where it was', !!(await stat(join(from2, '撞名')).catch(() => null)))

    const empty = await lib.moveRoot(join(cfgDir, 'nope'), join(cfgDir, 'nope2'))
    check('a missing source moves nothing', empty.moved.length === 0 && empty.skipped.length === 0)
    const same = await lib.moveRoot(to, to)
    check('the same folder is a no-op', same.moved.length === 0 && same.from === same.to)

    // the folder picker behind the library root field
    const browseDir = join(cfgDir, 'browse')
    await mkdir(join(browseDir, 'alpha'), { recursive: true })
    await mkdir(join(browseDir, 'Beta'), { recursive: true })
    await lib.atomicWrite(join(browseDir, 'note.txt'), 'not a folder\n')

    const here = await lib.listFolders(browseDir)
    check('listFolders reports the folder it read', here.path === resolve(browseDir), here.path)
    check('listFolders hands back a parent to go up to',
      here.parent === resolve(cfgDir) && here.home === homedir(), `${here.parent} / ${here.home}`)
    check('listFolders lists folders only, each with a path',
      here.items.length === 2 && here.items.every((it) => it.name && it.path),
      JSON.stringify(here.items))
    check('listFolders sorts the names, case-insensitively',
      here.items.map((it) => it.name).join(',') === 'alpha,Beta')

    const emptyDir = await lib.listFolders(join(browseDir, 'alpha'))
    check('an empty folder lists nothing', emptyDir.items.length === 0, JSON.stringify(emptyDir.items))
    check('a folder one level down still knows its parent', emptyDir.parent === resolve(browseDir))

    const nope = await lib.listFolders(join(cfgDir, 'nope-folder')).then(() => null, (e) => e)
    check('a folder that is not there is a bad path',
      !!nope && nope.status === 400 && nope.code === 'bad-path', nope ? nope.message : 'resolved anyway')
    const plainFile = await lib.listFolders(join(browseDir, 'note.txt')).then(() => null, (e) => e)
    check('a plain file is a bad path too',
      !!plainFile && plainFile.status === 400 && plainFile.code === 'bad-path')

    const top = await lib.listFolders()
    check('with no path the picker still offers a place to start',
      top.home === homedir() && top.items.length > 0 && top.items.every((it) => it.name && it.path),
      JSON.stringify(top.items.slice(0, 3)))
    check('on Windows that place is the drives',
      process.platform !== 'win32' || top.items.every((it) => /^[A-Z]:\\$/.test(it.path)),
      JSON.stringify(top.items.map((it) => it.path)))
  } finally {
    if (savedEnv.root === undefined) delete process.env.DSH_NOVEL_ROOT
    else process.env.DSH_NOVEL_ROOT = savedEnv.root
    if (savedEnv.cfg === undefined) delete process.env.DSH_NOVEL_CONFIG
    else process.env.DSH_NOVEL_CONFIG = savedEnv.cfg
    await rm(cfgDir, { recursive: true, force: true })
  }
} finally {
  await rm(root, { recursive: true, force: true })
  console.log(log.join('\n'))
  console.log(`\n${log.filter((l) => l.startsWith('PASS')).length}/${log.length} passed`)
}
