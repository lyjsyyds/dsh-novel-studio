import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { transform } from 'esbuild'

const source = process.argv[2]
if (!source) throw new Error('Supply the Guaji ai-divination directory as the first argument.')
const vendor = new URL('../standalone/src/divination/vendor/', import.meta.url)
await mkdir(vendor, { recursive: true })
const read = (path) => readFile(join(source, 'web', path), 'utf8').then((text) => text.replace(/\r\n/g, '\n'))

function cut(text, start, end, replacement = '') {
  const from = text.indexOf(start)
  const to = text.indexOf(end, from + start.length)
  if (from < 0 || to < 0) throw new Error('Unexpected Guaji source section: ' + start)
  return text.slice(0, from) + replacement + text.slice(to)
}

const html = await read('index.html')
const safeScripts = [
  'guatu.js', 'i18n.js', 'manifests.js', 'casts/registry.js', 'casts/shared/kit.js', 'casts/shared/lines.js',
  'casts/shared/stage.js', 'casts/liuyao/coin.js', 'casts/liuyao/time.js', 'casts/liuyao/number.js',
  'casts/meihua/time.js', 'casts/meihua/number.js', 'casts/meihua/random.js', 'casts/zhouyi/dayan.js',
  'casts/zhouyi/coin.js', 'casts/xiaoliuren/palm.js', 'casts/qimen/hour.js', 'casts/daliuren/monthhour.js',
  'casts/default.js', 'casts/index.js',
]
const parts = await Promise.all(safeScripts.map((name) => read('static/' + name)))
let markup = cut(html, '<div class="modal" id="modal"', '<!-- ══════════════ 自定义事类管理弹层', `<div class="modal" id="modal" style="display:none">
  <div class="modal-box"><div class="modal-head"><h2>工坊设置</h2><button id="btnCloseModal" type="button">关闭</button></div>
  <div class="modal-body"><div class="cfg-section"><p>界面语言</p><div class="lang-row" id="langRow"></div></div>
  <button type="button" id="studioModelSettings">打开工作台模型设置</button></div></div></div>
`)
markup = cut(markup, '    <div class="field" id="llmField">', '    <div class="actions">')
markup = cut(markup, '    <!-- 顶栏「窥天机」', '    <button aria-label="设置"')
markup = markup.replace('    <div class="actions">', `    <details class="studio-inputs"><summary>起卦时间与种子</summary>
      <label>起卦时间 <input type="datetime-local" id="studioTimestamp" step="1"></label>
      <label>随机种子 <input type="text" id="studioSeed" maxlength="128" placeholder="留空时自动生成"></label>
    </details>\n    <div class="actions">`)
markup = markup.replace(/<link\b[^>]*href="\/static\/style\.css"[^>]*>/, '')
  .replace(/<script\s+src="\/static\/[^"]+"><\/script>/g, '').replace(/<!--pnid:[^>]*-->/g, '')
  .replace('<div class="panel" id="summaryPanel"', `<section class="panel studio-reading" id="studioResultActions" hidden>
  <div class="panel-head"><h2>创作笔记</h2></div>
  <details class="studio-effective"><summary>本次起卦输入</summary><p id="studioEffective"></p></details>
  <div class="actions">
    <button type="button" id="studioInterpret">AI 解读</button><button type="button" id="studioSave">保存卦象笔记</button>
    <button type="button" id="studioFork">送入分岔宇宙</button>
  </div><p id="studioStatus" role="status"></p><div id="studioDraft" hidden>
    <h3>AI 草稿</h3><p id="studioModel"></p><p id="studioText"></p>
    <button type="button" id="studioAdopt">采纳到笔记</button><button type="button" id="studioDiscard">丢弃</button>
  </div><div id="studioConfirm" hidden><p>把这次的题目和卦象摘要制成一条新推演？</p>
    <button type="button" id="studioConfirmFork">创建推演</button><button type="button" id="studioCancelFork">取消</button>
  </div><div id="studioAccepted"></div></section>
  <div class="panel" id="summaryPanel"`)
if (!markup.includes('id="studioResultActions"') || /<script\b|\son\w+=|\b(?:src|href)="https?:/i.test(markup)) {
  throw new Error('Unexpected executable or remote resource in Guaji markup')
}
let app = await read('static/app.js')
app = app.slice(app.indexOf('const $ ='))
app = cut(app, '/* 暴露给测试', '/* ══════════════ 工具')
app = cut(app, 'async function api(', '/* ══════════════ 星图背景', 'const api = (path, body) => studioRequest(path, body);\n\n')
app = cut(app, '  // 设置面板：先用', '  renderLangRow();')
app = app.replace('    if (META.config) fillConfig(META.config);\n', '')
app = cut(app, '/* ══════════════ 厂商适配', '/* ══════════════ 界面语言切换')
app = app.replaceAll('  renderProviderChips();\n', '').replaceAll('  syncThinkingUI();\n', '')
app = cut(app, '  // 厂商相关提示按新语言重刷', '  // 模式切换按钮文案')
app = cut(app, "  $('#btnSettings').addEventListener('click', () => {", "  $('#btnCloseModal')", "  $('#btnSettings').addEventListener('click', () => { renderLangRow(); $('#modal').style.display = 'flex'; });\n")
app = cut(app, '  // 「窥天机」开关：设置面板', "  $('#btnAsk').addEventListener")
app = cut(app, '    const r = await fetch(API_BASE', '  } catch (e) {\n    bubble.textContent', `    const draft = await studioRequest('/api/chat', { followup: q });
    bubble.textContent = draft.text;
    studioShowDraft(draft);
`)
app = app.replace("    use_llm: $('#useLLM').checked,\n    thinking: getThinking(),   // 窥天机随请求下发：面板开了（即使没保存）也即时生效", '    use_llm: false,')
app = app.replace('    use_llm: false,', `    timestamp: $('#studioTimestamp').value,
    seed: $('#studioSeed').value,
    use_llm: false,`)
  .replace("    use_llm: $('#useLLM').checked,", '    use_llm: false,')
  .replace(/\s*thinking: getThinking\(\),[^\n]*/g, '')
  .replace(/use_llm: \$\('#useLLM'\)\.checked/g, 'use_llm: false')
  .replace(/use_llm: !!\(\$\('#useLLM'\)[\s\S]+?key_configured\),/, 'use_llm: false,')
  .replaceAll("if (META && META.config) fillConfig(META.config);", '')
app = app.replace('      category: LAST_RESULT.category_key,', '      category: LAST_RESULT.category_key,\n      timestamp: LAST_RESULT.studioInput.timestamp, seed: LAST_RESULT.studioInput.seed,')
app = app.replace("let PROGRESSIVE = true", "let PROGRESSIVE = !matchMedia('(prefers-reduced-motion: reduce)').matches")
app = app.replace('const anim = PROGRESSIVE', 'const anim = PROGRESSIVE && !matchMedia(\'(prefers-reduced-motion: reduce)\').matches')
app = app.replace('    await renderResult(res);', '    await renderResult(res);\n    studioPresent(res);')
app = app.replace('${v.error}', '${escapeHtml(v.error)}').replace('${v.name}</span>', '${escapeHtml(v.name)}</span>')
  .replace('${v.main}</span>', '${escapeHtml(v.main)}</span>')
app = app.replace(/\ninit\(\);\s*$/, '')
app = app.replaceAll('localStorage.', 'studioPrefs.')
const bridge = await readFile(new URL('../standalone/src/divination/frame-bridge.js', import.meta.url), 'utf8')
const sourceCode = [bridge, ...parts.map((part, index) => index === 1
  ? part.replace(/function (\w+)\(\) \{\s*return safe\(\(\) => \(typeof localStorage[\s\S]+?\n  \}/, 'function $1() { return studioPrefs; }')
    .replaceAll('走向概率', '走向权重').replaceAll('Outcome Probability', 'Story Direction Weights')
  : part.replaceAll('localStorage.', 'studioPrefs.')), app].join('\n;\n')
if (/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|DEFAULT_API_BASE|llm\.api_key/i.test(sourceCode)) {
  throw new Error('Found a legacy network or configuration path in the embedded JavaScript')
}
await writeFile(new URL('view.html', vendor), markup, 'utf8')
const style = await transform(await read('static/style.css'), { loader: 'css', minify: true })
await writeFile(new URL('theme.css', vendor), style.code, 'utf8')
const { code } = await transform(sourceCode, { loader: 'js', target: 'es2020', minifySyntax: true, minifyWhitespace: true, legalComments: 'inline' })
await writeFile(new URL('view.js', vendor), code, 'utf8')
