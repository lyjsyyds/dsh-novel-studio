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
  check('13 built-in rules over HTTP', (ruleCat.data?.rules || []).length === 13, (ruleCat.data?.rules || []).length)

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
  check('the AI task menu has five entries', (aiTasks.data?.tasks || []).length === 5, (aiTasks.data?.tasks || []).length)
  check('the AI task menu starts with continue', aiTasks.data?.tasks?.[0]?.key === 'continue', aiTasks.data?.tasks?.[0])
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

  // ── delete ──────────────────────────────────────────────────────────────
  const del = await req('DELETE', `/library/${enc}`)
  check('DELETE 200', del.status === 200, `status=${del.status}`)
  created = false
  check('deleted book is gone', (await req('GET', `/library/${enc}`)).status === 404)
  check('shelf no longer lists it', !((await req('GET', '/library')).data?.books || []).some((b) => b.id === id))
} finally {
  // Never leave test data behind, even when a check threw.
  if (created && id) await req('DELETE', `/library/${encodeURIComponent(id)}`).catch(() => {})
}

console.log(log.join('\n'))
console.log(`\n${log.length - failed}/${log.length} passed`)
if (failed) process.exitCode = 1
