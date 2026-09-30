// dsh-novel-studio — relationship graph.
//
// The people, factions, places and items of a book are already stored as
// records; `relationships.yaml` holds the typed edges between them. This module
// turns those files into a node/edge graph the panel can draw and the assistant
// can reason about — no new data format, no database, still just files.
//
// Graph kinds are declarative and extensible: an extension may export
// `graphs: [{ key, zh, en, section, group, label, role, links }]` to add another
// node type to the same web, and it appears in the panel without a client change.
//
// Edge shape in relationships.yaml:
//   schemaVersion: 1
//   edges:
//     - from: 林望          # node id OR its display name
//       to: 老周
//       type: 师徒           # free text; drives the edge label
//       note: 在垃圾带认识
//       strength: 3          # optional 1..5, drives the stroke weight

import { join } from 'node:path'

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'
const { getSchema } = await import(`./schema.js?v=${V}`)
const { listUnit } = await import(`./records.js?v=${V}`)
const { readYamlFile } = await import(`./library.js?v=${V}`)

export const EDGE_FILE = 'relationships.yaml'
export const EDGE_LIST_KEY = 'edges'

/**
 * Built-in node kinds. `section`/`group` point at an existing schema unit, so a
 * kind never invents storage — it only says which records join the web and which
 * field is their label.
 *
 * `links` promotes a plain text field into an edge. It fires only when the field
 * value resolves to a node that actually exists, so a typo shows up in the
 * validator instead of silently becoming a node. A `tags` field (array or a
 * comma-separated string) yields one edge per listed name, so one item can be
 * held by several people and one person can hold several items.
 */
export const GRAPH_KINDS = [
  { key: 'characters', zh: '人物', en: 'Characters', section: 'characters', label: 'name', role: 'role' },
  {
    key: 'factions', zh: '势力', en: 'Factions', section: 'world', group: 'factions',
    label: 'name', role: 'type',
    links: [{ field: 'leader', type: '首领' }, { field: 'members', type: '成员' }],
  },
  {
    key: 'locations', zh: '地点', en: 'Locations', section: 'world', group: 'locations',
    label: 'name', role: 'type', links: [{ field: 'region', type: '位于' }],
  },
  {
    key: 'items', zh: '物品', en: 'Items', section: 'world', group: 'items',
    label: 'name', role: 'type', links: [{ field: 'owner', type: '持有' }],
  },
]

/** A link field's stored value → the list of names it points at. */
function linkNames(value) {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean)
  return String(value ?? '').split(/[,，]+/).map((s) => s.trim()).filter(Boolean)
}

/** Every node kind currently known, built-ins first. */
export async function graphKinds() {
  const schema = await getSchema()
  return [...GRAPH_KINDS, ...(schema.extraGraphKinds || [])]
}

/** The unit a kind reads from, or null when an extension named a missing one. */
function unitFor(schema, kind) {
  // `unitOf` answers with `{ unit, group }`, so unwrap it here rather than making
  // every caller remember which half of the pair holds the kind.
  return schema.unitOf(kind.section, kind.group ?? kind.section)?.unit ?? null
}

/**
 * Materialise every node of every kind, plus the alias table that turns a
 * display name back into a canonical id.
 *
 * `buildGraph` filters this down to the requested subgraph, which is fine for
 * drawing — but the edge writer must see the whole cast, because the two ends of
 * an edge may belong to different kinds and one of them may be filtered out.
 * Keeping the index separate means "write an edge" and "draw an edge" agree on
 * what a name means.
 *
 * @param {string} bookDir
 * @returns {Promise<{schema:any,kinds:any[],all:Map<string,any>,alias:Map<string,string>,units:Map<string,any>,problems:any[]}>}
 */
export async function indexNodes(bookDir) {
  const schema = await getSchema()
  const kinds = await graphKinds()

  const all = new Map() // id -> node record (all kinds)
  const alias = new Map() // id or display name -> canonical id
  const units = new Map() // kind key -> schema unit, for writers that go back to storage
  const problems = []

  for (const kind of kinds) {
    const unit = unitFor(schema, kind)
    if (!unit) {
      problems.push({ code: 'unknown-unit', kind: kind.key, message: `graph kind "${kind.key}" points at missing unit ${kind.section}${kind.group ? '/' + kind.group : ''}` })
      continue
    }
    units.set(kind.key, unit)
    const { items } = await listUnit(bookDir, unit)
    for (const item of items) {
      const id = String(item.id ?? item[kind.label] ?? '').trim()
      if (!id) continue
      const label = String(item[kind.label] ?? item.title ?? id).trim() || id
      if (all.has(id)) {
        problems.push({ code: 'duplicate-node', kind: kind.key, id, message: `"${id}" exists in more than one graph kind` })
        continue
      }
      all.set(id, {
        id,
        label,
        kind: kind.key,
        role: String(item[kind.role] ?? '').trim(),
        summary: String(item.summary ?? item.description ?? '').trim().slice(0, 160),
        degree: 0,
        external: false,
      })
      alias.set(id, id)
      alias.set(label, id)
    }
  }

  return { schema, kinds, all, alias, units, problems }
}

/**
 * Build the whole relationship web of one book.
 *
 * @param {string} bookDir
 * @param {{ kinds?: string[] }} [opts] node kinds to keep; omit for all
 * @returns {Promise<{nodes:any[],edges:any[],stats:any,problems:any[],kinds:any[]}>}
 */
export async function buildGraph(bookDir, opts = {}) {
  const wanted = Array.isArray(opts.kinds) && opts.kinds.length
    ? opts.kinds
    : (await graphKinds()).map((k) => k.key)

  // ── 1. materialise nodes ────────────────────────────────────────────────
  // Every kind is read, even the ones being filtered out: an edge endpoint may
  // legitimately point outside the visible subgraph, and we still need its label.
  const { schema, kinds, all, alias, problems } = await indexNodes(bookDir)

  // ── 2. edges ────────────────────────────────────────────────────────────
  const edges = []
  const seen = new Set()
  const edgeKey = (from, to, type) => [from, to, type || ''].join('\u0000')

  const addEdge = (fromRef, toRef, type, note, strength, source, origin) => {
    const from = alias.get(String(fromRef ?? '').trim())
    const to = alias.get(String(toRef ?? '').trim())
    if (!from || !to) {
      problems.push({
        code: 'dangling-edge',
        from: String(fromRef ?? ''),
        to: String(toRef ?? ''),
        message: `edge ${fromRef} → ${toRef} (${type || '未分类'}) points at a node that does not exist`,
      })
      return
    }
    if (from === to) {
      problems.push({ code: 'self-edge', id: from, message: `edge ${from} → ${from} is a self-loop` })
      return
    }
    const key = edgeKey(from, to, type)
    if (seen.has(key)) {
      problems.push({ code: 'duplicate-edge', from, to, message: `duplicate edge ${from} → ${to} (${type || '未分类'})` })
      return
    }
    seen.add(key)
    const n = Number(strength)
    edges.push({
      id: `${from}->${to}`,
      from,
      to,
      type: String(type ?? '').trim(),
      note: String(note ?? '').trim(),
      strength: Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 2,
      source,
      // Only a field-derived edge carries its origin: the editor needs to know
      // which record's field to rewrite (or clear) when the reader edits it.
      ...(origin?.field ? { field: origin.field, owner: origin.owner } : {}),
    })
  }

  const doc = await readYamlFile(join(bookDir, EDGE_FILE), {})
  const raw = Array.isArray(doc?.[EDGE_LIST_KEY]) ? doc[EDGE_LIST_KEY] : []
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue
    addEdge(e.from ?? e.a ?? e.source, e.to ?? e.b ?? e.target, e.type ?? e.label ?? e.kind, e.note ?? e.description, e.strength ?? e.weight, 'manual')
  }

  // Auto-edges from declared plain-text fields (item.owner, faction.leader, …).
  for (const kind of kinds) {
    if (!kind.links?.length) continue
    const unit = unitFor(schema, kind)
    if (!unit) continue
    const { items } = await listUnit(bookDir, unit)
    for (const item of items) {
      const id = String(item.id ?? item[kind.label] ?? '').trim()
      if (!id || !all.has(id)) continue
      for (const link of kind.links) {
        for (const value of linkNames(item[link.field])) {
          if (alias.has(value)) addEdge(value, id, link.type, `来自字段 ${link.field}`, 1, 'auto', { field: link.field, owner: id })
          else problems.push({
            code: 'broken-link-field',
            id,
            field: link.field,
            message: `${kind.zh}「${id}」的「${link.field}」写着「${value}」，但没有这个条目`,
          })
        }
      }
    }
  }

  // ── 3. filter to the requested subgraph ─────────────────────────────────
  // Keep an edge when at least one endpoint is visible; the far end becomes a
  // context node rather than being dropped, which is what makes "show me the
  // character web" also show which faction each character belongs to.
  const nodes = new Map()
  const keep = (id) => {
    if (nodes.has(id)) return nodes.get(id)
    const full = all.get(id)
    if (!full) return null
    const copy = { ...full, external: !wanted.includes(full.kind) }
    nodes.set(id, copy)
    return copy
  }

  for (const id of all.keys()) {
    const node = all.get(id)
    if (wanted.includes(node.kind)) keep(id)
  }

  const keptEdges = []
  for (const e of edges) {
    const fromVisible = all.get(e.from) && wanted.includes(all.get(e.from).kind)
    const toVisible = all.get(e.to) && wanted.includes(all.get(e.to).kind)
    if (!fromVisible && !toVisible) continue
    if (!fromVisible) keep(e.from)
    if (!toVisible) keep(e.to)
    keptEdges.push(e)
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (a) a.degree += 1
    if (b) b.degree += 1
  }

  const nodeList = [...nodes.values()].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label, 'zh-Hans-CN'))
  const nodeIds = new Set(nodeList.map((n) => n.id))
  const edgeList = keptEdges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))

  // ── 4. components & orphans ─────────────────────────────────────────────
  const adjacency = new Map(nodeList.map((n) => [n.id, []]))
  for (const e of edgeList) {
    adjacency.get(e.from)?.push(e.to)
    adjacency.get(e.to)?.push(e.from)
  }
  const seenNode = new Set()
  let components = 0
  for (const n of nodeList) {
    if (seenNode.has(n.id)) continue
    components += 1
    const stack = [n.id]
    seenNode.add(n.id)
    while (stack.length) {
      for (const next of adjacency.get(stack.pop()) || []) {
        if (seenNode.has(next)) continue
        seenNode.add(next)
        stack.push(next)
      }
    }
  }

  const visible = nodeList.filter((n) => !n.external)
  return {
    nodes: nodeList,
    edges: edgeList,
    kinds: kinds.map((k) => ({ key: k.key, zh: k.zh, en: k.en })),
    problems,
    stats: {
      nodes: visible.length,
      context: nodeList.length - visible.length,
      edges: edgeList.length,
      manual: edgeList.filter((e) => e.source === 'manual').length,
      auto: edgeList.filter((e) => e.source === 'auto').length,
      components,
      orphans: visible.filter((n) => n.degree === 0).map((n) => n.id),
      byKind: visible.reduce((acc, n) => ({ ...acc, [n.kind]: (acc[n.kind] || 0) + 1 }), {}),
    },
  }
}
