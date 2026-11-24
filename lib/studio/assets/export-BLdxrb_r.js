const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./library-BWFI1ABg.js","./index-D2rIokL7.js","./node-compat-DcYLBH2J.js","./files-Crg6jTux.js","./platform-D1VmKL2M.js","./index-5cmXGPc6.js","./public-api-DjbuI4w3.js","./records-CQJdwyPo.js","./preload-helper-PPVm8Dsz.js","./index-7ZtTAPUX.js"])))=>i.map(i=>d[i]);
import{_ as u}from"./preload-helper-PPVm8Dsz.js";import{b as E}from"./index-D2rIokL7.js";new URL(import.meta.url).searchParams.get("v");const{atomicWrite:v,readYamlFile:y,writeYamlFile:S}=await u(async()=>{const{atomicWrite:t,readYamlFile:e,writeYamlFile:r}=await import("./library-BWFI1ABg.js");return{atomicWrite:t,readYamlFile:e,writeYamlFile:r}},__vite__mapDeps([0,1,2,3,4,5,6]),import.meta.url),{countWords:z,listUnit:I,parseFrontMatter:F,readUnit:L,compareChapters:O}=await u(async()=>{const{countWords:t,listUnit:e,parseFrontMatter:r,readUnit:n,compareChapters:i}=await import("./records-CQJdwyPo.js");return{countWords:t,listUnit:e,parseFrontMatter:r,readUnit:n,compareChapters:i}},__vite__mapDeps([7,8,1,3,4,5,6]),import.meta.url),{getSchema:_}=await u(async()=>{const{getSchema:t}=await import("./index-7ZtTAPUX.js").then(e=>e.s);return{getSchema:t}},__vite__mapDeps([9,1,2,4,5,6]),import.meta.url),{readdir:b,readFile:T,rm:M}=await u(async()=>{const{readdir:t,readFile:e,rm:r}=await import("./files-Crg6jTux.js");return{readdir:t,readFile:e,rm:r}},__vite__mapDeps([3,1,4]),import.meta.url),{join:d}=await u(async()=>{const{join:t}=await import("./index-5cmXGPc6.js").then(e=>e.i);return{join:t}},[],import.meta.url),{stringify:j}=await u(async()=>{const{stringify:t}=await import("./index-7ZtTAPUX.js").then(e=>e.i);return{stringify:t}},__vite__mapDeps([9,1,2,4,5,6]),import.meta.url),P="publish",p="manifest.yaml",$=1,B=new Set(["records","doc","chapters","files","raw"]);function h(t,e=400){const r=new Error(t);return r.status=e,r}function A(t){const e=String(t??"").trim().replace(/\\/g,"/");if(!e||e.includes("/")||e.includes("..")||e.startsWith(".")||/[\\/:*?"<>|\u0000-\u001f]/.test(e))throw h("invalid artifact file name");if(e.length>120)throw h("artifact file name too long");return e}async function R(t){const e=d(t,"chapters");let r=[];try{r=(await b(e)).filter(i=>i.endsWith(".md"))}catch{return[]}const n=[];for(const i of r.slice().sort((o,s)=>O(o.replace(/\.md$/,""),s.replace(/\.md$/,"")))){const o=i.replace(/\.md$/,"");let s={},a="";try{const c=F(await T(d(e,i),"utf8"));s=c.meta,a=c.body}catch{}n.push({id:o,title:String(s.title??"").trim()||o,body:a,words:z(a),meta:s})}return n}function V(t){return{chapters:t.length,words:t.reduce((e,r)=>e+r.words,0),empty:t.filter(e=>!String(e.body).trim()).length}}function W(t){const e={};for(const[r,n]of Object.entries(t))n==null||n===""||Array.isArray(n)&&!n.length||(e[r]=n);return j(e,{lineWidth:0}).trimEnd()}function D({book:t,chapters:e,stats:r,stamp:n}){const o=[`---
${W({title:t.title||t.id,author:t.author,genre:t.genre,tags:t.tags,exported:n,chapters:r.chapters,words:r.words})}
---`,`# ${t.title||t.id}`];t.logline&&o.push(`> ${t.logline}`);for(const s of e){o.push(`## ${s.title}`);const a=String(s.body).trim();a&&o.push(a)}return`${o.join(`

`)}
`}function H({book:t,chapters:e}){const r=[t.title||t.id];t.author&&r.push(t.author),t.logline&&r.push(t.logline);for(const n of e){r.push(n.title);const i=String(n.body).trim();i&&r.push(i)}return`${r.filter(Boolean).join(`

`)}
`}function f(t){return String(t??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}function U(t){return String(t??"").split(/\n[ \t]*\n/).map(e=>e.trim()).filter(Boolean).map(e=>`<p>${f(e).replace(/\n/g,"<br>")}</p>`).join(`
`)}function Y({book:t,chapters:e,stats:r,stamp:n,options:i={}}){const o=t.title||t.id,s=i.lang||"zh",a=e.map(c=>["<section>",`<h2>${f(c.title)}</h2>`,U(c.body),"</section>"].filter(Boolean).join(`
`)).join(`
`);return`<!doctype html>
<html lang="${f(s)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${f(o)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;padding:3rem 1.25rem 6rem;background:#fbfaf7;color:#1b1b1b;
 font:16px/1.85 "Iowan Old Style","Source Han Serif SC","Songti SC",Georgia,serif}
main{max-width:36em;margin:0 auto}
h1{font-size:1.9em;line-height:1.3;margin:0 0 .2em}
.byline{color:#6b6b6b;margin:0 0 2.5em}
.logline{font-style:italic;color:#444;border-left:2px solid #d8d3c8;padding-left:1em;margin:0 0 3em}
section{margin:0 0 3.5em}
h2{font-size:1.15em;font-weight:600;margin:0 0 1.2em;letter-spacing:.02em}
p{margin:0 0 1em;text-indent:2em}
footer{margin-top:4em;color:#8a8a8a;font-size:.85em;text-align:center}
@media print{
 body{background:#fff;padding:0;font-size:11.5pt}
 section{page-break-before:always}
 section:first-of-type{page-break-before:avoid}
}
</style>
</head>
<body>
<main>
<h1>${f(o)}</h1>
${t.author?`<p class="byline">${f(t.author)}</p>`:""}
${t.logline?`<p class="logline">${f(t.logline)}</p>`:""}
${a}
<footer>${f(String(r.words))} 字 · ${f(String(r.chapters))} 章 · ${f(n)}</footer>
</main>
</body>
</html>
`}function C({book:t,chapters:e,stats:r,stamp:n,data:i}){const{dir:o,...s}=t;return`${JSON.stringify({format:"novel-studio/book",version:1,exportedAt:n,book:s,stats:r,chapters:e.map(a=>({id:a.id,title:a.title,words:a.words,meta:a.meta,body:a.body})),...i?{data:i}:{}},null,2)}
`}const x=[{key:"md",zh:"手稿 Markdown",en:"Manuscript (Markdown)",ext:"md",mime:"text/markdown; charset=utf-8",render:D},{key:"txt",zh:"纯文本",en:"Plain text",ext:"txt",mime:"text/plain; charset=utf-8",render:H},{key:"html",zh:"单页 HTML",en:"Standalone HTML",ext:"html",mime:"text/html; charset=utf-8",render:Y},{key:"json",zh:"整书备份",en:"Whole-book backup",ext:"json",mime:"application/json; charset=utf-8",needsData:!0,render:C}];async function k(){const t=await _().catch(()=>({extraFormats:[]})),e=[];for(const r of t.extraFormats||[]){if(x.some(n=>n.key===r.key)){console.error(`[novel-studio] extension format "${r.key}" skipped (shadows a built-in format)`);continue}e.push(r)}return[...x,...e]}async function Q(){return(await k()).map(e=>({key:e.key,zh:e.zh||e.key,en:e.en||e.key,ext:e.ext,mime:e.mime}))}async function N(t){const e=await _(),r={};for(const n of e.sections){const i=n.kind==="groups"?n.groups||[]:[n];for(const o of i){if(!o||!B.has(o.kind))continue;const s=n.kind==="groups"?`${n.key}/${o.key}`:n.key;try{const{items:a,extra:c}=await I(t,o);if(c&&c.text!==void 0)r[s]=c.text;else if(o.kind==="files"){const l=[];for(const m of a)try{const w=(await L(t,o,m.id))?.data?.text;l.push(typeof w=="string"?{id:m.id,text:w}:{id:m.id,size:m.size,binary:!0})}catch{l.push({id:m.id,size:m.size})}r[s]=l}else r[s]=a}catch(a){r[s]={error:String(a&&a.message||a)}}}}return r}async function J(t,e,r={}){const n=String(r.format||"md"),i=(await k()).find(m=>m.key===n);if(!i)throw h(`unknown export format "${n}"`);const o=await R(t),s=V(o),a=new Date().toISOString(),c=i.needsData?await N(t):null,l=String(await i.render({book:e,chapters:o,stats:s,stamp:a,dir:t,data:c,options:r}));return{format:i.key,label:i.zh||i.key,ext:i.ext||"txt",mime:i.mime||"text/plain; charset=utf-8",filename:A(r.filename||`${e.id||e.title||"book"}.${i.ext||"txt"}`),text:l,bytes:E.Buffer.byteLength(l,"utf8"),...s}}function g(t){return d(t,P)}async function X(t){const e=g(t),r=await y(d(e,p),{}),n=Array.isArray(r?.artifacts)?r.artifacts:[];let i=[];try{i=(await b(e)).filter(a=>!a.startsWith(".")&&a!==p)}catch{}const o=new Set(n.map(a=>a?.file).filter(Boolean)),s=i.filter(a=>!o.has(a)).map(a=>({file:a,format:null,untracked:!0}));return{path:e,artifacts:[...n.filter(Boolean),...s]}}async function Z(t,e,r={}){const n=await J(t,e,r),i=g(t);await v(d(i,n.filename),n.text);const o=d(i,p),s=await y(o,{}),a=Array.isArray(s?.artifacts)?s.artifacts.slice():[],c={file:n.filename,format:n.format,bytes:n.bytes,chapters:n.chapters,words:n.words,createdAt:new Date().toISOString()},l=a.findIndex(m=>m?.file===n.filename);return l===-1?a.push(c):a[l]={...a[l],...c},await S(o,{schemaVersion:$,artifacts:a}),{artifact:c,path:d(i,n.filename),format:n.format,label:n.label,bytes:n.bytes,chapters:n.chapters,words:n.words}}async function tt(t,e){const r=A(e);if(r===p)throw h("cannot delete the manifest");const n=g(t);await M(d(n,r),{force:!0});const i=d(n,p),o=await y(i,{}),s=Array.isArray(o?.artifacts)?o.artifacts:[],a=s.filter(c=>c?.file!==r);return a.length!==s.length&&await S(i,{schemaVersion:$,artifacts:a}),{file:r,removed:!0}}export{p as MANIFEST,$ as MANIFEST_VERSION,P as PUBLISH_DIR,V as chapterStats,tt as deleteArtifact,J as exportBook,k as formatList,Q as formatMenu,X as listArtifacts,Z as publishBook,g as publishPath,R as readChapters};
