# 扩展 dsh-novel-studio / Extending the studio

这个插件被设计成**可以被继续加东西**：加一个新的分区（tab）、一条 HTTP 路由、一个给 AI 用的工具，都只需要往 `lib/extensions/` 丢一个 `.js` 文件。

This plugin is built to be extended: a new section (tab), an HTTP route, or an
assistant-facing tool is one `.js` file in `lib/extensions/`.

---

## 1. 为什么改文件就能生效 / Why edits take effect without a restart

DSH 只在进程启动时加载一次插件的 host 半边。所以 `lib/index.js` 被刻意写得很薄，只做三件事：注册一条 HTTP 路由、注册 agent 工具、以及**给 `lib/` 下每个 `.js` 算指纹**。

每次 HTTP 请求都会重新算指纹；指纹变了就把整套模块用 `?v=<指纹>` 重新 `import` 一遍（`api.js` → `schema.js` / `library.js` / `records.js` / `graph.js` / `edges.js` / `validate.js` / `export.js` / `ai.js` / `ops.js`，`ai.js` → `prompt.js` / `graph.js` / `validate.js`，`tools.js` → `ops.js`）。因此：

| 改了什么 | 生效方式 |
| --- | --- |
| `lib/extensions/*.js` | 下一个请求 |
| `lib/schema.js`、`records.js`、`library.js`、`graph.js`、`edges.js`、`validate.js`、`export.js`、`prompt.js`、`ai.js`、`ops.js`、`api.js`、`tools.js` | 下一个请求 |
| `lib/client.js`（浏览器半边） | 刷新页面 |
| `lib/index.js` | **需要重启 App** |

指纹是递归的：新增一个扩展文件本身就会改变指纹。

---

## 2. 扩展文件能导出什么 / What an extension may export

```js
export const id = 'wordcount'                 // 标识，出现在报告里
export const sections = [...]                 // 新分区（面板里多一个 tab）
export const routes = [...]                   // /novel-studio/api/ext/<id>/...
export const tools = [...]                    // 给 AI 用的工具
export const graphs = [...]                   // 关系网里多一种节点
export const rules = [...]                    // 校验里多一条规则
export const formats = [...]                  // 导出时多一种格式
export const ai = [...]                       // AI 标签里多一个任务
```

全部可选。八个都省略也不会报错，只是什么都不做。

> 文件名以 `_` 开头的扩展会被**跳过**（保留但禁用）。`lib/extensions/_example.js` 就是这样一个模板。

---

## 3. 分区 / Sections

`kind` 有六种：

| kind | 含义 | 存放方式 | 条目 id |
| --- | --- | --- | --- |
| `records` | 一个条目一个文件 | `<dir>/<id>.yaml` | 文件名主干（slug） |
| `doc` | 一个文件里放整个数组 | `<path>` → `{ [listKey]: [...] }` | 0 起的列表下标 |
| `chapters` | Markdown + YAML front matter | `<dir>/<id>.md` | 文件名主干 |
| `files` | 原始文件，不解析 | `<dir>/` | 文件名 |
| `raw` | 整份 YAML 当文本编辑（逃生舱） | `<path>` | — |
| `groups` | 分区下再分组 | `groups: [...]` | — |

例：

```js
export const sections = [
  { key: 'sparks', zh: '灵感', en: 'Sparks', kind: 'doc',
    path: 'meta/sparks.yaml', listKey: 'sparks', titleField: 'text',
    fields: [
      { k: 'text', zh: '内容', en: 'Text', type: 'textarea' },
      { k: 'tags', zh: '标签', en: 'Tags', type: 'tags' },
      { k: 'used', zh: '已用', en: 'Used', type: 'boolean' },
    ] },
]
```

- **`fields` 可以整个省略。** 省略时客户端用 `inferFields()` 从已有数据推断表单（取前 50 条的键并集，按首个非空值判类型）。这是「先有数据、后补结构」的通道：AI 可以直接往一个没声明过结构的 YAML 里写东西，面板照样能编辑。
- `key` 与内置分区或另一个扩展冲突时，该分区被跳过并在日志里留一行，不影响其它部分。
- 写入容器文件时是**合并**而不是覆盖：`schemaVersion` 和其它你不认识的兄弟键都会保留。
- **新分区会自动进入检索与导入。** `lib/search.js` 按 `getSchema()` 的顺序扫所有可搜的 kind（`records` / `doc` / `chapters` / `files` / `raw`），所以扩展贡献的分区不需要额外登记就能被 `?q=` 搜到；`lib/import.js` 同样按分区回灌备份，认不出的 kind 会被跳过并在报告里写一行 warning。只读或纯派生的分区应该自己从备份里排除（`importBackup` 会跳过 `drafts` 这类内部目录）。
- **新分区也是「补材料」的候选。** `lib/extract.js` 的 `extractTargets()` 同样按 `getSchema()` 走：只要一个单元是 `records` 或 `doc`、并且声明了 `titleField`，它就会出现在给模型的区域目录里，字段清单与 `select` 选项表都从 schema 现取。所以扩展贡献的分区**不用改一行代码**就能被 AI 识别后自动补条目；反过来，`titleField` 没声明的单元不会被写（模型给了名字也无处安放）。
- **偏好可以写进 `settings.yaml`。** `POST /library/:book/settings` 只校验它认识的四个键（`theme` / `autosave` / `fontSize` / `wordGoal`），其余键原样透传并保留，所以扩展可以把自己的设置放在同一个文件里。

---

## 4. 路由 / Routes

```js
export const routes = [
  { method: 'GET', pattern: '/ext/sparks/unused', handler: async (req, res, ctx) => {
      return ctx.json(res, { ok: true })
    } },
]
```

`pattern` 按 `/` 切段逐段匹配，`:name` 捕获进 `ctx.params`。`handler` 拿到的是：

```
ctx = {
  json, fail, readJsonBody,          // 响应与请求体
  resolveRoot, listBooks, readBook,  // 书库
  getSchema,                         // 解析后的分区树（含 unitOf / unitByPath）
  listUnit, readUnit, writeUnit, deleteUnit, inferFields,
  bookDirOf(bookId),                 // 书目录的绝对路径
  params,                            // 路径里 :name 捕获的值
  segments,                          // 完整路径段数组
}
```

路由挂在 `/novel-studio/api` 之下，所以浏览器端可以 `fetch('/novel-studio/api/ext/sparks/unused/星海拾遗')`。

---

## 5. 工具 / Tools

```js
export const tools = [
  { name: 'novel_sparks_unused',
    description: '列出某本书里还没用过的灵感。',
    parameters: { type: 'object', properties: { book: { type: 'string' } }, required: ['book'] },
    run: async (args, ctx) => ctx.invoke('records', { action: 'list', book: args.book, section: 'sparks' }) },
]
```

`run(args, ctx)` 里的 `ctx` 是 `{ invoke, getSchema, guide, schema }`；`invoke` 是插件内部的统一操作层（见下）。工具名与内置工具或另一个扩展重名时被跳过并记日志。

工具注册会在指纹变化时**重新同步**，所以新工具同样不需要重启。

---

## 6. 关系网 / Graphs

关系网默认认四种节点：`characters`（人物）、`factions`（势力）、`locations`（地点）、`items`（物品）。加一种只要声明它在哪个分区、拿哪个字段当名字：

```js
export const graphs = [
  { key: 'relics', zh: '遗物', en: 'Relics',
    section: 'relics',        // 必填：节点来自哪个分区
    group: undefined,         // 分区是 groups 时再填分组 key
    label: 'name',            // 必填：拿哪个字段当显示名
    role: 'type',             // 可选：副标题字段
    links: [                  // 可选：从这个字段自动连边
      { field: 'owner', type: '持有' },
    ] },
]
```

- 节点 id 就是条目 id；`label` 字段的值会被登记成**别名**，所以关系边里写 id 或写显示名都能解析。
- `links` 里的字段值如果指向另一个节点的 id/别名，就自动生成一条边（来源标记为 `auto`，虚线绘制）。指向不存在的名字不会生成边，而是记进 `problems`（`broken-link-field`）。
- `links` 的字段可以是**多值**的：数组，或 `老周、林望` 这样的逗号串都读，**每个名字各得一条边**。势力 `members`（成员）、物品 `owner`（持有者）、面板分组的 `owners`（归属）就是这个形状，所以一对多 / 多对一 / 多对多共用同一套读写——人物卡上的「档案」抽屉就是按这些字段绑 / 解绑的。
- 手动边仍然写在 `relationships.yaml` 的 `edges` 数组里：`{ from, to, type, note?, strength? }`。
- **过滤语义**：面板选了「只要人物」时，一条边只要有**任一端**可见就保留，另一端作为灰色上下文节点画出来——这样人物图里依然能看到各人所属的势力，而不是一堆孤立点。

---

## 7. 校验 / Rules

```js
export const rules = [
  { id: 'no-placeholder', zh: '不要留占位符', level: 'warn',
    run(ctx) {
      for (const u of ctx.units) {
        for (const item of u.items) {
          for (const s of ctx.stringsOf(item)) {
            if (s.includes('TODO')) ctx.add(this.id, this.level, `还有 TODO：${s}`, { unit: u.key })
          }
        }
      }
    } },
]
```

`level` 是 `error` / `warn` / `info` 之一，决定它在报告里落在哪一栏。

`run(ctx)` 拿到的 `ctx`：

```
ctx = {
  book,                 // 书的元信息
  dir,                  // 书的绝对目录
  schema,               // 解析后的分区树
  units,                // 已展开、已读取的分区：[{ key, zh, kind, items, ... }]
  graph,                // buildGraph() 的结果（nodes / edges / problems）
  known,                // 所有已知 id + label 的 Set，用来查引用
  texts,                // Map<分区key, 章节全文>，供扫 [[wiki 链接]]
  stringsOf(value),     // 递归取出一段数据里所有字符串
  add(rule, level, message, extra),
}
```

- **规则只读，绝不写入。** 写文件的只有 `lib/records.js`。
- 一条规则抛异常不会中断整场校验：它被兜住，变成一条 `level: 'error'` 的报告，其余规则照常跑完。
- 内置 13 条规则（书题缺失、悬空边、自环、重复边、断掉的联动字段、`[[链接]]` 指向未知条目、空标题条目、空章节、章节序号重号/断号、未回收的伏笔、未关闭的线、孤立节点、空分区）可以通过 `GET /library/<书>/validate/rules` 或 `novel_validate { rules: 'list' }` 列出来。

---

## 8. 导出格式 / Formats

导出走的是「拿到整本书 → 变成一个字符串」这条路，所以加一种格式就是加一个纯函数。

```js
export const formats = [
  { key: 'csv', zh: '表格', en: 'Spreadsheet', ext: 'csv', mime: 'text/csv',
    render(ctx) {
      const rows = [['章', '字数', '正文']]
      for (const c of ctx.chapters) rows.push([c.title, String(c.words), c.body.replace(/\n/g, ' ')])
      return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    } },
]
```

`key` 必须有，`render` 必须是函数，**两者缺一就会被丢弃并 `console.error`**。

`render(ctx)` 拿到的 `ctx`：

```
ctx = {
  book,                 // 书的元信息（已去掉 dir，不含本地路径）
  dir,                  // 书的绝对目录（要读额外文件时才用）
  chapters,             // [{ id, title, body, words, meta }]，已按章节序号排好
  stats,                // { chapters, words, empty }
  stamp,                // 本次导出的 ISO 时间戳
  data,                 // 整书数据备份，仅当 needsData: true 时才会被收集
  options,              // { format, filename, lang }，调用方原样透传
}
```

- `needsData: true` 会让宿主先把**所有可列举分区**读成 `{ '分区key': items }`（`groups` 会展开成 `'world/rules'` 这样带斜杠的 key），代价是一次全库读取，所以默认关闭。
- **内置四个格式是 `md` / `txt` / `html` / `json`，扩展不能用同名的 `key` 覆盖它们**——`md` 被顶替会让「导出 Markdown」静默变成别的东西，所以冲突时内置格式胜出，扩展那条被丢弃。
- 新增的格式会排在菜单最后，立刻出现在「导出」标签的格式条里，也能被 `novel_publish` 落盘。

---

## 9. AI 任务 / AI tasks

面板的「AI」标签有四个内置任务：续写、润色、大纲推演、一致性审稿。加第五个就是加一个 `ai` 数组。

```js
export const ai = [
  { key: 'timeline', zh: '年表推演', en: 'Timeline',
    hint: '把已写的情节按时间排一遍',
    needs: 'none',            // 'chapter' | 'text' | 'input' | 'none'
    maxTokens: 900,
    system: '你是年表编辑。只输出年表本身。',
    frame(request, context) { return `按时间排一遍。${request.instruction || ''}` } },
]
```

`key`、`zh`、`frame` 三者缺一就会被丢弃并 `console.error`。

- `frame(request, context)` 返回**这次请求的那一段**（放在设定之后）。`request` 是面板发来的原始体
  （`task` / `chapter` / `text` / `input` / `instruction` / `maxTokens`），`context` 与内置任务拿到的
  完全一样——关系网、人物、世界规则、术语、故事线、情节节拍、章节索引、校验问题。写作时用
  `lib/prompt.js` 里的 `clip` / `oneLine` / `section` 就够了，它们会**把截断讲给模型听**。
- `system` 会被接在公共人设（`PERSONA`）之后，人设不可覆盖：设定高于即兴发挥。
- `needs` 决定面板显示哪个输入框，也决定缺参数时的 `400`：`'chapter'` 要选章、`'text'` 要原文、
  `'input'` 要一个想法、`'none'` 什么都不用。默认 `'none'`。
- `maxTokens` 默认 1400。
- **键名与内置任务冲突时内置胜出**，扩展那条被丢弃（`polish` 被顶替会让「润色」静默变成别的东西）。
  `lib/prompt.js` 是唯一知道内置键名的地方。
- 新任务排在菜单最后，立刻出现在 AI 标签的下拉里，也能直接 `POST /library/:book/ai {task:'timeline'}`。

**扩展新增的分区会自动进入勾选面板。** AI 标签跑一轮之前可以勾选这本书要喂进去的条目，那个清单不是写死的：
`lib/ai.js` 的 `poolDefs(schema)` 从解析后的分区树里挑出所有 `records` / `doc` 分区与子组，键就是分区路径
（`world/locations`、`outline/beats`、你新加的 `relics` 或 `world/timeline`）。所以你写下一个 `records` 分区，
它下一次请求就会作为一组可勾选条目出现；条目 id 取 `id`（records）或 `titleField`（doc，回退 `name/title/term/event`），
标签取同名标题字段。`frame(request, context)` 里想按勾选裁剪自己要读什么，看 `context.pools`：每个池是
`{ key, zh, section, group, titleField, keys, labels, items: [{ id, label, on, data }] }`——`on` 就是调用方
勾选的结果（未提及的池默认全 true）。`pick` 形状与校验见 `README.md` 的「AI 联动」。

---

## 10. 内部操作层 / The operation layer (`lib/ops.js`)

HTTP 路由、agent 工具、扩展都走同一个 `invoke(operation, payload)`。它**从不抛异常**：业务上的拒绝返回 `{ ok: false, code, message }`，让调用方（尤其是模型）能读到原因并自行纠正。

| operation | payload | 说明 |
| --- | --- | --- |
| `guide` | `{ topic }` | `overview` / `data` / `extend` 三份说明文本 |
| `schema` | `{}` | 解析后的分区树 |
| `books` | `{ action, book?, title?, meta?, patch? }` | `list` `create` `get` `update` `delete` |
| `records` | `{ action, book?, section?, group?, entry?, data? }` | `schema` `list` `read` `write` `delete` |
| `extensions` | `{ action, name?, source?, ... }` | `list` `scaffold` `write` `delete` |
| `graph` | `{ book, kinds?: string[] \| 'list' }` | 关系网；`'list'` 返回节点类型菜单 |
| `validate` | `{ book, rules?: 'list' }` | 一致性校验；`'list'` 返回规则目录 |
| `path` | `{ book, section, group? }` | 某个分区的绝对路径 |
| `search` | `{ book, q, limit?, section? }` | 在整本书里找词：正文（带行号）、记录字段、文件名、原始 YAML |
| `chapters` | `{ action, ... }` | `plan` 读序计划 / `reorder` 重排 / `renumber` 重编号 |
| `drafts` | `{ action, ... }` | `list` `read` `save` `restore` `delete` 章节快照 |
| `progress` | `{ book, action?, words?, deadline? }` | `get` 进度与节奏 / `set` 目标字数与截止日 |
| `settings` | `{ book, action?, patch? }` | `get` / `set` 这本书的偏好（未知键原样保留） |
| `import` | `{ action, ... }` | `list` `backup` `markdown`；**写操作默认 dry-run** |
| `extract` | `{ book, action?, chapter?, passage?, entries? }` | `recognize` 只给清单（不写盘）/ `apply` 把选中的条目补进各分区 |
| `root` | `{ action?, root?, path?, move?, reset? }` | 书库根目录：`get` 现状与来源 / `set` 换位置（`move: true` 连书一起搬）/ `reset` 交还默认；被 `DSH_NOVEL_ROOT` 钉住时报 `root-locked`。**扩展别在 `get` 之外随手改它**：书库位置是全局的，改完所有书一起搬家 |

---

## 11. 给 AI 的工具 / The assistant-facing tools

装好之后，助手会多出十六个工具：

- **`novel_guide`** — 读插件手册（`overview` / `data` / `extend`）。
- **`novel_library`** — 建书、列书、改元信息、删书。
- **`novel_records`** — 读写真个分区里的条目（人物、世界观、大纲、面板、正文、素材）。`action: 'schema'` 先列出所有分区在哪。
- **`novel_graph`** — 取一本书的关系网（节点、边、自动生成的联动边、图内异常）。`kinds: 'list'` 先看有哪些节点类型，传数组则只看那几类。
- **`novel_link`** — 增 / 删 / 改一条关系。一条关系只有两个归宿，它会自动选对：手写的 `relationships.yaml` 行，或记录上的字段（`item.owner` / `faction.leader` / `location.region`）。改写后者就是**改写那个字段**，所以人物卡与关系图永不打架——这正是面板里「同步到各大区域」的机制。先 `novel_graph` 看 `id` / `type` / `source`，再动手。
- **`novel_validate`** — 跑一遍一致性校验，返回 `error` / `warn` / `info` 三档问题清单。**只读**；`ok` 仅在出现 `error` 时为 false。写完一批内容后跑一次，把发现讲给用户听。
- **`novel_export`** — 把整本书渲染成一份文本（Markdown / 纯文本 / 可打印 HTML / JSON 备份）交回给模型，**不写盘**。适合「把第一章发我看看」这类请求。
- **`novel_publish`** — 真正落盘到书的 `publish/` 目录：`formats` 列格式、`list` 列已发布文件、`write` 生成一份、`delete` 删掉一份。适合「导出一份手稿给我」。
- **`novel_extension`** — 装扩展：`scaffold` 出模板 → `write` 写入 `lib/extensions/`。写入时会真的 `import` 一次做校验：语法错、顶层抛错、导出形状不对，都会把文件**回滚删除**并说明原因。
- **`novel_ai`** — 在聊天里跑这本书的 AI 任务。`action: 'list'` 看任务菜单（**扩展贡献的任务同样出现在里面**）；`action: 'context'` 预览会读到什么（含勾选目录，不调模型）；`action: 'run'` 真跑一轮，返回全文与 `usage`。参数与 `POST /library/:book/ai` 的 body 一致：`task` 默认 `continue`，`pick` 勾选要喂进去的条目，`history` 带上之前的问答（多轮）。业务拒绝按 `{ ok: false, code, message }` 交回（`bad-pick` / `bad-history` / `no-model` / `no-llm`…），**从不抛异常**，所以模型读到原因后能自行纠正。

- **`novel_search`** — 在整本书里找词，返回每条命中所在的分区、条目、字段、正文行号与片段。比 `novel_records` 逐个分区翻更省事，适合「这个人名第一次出现在哪」。
- **`novel_chapters`** — `action: 'plan'` 看读序与编号诊断（断号 / 重号 / 未编号），`reorder` 摆顺序，`renumber` 重编号（`dryRun` 先看）。
- **`novel_drafts`** — 章节快照：`list` / `read` / `save`（改之前先留一份）/ `restore`（章节被改过要先 `force`）/ `delete`。
- **`novel_progress`** — 写作进度：`get` 拿总字数、今日 / 本周、连续天数、30 天历史与节奏推算；`set` 定目标字数与截止日。
- **`novel_import`** — 导入：`list` 书内可导入的文件，`backup` 读 JSON 备份（`describe: true` 先看有什么），`markdown` 按标题切章。**默认只预览**，`dryRun: false` 才落盘。
- **`novel_extract`** — 读一段正文（`passage`），让本书模型把新出现的人 / 地 / 物 / 规则列成清单：`recognize` 只回 `plan`（**不写盘**），`apply` 把选中的 `entries` 补进各分区。落盘**只填空字段、`tags` 取并集**，作者写过的一行永不覆盖；区域名与字段名都要先过 schema，`select` 必须命中选项表。

也就是说，让 AI「给小说面板加一个年表分区」是可行的：它会 `novel_guide{topic:'extend'}` → `novel_extension{action:'scaffold'}` → 改模板 → `novel_extension{action:'write'}`，下一个请求面板里就多了一个 tab。

---

## 12. 安全边界 / Boundaries

- 分区必须先经 `getSchema()` 解析出 `unit`，未知的分区名到不了文件系统。
- 条目 id / 文件名走 `safeId`、`safeRelName`：拒绝空、`..`、含 `/` 或 `\`、以 `.` 开头、超过 120 字符、层级超过两段。
- 文本读取上限 1 MB；HTTP 请求体上限 512 KB。
- 写入一律先写临时文件再 `rename`（`atomicWrite`），不会留下半截文件。
- `lib/extensions/` 里的代码是在 DSH 宿主进程里执行的——扩展等同于插件代码，只应写入你信任的内容。
