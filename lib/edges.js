// dsh-novel-studio — edge writer.
//
// The graph is a *view*: `graph.js` only reads. This module is the way back.
//
// A relation has two possible homes, and which one it lives in decides how it is
// edited:
//
//   manual  the row in relationships.yaml. Type, note and strength are the
//           reader's own words, so all three are writable.
//   auto    a field on a record (item.owner, faction.leader, location.region).
//           The row is derived, so the only honest edit is to point the field at
//           a different node — or clear it. Changing the type would mean editing
//           the graph kind's declaration, not the book.
//
// Everything here answers with a plain object; `ops.js` turns errors into
// `{ ok: false, code, message }` so no caller ever has to catch.

import { join } from 'node:path'

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'
const { clearField, listUnit, writeUnit } = await import(`./records.js?v=${V}`)
const { readYamlFile, writeYamlFile } = await import(`./library.js?v=${V}`)
const { EDGE_FILE, EDGE_LIST_KEY, buildGraph, indexNodes } = await import(`./graph.js?v=${V}`)

/** Keys the loader accepts as aliases for the canonical ones we always write. */
const FROM_KEYS = ['from', 'a', 'source']
const TO_KEYS = ['to', 'b', 'target']
const TYPE_KEYS = ['type', 'label', 'kind']
const NOTE_KEYS = ['note', 'description']
const STRENGTH_KEYS = ['strength', 'weight']

function refuse(code, message) {
  const err = new Error(message)
  err.code = code
  // Every refusal here is something the reader can fix, so the HTTP layer should
  // answer 400 rather than dressing a rejected edit up as a server fault.
  err.status = 400
  return err
}

function text(value) {
  return String(value ?? '').trim()
}

function clampStrength(value, fallback = 2) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : fallback
}

function firstOf(entry, keys) {
  for (const key of keys) if (entry[key] !== undefined && entry[key] !== null) return entry[key]
  return undefined
}

/** Accept either a canonical id or the display name the reader typed. */
function resolveNode(alias, ref) {
  const raw = text(ref)
  if (!raw) throw refuse('missing-argument', '关系需要两端都有节点')
  const id = alias.get(raw)
  if (!id) throw refuse('unknown-node', `这本书里没有「${raw}」这个节点`)
  return id
}

/** Which row of relationships.yaml produced this edge, or -1. */
function rawIndexOf(list, alias, edge) {
  return list.findIndex((e) => {
    if (!e || typeof e !== 'object') return false
    const from = alias.get(text(firstOf(e, FROM_KEYS)))
    const to = alias.get(text(firstOf(e, TO_KEYS)))
    const type = text(firstOf(e, TYPE_KEYS))
    return from === edge.from && to === edge.to && type === edge.type
  })
}

/**
 * Find the one edge the reader acted on.
 *
 * `from`/`to`/`type`/`source` are all optional filters, so the client can be
 * lazy about which of them it knows — but a filter set that matches two edges is
 * refused rather than guessed, because "edit the wrong relation" is silent.
 */
async function locateEdge(bookDir, payload) {
  const { alias } = await indexNodes(bookDir)
  const graph = await buildGraph(bookDir)

  const wantFrom = payload.from !== undefined ? resolveNode(alias, payload.from) : ''
  const wantTo = payload.to !== undefined ? resolveNode(alias, payload.to) : ''
  const wantType = payload.type !== undefined ? text(payload.type) : ''
  const wantSource = text(payload.source)

  const hits = graph.edges.filter((e) =>
    (!wantFrom || e.from === wantFrom)
    && (!wantTo || e.to === wantTo)
    && (payload.type === undefined || e.type === wantType)
    && (!wantSource || e.source === wantSource))

  if (!hits.length) throw refuse('no-such-edge', '找不到这条关系，它可能刚刚被改过了')
  if (hits.length > 1) throw refuse('ambiguous-edge', `匹配到 ${hits.length} 条关系，请把 source 或 type 说清楚`)
  return { alias, graph, edge: hits[0] }
}

/** Read-modify-write relationships.yaml through one helper, so leaks stay impossible. */
async function withEdgeList(bookDir, mutate) {
  const file = join(bookDir, EDGE_FILE)
  const doc = await readYamlFile(file, {})
  const base = doc && typeof doc === 'object' ? doc : {}
  const list = Array.isArray(base[EDGE_LIST_KEY]) ? base[EDGE_LIST_KEY].slice() : []
  const result = await mutate(list)
  await writeYamlFile(file, { ...base, [EDGE_LIST_KEY]: list })
  return { ...result, file: EDGE_FILE, count: list.length }
}

/** Where the record behind a node lives, and which id writes reach it. */
async function locateRecord(bookDir, index, ownerId) {
  const node = index.all.get(ownerId)
  if (!node) throw refuse('unknown-node', `这本书里没有「${ownerId}」这个节点`)
  const unit = index.units.get(node.kind)
  if (!unit) throw refuse('unknown-unit', `节点类型「${node.kind}」没有对应的存储分区`)
  const kind = index.kinds.find((k) => k.key === node.kind)
  const { items } = await listUnit(bookDir, unit)
  const at = items.findIndex((item) => text(item.id ?? item[kind?.label]) === ownerId)
  if (at < 0) throw refuse('unknown-entry', `分区「${unit.key}」里找不到条目「${ownerId}」`)
  // A records unit is addressed by its own id, a doc unit by its array index.
  return { unit, at, writeId: unit.kind === 'records' ? ownerId : at }
}

/**
 * Point a record's link field at another node.
 *
 * This is the edit that makes a field-derived edge feel like an edge: the reader
 * drags the line, and the character file changes.
 */
async function retargetField(bookDir, index, edge, nextFrom) {
  if (nextFrom === edge.from) return { changed: false }
  if (nextFrom === edge.to) throw refuse('self-edge', `「${edge.to}」不能连自己`)
  const clash = index.all.get(nextFrom)
  if (!clash) throw refuse('unknown-node', `这本书里没有「${nextFrom}」这个节点`)
  const target = await locateRecord(bookDir, index, edge.owner)
  await writeUnit(bookDir, target.unit, target.writeId, { [edge.field]: nextFrom })
  return {
    changed: true,
    unit: target.unit.key,
    owner: edge.owner,
    field: edge.field,
    from: nextFrom,
    to: edge.to,
  }
}

/** Add a hand-written relation between two existing nodes. */
export async function createEdge(bookDir, payload = {}) {
  const { alias } = await indexNodes(bookDir)
  const from = resolveNode(alias, payload.from)
  const to = resolveNode(alias, payload.to)
  if (from === to) throw refuse('self-edge', `「${from}」不能连自己`)
  const type = text(payload.type)

  const graph = await buildGraph(bookDir)
  const clash = graph.edges.find((e) => e.from === from && e.to === to && e.type === type)
  if (clash) {
    if (clash.source === 'auto') {
      throw refuse('duplicate-edge', `这条关系已经由「${clash.owner}」的「${clash.field}」字段生成，改那个字段就行`)
    }
    throw refuse('duplicate-edge', `已经有一条 ${from} → ${to}${type ? `（${type}）` : ''} 了`)
  }
  // The drawing dedupes by unordered pair, so the mirror image would be stored
  // but never visible. Refuse it instead of letting an invisible row accumulate.
  const mirror = graph.edges.find((e) => e.from === to && e.to === from && e.type === type)
  if (mirror) {
    throw refuse('duplicate-edge', `已经有一条 ${to} → ${from}${type ? `（${type}）` : ''} 了，方向相反但图上会重叠`)
  }

  const entry = { from, to }
  if (type) entry.type = type
  const note = text(payload.note)
  if (note) entry.note = note
  if (payload.strength !== undefined && payload.strength !== null && payload.strength !== '') {
    entry.strength = clampStrength(payload.strength)
  }

  const written = await withEdgeList(bookDir, (list) => {
    list.push(entry)
    return {}
  })
  return { action: 'create', source: 'manual', edge: { ...entry, source: 'manual' }, ...written }
}

/**
 * Edit one relation.
 *
 * `patch` may carry `from`, `to`, `type`, `note`, `strength`. A field-derived
 * edge accepts only `from`; the rest are refused by name so the reader learns
 * *why* they are not editable here rather than watching the value snap back.
 */
export async function updateEdge(bookDir, payload = {}) {
  const { alias, graph, edge } = await locateEdge(bookDir, payload)
  const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : {}

  if (edge.source === 'auto') {
    const locked = ['type', 'note', 'strength'].filter((k) => patch[k] !== undefined)
    if (locked.length) {
      throw refuse('locked-field-link', `这条关系由「${edge.owner}」的「${edge.field}」字段生成，${locked.join('/')} 由字段定义决定，不能在这里改`)
    }
    if (patch.from === undefined) return { action: 'update', source: 'auto', changed: false, edge }
    const index = await indexNodes(bookDir)
    return { action: 'update', source: 'auto', ...(await retargetField(bookDir, index, edge, resolveNode(alias, patch.from))) }
  }

  const written = await withEdgeList(bookDir, (list) => {
    // Resolve the row against the list we are about to write, not an earlier
    // read, so a concurrent edit can only ever be seen or refused — not lost.
    const index = rawIndexOf(list, alias, edge)
    if (index < 0) throw refuse('no-such-edge', '这条关系已经不在 relationships.yaml 里了')
    const next = { ...(list[index] || {}) }
    // Always write the canonical keys, then drop the aliases we may have read:
    // a shadowed `a:` next to a live `from:` invites an edit that does nothing.
    next.from = patch.from !== undefined ? resolveNode(alias, patch.from) : edge.from
    next.to = patch.to !== undefined ? resolveNode(alias, patch.to) : edge.to
    const type = patch.type !== undefined ? text(patch.type) : edge.type
    const note = patch.note !== undefined ? text(patch.note) : edge.note
    const strength = patch.strength !== undefined ? clampStrength(patch.strength, edge.strength) : edge.strength

    if (type) next.type = type
    else delete next.type
    if (note) next.note = note
    else delete next.note
    next.strength = strength

    for (const key of [...FROM_KEYS.slice(1), ...TO_KEYS.slice(1), ...TYPE_KEYS.slice(1), ...NOTE_KEYS.slice(1), ...STRENGTH_KEYS.slice(1)]) {
      delete next[key]
    }

    if (next.from === next.to) throw refuse('self-edge', `「${next.from}」不能连自己`)
    const clash = graph.edges.find((e) =>
      e !== edge && e.from === next.from && e.to === next.to && e.type === (type || ''))
    if (clash) {
      throw refuse('duplicate-edge', `已经有一条 ${next.from} → ${next.to}${type ? `（${type}）` : ''} 了`)
    }

    list[index] = next
    return { edge: { ...next, source: 'manual' } }
  })
  return { action: 'update', source: 'manual', ...written }
}

/** Remove one relation — a row for a manual edge, a field value for a derived one. */
export async function deleteEdge(bookDir, payload = {}) {
  const { alias, edge } = await locateEdge(bookDir, payload)

  if (edge.source === 'auto') {
    const index = await indexNodes(bookDir)
    const target = await locateRecord(bookDir, index, edge.owner)
    const cleared = await clearField(bookDir, target.unit, target.writeId, edge.field)
    return {
      action: 'delete',
      source: 'auto',
      changed: cleared.changed,
      unit: target.unit.key,
      owner: edge.owner,
      field: edge.field,
      from: edge.from,
      to: edge.to,
    }
  }

  const written = await withEdgeList(bookDir, (list) => {
    const index = rawIndexOf(list, alias, edge)
    if (index < 0) throw refuse('no-such-edge', '这条关系已经不在 relationships.yaml 里了')
    list.splice(index, 1)
    return {}
  })
  return { action: 'delete', source: 'manual', changed: true, edge: { from: edge.from, to: edge.to, type: edge.type }, ...written }
}
