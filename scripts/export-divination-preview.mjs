import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const destination = process.argv[2]
if (!destination) throw new Error('Supply a path for the Codex preview fragment.')
const root = fileURLToPath(new URL('../', import.meta.url))
const result = await build({
  stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React, {useRef, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {GuajiSpace} from './standalone/src/divination/GuajiSpace.jsx';
    import {GuideContext, GuideContents} from './standalone/src/guide.jsx';
    const surface = document.getElementById('novel-studio-guaji-preview');
    const prefersNight = matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.appearance = prefersNight ? 'night' : 'day';
    function Preview() {
      const [night, setNight] = useState(prefersNight);
      const [guide, setGuide] = useState('');
      const [view, setView] = useState('workshop');
      const [branch, setBranch] = useState(null);
      const initial = {divination: [], paths: []};
      const dataRef = useRef(initial);
      const [data, setData] = useState(initial);
      const hub = {data, change: (kind, change) => {
        dataRef.current = {...dataRef.current, [kind]: change(dataRef.current[kind])};
        setData(dataRef.current);
      }, flush: async () => true};
      return <GuideContext.Provider value={setGuide}><div className="guaji-preview-desk" data-theme={night ? 'night' : 'day'}>
        <section className="guaji-preview-window" aria-label="Novel Studio 卦象工坊">
          <header className="guaji-preview-chrome"><strong>Novel Studio</strong><div>
            <button onClick={() => {document.documentElement.dataset.appearance = night ? 'day' : 'night'; setNight(!night)}}>{night ? '切到白天' : '切到夜晚'}</button>
            <button onClick={() => setGuide('divination')}>使用说明</button></div>
          </header>
          {view === 'paths' ? <article className="guaji-preview-page"><h1>分岔宇宙</h1><h2>{branch?.title}</h2><p>{branch?.premise}</p><button onClick={() => setView('workshop')}>返回卦象工坊</button></article>
            : <GuajiSpace hub={hub} onModelSettings={() => setGuide('model-preview')} onFork={(id) => {
              setBranch(dataRef.current.paths.find(item => item.id === id)); setView('paths');
            }} />}
          {guide && <aside className="guaji-preview-guide" role="dialog" aria-label="使用说明">
            <header><strong>{guide === 'model-preview' ? '模型设置' : '使用说明'}</strong><button onClick={() => setGuide('')}>关闭</button></header>
            {guide === 'model-preview' ? <p>预览使用示例解读。安装版沿用已保存模型，DSH 版沿用宿主当前模型。</p> : <GuideContents initial={guide} />}
          </aside>}
        </section></div></GuideContext.Provider>;
    }
    createRoot(surface).render(<Preview />);
  ` },
  bundle: true, minify: true, target: 'chrome109', write: false, outfile: 'preview.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'inline-preview-assembly',
    setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, ({ path, importer }) => ({ namespace: 'inline', path: resolve(dirname(importer), path.slice(0, -4)) }))
      plugin.onLoad({ filter: /.*/, namespace: 'inline' }, async ({ path }) => ({ contents: await readFile(path, 'utf8'), loader: 'text' }))
      plugin.onResolve({ filter: /\.\.\/(transport|spaces)\.js$/ }, ({ path }) => ({ path, namespace: 'preview-fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'preview-fixture' }, ({ path }) => ({ loader: 'js', contents: path.endsWith('spaces.js')
        ? `export const uid = () => crypto.randomUUID(); export const createItem = (kind, title, value) => ({ id: uid(), title, ...value });`
        : `export async function* streamWorkspace() {
            yield {type:'model', model:'示例解读'};
            yield {type:'text-delta', text:'把动爻落在角色第一次打破旧习惯的时刻。让一次看似有利的选择带来意外的代价，再从另一条走法试写同一场景。'};
          }` }))
    },
  }],
})
const js = result.outputFiles.find(({ path }) => path.endsWith('.js')).text.replace(/<\/script/ig, '<\\/script')
const css = result.outputFiles.find(({ path }) => path.endsWith('.css')).text
const fragment = `<style>
${css}
#novel-studio-guaji-preview *{box-sizing:border-box}
#novel-studio-guaji-preview .guaji-preview-desk{--studio-background:#e4e4dc;--studio-surface:#f8f8f1;--studio-text:#202a23;--frame-stroke:#b8c0b4;--body-font:Georgia,serif;padding:clamp(7px,1.3vw,15px);background:radial-gradient(ellipse at top left,var(--studio-surface),var(--studio-background));color:var(--studio-text);font:14px system-ui,sans-serif}
#novel-studio-guaji-preview [data-theme=night]{--studio-background:#1c241f;--studio-surface:#253128;--studio-text:#e5e9df;--frame-stroke:#526259;color-scheme:dark}
#novel-studio-guaji-preview .guaji-preview-window{position:relative;display:grid;grid-template-rows:auto minmax(0,1fr);height:720px;border:1px solid var(--frame-stroke);border-radius:17px;overflow:hidden;background:var(--studio-surface);box-shadow:0 16px 36px #10281924,0 3px 11px #10281912}
#novel-studio-guaji-preview .guaji-preview-chrome,#novel-studio-guaji-preview .guaji-preview-guide header{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:10px 14px}
#novel-studio-guaji-preview .guaji-preview-chrome{border-bottom:1px solid var(--frame-stroke)}
#novel-studio-guaji-preview .guaji-preview-chrome div{display:flex;gap:6px}
#novel-studio-guaji-preview button,#novel-studio-guaji-preview select{font:inherit;color:inherit;background:var(--studio-surface);border:1px solid var(--frame-stroke);border-radius:8px;padding:6px 9px;min-height:34px}
#novel-studio-guaji-preview button{cursor:pointer}
#novel-studio-guaji-preview .guaji-preview-page,#novel-studio-guaji-preview .guaji-preview-guide{padding:16px;overflow:auto}
#novel-studio-guaji-preview .guaji-preview-page p{white-space:pre-wrap;overflow-wrap:anywhere}
#novel-studio-guaji-preview .guaji-preview-guide{position:absolute;inset:46px 0 0 auto;width:min(100%,410px);background:var(--studio-surface);border-inline-start:1px solid var(--frame-stroke);box-shadow:-6px 0 18px #0002}
#novel-studio-guaji-preview .guaji-preview-guide header{padding:0 0 10px}
#novel-studio-guaji-preview .guide-topics{display:flex;gap:4px;flex-wrap:wrap}
#novel-studio-guaji-preview .guide-topics svg{display:none}
</style>
<div id="novel-studio-guaji-preview"></div>
<script>${js}</script>
`
if (Buffer.byteLength(fragment) > 1_000_000) throw new Error('Codex preview exceeds 1 MB.')
await writeFile(destination, fragment, 'utf8')
