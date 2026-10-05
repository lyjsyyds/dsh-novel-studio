// Standalone smoke test for the shared library (跨书共享库) — runs outside
// DSH against a throwaway root: promote into the store, link/fork back into
// another book, staleness/drift/pinning, impact scanning and versioned
// overwrites, with the shelf proving it never sees `.novel-shared` as a book.
import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lib = await import(new URL('../lib/library.js', import.meta.url).href)
const sh = await import(new URL('../lib/shared.js', import.meta.url).href)

const root = await mkdtemp(join(tmpdir(), 'novel-shared-smoke-'))
const log = []
const check = (name, ok, extra = '') => {
  log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) process.exitCode = 1
}
const boom = (fn) => fn.then(() => null, (e) => e)

try {
  // ── catalog ───────────────────────────────────────────────────────────
  const units = sh.unitCatalog()
  const keys = units.map((u) => u.key)
  check('catalog has characters', keys.includes('characters'))
  check('catalog has materials', keys.includes('materials'))
  check('catalog drops drafts', !keys.includes('drafts'))
  check('catalog drops chapters', !keys.includes('chapters'))
  const loc = units.find((u) => u.key === 'locations')
  check('group unit route is world/locations', loc && loc.route === 'world/locations', loc && loc.route)
  check('SHARED_DIR is dot-prefixed', sh.SHARED_DIR === '.novel-shared')

  // ── fixtures: two books ───────────────────────────────────────────────
  const a = await lib.createBook(root, { title: '甲书' })
  const b = await lib.createBook(root, { title: '乙书' })
  await lib.atomicWrite(join(root, a.id, 'characters', 'hero.yaml'), 'name: 主角\n职业: 拾荒\n')
  await lib.atomicWrite(join(root, a.id, 'characters', 'side.yaml'), 'name: 配角\n')
  await lib.atomicWrite(join(root, a.id, 'materials', 'clip.txt'), '雨夜的港口，霓虹倒影。')
  await lib.atomicWrite(join(root, a.id, 'materials', 'pack', 'raw.txt'), 'nope')

  // ── browse on an empty store ──────────────────────────────────────────
  const empty = await sh.listShared(root)
  check('empty store lists nothing', empty.entries.length === 0, `n=${empty.entries.length}`)

  // ── promote (本书 → 共享库) ───────────────────────────────────────────
  const p1 = await sh.promote(root, a.dir, a.id, 'characters', 'hero', 'stable')
  check('promote returns key', p1.key === 'characters/hero', p1.key)
  check('promote has no backup on first write', p1.backup === null)
  check('promote store dir created', !!(await stat(join(root, '.novel-shared', 'shared.yaml')).catch(() => null)))
  const shelf = await lib.listBooks(root)
  check('shelf still shows only the two books', shelf.length === 2, `n=${shelf.length}`)
  check('store is not a book on the shelf', !shelf.some((x) => x.id === '.novel-shared'))

  const listed = await sh.listShared(root)
  const hero = listed.entries.find((e) => e.key === 'characters/hero')
  check('listShared finds the promoted entry', !!hero)
  check('entry is stable', hero && hero.status === 'stable')
  check('entry title from name field', hero && hero.title === '主角', hero && hero.title)
  check('entry records its origin book', hero && hero.origin?.book === a.id)
  check('entry carries a rev', /^[0-9a-f]{40}$/.test(hero?.rev || ''))

  // promote a plain file unit too
  const pf = await sh.promote(root, a.dir, a.id, 'materials', 'clip.txt', 'stable')
  check('promote a materials file', pf.key === 'materials/clip.txt', pf.key)
  const subErr = await boom(sh.promote(root, a.dir, a.id, 'materials', 'pack/raw.txt', 'stable'))
  check('subdirectory file refused', subErr && subErr.status === 400, subErr && subErr.message)
  const gone = await boom(sh.promote(root, a.dir, a.id, 'characters', 'nobody', 'stable'))
  check('promote of a missing record is 404', gone && gone.status === 404, gone && gone.message)

  // ── 引入 link (共享库 → 本书) ─────────────────────────────────────────
  const i1 = await sh.importToBook(root, b.dir, 'characters', 'hero', 'link')
  check('link import returns mode', i1.key === 'characters/hero' && i1.mode === 'link')
  const bHero = await lib.readYamlFile(join(root, b.id, 'characters', 'hero.yaml'), {})
  check('link copies the record into the book', bHero && bHero.name === '主角')
  const again = await boom(sh.importToBook(root, b.dir, 'characters', 'hero', 'link'))
  check('re-import refused (target exists)', again && again.status === 409 && again.code === 'shared-target-exists', again && again.message)

  let links = (await sh.bookLinks(root, b.dir)).links
  const link1 = links.find((l) => l.key === 'characters/hero')
  check('bookLinks shows the link', link1 && link1.mode === 'link' && !link1.orphan)
  check('fresh link is not stale', link1 && !link1.stale)
  check('fresh link has no drift', link1 && !link1.drift)
  check('link is not pinned by default', link1 && !link1.pin)

  // ── 派生 fork, even from a draft ──────────────────────────────────────
  await sh.promote(root, a.dir, a.id, 'characters', 'side', 'draft')
  const draftLink = await boom(sh.importToBook(root, b.dir, 'characters', 'side', 'link'))
  check('link from a draft is refused', draftLink && draftLink.status === 409 && draftLink.code === 'shared-not-stable', draftLink && draftLink.message)
  const i2 = await sh.importToBook(root, b.dir, 'characters', 'side', 'fork')
  check('fork from a draft is allowed', i2.mode === 'fork')
  links = (await sh.bookLinks(root, b.dir)).links
  const fork1 = links.find((l) => l.key === 'characters/side')
  check('fork shows draft status', fork1 && fork1.status === 'draft')
  const forkSync = await boom(sh.sync(root, b.dir, 'characters', 'side'))
  check('fork refuses to sync', forkSync && forkSync.status === 409 && forkSync.code === 'shared-fork', forkSync && forkSync.message)

  // ── staleness: the source moves on, sync pulls it ─────────────────────
  await lib.atomicWrite(join(root, '.novel-shared', 'characters', 'hero.yaml'), 'name: 主角·修订\n职业: 拾荒\n')
  links = (await sh.bookLinks(root, b.dir)).links
  const stale1 = links.find((l) => l.key === 'characters/hero')
  check('source edit marks the link stale', stale1 && stale1.stale)
  const badSync = await boom(sh.sync(root, b.dir, 'characters', 'nobody'))
  check('sync of an unknown link is 404', badSync && badSync.status === 404)
  await sh.sync(root, b.dir, 'characters', 'hero')
  links = (await sh.bookLinks(root, b.dir)).links
  const after = links.find((l) => l.key === 'characters/hero')
  check('sync clears staleness', after && !after.stale)
  const bHero2 = await lib.readYamlFile(join(root, b.id, 'characters', 'hero.yaml'), {})
  check('sync pulled the revision into the book', bHero2 && bHero2.name === '主角·修订', JSON.stringify(bHero2))

  // ── drift: a local edit is kept, not silently overwritten ─────────────
  await lib.atomicWrite(join(root, b.id, 'characters', 'hero.yaml'), 'name: 主角·本地改\n')
  links = (await sh.bookLinks(root, b.dir)).links
  const drifted = links.find((l) => l.key === 'characters/hero')
  check('local edit marks drift', drifted && drifted.drift)

  // ── pin: a locked link stops accepting updates ────────────────────────
  await sh.setPin(b.dir, 'characters', 'hero', true)
  await sh.promote(root, a.dir, a.id, 'characters', 'hero', 'stable')
  await lib.atomicWrite(join(root, '.novel-shared', 'characters', 'hero.yaml'), 'name: 主角·新修订\n')
  const pinnedSync = await boom(sh.sync(root, b.dir, 'characters', 'hero'))
  check('pinned link refuses sync', pinnedSync && pinnedSync.status === 409 && pinnedSync.code === 'shared-pinned', pinnedSync && pinnedSync.message)
  const pinnedLinks = (await sh.bookLinks(root, b.dir)).links
  check('pinned link still reports stale', pinnedLinks.find((l) => l.key === 'characters/hero')?.stale)
  await sh.setPin(b.dir, 'characters', 'hero', false)
  await sh.sync(root, b.dir, 'characters', 'hero')
  const unpinned = (await sh.bookLinks(root, b.dir)).links.find((l) => l.key === 'characters/hero')
  check('after unlock sync clears stale', unpinned && !unpinned.stale)

  // ── versioned overwrite (保留版本) ────────────────────────────────────
  const p2 = await sh.promote(root, a.dir, a.id, 'characters', 'hero', 'stable')
  check('re-promote reports a backup', !!p2.backup, p2.backup)
  const versions = await readdir(join(root, '.novel-shared', '.versions', 'characters', 'hero')).catch(() => [])
  check('backup file kept under .versions', versions.length >= 1, versions.join(','))
  const heroAfter = (await sh.listShared(root)).entries.find((e) => e.key === 'characters/hero')
  check('origin survives an overwrite', heroAfter?.origin?.book === a.id)

  // ── 影响范围 impact ───────────────────────────────────────────────────
  const imp = await sh.impact(root, 'characters/hero')
  check('impact lists this book', imp.books.some((x) => x.id === b.id))
  check('impact reports the mode', imp.books.find((x) => x.id === b.id)?.mode === 'link')
  const impFork = await sh.impact(root, 'characters/side')
  check('impact counts forks too', impFork.books.find((x) => x.id === b.id)?.mode === 'fork')
  const impNone = await sh.impact(root, 'characters/nobody')
  check('impact empty for unreferenced key', impNone.books.length === 0)
  const impBad = await boom(sh.impact(root, 'nokey'))
  check('malformed key rejected', impBad && impBad.status === 400, impBad && impBad.message)

  // ── guards ────────────────────────────────────────────────────────────
  const badMode = await boom(sh.importToBook(root, b.dir, 'characters', 'hero', 'copy'))
  check('unknown import mode is 400', badMode && badMode.status === 400, badMode && badMode.message)
  const badUnit = await boom(sh.promote(root, a.dir, a.id, 'chapters', 'x', 'stable'))
  check('unknown unit refused', badUnit && badUnit.status === 404 && badUnit.code === 'shared-unit-unknown', badUnit && badUnit.message)
  const missingUnit = await boom(sh.importToBook(root, b.dir, 'characters', 'ghost', 'fork'))
  check('import of a missing shared entry is 404', missingUnit && missingUnit.status === 404 && missingUnit.code === 'shared-source-missing', missingUnit && missingUnit.message)
  const dotId = await boom(sh.promote(root, a.dir, a.id, 'characters', '.hidden', 'stable'))
  check('dot-prefixed ids refused', dotId && dotId.status === 400)
  const noPin = await boom(sh.setPin(b.dir, 'characters', 'ghost', true))
  check('pin of an unknown link is 404', noPin && noPin.status === 404)

  // ── ② 书系层 (series scope) ─────────────────────────────────────────────
  const s1 = await sh.createSeries(root, '蓝月宇宙')
  check('create series returns a sid', !!s1.sid && !s1.existed, s1.sid)
  const s1again = await sh.createSeries(root, '蓝月宇宙')
  check('same series name twice is idempotent', s1again.existed && s1again.sid === s1.sid)
  const badScope = await boom(sh.promote(root, a.dir, a.id, 'characters', 'hero', 'stable', 'ghost-series'))
  check('promote into an unknown series is 404', badScope && badScope.status === 404 && badScope.code === 'shared-series-unknown', badScope && badScope.message)

  await lib.atomicWrite(join(root, a.id, 'characters', 'star.yaml'), 'name: 星海\n职业: 导航员\n')
  const ps = await sh.promote(root, a.dir, a.id, 'characters', 'star', 'stable', s1.sid)
  check('promote with scope returns the scoped key', ps.key === `series:${s1.sid}:characters/star`, ps.key)
  check('scoped entry lands under series/<sid>/', !!(await stat(join(root, '.novel-shared', 'series', s1.sid, 'characters', 'star.yaml')).catch(() => null)))
  const slisted = await sh.listShared(root)
  const starS = slisted.entries.find((e) => e.key === `series:${s1.sid}:characters/star`)
  check('scoped entry lists scope + series name', starS && starS.scope === s1.sid && starS.series === '蓝月宇宙', starS && JSON.stringify({ scope: starS.scope, series: starS.series }))
  check('global entries keep plain keys', slisted.entries.some((e) => e.key === 'characters/hero' && !e.scope))
  check('series registry comes back', Object.values(slisted.series).some((x) => x.name === '蓝月宇宙'))
  const slist = await sh.listSeries(root)
  check('listSeries includes the created series', slist.series.some((x) => x.sid === s1.sid && x.name === '蓝月宇宙'))
  await sh.createSeries(root, '测试-')
  const conflict = await boom(sh.createSeries(root, '测试:'))
  check('sid collision under another name is 409', conflict && conflict.status === 409 && conflict.code === 'shared-series-conflict', conflict && conflict.message)

  const si = await sh.importToBook(root, b.dir, 'characters', 'star', 'link', s1.sid)
  check('import from a series scope', si.scope === s1.sid, JSON.stringify(si))
  let bLinks = (await sh.bookLinks(root, b.dir)).links
  const starLink = bLinks.find((l) => l.key === 'characters/star')
  check('scoped link carries scope + series name', starLink && starLink.scope === s1.sid && starLink.series === '蓝月宇宙', starLink && JSON.stringify({ scope: starLink.scope, series: starLink.series }))
  const impScoped = await sh.impact(root, `series:${s1.sid}:characters/star`)
  check('scoped impact lists the referencing book', impScoped.books.some((x) => x.id === b.id))
  check('impact reports its scope', impScoped.scope === s1.sid)
  const impGlobalStar = await sh.impact(root, 'characters/star')
  check('plain impact misses the scoped reference', !impGlobalStar.books.some((x) => x.id === b.id))

  // ── ④ 覆盖 Override (字段例外) ─────────────────────────────────────────
  const ovFiles = await boom(sh.setOverrides(b.dir, 'materials', 'clip.txt', ['x']))
  check('field exceptions refuse file units', ovFiles && ovFiles.status === 400 && ovFiles.code === 'shared-override-files', ovFiles && ovFiles.message)
  const ovFork = await boom(sh.setOverrides(b.dir, 'characters', 'side', ['name']))
  check('field exceptions refuse forks', ovFork && ovFork.status === 409 && ovFork.code === 'shared-fork', ovFork && ovFork.message)
  const ovNoLink = await boom(sh.setOverrides(b.dir, 'characters', 'nobody', ['name']))
  check('field exceptions without a link are 404', ovNoLink && ovNoLink.status === 404, ovNoLink && ovNoLink.message)
  await sh.setOverrides(b.dir, 'characters', 'star', ['职业'])
  bLinks = (await sh.bookLinks(root, b.dir)).links
  const starOv = bLinks.find((l) => l.key === 'characters/star')
  check('overrides recorded on the link', starOv && JSON.stringify(starOv.overrides) === JSON.stringify(['职业']), starOv && JSON.stringify(starOv.overrides))

  // source evolves, re-promote, sync: the excepted field stays local
  await lib.atomicWrite(join(root, a.id, 'characters', 'star.yaml'), 'name: 星海·改\n职业: 舵手\n')
  await sh.promote(root, a.dir, a.id, 'characters', 'star', 'stable', s1.sid)
  const staleStar = (await sh.bookLinks(root, b.dir)).links.find((l) => l.key === 'characters/star')
  check('scoped source edit marks the link stale', staleStar && staleStar.stale)
  await sh.sync(root, b.dir, 'characters', 'star')
  const starFile = await lib.readYamlFile(join(root, b.id, 'characters', 'star.yaml'), {})
  check('excepted field stays local after sync', starFile['职业'] === '导航员', JSON.stringify(starFile))
  check('other fields follow the source on sync', starFile.name === '星海·改', JSON.stringify(starFile))
  const starFresh = (await sh.bookLinks(root, b.dir)).links.find((l) => l.key === 'characters/star')
  check('sync clears staleness with exceptions kept', starFresh && !starFresh.stale && starFresh.overrides?.includes('职业'))

  // ── ⑤ 模板 (题材模板 → 从模板建书) ─────────────────────────────────────
  const tplErr = await boom(sh.saveTemplate(root, '空模板', []))
  check('template without items is 400', tplErr && tplErr.status === 400, tplErr && tplErr.message)
  const tplErr2 = await boom(sh.saveTemplate(root, '坏条目', ['characters/ghost']))
  check('template with an unknown entry is 404', tplErr2 && tplErr2.status === 404 && tplErr2.code === 'shared-source-missing', tplErr2 && tplErr2.message)
  const tpl = await sh.saveTemplate(root, '星际流亡开局', ['characters/hero', `series:${s1.sid}:characters/star`])
  check('template saved with a tid', !!tpl.tid && tpl.items.length === 2, tpl.tid)
  const tplList = await sh.listTemplates(root)
  const t1 = tplList.templates.find((x) => x.tid === tpl.tid)
  check('template lists with resolved titles', t1 && t1.items.every((i) => i.title && !i.missing), JSON.stringify(t1 && t1.items.map((i) => i.title)))
  check('template keeps scoped keys readable', t1 && t1.items.some((i) => i.scope === s1.sid))
  const newBook = await sh.bookFromTemplate(root, '流亡第一季', tpl.tid)
  check('from-template creates a book with both entries', newBook.book && newBook.imported.length === 2 && !newBook.skipped.length, JSON.stringify(newBook))
  const nb = (await lib.listBooks(root)).find((x) => x.id === newBook.book.id)
  check('the template book is on the shelf', !!nb)
  const nbLinks = (await sh.bookLinks(root, nb.dir)).links
  check('template entries linked into the new book', nbLinks.some((l) => l.key === 'characters/hero') && nbLinks.some((l) => l.key === 'characters/star' && l.scope === s1.sid), JSON.stringify(nbLinks.map((l) => `${l.key}:${l.scope || ''}`)))
  const nbFile = await lib.readYamlFile(join(root, nb.id, 'characters', 'hero.yaml'), {})
  check('linked entry content copied in', !!nbFile.name, JSON.stringify(nbFile))

  await lib.atomicWrite(join(root, a.id, 'characters', 'drafty.yaml'), 'name: 草稿人\n')
  await sh.promote(root, a.dir, a.id, 'characters', 'drafty', 'draft')
  const tpl2 = await sh.saveTemplate(root, '含草稿模板', ['characters/drafty'])
  const nb2 = await sh.bookFromTemplate(root, '草稿开本', tpl2.tid)
  const nb2Links = (await sh.bookLinks(root, join(root, nb2.book.id))).links
  check('a draft template entry becomes a fork', nb2Links.find((l) => l.key === 'characters/drafty')?.mode === 'fork', JSON.stringify(nb2Links))
  const missingTpl = await boom(sh.bookFromTemplate(root, '无', 'no-such-tpl'))
  check('from-template with a missing template is 404', missingTpl && missingTpl.status === 404 && missingTpl.code === 'shared-template-missing', missingTpl && missingTpl.message)
  const del = await sh.deleteTemplate(root, tpl.tid)
  check('delete template returns the tid', del.tid === tpl.tid)
  const delAgain = await boom(sh.deleteTemplate(root, tpl.tid))
  check('deleting a template twice is 404', delAgain && delAgain.status === 404 && delAgain.code === 'shared-template-missing')
  check('shelf grew by exactly the two template books', (await lib.listBooks(root)).length === 4, `n=${(await lib.listBooks(root)).length}`)

  // ── ① 跨书伏笔 (cross-book foreshadowing) ──────────────────────────────
  const fosEmpty = await sh.crossForeshadowing(root)
  check('foreshadowing skips books without items', !fosEmpty.groups.some((g) => g.book === a.id), JSON.stringify(fosEmpty.groups.map((g) => g.book)))
  await lib.atomicWrite(join(root, b.id, 'outline', 'foreshadowing.yaml'), 'items:\n  - title: 神秘吊坠\n    planted: 第1章\n    payoff: 第3卷\n    status: 未回收\n')
  const fos = await sh.crossForeshadowing(root)
  const fb = fos.groups.find((g) => g.book === b.id)
  check('cross-book foreshadowing groups by book', !!fb, JSON.stringify(fos.groups.map((g) => g.book)))
  check('foreshadow item keeps its fields', fb && fb.items[0]?.title === '神秘吊坠' && fb.items[0]?.planted === '第1章' && fb.items[0]?.payoff === '第3卷' && fb.items[0]?.status === '未回收', JSON.stringify(fb && fb.items))

  // ── the store survives listing the shelf clean ────────────────────────
  check('listBooks never returns dot dirs', (await lib.listBooks(root)).every((x) => !x.id.startsWith('.')))
} finally {
  console.log(log.join('\n'))
  const pass = log.filter((l) => l.startsWith('PASS')).length
  const fail = log.filter((l) => l.startsWith('FAIL')).length
  console.log(`\nshared: ${pass} passed${fail ? `, ${fail} FAILED` : ''} (${log.length} checks)`)
  const { rm } = await import('node:fs/promises')
  await rm(root, { recursive: true, force: true })
}
