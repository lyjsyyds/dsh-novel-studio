// End-to-end test against a RUNNING DSH: exercises the real HTTP routes and the
// host half's edit-without-restart behaviour. Requires the plugin to be loaded.
//
//   node tests/http.e2e.mjs
//
// Override the base URL with DSH_BASE if the GUI is not on the default port.
// Every book it creates is deleted again, so the user's library is untouched.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const BASE = process.env.DSH_BASE || 'http://127.0.0.1:19387'
const API = `${BASE}/novel-studio/api`

const log = []
let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed += 1
  log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

async function req(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, data, type: res.headers.get('content-type') || '' }
}

const stamp = Date.now().toString(36)
const title = `e2e-${stamp}`
let id = ''
let created = false
let origSites = null // the writer's real website list, restored in the finally
let id2 = '' // a second book, only for the shared-library link flow
let created2 = false
let sharedRoot = '' // the library root, so the finally can tidy the store
let sharedExisted = false // whether the store was already there before this run
let shId = '' // e2e record promoted into the store
let shId2 = '' // e2e draft record, for the fork flow
let shId3 = '' // e2e record promoted into a series layer
let sid = '' // the series id this run created
let tid = '' // the template id this run created
let id3 = '' // a third book, grown from the template
let created3 = false

try {
  // ── carrier ─────────────────────────────────────────────────────────────
  const ping = await req('GET', '/ping')
  check('GET /ping 200', ping.status === 200, `status=${ping.status}`)
  check('GET /ping reports stage 9', ping.data?.stage === 9, `stage=${ping.data?.stage}`)

  const boot = await req('GET', '/bootstrap')
  check('GET /bootstrap 200', boot.status === 200)
  check('bootstrap lists 8 sections', Array.isArray(boot.data?.sections) && boot.data.sections.length === 8)

  check('unknown route 404', (await req('GET', '/nope')).status === 404)
  check('over-deep library path 404', (await req('GET', '/library/x/y')).status === 404)
  check('method not allowed 405', (await req('PUT', '/library')).status === 405)

  // ── schema ──────────────────────────────────────────────────────────────
  const schema = await req('GET', '/schema')
  check('GET /schema 200', schema.status === 200, `status=${schema.status}`)
  const secs = schema.data?.sections || []
  check('schema has 8 sections', secs.length === 8, `n=${secs.length}`)
  check('schema order starts at overview', secs[0]?.key === 'overview')
  check('characters is kind=records', secs.find((s) => s.key === 'characters')?.kind === 'records')
  check('world is kind=groups', secs.find((s) => s.key === 'world')?.kind === 'groups')
  check('world declares groups', (secs.find((s) => s.key === 'world')?.groups || []).length >= 9)
  check('schema reports extensions', Array.isArray(schema.data?.extensions))

  // ── validation ──────────────────────────────────────────────────────────
  check('POST /library without title 400', (await req('POST', '/library', { author: 'x' })).status === 400)
  check('POST /library blank title 400', (await req('POST', '/library', { title: '   ' })).status === 400)

  const made = await req('POST', '/library', { title, author: 'e2e', genre: 'test', logline: 'temp' })
  id = made.data?.book?.id || ''
  created = made.status === 201
  check('POST /library 201', created, `status=${made.status}`)
  check('created book has id', !!id, `id=${id}`)
  check('created book echoes author', made.data?.book?.author === 'e2e')

  const enc = encodeURIComponent(id)

  // ── read back ───────────────────────────────────────────────────────────
  const shelf = await req('GET', '/library')
  check('GET /library 200', shelf.status === 200)
  check('shelf contains the new book', (shelf.data?.books || []).some((b) => b.id === id))

  const detail = await req('GET', `/library/${enc}`)
  check('GET /library/<id> 200', detail.status === 200, `status=${detail.status}`)
  check('detail carries counts', !!detail.data?.counts, JSON.stringify(detail.data?.counts))
  check('fresh book has zero characters', detail.data?.counts?.characters === 0)
  check('detail exposes a dir', typeof detail.data?.book?.dir === 'string')

  // ── unit routes: records ────────────────────────────────────────────────
  const empty = await req('GET', `/library/${enc}/unit/characters`)
  check('GET records unit 200', empty.status === 200, `status=${empty.status}`)
  check('records unit reports kind', empty.data?.kind === 'records')
  check('records unit serves declared fields', (empty.data?.fields || []).some((f) => f.k === 'habits'))
  check('records unit starts empty', (empty.data?.items || []).length === 0)

  const wrote = await req('POST', `/library/${enc}/unit/characters`, { name: '林望', role: '主角', habits: '咬笔帽' })
  check('POST records unit 201', wrote.status === 201, `status=${wrote.status}`)
  check('records unit slugified the id', wrote.data?.id === '林望', `id=${wrote.data?.id}`)

  const listed = await req('GET', `/library/${enc}/unit/characters`)
  check('records unit now lists one', (listed.data?.items || []).length === 1)
  const entry = encodeURIComponent('林望')
  const one = await req('GET', `/library/${enc}/unit/characters/${entry}`)
  check('GET one record 200', one.status === 200, `status=${one.status}`)
  check('record body round-trips', one.data?.data?.habits === '咬笔帽')

  const put = await req('PUT', `/library/${enc}/unit/characters/${entry}`, { name: '林望', age: '27' })
  check('PUT record 200', put.status === 200, `status=${put.status}`)
  const reread = await req('GET', `/library/${enc}/unit/characters/${entry}`)
  check('PUT merged rather than replaced', reread.data?.data?.habits === '咬笔帽' && reread.data?.data?.age === '27')

  // ── unit routes: doc (grouped) ──────────────────────────────────────────
  const rules = await req('GET', `/library/${enc}/unit/world/rules`)
  check('GET doc unit 200', rules.status === 200, `status=${rules.status}`)
  check('doc unit reports kind', rules.data?.kind === 'doc')
  check('doc unit reports its file', rules.data?.path === 'world/rules.yaml')

  const rule1 = await req('POST', `/library/${enc}/unit/world/rules`, { title: '灵气守恒' })
  check('POST doc unit 201', rule1.status === 201, `status=${rule1.status}`)
  const rule2 = await req('POST', `/library/${enc}/unit/world/rules`, { title: '越阶反噬' })
  check('doc entries are indexed', rule2.data?.id === 1, `id=${rule2.data?.id}`)

  const rulesList = await req('GET', `/library/${enc}/unit/world/rules`)
  check('doc lists both entries', (rulesList.data?.items || []).length === 2)
  const docDel = await req('DELETE', `/library/${enc}/unit/world/rules/1`)
  check('DELETE doc entry 200', docDel.status === 200, `status=${docDel.status}`)
  check('doc back to one entry', ((await req('GET', `/library/${enc}/unit/world/rules`)).data?.items || []).length === 1)

  // ── unit routes: chapters ───────────────────────────────────────────────
  const chapter = await req('POST', `/library/${enc}/unit/chapters`, { title: '第一章', body: '夜里，船离港了。' })
  check('POST chapter 201', chapter.status === 201, `status=${chapter.status}`)
  const chapterGet = await req('GET', `/library/${enc}/unit/chapters/${encodeURIComponent(chapter.data?.id || '')}`)
  check('chapter body round-trips', chapterGet.data?.data?.body === '夜里，船离港了。')

  // ── unit guards ─────────────────────────────────────────────────────────
  check('unknown section 404', (await req('GET', `/library/${enc}/unit/nope`)).status === 404)
  check('unknown group 404', (await req('GET', `/library/${enc}/unit/world/nope`)).status === 404)
  check('unknown entry 404', (await req('GET', `/library/${enc}/unit/characters/nobody-here`)).status === 404)
  check('traversing entry id rejected', (await req('GET', `/library/${enc}/unit/characters/..%2F..%2Fetc`)).status === 400)
  check('unsupported unit method 405', (await req('PATCH', `/library/${enc}/unit/characters`)).status === 405)
  check('unregistered /ext route 404', (await req('GET', '/ext/ghost/thing')).status === 404)

  // ── graph routes ────────────────────────────────────────────────────────
  const kindsRes = await req('GET', `/library/${enc}/graph/kinds`)
  check('GET graph/kinds 200', kindsRes.status === 200, `status=${kindsRes.status}`)
  check('four built-in graph kinds over HTTP', (kindsRes.data?.kinds || []).length === 4, kindsRes.data?.kinds)

  const graph = await req('GET', `/library/${enc}/graph`)
  check('GET graph 200', graph.status === 200, `status=${graph.status}`)
  check('graph contains the character', (graph.data?.nodes || []).some((n) => n.id === '林望'), graph.data?.nodes)
  check('graph echoes the book id', graph.data?.book === id)

  const filtered = await req('GET', `/library/${enc}/graph?kinds=characters`)
  check('graph kind filter accepted', filtered.status === 200, `status=${filtered.status}`)

  const badKind = await req('GET', `/library/${enc}/graph?kinds=nope`)
  check('unknown graph kind 400', badKind.status === 400, `status=${badKind.status}`)
  check('unknown kind names the culprit', (badKind.data?.unknown || []).includes('nope'), badKind.data?.unknown)
  check('graph rejects POST 405', (await req('POST', `/library/${enc}/graph`)).status === 405)

  // ── edge writes (the graph writes back) ─────────────────────────────────
  const peer = await req('POST', `/library/${enc}/unit/characters`, { name: '老周', role: '配角' })
  check('second character created for linking', peer.status === 201, `status=${peer.status}`)

  const linked = await req('POST', `/library/${enc}/graph/edges`, { action: 'create', from: '林望', to: '老周', type: '师徒', strength: 4 })
  check('POST graph/edges create 201', linked.status === 201, `status=${linked.status}`)
  check('edge write reports create', linked.data?.action === 'create', linked.data)
  check('edge write echoes the book', linked.data?.book === id, linked.data?.book)
  check('edge write names its file', linked.data?.file === 'relationships.yaml', linked.data?.file)

  const afterLink = await req('GET', `/library/${enc}/graph`)
  check('graph picked up the manual edge', (afterLink.data?.stats?.manual ?? 0) === 1, afterLink.data?.stats)

  const relink = await req('POST', `/library/${enc}/graph/edges`, {
    action: 'update', from: '林望', to: '老周', type: '师徒', source: 'manual', patch: { type: '忘年交' },
  })
  check('POST graph/edges update 200', relink.status === 200, `status=${relink.status}`)
  check('edge update reports update', relink.data?.action === 'update', relink.data)

  const dup = await req('POST', `/library/${enc}/graph/edges`, { action: 'create', from: '林望', to: '老周', type: '忘年交' })
  check('duplicate edge 400', dup.status === 400, `status=${dup.status}`)
  check('duplicate edge reports its code', dup.data?.code === 'duplicate-edge', dup.data)

  const ghost = await req('POST', `/library/${enc}/graph/edges`, { action: 'create', from: '林望', to: '幽灵' })
  check('linking an unknown node 400', ghost.status === 400, `status=${ghost.status}`)
  check('unknown node reports its code', ghost.data?.code === 'unknown-node', ghost.data)

  const noAction = await req('POST', `/library/${enc}/graph/edges`, { action: 'nope' })
  check('unknown edge action 400', noAction.status === 400, `status=${noAction.status}`)

  const unlink = await req('POST', `/library/${enc}/graph/edges`, { action: 'delete', from: '林望', to: '老周', type: '忘年交', source: 'manual' })
  check('POST graph/edges delete 200', unlink.status === 200, `status=${unlink.status}`)
  check('edge delete reports delete', unlink.data?.action === 'delete', unlink.data)
  const afterUnlink = await req('GET', `/library/${enc}/graph`)
  check('manual edges are gone again', (afterUnlink.data?.stats?.manual ?? 1) === 0, afterUnlink.data?.stats)

  check('graph/edges rejects GET 405', (await req('GET', `/library/${enc}/graph/edges`)).status === 405)

  // ── validate routes ─────────────────────────────────────────────────────
  const ruleCat = await req('GET', `/library/${enc}/validate/rules`)
  check('GET validate/rules 200', ruleCat.status === 200, `status=${ruleCat.status}`)
  check('20 built-in rules over HTTP', (ruleCat.data?.rules || []).length === 20, (ruleCat.data?.rules || []).length)

  const report = await req('GET', `/library/${enc}/validate`)
  check('GET validate 200', report.status === 200, `status=${report.status}`)
  check('validate returns counts', typeof report.data?.counts?.error === 'number', report.data?.counts)
  check('validate scanned the character', (report.data?.scanned?.nodes ?? 0) >= 1, report.data?.scanned)
  check('validate rejects POST 405', (await req('POST', `/library/${enc}/validate`)).status === 405)

  // ── export routes ───────────────────────────────────────────────────────
  const formats = await req('GET', `/library/${enc}/export/formats`)
  check('GET export/formats 200', formats.status === 200, `status=${formats.status}`)
  check('four built-in formats over HTTP', (formats.data?.formats || []).length === 4, formats.data?.formats)

  const md = await req('GET', `/library/${enc}/export?format=md`)
  check('GET export 200', md.status === 200, `status=${md.status}`)
  check('export returns the manuscript', String(md.data?.text || '').startsWith('---\n'), (md.data?.text || '').slice(0, 20))
  check('export carries the prose', String(md.data?.text || '').includes('夜里，船离港了。'), null)
  check('export suggests a file name', String(md.data?.filename || '').endsWith('.md'), md.data?.filename)
  check('export counts chapters and words', (md.data?.chapters ?? 0) >= 1 && (md.data?.words ?? 0) > 0, { c: md.data?.chapters, w: md.data?.words })

  const html = await req('GET', `/library/${enc}/export?format=html`)
  check('export?format=html 200', html.status === 200, `status=${html.status}`)
  check('html export is a document', String(html.data?.text || '').startsWith('<!doctype html>'), null)

  const badFormat = await req('GET', `/library/${enc}/export?format=epub`)
  check('unknown export format 400', badFormat.status === 400, `status=${badFormat.status}`)
  check('unknown export format says why', /unknown export format/.test(String(badFormat.data?.error || '')), badFormat.data)
  check('export rejects POST 405', (await req('POST', `/library/${enc}/export`)).status === 405)

  // ── publish routes ──────────────────────────────────────────────────────
  const emptyPublish = await req('GET', `/library/${enc}/publish`)
  check('GET publish 200', emptyPublish.status === 200, `status=${emptyPublish.status}`)
  check('publish starts empty', (emptyPublish.data?.artifacts || []).length === 0, emptyPublish.data?.artifacts)

  const pubWrote = await req('POST', `/library/${enc}/publish`, { format: 'md' })
  check('POST publish 201', pubWrote.status === 201, `status=${pubWrote.status}`)
  check('publish wrote an artifact', typeof pubWrote.data?.artifact?.file === 'string', pubWrote.data?.artifact)
  const artifactName = pubWrote.data?.artifact?.file

  const pubListed = await req('GET', `/library/${enc}/publish`)
  check('published artifact is listed', (pubListed.data?.artifacts || []).some((a) => a.file === artifactName), pubListed.data?.artifacts)

  const removed = await req('DELETE', `/library/${enc}/publish/${encodeURIComponent(artifactName || 'x')}`)
  check('DELETE publish/:name 200', removed.status === 200, `status=${removed.status}`)
  const afterRemove = await req('GET', `/library/${enc}/publish`)
  check('artifact is gone from the list', !(afterRemove.data?.artifacts || []).some((a) => a.file === artifactName), afterRemove.data?.artifacts)

  const manifestGuard = await req('DELETE', `/library/${enc}/publish/manifest.yaml`)
  check('manifest is protected', manifestGuard.status === 400, `status=${manifestGuard.status}`)
  check('publish rejects PUT 405', (await req('PUT', `/library/${enc}/publish`)).status === 405)

  // ── update ──────────────────────────────────────────────────────────────
  const patched = await req('PATCH', `/library/${enc}`, { genre: 'updated', id: 'hijacked' })
  check('PATCH 200', patched.status === 200, `status=${patched.status}`)
  check('PATCH applied', patched.data?.book?.genre === 'updated')
  check('PATCH cannot rename id', patched.data?.book?.id === id)

  // ── ai routes ───────────────────────────────────────────────────────────
  // The prompt side works with no model at all. The model side must answer
  // JSON for every bad request, because once an event stream is open a failure
  // can only be reported as a half-finished answer. (A real model call is
  // deliberately not made here: tests must not spend tokens or depend on a
  // provider — tests/ai.smoke.mjs drives the streaming path with a stub.)
  const aiTasks = await req('GET', `/library/${enc}/ai/tasks`)
  check('GET /ai/tasks 200', aiTasks.status === 200, `status=${aiTasks.status}`)
  check('the AI task menu has nine entries', (aiTasks.data?.tasks || []).length === 9, (aiTasks.data?.tasks || []).length)
  check('the AI task menu starts with continue', aiTasks.data?.tasks?.[0]?.key === 'continue', aiTasks.data?.tasks?.[0])
  check('the AI task menu offers the reader simulation',
    !!aiTasks.data?.tasks?.find((x) => x.key === 'reader'), (aiTasks.data?.tasks || []).map((x) => x.key))
  check('the AI task menu offers the board, the ripple and the teardown',
    ['board', 'ripple', 'teardown'].every((k) => !!aiTasks.data?.tasks?.find((x) => x.key === k)),
    (aiTasks.data?.tasks || []).map((x) => x.key))
  const teardownMeta = (aiTasks.data?.tasks || []).find((x) => x.key === 'teardown')
  check('the teardown asks for a pasted passage', teardownMeta?.needs === 'paste', teardownMeta)
  check('every AI task describes itself', (aiTasks.data?.tasks || []).every((x) => x.key && x.zh && x.hint))
  check('POST /ai/tasks 405', (await req('POST', `/library/${enc}/ai/tasks`)).status === 405)

  const aiCtx = await req('GET', `/library/${enc}/ai/context?task=continue`)
  check('GET /ai/context 200', aiCtx.status === 200, `status=${aiCtx.status}`)
  check('the context preview counts the book', typeof aiCtx.data?.context?.characters?.length === 'number', aiCtx.data?.context)
  check('the preview picks the chapter it would send', aiCtx.data?.context?.chapter?.id === chapter.data?.id, aiCtx.data?.context?.chapter)
  check('the preview carries no prose', aiCtx.data?.context?.chapter?.body === undefined)
  check('PUT /ai/context 405', (await req('PUT', `/library/${enc}/ai/context`)).status === 405)

  // The picker: the preview advertises what can be selected, and both routes
  // refuse a malformed selection as JSON — long before an event stream exists.
  const aiCatalog = aiCtx.data?.context?.catalog || []
  check('the preview carries the picker catalogue', Array.isArray(aiCatalog) && aiCatalog.some((p) => p.key === 'characters'), aiCatalog.map((p) => p.key))
  const charCat = aiCatalog.find((p) => p.key === 'characters')
  check(
    'a catalogue entry names what it is',
    (charCat?.items || []).length >= 1 && charCat.items.every((i) => typeof i.id === 'string' && typeof i.label === 'string' && typeof i.on === 'boolean'),
    charCat?.items,
  )

  const pickQuery = encodeURIComponent(JSON.stringify({ characters: ['nobody-here'] }))
  const narrowed = await req('GET', `/library/${enc}/ai/context?task=continue&pick=${pickQuery}`)
  check('GET /ai/context honours a pick', narrowed.status === 200 && (narrowed.data?.context?.characters || []).length === 0, narrowed.data?.context?.characters)

  const badPickQuery = await req('GET', `/library/${enc}/ai/context?pick=not-json`)
  check('a malformed pick query is 400', badPickQuery.status === 400, `status=${badPickQuery.status}`)
  check('a malformed pick query names its code', badPickQuery.data?.code === 'bad-pick', badPickQuery.data)

  const badTask = await req('POST', `/library/${enc}/ai`, { task: 'nope' })
  check('POST /ai refuses an unknown task', badTask.status === 400, `status=${badTask.status}`)
  check('POST /ai names the unknown task', badTask.data?.code === 'unknown-task', badTask.data)
  check('POST /ai answers JSON, not a stream', badTask.type.includes('json'), badTask.type)

  const noText = await req('POST', `/library/${enc}/ai`, { task: 'polish' })
  check('POST /ai refuses a missing argument', noText.status === 400, `status=${noText.status}`)
  check('POST /ai names the missing argument', noText.data?.code === 'missing-argument', noText.data)
  check('a refusal is never an event stream', !noText.type.includes('event-stream'), noText.type)

  const badPickBody = await req('POST', `/library/${enc}/ai`, { task: 'continue', pick: 'nope' })
  check('POST /ai refuses a malformed pick', badPickBody.status === 400, `status=${badPickBody.status}`)
  check('POST /ai names the bad pick', badPickBody.data?.code === 'bad-pick', badPickBody.data)
  check('a bad pick is still JSON, never a stream', badPickBody.type.includes('json'), badPickBody.type)

  // The thread from a previous round rides along; a malformed one is judged
  // before the stream opens, exactly like a bad pick.
  const badHistory = await req('POST', `/library/${enc}/ai`, { task: 'continue', history: [{ role: 'user' }] })
  check('POST /ai refuses a malformed history', badHistory.status === 400, `status=${badHistory.status}`)
  check('POST /ai names the bad history', badHistory.data?.code === 'bad-history', badHistory.data)
  check('a bad history is JSON, never a stream', badHistory.type.includes('json'), badHistory.type)

  const historyNotArray = await req('POST', `/library/${enc}/ai`, { task: 'continue', history: 'nope' })
  check('POST /ai refuses a non-array history', historyNotArray.status === 400 && historyNotArray.data?.code === 'bad-history', historyNotArray.data)

  check('GET /ai 405', (await req('GET', `/library/${enc}/ai`)).status === 405)

  // ── 读者模拟: the reports on disk, and the guards in front of a model call ─
  // No model is called here either: only the empty list, the refusals and the
  // delete path are exercised, so the suite stays free and offline-safe.
  const rdEmpty = await req('GET', `/library/${enc}/reader`)
  check('GET /reader 200', rdEmpty.status === 200 && Array.isArray(rdEmpty.data?.reports), rdEmpty.data)
  check('a book with no reports says so', (rdEmpty.data?.reports || []).length === 0 && (rdEmpty.data?.curve || []).length === 0, rdEmpty.data)
  const rdNoChapter = await req('POST', `/library/${enc}/reader`, {})
  check('POST /reader without a chapter 400', rdNoChapter.status === 400 && rdNoChapter.data?.code === 'bad-chapter', rdNoChapter.data)
  const rdMissing = await req('POST', '/library/no-such-book/reader', { chapter: '0001' })
  check('POST /library/:book/reader on a missing book 404', rdMissing.status === 404, `status=${rdMissing.status}`)
  const rdGone = await req('DELETE', `/library/${enc}/reader/0001-没有这一章`)
  check('DELETE a report that is not there 404', rdGone.status === 404 && rdGone.data?.code === 'reader-missing', rdGone.data)
  check('PUT /reader 405', (await req('PUT', `/library/${enc}/reader`)).status === 405)
  check('GET /reader of a missing book 404', (await req('GET', '/library/no-such-book/reader')).status === 404)

  // the two new rules are in the catalogue the panel lists
  const ruleCatalogue = await req('GET', `/library/${enc}/validate/rules`)
  check('GET /validate/rules 200', ruleCatalogue.status === 200 && Array.isArray(ruleCatalogue.data?.rules), `status=${ruleCatalogue.status}`)
  for (const id of ['foreshadowing-overdue', 'absent-character', 'secret-leak', 'info-boundary']) {
    check(`the rule catalogue lists ${id}`, (ruleCatalogue.data?.rules || []).some((r) => r.id === id))
  }

  // ── per-book model route ────────────────────────────────────────────────
  // Books carry their own model choice, independent of each other and of the
  // harness default. No model is called here — only the stored route is read,
  // saved and cleared. An empty catalogue (a host half older than the llm
  // bridge) must not stop a book from keeping its route.
  const modelEmpty = await req('GET', `/library/${enc}/model`)
  check('GET /model 200', modelEmpty.status === 200, `status=${modelEmpty.status}`)
  check('a fresh book has no model of its own', modelEmpty.data?.model === null, modelEmpty.data?.model)
  check('GET /model reports a catalogue shape', Array.isArray(modelEmpty.data?.catalog?.providers), modelEmpty.data?.catalog)
  check('DELETE /model 405', (await req('DELETE', `/library/${enc}/model`)).status === 405)

  const modelBad = await req('POST', `/library/${enc}/model`, { provider: 'only-provider' })
  check('POST /model refuses a half-filled route', modelBad.status === 400, `status=${modelBad.status}`)
  check('POST /model names the bad route', modelBad.data?.code === 'bad-model', modelBad.data)

  const modelSaved = await req('POST', `/library/${enc}/model`, { provider: 'e2e-provider', model: 'e2e-model' })
  check('POST /model 200', modelSaved.status === 200, `status=${modelSaved.status}`)
  check('POST /model echoes the saved route', modelSaved.data?.model?.provider === 'e2e-provider' && modelSaved.data?.model?.model === 'e2e-model', modelSaved.data?.model)

  const modelBack = await req('GET', `/library/${enc}/model`)
  check('the saved route is read back', modelBack.data?.model?.model === 'e2e-model', modelBack.data?.model)
  const detailWithModel = await req('GET', `/library/${enc}`)
  check('the route lives on the book record', detailWithModel.data?.book?.aiModel?.model === 'e2e-model', detailWithModel.data?.book?.aiModel)

  const modelCleared = await req('POST', `/library/${enc}/model`, { clear: true })
  check('clearing the route 200', modelCleared.status === 200, `status=${modelCleared.status}`)
  check('a cleared route reads as unset', modelCleared.data?.model === null, modelCleared.data?.model)
  check('clearing sticks', (await req('GET', `/library/${enc}/model`)).data?.model === null)

  // ── thinking strength ───────────────────────────────────────────────────
  // The menu comes from the deployment's own model registry, so an unknown
  // model has to degrade to "no menu" rather than to an error, and a real one
  // has to answer in the shape the panel renders.
  const noMenu = await req('GET', `/library/${enc}/efforts?provider=e2e-provider&model=e2e-model`)
  check('GET /efforts 200', noMenu.status === 200, `status=${noMenu.status}`)
  check('an undescribable model offers no menu', Array.isArray(noMenu.data?.efforts) && noMenu.data.efforts.length === 0, noMenu.data?.efforts)
  check('the menu names the route it read', noMenu.data?.provider === 'e2e-provider' && noMenu.data?.model === 'e2e-model', noMenu.data)

  const menu = await req('GET', `/library/${enc}/efforts`)
  check('GET /efforts without a query 200', menu.status === 200, `status=${menu.status}`)
  check('the menu is a list', Array.isArray(menu.data?.efforts), menu.data?.efforts)
  check(
    'each level carries an id and a name',
    (menu.data?.efforts || []).every((e) => typeof e?.id === 'string' && !!e.id && typeof e?.name === 'string'),
    menu.data?.efforts,
  )
  check('the menu names its default level', typeof menu.data?.defaultEffort === 'string', menu.data?.defaultEffort)
  check('POST /efforts 405', (await req('POST', `/library/${enc}/efforts`)).status === 405)
  check('an unknown efforts sub-path 404', (await req('GET', `/library/${enc}/efforts/x`)).status === 404)

  // An effort rides on the stored route, and omitting it again is how a book
  // goes back to whatever the model itself defaults to.
  const withEffort = await req('POST', `/library/${enc}/model`, {
    provider: 'e2e-provider',
    model: 'e2e-model',
    reasoningEffort: 'low',
  })
  check('POST /model keeps an effort', withEffort.data?.model?.reasoningEffort === 'low', withEffort.data?.model)
  const withoutEffort = await req('POST', `/library/${enc}/model`, { provider: 'e2e-provider', model: 'e2e-model' })
  check('omitting the effort drops it again', withoutEffort.data?.model?.reasoningEffort === undefined, withoutEffort.data?.model)
  await req('POST', `/library/${enc}/model`, { clear: true })
  check('the route is unset again', (await req('GET', `/library/${enc}/model`)).data?.model === null)

  // ── extract: reading a passage back into the regions ────────────────────
  check('GET /extract 405', (await req('GET', `/library/${enc}/extract`)).status === 405)

  const noPassage = await req('POST', `/library/${enc}/extract`, {})
  check('POST /extract without a passage 400', noPassage.status === 400, `status=${noPassage.status}`)
  check('POST /extract names the missing passage', noPassage.data?.code === 'missing-argument', noPassage.data)
  check('an unknown extract sub-path 404', (await req('POST', `/library/${enc}/extract/nope`, {})).status === 404)

  const noChapters = await req('POST', `/library/${enc}/extract`, { chapters: [] })
  check('POST /extract with an empty chapter list 400', noChapters.status === 400, `status=${noChapters.status}`)
  check('an empty chapter list names what is missing', noChapters.data?.code === 'missing-argument', noChapters.data)

  const blankChapters = await req('POST', `/library/${enc}/extract`, { chapters: [{ id: '第一章', passage: '   ' }] })
  check('a chapter list with no text is refused too', blankChapters.status === 400, `status=${blankChapters.status}`)
  // The refusal has to come from the chapter path: a single-passage call with the
  // same blank text is refused as well, so only the message tells them apart.
  check('that refusal is the chapter path speaking', JSON.stringify(blankChapters.data || {}).includes('选中的章节'), blankChapters.data)

  const badApply = await req('POST', `/library/${enc}/extract/apply`, { entries: 'nope' })
  check('POST /extract/apply refuses a non-list 400', badApply.status === 400, `status=${badApply.status}`)
  check('POST /extract/apply names the bad body', badApply.data?.code === 'bad-request', badApply.data)

  const filed = await req('POST', `/library/${enc}/extract/apply`, {
    entries: [
      { key: 'world/items', name: 'e2e-青玉佩', fields: { type: '法宝', description: '临时物件。' } },
      { key: 'characters', name: 'e2e-小满', fields: { role: '配角', habits: '数铜钱' } },
      { key: 'nowhere', name: 'e2e-虚无', fields: {} },
    ],
  })
  check('POST /extract/apply 200', filed.status === 200, `status=${filed.status}`)
  check('two regions are filed in one pass', (filed.data?.written || []).length === 2, filed.data)
  check('an unknown region is skipped', (filed.data?.skipped || []).some((s) => s.reason === 'unknown-target'), filed.data?.skipped)

  const itemsBack = (await req('GET', `/library/${enc}/unit/world/items`)).data?.items || []
  const filedItem = itemsBack.find((row) => row.name === 'e2e-青玉佩')
  check('the filed item is on disk', !!filedItem, itemsBack.map((row) => row.name))
  check('the filed item keeps its declared field', filedItem?.type === '法宝', filedItem)
  check('the filed item landed in its own list', itemsBack.length === 1, itemsBack.length)
  check('the other region was filed too', ((await req('GET', `/library/${enc}/unit/characters`)).data?.items || []).some((row) => row.name === 'e2e-小满'))

  const again = await req('POST', `/library/${enc}/extract/apply`, {
    entries: [{ key: 'world/items', name: 'e2e-青玉佩', fields: { type: '武器', rarity: '稀有' } }],
  })
  check('a second pass updates instead of creating', (again.data?.updated || []).length === 1 && (again.data?.written || []).length === 0, again.data)
  const itemAfter = ((await req('GET', `/library/${enc}/unit/world/items`)).data?.items || []).find((row) => row.name === 'e2e-青玉佩')
  check('a value the author already has is not overwritten', itemAfter?.type === '法宝', itemAfter)
  check('an empty field is filled on the second pass', itemAfter?.rarity === '稀有', itemAfter)
  check('no duplicate record is filed', ((await req('GET', `/library/${enc}/unit/world/items`)).data?.items || []).length === 1)

  // ── the library's own location ──────────────────────────────────────────
  // Read-only on purpose: this suite runs against the writer's real library, so
  // it proves the contract — what is reported, what is refused — and leaves the
  // saved path alone. Switching folders and moving books are covered offline in
  // tests/library.smoke.mjs, where the config file is a throwaway.
  const rootInfo = await req('GET', '/root')
  check('GET /root 200', rootInfo.status === 200, `status=${rootInfo.status}`)
  check('GET /root reports where the library is',
    typeof rootInfo.data?.root === 'string' && rootInfo.data.root.length > 0, rootInfo.data)
  check('GET /root explains why it is there',
    ['env', 'settings', 'default'].includes(rootInfo.data?.source), rootInfo.data?.source)
  check('PUT /root 405', (await req('PUT', '/root', {})).status === 405)

  const noRoot = await req('POST', '/root', {})
  check('POST /root without a path 400', noRoot.status === 400, `status=${noRoot.status}`)
  const relRoot = await req('POST', '/root', { root: 'relative/folder' })
  check('POST /root refuses a relative path 400', relRoot.status === 400 && relRoot.data?.code === 'bad-root', relRoot.data)
  const nestedRoot = await req('POST', '/root', { root: `${rootInfo.data.root}/sub` })
  check('POST /root refuses a folder inside the library',
    nestedRoot.status === 400 && nestedRoot.data?.code === 'bad-root', nestedRoot.data)
  const stillThere = await req('GET', '/root')
  check('a refused switch changes nothing',
    stillThere.data?.root === rootInfo.data.root && stillThere.data?.configuredRoot === rootInfo.data.configuredRoot,
    stillThere.data)

  // ── picking a folder instead of pasting one ─────────────────────────────
  // Also read-only: it walks real folders but never switches the library.
  const drives = await req('GET', '/folders')
  check('GET /folders 200', drives.status === 200, `status=${drives.status}`)
  check('GET /folders offers a place to start, each entry named and pathed',
    Array.isArray(drives.data?.items) && drives.data.items.length > 0 &&
    drives.data.items.every((it) => typeof it.name === 'string' && typeof it.path === 'string'),
    drives.data?.items)
  check('GET /folders knows the home folder and the way up',
    'home' in (drives.data || {}) && 'parent' in (drives.data || {}), drives.data)

  const libFolder = await req('GET', `/folders?path=${encodeURIComponent(rootInfo.data.root)}`)
  check('GET /folders reads a real folder', libFolder.status === 200 && libFolder.data?.path === rootInfo.data.root,
    libFolder.data?.path)
  check('GET /folders reports the folder above it', typeof libFolder.data?.parent === 'string', libFolder.data?.parent)
  check('every entry really lives inside the folder it was asked about',
    (libFolder.data?.items || []).every((it) => it.path.startsWith(rootInfo.data.root)),
    libFolder.data?.items)

  const noFolder = await req('GET', `/folders?path=${encodeURIComponent(`${rootInfo.data.root}\\no-such-sub-xyz`)}`)
  check('a folder that is not there 400', noFolder.status === 400 && noFolder.data?.code === 'bad-path', noFolder.data)
  const notAFolder = await req('GET', `/folders?path=${encodeURIComponent(fileURLToPath(new URL('../lib/api.js', import.meta.url)))}`)
  check('a plain file is refused too 400', notAFolder.status === 400 && notAFolder.data?.code === 'bad-path', notAFolder.data)
  check('POST /folders 405', (await req('POST', '/folders', {})).status === 405)

  // ── website shortcuts: the panel's saved backends ───────────────────────
  // The one section here that writes to the config file. The whole list is
  // captured first and put back in the finally below, so a writer's shortcuts
  // are exactly as they were once the suite ends.
  const sites0 = await req('GET', '/websites')
  check('GET /websites 200', sites0.status === 200 && Array.isArray(sites0.data?.items), `status=${sites0.status}`)
  origSites = sites0.data?.items || []

  const saveSites = await req('POST', '/websites', {
    items: [
      { name: 'e2e-起点后台', url: 'https://admin.qidian.example/console' },
      { name: 'e2e-番茄', url: 'http://fanqie.example/manage' },
    ],
  })
  check('POST /websites saves the list',
    saveSites.status === 200 && saveSites.data?.items?.length === 2, saveSites.data)
  const sitesBack = await req('GET', '/websites')
  check('the saved list reads back',
    JSON.stringify(sitesBack.data?.items) === JSON.stringify(saveSites.data?.items), sitesBack.data)

  const badUrl = await req('POST', '/websites', { items: [{ name: 'x', url: 'javascript:alert(1)' }] })
  check('a non-http URL is refused 400', badUrl.status === 400 && badUrl.data?.code === 'bad-websites', badUrl.data)
  const badItems = await req('POST', '/websites', { items: 'nope' })
  check('a non-array is refused 400', badItems.status === 400 && badItems.data?.code === 'bad-websites', badItems.data)
  const stillSaved = await req('GET', '/websites')
  check('a refusal changes nothing',
    JSON.stringify(stillSaved.data?.items) === JSON.stringify(saveSites.data?.items), stillSaved.data)
  check('PUT /websites 405', (await req('PUT', '/websites', {})).status === 405)
  check('a route under /websites is not found', (await req('GET', '/websites/extra')).status === 404)

  // ── the shared library across books: promote → link → sync, over HTTP ──
  // The store lives beside the books at `<root>/.novel-shared/`. Everything
  // this section writes into it is removed again in the finally below (the
  // store has no delete route yet — that is a later stage), so the writer's
  // shared library is exactly as it was once the suite finishes.
  const sh1 = await req('GET', '/shared')
  check('GET /shared 200', sh1.status === 200 && Array.isArray(sh1.data?.units), `status=${sh1.status}`)
  check('shared catalog holds characters and materials',
    !!sh1.data?.units?.find((u) => u.key === 'characters') && !!sh1.data?.units?.find((u) => u.key === 'materials'),
    (sh1.data?.units || []).map((u) => u.key).join(','))
  check('shared catalog skips chapters and drafts',
    !(sh1.data?.units || []).some((u) => u.key === 'chapters' || u.key === 'drafts'))
  check('a group unit carries its full route',
    sh1.data?.units?.find((u) => u.key === 'locations')?.route === 'world/locations')
  sharedRoot = sh1.data?.root || ''
  shId = `e2e-sh-${stamp}`
  shId2 = `e2e-sh2-${stamp}`
  {
    const { stat } = await import('node:fs/promises')
    const { join } = await import('node:path')
    sharedExisted = await stat(join(sharedRoot, '.novel-shared', 'shared.yaml')).then(() => true, () => false)
  }

  // guards first, while nothing exists yet
  check('bare POST /shared 405', (await req('POST', '/shared', {})).status === 405)
  check('unknown /shared route 404', (await req('GET', '/shared/nope')).status === 404)
  check('links of a missing book 404', (await req('GET', '/shared/links?book=no-such-book-xyz')).status === 404)
  const linksFresh = await req('GET', `/shared/links?book=${enc}`)
  check('a book with no references lists none',
    linksFresh.status === 200 && (linksFresh.data?.links || []).length === 0, JSON.stringify(linksFresh.data))
  const impBad = await req('GET', '/shared/impact?key=nokey')
  check('malformed impact key 400', impBad.status === 400 && impBad.data?.code === 'shared-key-invalid', impBad.data?.code)
  check('promote of a missing book 404',
    (await req('POST', '/shared/promote', { book: 'no-such-book-xyz', unit: 'characters', id: 'x' })).status === 404)
  check('promote of an unknown unit 404',
    (await req('POST', '/shared/promote', { book: id, unit: 'chapters', id: 'x' })).status === 404)
  check('import with a bad mode 400',
    (await req('POST', '/shared/import', { book: id, unit: 'characters', id: 'x', mode: 'copy' })).status === 400)
  check('import of an unknown entry 404',
    (await req('POST', '/shared/import', { book: id, unit: 'characters', id: 'ghost-x', mode: 'fork' })).status === 404)
  check('sync without a link 404',
    (await req('POST', '/shared/sync', { book: id, unit: 'characters', id: 'ghost-x' })).status === 404)
  check('pin without a link 404',
    (await req('POST', '/shared/pin', { book: id, unit: 'characters', id: 'ghost-x', pin: true })).status === 404)

  // promote two of this book's own records into the store
  const rec1 = await req('POST', `/library/${enc}/unit/characters`, { id: shId, name: '共享林望', role: '主角' })
  check('a record to promote is created', rec1.status === 201 && rec1.data?.id === shId, JSON.stringify(rec1.data))
  const prom = await req('POST', '/shared/promote', { book: id, unit: 'characters', id: shId, status: 'stable' })
  check('POST /shared/promote 200', prom.status === 200 && prom.data?.key === `characters/${shId}`, JSON.stringify(prom.data))
  const rec2 = await req('POST', `/library/${enc}/unit/characters`, { id: shId2, name: '共享配角', role: '常驻' })
  check('a draft record to promote is created', rec2.status === 201 && rec2.data?.id === shId2, JSON.stringify(rec2.data))
  const prom2 = await req('POST', '/shared/promote', { book: id, unit: 'characters', id: shId2, status: 'draft' })
  check('a draft entry can be promoted', prom2.status === 200 && prom2.data?.status === 'draft', JSON.stringify(prom2.data))

  const store = await req('GET', '/shared')
  const entry1 = (store.data?.entries || []).find((e) => e.key === `characters/${shId}`)
  check('the store lists the promoted entry', !!entry1, JSON.stringify((store.data?.entries || []).map((e) => e.key)))
  check('the promoted entry is stable', entry1?.status === 'stable')
  check('the promoted entry carries a rev', /^[0-9a-f]{40}$/.test(entry1?.rev || ''))
  check('the store never appears as a book',
    !((await req('GET', '/library')).data?.books || []).some((b) => b.id === '.novel-shared'))
  const impEmpty = await req('GET', `/shared/impact?key=${encodeURIComponent(`characters/${shId}`)}`)
  check('impact is empty before anyone references it',
    impEmpty.status === 200 && impEmpty.data?.books?.length === 0, JSON.stringify(impEmpty.data))

  // a second book brings the entry in as a link …
  const made2 = await req('POST', '/library', { title: `e2e2-${stamp}`, logline: 'temp' })
  id2 = made2.data?.book?.id || ''
  created2 = made2.status === 201
  check('a second book for the link', created2, JSON.stringify(made2.data))
  const enc2 = encodeURIComponent(id2)
  const il = await req('POST', '/shared/import', { book: id2, unit: 'characters', id: shId, mode: 'link' })
  check('POST /shared/import (link) 200', il.status === 200 && il.data?.mode === 'link', JSON.stringify(il.data))
  const dupImp = await req('POST', '/shared/import', { book: id2, unit: 'characters', id: shId, mode: 'link' })
  check('importing twice 409', dupImp.status === 409 && dupImp.data?.code === 'shared-target-exists', dupImp.data?.code)
  const links2 = await req('GET', `/shared/links?book=${enc2}`)
  const lk = (links2.data?.links || []).find((l) => l.key === `characters/${shId}`)
  check('the link shows up fresh', !!lk && lk.mode === 'link' && !lk.stale && !lk.drift && !lk.pin, JSON.stringify(lk))

  // … the origin book moves on: editing it alone leaves the store (the single
  // source of truth) untouched, so the link stays fresh until the change is
  // re-promoted — the impact prompt and version backup ride on that overwrite …
  const upd = await req('PUT', `/library/${enc}/unit/characters/${shId}`, { name: '共享林望·修订', role: '主角' })
  check('editing the source record 200', upd.status === 200, `status=${upd.status}`)
  const freshAfterEdit = await req('GET', `/shared/links?book=${enc2}`)
  const stillLink = freshAfterEdit.data?.links?.find((l) => l.key === `characters/${shId}`)
  check('an origin edit alone leaves the link fresh', !!stillLink && !stillLink.stale, JSON.stringify(freshAfterEdit.data))
  const reprom = await req('POST', '/shared/promote', { book: id, unit: 'characters', id: shId, status: 'stable' })
  check('re-promoting the edit overwrites the store', reprom.status === 200, JSON.stringify(reprom.data))
  const linksStale = await req('GET', `/shared/links?book=${enc2}`)
  check('the re-promotion marks the link stale',
    !!linksStale.data?.links?.find((l) => l.key === `characters/${shId}`)?.stale, JSON.stringify(linksStale.data))
  const syn = await req('POST', '/shared/sync', { book: id2, unit: 'characters', id: shId })
  check('POST /shared/sync 200', syn.status === 200, JSON.stringify(syn.data))
  const linksAfter = await req('GET', `/shared/links?book=${enc2}`)
  check('sync clears staleness',
    !linksAfter.data?.links?.find((l) => l.key === `characters/${shId}`)?.stale, JSON.stringify(linksAfter.data))
  const pulled = await req('GET', `/library/${enc2}/unit/characters/${shId}`)
  check('the revision landed in the second book',
    pulled.status === 200 && JSON.stringify(pulled.data).includes('共享林望·修订'), JSON.stringify(pulled.data))

  // … and a locked link stops taking updates until it is unlocked again.
  const pinOn = await req('POST', '/shared/pin', { book: id2, unit: 'characters', id: shId, pin: true })
  check('pin the link 200', pinOn.status === 200 && pinOn.data?.pin === true, JSON.stringify(pinOn.data))
  await req('PUT', `/library/${enc}/unit/characters/${shId}`, { name: '共享林望·再修订', role: '主角' })
  await req('POST', '/shared/promote', { book: id, unit: 'characters', id: shId, status: 'stable' })
  const pinnedSync = await req('POST', '/shared/sync', { book: id2, unit: 'characters', id: shId })
  check('a pinned link refuses sync 409',
    pinnedSync.status === 409 && pinnedSync.data?.code === 'shared-pinned', pinnedSync.data?.code)
  const pinOff = await req('POST', '/shared/pin', { book: id2, unit: 'characters', id: shId, pin: false })
  check('unpin 200', pinOff.status === 200 && pinOff.data?.pin === false, JSON.stringify(pinOff.data))
  check('after unlocking, sync runs', (await req('POST', '/shared/sync', { book: id2, unit: 'characters', id: shId })).status === 200)

  // a draft cannot be linked but may be forked, and a fork never syncs
  const draftLink = await req('POST', '/shared/import', { book: id2, unit: 'characters', id: shId2, mode: 'link' })
  check('linking a draft 409', draftLink.status === 409 && draftLink.data?.code === 'shared-not-stable', draftLink.data?.code)
  const forked = await req('POST', '/shared/import', { book: id2, unit: 'characters', id: shId2, mode: 'fork' })
  check('forking a draft 200', forked.status === 200 && forked.data?.mode === 'fork', JSON.stringify(forked.data))
  const forkSync = await req('POST', '/shared/sync', { book: id2, unit: 'characters', id: shId2 })
  check('a fork refuses to sync 409',
    forkSync.status === 409 && forkSync.data?.code === 'shared-fork', forkSync.data?.code)

  // 影响范围: the store reports exactly the book that references the entry
  const imp1 = await req('GET', `/shared/impact?key=${encodeURIComponent(`characters/${shId}`)}`)
  check('impact lists the referencing book',
    imp1.data?.books?.some((x) => x.id === id2), JSON.stringify(imp1.data))
  check('impact reports the mode',
    imp1.data?.books?.find((x) => x.id === id2)?.mode === 'link', JSON.stringify(imp1.data))
  const imp2 = await req('GET', `/shared/impact?key=${encodeURIComponent(`characters/${shId2}`)}`)
  check('impact counts the fork too',
    imp2.data?.books?.find((x) => x.id === id2)?.mode === 'fork', JSON.stringify(imp2.data))

  // ── P2: series layers, field exceptions, templates, over HTTP ───────────
  const ser1 = await req('GET', '/shared/series')
  check('GET /shared/series 200', ser1.status === 200 && typeof ser1.data?.series === 'object', JSON.stringify(ser1.data))
  const sname = `e2e系-${stamp}`
  const ser2 = await req('POST', '/shared/series', { name: sname })
  sid = ser2.data?.sid || ''
  check('POST /shared/series 200', ser2.status === 200 && !!sid, JSON.stringify(ser2.data))
  const ser3 = await req('POST', '/shared/series', { name: sname })
  check('the same series name is idempotent',
    ser3.status === 200 && ser3.data?.sid === sid && ser3.data?.existed === true, JSON.stringify(ser3.data))
  const ser4 = await req('GET', '/shared/series')
  check('the series shows in the registry',
    (ser4.data?.series || []).find((s) => s.sid === sid)?.name === sname, JSON.stringify(ser4.data?.series))

  const badScope = await req('POST', '/shared/promote', { book: id, unit: 'characters', id: shId, scope: 'ghost-series-xyz' })
  check('promote into a missing series 404',
    badScope.status === 404 && badScope.data?.code === 'shared-series-unknown', badScope.data?.code)

  shId3 = `e2e-sh3-${stamp}`
  const rec3 = await req('POST', `/library/${enc}/unit/characters`, { id: shId3, name: '系内人物', role: '配角' })
  check('a third record for the series', rec3.status === 201 && rec3.data?.id === shId3, JSON.stringify(rec3.data))
  const prom3 = await req('POST', '/shared/promote', { book: id, unit: 'characters', id: shId3, status: 'stable', scope: sid })
  check('promoting into a series layer 200',
    prom3.status === 200 && String(prom3.data?.key || '').startsWith(`series:${sid}:`), JSON.stringify(prom3.data))
  {
    const { stat } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const scopedFile = await stat(join(sharedRoot, '.novel-shared', 'series', sid, 'characters', `${shId3}.yaml`))
      .then(() => true, () => false)
    check('the scoped file lands in the series folder', scopedFile)
  }
  const store2 = await req('GET', '/shared')
  const entry3 = (store2.data?.entries || []).find((e) => e.key === `series:${sid}:characters/${shId3}`)
  check('the store lists it under the series scope',
    !!entry3 && entry3.scope === sid && entry3.series === sname, JSON.stringify(entry3))

  // a second book links the scoped entry…
  const il3 = await req('POST', '/shared/import', { book: id2, unit: 'characters', id: shId3, mode: 'link', scope: sid })
  check('importing the scoped entry 200', il3.status === 200 && il3.data?.scope === sid, JSON.stringify(il3.data))
  const links3 = await req('GET', `/shared/links?book=${enc2}`)
  const lk3 = (links3.data?.links || []).find((l) => l.key === `characters/${shId3}`)
  check('the link knows its series',
    !!lk3 && lk3.scope === sid && lk3.series === sname && !lk3.stale, JSON.stringify(lk3))
  const imp3 = await req('GET', `/shared/impact?key=${encodeURIComponent(`series:${sid}:characters/${shId3}`)}`)
  check('impact finds the scoped reference',
    imp3.status === 200 && imp3.data?.scope === sid && imp3.data?.books?.some((x) => x.id === id2), JSON.stringify(imp3.data))
  const imp3plain = await req('GET', `/shared/impact?key=${encodeURIComponent(`characters/${shId3}`)}`)
  check('the plain key misses the scoped reference',
    imp3plain.status === 200 && (imp3plain.data?.books || []).length === 0, JSON.stringify(imp3plain.data))

  // … and the book keeps its own field while everything else follows the store
  const ovOk = await req('POST', '/shared/override', { book: id2, unit: 'characters', id: shId3, fields: ['role'] })
  check('POST /shared/override 200',
    ovOk.status === 200 && JSON.stringify(ovOk.data?.overrides) === '["role"]', JSON.stringify(ovOk.data))
  const ovFork = await req('POST', '/shared/override', { book: id2, unit: 'characters', id: shId2, fields: ['role'] })
  check('override on a fork 409', ovFork.status === 409 && ovFork.data?.code === 'shared-fork', ovFork.data?.code)
  const ovNone = await req('POST', '/shared/override', { book: id2, unit: 'characters', id: 'ghost-x', fields: ['role'] })
  check('override without a link 404', ovNone.status === 404, `status=${ovNone.status}`)
  await req('PUT', `/library/${enc2}/unit/characters/${shId3}`, { name: '系内人物', role: '本地角色' })
  await req('PUT', `/library/${enc}/unit/characters/${shId3}`, { name: '系内人物·修订', role: '配角' })
  await req('POST', '/shared/promote', { book: id, unit: 'characters', id: shId3, status: 'stable', scope: sid })
  const syn3 = await req('POST', '/shared/sync', { book: id2, unit: 'characters', id: shId3 })
  check('syncing the scoped link 200', syn3.status === 200, JSON.stringify(syn3.data))
  const after3 = await req('GET', `/library/${enc2}/unit/characters/${shId3}`)
  check('sync keeps the excepted field local', after3.data?.data?.role === '本地角色', JSON.stringify(after3.data))
  check('sync pulls the rest from the store',
    JSON.stringify(after3.data).includes('系内人物·修订'), JSON.stringify(after3.data))
  const lk3b = (await req('GET', `/shared/links?book=${enc2}`)).data?.links?.find((l) => l.key === `characters/${shId3}`)
  check('and the link is fresh again with its exceptions kept',
    !!lk3b && !lk3b.stale && JSON.stringify(lk3b.overrides || []) === '["role"]', JSON.stringify(lk3b))

  // templates: store one, grow a book from it, take it out again
  const tpl0 = await req('GET', '/shared/templates')
  check('GET /shared/templates 200', tpl0.status === 200 && Array.isArray(tpl0.data?.templates), JSON.stringify(tpl0.data))
  const tplGhost = await req('POST', '/shared/templates',
    { name: `e2e模板-${stamp}`, items: ['characters/ghost-x'] })
  check('a template pointing at nothing 404',
    tplGhost.status === 404 && tplGhost.data?.code === 'shared-source-missing', tplGhost.data?.code)
  const tpl1 = await req('POST', '/shared/templates', {
    name: `e2e模板-${stamp}`,
    items: [`characters/${shId}`, `series:${sid}:characters/${shId3}`],
  })
  tid = tpl1.data?.tid || ''
  check('POST /shared/templates 200', tpl1.status === 200 && !!tid, JSON.stringify(tpl1.data))
  const tpl2 = await req('GET', '/shared/templates')
  const tp = (tpl2.data?.templates || []).find((x) => x.tid === tid)
  check('the template resolves its titles', !!tp && (tp.items || []).every((it) => !!it.title), JSON.stringify(tp))
  check('the template item keeps its scope', (tp?.items || []).some((it) => it.scope === sid), JSON.stringify(tp))

  const made3 = await req('POST', '/shared/from-template', { title: `e2e模板书-${stamp}`, tid })
  id3 = made3.data?.book?.id || ''
  created3 = made3.status === 200 && !!id3
  check('POST /shared/from-template 200', created3, JSON.stringify(made3.data))
  check('the template brought both entries along',
    made3.data?.imported?.length === 2 && made3.data?.skipped?.length === 0, JSON.stringify(made3.data))
  const linksT = await req('GET', `/shared/links?book=${encodeURIComponent(id3)}`)
  check('the new book links both template entries',
    (linksT.data?.links || []).length === 2, JSON.stringify(linksT.data))
  check('the scoped link kept its scope in the new book',
    (linksT.data?.links || []).find((l) => l.key === `characters/${shId3}`)?.scope === sid, JSON.stringify(linksT.data))

  const tplDel = await req('DELETE', `/shared/templates/${encodeURIComponent(tid)}`)
  check('DELETE /shared/templates 200', tplDel.status === 200 && tplDel.data?.tid === tid, JSON.stringify(tplDel.data))
  check('deleting a template twice 404',
    (await req('DELETE', `/shared/templates/${encodeURIComponent(tid)}`)).data?.code === 'shared-template-missing')

  const fos = await req('GET', '/shared/foreshadowing')
  check('GET /shared/foreshadowing 200', fos.status === 200 && Array.isArray(fos.data?.groups), JSON.stringify(fos.data).slice(0, 160))

  // ── guards ──────────────────────────────────────────────────────────────
  const traversal = await req('GET', '/library/..%2F..%2Fetc')
  check('path traversal rejected 400', traversal.status === 400, `status=${traversal.status}`)
  check('unknown book 404', (await req('GET', '/library/no-such-book-xyz')).status === 404)

  // ── hot reload: edit api.js, the next request must run the new code ─────
  const apiFile = fileURLToPath(new URL('../lib/api.js', import.meta.url))
  const original = await readFile(apiFile, 'utf8')
  // The ping payload's own literal is the marker — it must be unique in api.js.
  const marker = "plugin: PLUGIN_ID, stage: STAGE, half: 'host'"
  if (!original.includes(marker)) throw new Error(`cannot find the ping marker in api.js`)
  try {
    await writeFile(apiFile, original.replace(marker, "plugin: PLUGIN_ID, stage: 987654, half: 'host'"), 'utf8')
    const hot = await req('GET', '/ping')
    check('edited api.js served without restart', hot.data?.stage === 987654, `stage=${hot.data?.stage}`)
  } finally {
    await writeFile(apiFile, original, 'utf8')
  }
  check('reverting api.js takes effect too', (await req('GET', '/ping')).data?.stage === 9)

  // ── delete: the book goes to the recycle bin, not the void ─────────────
  const del = await req('DELETE', `/library/${enc}`)
  check('DELETE 200', del.status === 200, `status=${del.status}`)
  created = false
  check('deleted book is gone', (await req('GET', `/library/${enc}`)).status === 404)
  check('shelf no longer lists it', !((await req('GET', '/library')).data?.books || []).some((b) => b.id === id))

  // the bin holds it now — listed, dated, and still invisible as a book
  const bin = await req('GET', '/trash')
  const binnedEntry = ((bin.data?.entries || []).find((e) => e.name === id)) || null
  if (!binnedEntry) throw new Error(`expected ${id} in the recycle bin, got ${JSON.stringify(bin.data)}`)
  check('DELETE lands in the recycle bin', bin.status === 200 && !!binnedEntry.deletedAt, JSON.stringify(bin.data))
  check('the bin is not a book', !((await req('GET', '/library')).data?.books || []).some((b) => b.id === '.trash'))

  // guards on entry names: nothing outside .trash, nothing imaginary
  const badPurge = await req('DELETE', '/trash/.hack')
  check('bad bin entry 400', badPurge.status === 400, `status=${badPurge.status}`)
  const ghostRestore = await req('POST', '/trash/ghost__ts1/restore', {})
  check('unknown bin entry 404', ghostRestore.status === 404, `status=${ghostRestore.status}`)

  // restore puts it back on the shelf, readable under its own id
  const back = await req('POST', `/trash/${encodeURIComponent(binnedEntry.id)}/restore`, {})
  check('restore 200', back.status === 200 && back.data?.restored === true, JSON.stringify(back.data))
  created = true
  check('restored book readable', (await req('GET', `/library/${enc}`)).status === 200)
  check('restored book listed again', ((await req('GET', '/library')).data?.books || []).some((b) => b.id === id))

  // delete once more, then this time purge for good
  const del2 = await req('DELETE', `/library/${enc}`)
  check('second DELETE 200', del2.status === 200, `status=${del2.status}`)
  created = false
  const bin2 = await req('GET', '/trash')
  const binnedEntry2 = ((bin2.data?.entries || []).find((e) => e.name === id)) || null
  if (!binnedEntry2) throw new Error(`expected ${id} back in the recycle bin, got ${JSON.stringify(bin2.data)}`)
  const purge = await req('DELETE', `/trash/${encodeURIComponent(binnedEntry2.id)}`)
  check('purge 200', purge.status === 200 && purge.data?.purged === true, JSON.stringify(purge.data))
  check('purged book gone', (await req('GET', `/library/${enc}`)).status === 404)
  check('the bin lets go of it', !((await req('GET', '/trash')).data?.entries || []).some((e) => e.name === id))
} finally {
  // Never leave test data behind, even when a check threw.
  if (created && id) await req('DELETE', `/library/${encodeURIComponent(id)}`).catch(() => {})
  if (created2 && id2) await req('DELETE', `/library/${encodeURIComponent(id2)}`).catch(() => {})
  if (created3 && id3) await req('DELETE', `/library/${encodeURIComponent(id3)}`).catch(() => {})
  const leftover = await req('GET', '/trash').catch(() => null)
  for (const gone of [id, id2, id3]) {
    const binned = leftover?.data?.entries?.find((e) => e.name === gone)
    if (binned) await req('DELETE', `/trash/${encodeURIComponent(binned.id)}`).catch(() => {})
  }
  if (origSites) await req('POST', '/websites', { items: origSites }).catch(() => {})

  // The shared store: this run promoted e2e records into it, and there is no
  // delete route yet — take them out straight on disk. A store that existed
  // before keeps only its own entries; one this run created goes away whole,
  // so the writer's shared library is exactly as it was.
  if (sharedRoot && (shId || shId2)) {
    try {
      const { rm } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const storeDir = join(sharedRoot, '.novel-shared')
      const ours = [shId, shId2, shId3].filter(Boolean)
      if (!sharedExisted) {
        await rm(storeDir, { recursive: true, force: true })
      } else {
        for (const n of ours) {
          await rm(join(storeDir, 'characters', `${n}.yaml`), { force: true })
          await rm(join(storeDir, '.versions', 'characters', n), { recursive: true, force: true })
        }
        if (sid && shId3) {
          await rm(join(storeDir, 'series', sid), { recursive: true, force: true })
          await rm(join(storeDir, '.versions', 'series', sid), { recursive: true, force: true })
          await rm(join(storeDir, 'series'), { force: true }).catch(() => {}) // only when now empty
        }
        const libmod = await import(new URL('../lib/library.js', import.meta.url).href)
        const idx = await libmod.readYamlFile(join(storeDir, 'shared.yaml'), null)
        if (idx?.entries) {
          for (const n of ours) delete idx.entries[`characters/${n}`]
          if (sid && shId3) delete idx.entries[`series:${sid}:characters/${shId3}`]
          if (sid && idx.series) delete idx.series[sid]
          if (tid && idx.templates) delete idx.templates[tid]
          await libmod.writeYamlFile(join(storeDir, 'shared.yaml'), idx)
        }
      }
    } catch (err) {
      console.error(`shared store cleanup: ${err.message}`)
    }
  }
}

console.log(log.join('\n'))
console.log(`\n${log.length - failed}/${log.length} passed`)
if (failed) process.exitCode = 1
