// dsh-novel-studio — HOST half (stable carrier).
//
// Runs inside the DSH Node process and owns everything the browser half cannot
// do: reading and writing the novel library on disk, and exposing that to the
// assistant as tools.
//
// This file is deliberately thin and stable. DSH loads the host half once at
// process start, so anything written directly here would need an app restart to
// take effect. Everything else — routing, the operation layer, the section
// schema, the tool definitions — lives in files that are re-imported with an
// mtime-based cache-busting query. Edit any .js under lib/ (extensions
// included) and the next request runs the new code.
//
// Two contracts are consumed here, both verified against the live runtime:
//   webServer.register(route: WebRoute): () => void
//     WebRoute = { kind: 'exact' | 'prefix', path, handler(req, res) }
//     Duplicate (kind, path) throws, so exactly one prefix route is registered.
//   tools.register(definition: ToolDefinition): () => void
//     Registered through `ctx.inject(['tools'], …)` so the plugin never
//     hard-depends on the tools service.
//   llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>
//     Reached through `ctx.inject(['llm'], …)` for the same reason: an
//     optional dependency must not be able to blank out the whole panel.
//     The handle is passed to the reloadable api layer via `setServices`.

import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const name = 'novel-studio'

export const inject = ['webServer']

const PLUGIN_ID = 'novel-studio'
const BASE = '/novel-studio/api'

const HERE = dirname(fileURLToPath(import.meta.url))

let cache = { token: '', mod: null, wired: false }

// The model catalogue the panel offers: what this deployment can actually run.
// Listing models can reach a provider, so a result is cached briefly. A host
// without llm — or a provider that refuses to list — degrades to an empty
// catalogue; the panel then still keeps whatever route a book already has.
const CATALOG_TTL_MS = 30_000
let catalogCache = { at: 0, value: { providers: [] } }

/**
 * The catalogue shape the panel shows, built from whatever the host reports.
 *
 * The exact member names of `LlmProviderInfo` / `LlmModelInfo` are not pinned in
 * the host contract, so both common spellings are read; a provider that refuses
 * to list, or has nothing to list, still appears with an empty `models`. Exported
 * so it can be exercised without a live llm service.
 */
export async function shapeCatalog(providers, listModels) {
  const out = []
  for (const p of Array.isArray(providers) ? providers : []) {
    const id = String(p?.id ?? p?.key ?? p?.provider ?? '').trim()
    if (!id) continue
    let models = []
    try {
      const listed = typeof listModels === 'function' ? await listModels(id) : []
      models = (Array.isArray(listed) ? listed : [])
        .map((m) => {
          const id = String(m?.id ?? m?.model ?? m?.key ?? '').trim()
          return { id, name: String(m?.name ?? m?.label ?? id).trim() || id }
        })
        .filter((m) => m.id)
    } catch {
      /* a provider that cannot list still appears, with nothing to pick */
    }
    out.push({ id, name: String(p?.name ?? p?.label ?? id), models })
  }
  return { providers: out }
}

async function readCatalog() {
  const llm = services.llm
  if (!llm || typeof llm.listProviders !== 'function') return { providers: [] }
  if (Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value
  const raw = await llm.listProviders()
  catalogCache = {
    at: Date.now(),
    value: await shapeCatalog(raw, (id) => (typeof llm.listModels === 'function' ? llm.listModels(id) : [])),
  }
  return catalogCache.value
}

// Handed to the reloadable api layer on every load. This is one stable object
// whose *fields* are mutated, so a module that captured it sees the llm service
// appear — or disappear on teardown — without being re-imported.
const services = { llm: null, selection: () => null, catalog: readCatalog }

function wire(mod) {
  try {
    mod?.setServices?.(services)
  } catch (err) {
    console.error(`[${PLUGIN_ID}] service handoff failed:`, err)
  }
}

/**
 * Fingerprint of every .js under lib/ — including lib/extensions/, so adding or
 * editing an extension reloads the plugin just like editing a core module.
 */
async function fingerprint() {
  let names
  try {
    names = await readdir(HERE, { recursive: true })
  } catch {
    return 'unreadable'
  }
  const files = names.filter((n) => n.endsWith('.js')).map((n) => String(n).replace(/\\/g, '/')).sort()
  const parts = []
  for (const file of files) {
    try {
      const info = await stat(join(HERE, file))
      parts.push(`${file}:${info.mtimeMs}:${info.size}`)
    } catch {
      parts.push(`${file}:missing`)
    }
  }
  return parts.join(';')
}

async function loadApi() {
  const token = await fingerprint()
  if (cache.mod && cache.token === token) {
    if (!cache.wired) {
      cache.wired = true
      wire(cache.mod)
    }
    return cache.mod
  }
  const mod = await import(`${pathToFileURL(join(HERE, 'api.js')).href}?v=${encodeURIComponent(token)}`)
  cache = { token, mod, wired: true }
  wire(mod)
  void syncTools(token)
  return mod
}

// ── agent tools ───────────────────────────────────────────────────────────

let toolsScope = null
let toolDisposers = []

/**
 * (Re)register the model-facing tools from the reloadable lib/tools.js. Runs at
 * startup and again whenever the fingerprint changes, so a section or tool an
 * extension contributes becomes callable without restarting DSH.
 */
async function syncTools(token) {
  if (!toolsScope) return
  const key = token ?? (await fingerprint())
  try {
    const mod = await import(`${pathToFileURL(join(HERE, 'tools.js')).href}?v=${encodeURIComponent(key)}`)
    const defs = await mod.buildTools()
    for (const dispose of toolDisposers) {
      try {
        dispose()
      } catch {
        // already gone
      }
    }
    toolDisposers = defs.map((def) => toolsScope.tools.register(def))
    console.log(`[${PLUGIN_ID}] ${defs.length} agent tool(s): ${defs.map((d) => d.name).join(', ')}`)
  } catch (err) {
    console.error(`[${PLUGIN_ID}] tool sync failed:`, err)
  }
}

// ── http ──────────────────────────────────────────────────────────────────

async function handler(req, res) {
  let pathname = '/'
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  } catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end('{"ok":false,"error":"bad-url"}')
    return
  }

  const route = {
    method: (req.method ?? 'GET').toUpperCase(),
    rest: pathname.slice(BASE.length) || '/',
  }

  try {
    const api = await loadApi()
    await api.dispatch(req, res, route)
  } catch (err) {
    // A syntax error in a just-edited file must not take the panel down for good.
    console.error(`[${PLUGIN_ID}] dispatch failed:`, err)
    if (!res.headersSent) {
      const buf = Buffer.from(JSON.stringify({ ok: false, error: String((err && err.message) || err) }), 'utf8')
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length })
      res.end(buf)
    } else {
      res.end()
    }
  }
}

// ── mount ─────────────────────────────────────────────────────────────────

export function apply(ctx) {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: BASE, handler })
    console.log(`[${PLUGIN_ID}] host half mounted at ${BASE}`)
    return dispose
  }, `${PLUGIN_ID}: routes`)

  // The default model route. Read through `ctx.get` at call time rather than
  // captured now, so a selection saved later is honoured without a reload.
  services.selection = () => {
    try {
      return ctx.get('agentDefaultModel')?.currentSelection() ?? null
    } catch {
      return null
    }
  }

  // Optional dependency: without an llm service the panel still browses and
  // edits, and the AI pane explains why it cannot run instead of vanishing.
  ctx.effect(() => {
    const fiber = ctx.inject(['llm'], (llmCtx) => {
      services.llm = llmCtx.llm
      llmCtx.effect(
        () => () => {
          services.llm = null
        },
        `${PLUGIN_ID}: llm bridge`,
      )
    })
    return () => {
      try {
        fiber.dispose()
      } catch {
        // never mounted
      }
      services.llm = null
    }
  }, `${PLUGIN_ID}: llm`)

  // Optional dependency: if a deployment has no tools service, the panel still works.
  ctx.effect(() => {
    const fiber = ctx.inject(['tools'], (toolCtx) => {
      toolsScope = toolCtx
      toolCtx.effect(
        () => () => {
          toolsScope = null
          for (const dispose of toolDisposers) {
            try {
              dispose()
            } catch {
              // already gone
            }
          }
          toolDisposers = []
        },
        `${PLUGIN_ID}: tool registrations`,
      )
      void syncTools()
    })
    return () => {
      try {
        fiber.dispose()
      } catch {
        // never mounted
      }
      toolsScope = null
    }
  }, `${PLUGIN_ID}: agent tools`)
}
