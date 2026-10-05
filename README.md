# Novel Studio

一个独立于任务与聊天之外的**小说分区**，作为 DeepSeek Harness 插件运行。

侧栏出现一本书的图标；点开后是两块：左边**书架**（每部小说一个条目，标题旁一个箭头可以把它折成
一条竖边、把宽度全让给正文，选择记在浏览器里，没记录时默认收起），右边当前作品的**十一个分区**
（总览 · 人物 · 世界观 · 大纲 · 面板 · 正文 · 素材 · **草稿**）加上 **检索 · 进度 · 导入 · 设置** 与
**关系图 · 校验 · AI · 导出** 八个工具标签。

**检索**在一个地方找遍整本书：正文（带行号）、每一条记录、每个字段、素材文件名、原始 YAML。
搜到的条目点一下就跳到它所属的分区并高亮，所以「这个名字到底在哪写过」不用挨个标签翻。

**进度**把写作量画出来：总字数、今日与本周、连续写作天数、30 天历史曲线，以及设了目标之后的
「还差多少 / 每天要写多少 / 按当前速度哪天写完」。它按**每日净产出**记账（`progress.yaml`），
所以删掉一段正文是负的，不是「今天写了 0 字」。

**关系图**把人物、势力、地点、物品画成一张网：名字旁边的字段（势力的 `leader`、地点的 `region`、
物品的 `owner`）会自动连边，手写的边存在 `relationships.yaml` 里。只看人物时，各人所属的势力仍会
作为灰色上下文节点画出来，所以不会看到一堆孤立的点。整张图**可以缩放**（图框顶上的 － / 百分比 /
＋，或 `Ctrl/Cmd + 滚轮`，0.5×–4×），图比框大时**拖拽就能平移**（按住空白处拖，点节点仍然选中），
框架自己滚动。

**校验**跑一遍书的内部一致性：悬空的边、指向未知条目的 `[[链接]]`、重号或断号的章节、还没回收的
伏笔、空分区等等，分「错误 / 提醒 / 提示」三档列出来。它**只读**，不会改任何文件。

**导出**把整本书渲染成一份可读的稿子：Markdown 手稿、纯文本、可打印的单页 HTML，或者一份完整的
JSON 备份（含所有分区数据与素材正文，且不含本地路径）。可以在面板里预览、复制、下载，也能落盘到该书的
`publish/` 目录并留下 `manifest.yaml` 记录；扩展可以再添自己的格式。

**导入与恢复**是导出的回程：一份 JSON 备份可以**整体恢复**（逐分区报告会写什么、跳过什么、删什么）
或**恢复成一本书**；一段粘贴进来的 Markdown 手稿可以按它自己的 `# 第一章` 切章，追加或整本替换；
书里 `materials/`、`publish/`、`import/` 下已有的 `.md` / `.txt` / `.json` 也能直接读进来。**默认只预览**，
确认之后才落盘，替换整本书还要再确认一次。

**草稿箱**在改章节之前先留快照，改坏了能退回去；从草稿恢复时会先自动存一份「恢复前的样子」，
所以退回一步本身也是可退的。

**回收站**是书架上「删除」所去的地方。书条目悬停出现 🗑，点一下把这本书**移进回收站**——只是把它
改名挪进书库根目录的 `.trash/`，字节一个不动，书架随即不再列出它；删的正好是当前打开的书，面板就
空出来，不会去请求一个不存在的书。书架底部「回收站 (N)」切到**回收分区**：里面按删除时间列出被删
的书，「恢复」放回书架（原名在这期间被占用，就和新建一样拿 `-2`、`-3`……，并且 `book.yaml` 里的
`id` 跟着文件夹改），「永久删除」才真的从磁盘上抹掉、还要求再确认一次。`.trash` 是点目录，而书架
的列表本来就跳过点目录——所以回收站永远不会被当成一本书，整个书库搬家时它也随行。

**网站接口**在右侧空着的面板里：把你常去的**上架后台**收成一排卡片，开几个平台就放几条，点卡片
在浏览器里新开标签（`window.open` + `noopener`，后台页面摸不回来这边），✎ 编辑、🗑 删除（要确认）。
列表**整表**存在配置文件里（和书库位置同一份 `~/.dsh/novel-studio.yaml`），所以清浏览器数据也不会丢，
保存失败时原表原样保留。卡片栅格是 `auto-fill`——**书架折起来右区变宽，就自动多一列**，跟着书架
一起伸缩；网址只收 `http://` / `https://`，`javascript:` 之类一律拒收。

它同时是一块**留给 AI 继续加东西的地盘**：新分区、新路由、新工具都是 `lib/extensions/` 下的一个
`.js` 文件，写完下一个请求就生效。见 [EXTENSIONS.md](EXTENSIONS.md)。

## 为什么是插件而不是一堆文件夹

小说数据本身就是**纯文件**——每部作品在书库根目录下拥有一个完全独立的目录，结构化记录用 YAML，
正文用 Markdown。你可以直接打开文件夹阅读、手改、丢进 git，插件只是一层透镜。
多部作品之间不共享任何东西：人物、世界观、大纲、面板、正文互不干扰。

```
~/.dsh/novels/<书名>/
  book.yaml                作品元信息
  settings.yaml
  characters/<id>.yaml     人物
  relationships.yaml       关系
  world/                   世界观：rules / locations / factions / timeline / items / races / cultures / economy / glossary
  outline/                 大纲：tree / threads / scenes / foreshadowing / beats / hooks
  panels/                  面板：status / skills / equipment / tasks / reputation + custom/
  chapters/<id>.md         正文（YAML front matter + Markdown 正文）
  meta/                    章节元信息
  drafts/                  草稿
  materials/               素材
  publish/                 发布产物
```

书库根目录默认 `~/.dsh/novels`。位置按四层决定，**先匹配先生效**：显式参数 → 环境变量
`DSH_NOVEL_ROOT` → 面板上保存的位置（写到 `~/.dsh/novel-studio.yaml` 的 `root`）→ 默认位置。
环境变量**故意压过**面板设置：部署或测试拿 `DSH_NOVEL_ROOT` 钉住书库时，面板就改不动它
（`GET /root` 回 `locked: true`），否则一次面板操作就能把测试的书写进真实书库。

面板书架底部写着当前位置、来源和一个「更改」：点「浏览」会打开**系统自己的文件夹选择框**（和「打开
工作空间」用的是同一个 Host 对话框，任意磁盘都能去），选好就填进输入框，再按「切换」才真正生效
——浏览本身什么都不改。没有那个服务时（或直接手填路径也可以）会退回到面板内置的只读文件夹浏览器：
从「这台电脑」逐级点下去（只列文件夹，另有「上一级 / 磁盘 / 主目录」三个快捷跳转），按
「用这个文件夹」填进输入框。也可以勾上「把现有的书
一起搬过去」，确认后**下一个请求就生效，不用重启**——`lib/api.js` 每个请求都重新解析一次位置。
搬运用逐本 `rename`（跨盘退回拷贝 + 删除），撞名的书留在原处并在结果里记 `target-exists`，
**永不覆盖**。
新位置必须是绝对路径，且不能是当前位置的上层或子目录：两个书库互相套住，下次扫描就会把同一批
书数两遍。

| 路由 | 作用 |
| --- | --- |
| `GET /root` | 书库在哪、为什么在那（`source`）、是否被环境变量钉住、配置文件路径 |
| `POST /root` | `{ root, move? }` 换位置（`move: true` 连书一起搬）；`{ reset: true }` 交还给默认 |
| `GET /folders` | `?path=` 逐级列文件夹：不给 `path` 列这台电脑的盘符，给了就列该目录下的子文件夹（`parent`/`home` 供跳转）。只在这台 Host 没有原生文件夹对话框时给面板「浏览」当回落（有对话框时走 `uiWorkspace.pickDirectory()`）；只读，从不写盘 |

## 结构

| 文件 | 半边 | 作用 |
| --- | --- | --- |
| `lib/index.js` | host | 稳定载体：注册前缀路由 + agent 工具，**递归**按 mtime 热重载 `lib/` 下所有 `.js` |
| `lib/api.js` | host | HTTP 路由分发（`/ping`、`/bootstrap`、`/schema`、`/root`、`/folders`、`/websites`、`/trash`、`/library[...]`、`/ext/...`） |
| `lib/ops.js` | host | **统一操作层**：`invoke(operation, payload)`，HTTP / 工具 / 扩展共用，从不抛异常 |
| `lib/library.js` | host | 数据层：书库扫描、建书脚手架、原子写、计数、增删改查 |
| `lib/schema.js` | host | 声明式分区树（六种 kind）+ 扩展发现与合并 |
| `lib/records.js` | host | 通用条目读写（records / doc / chapters / files / raw） |
| `lib/graph.js` | host | 关系图：节点、边、字段自动连边、图内异常（只读） |
| `lib/edges.js` | host | 关系图的写方：增删改一条关系（手写行 or 记录字段） |
| `lib/validate.js` | host | 一致性校验：13 条内置规则 + 扩展规则（只读） |
| `lib/export.js` | host | 导出与发布：四种内置格式 + 扩展格式、`publish/` 产物清单 |
| `lib/search.js` | host | 全库检索：正文（带行号）、记录字段、文件名、原始 YAML，同一个字段只报一次 |
| `lib/chapters.js` | host | 章节的读序与改名：排序计划、断号 / 重号 / 未编号诊断、重排、重编号，以及草稿箱 |
| `lib/progress.js` | host | 写作进度：`progress.yaml` 里的每日净产出、目标、节奏推算与 30 天历史 |
| `lib/import.js` | host | 导入与恢复：JSON 备份回灌、Markdown 切章、书内文件直读，默认 dry-run |
| `lib/usage.js` | host | 每本书一本 token 账本（`usage.yaml`）：拼写归一化、累加、归零 |
| `lib/extract.js` | host | 写回正文后的补材料：把一段正文里新出现的人 / 地 / 物列成清单，交回前按 schema 校验，落库只填空字段 |
| `lib/prompt.js` | host | **纯函数**的提示词装配：五个 AI 任务、设定渲染、预算截断、`buildPrompt` |
| `lib/ai.js` | host | AI 联动：取书里的真实数据 → 拼提示词 → 认路由 → 调 `llm.stream` 流式回吐 |
| `lib/tools.js` | host | 模型可见工具的定义（含扩展贡献的工具） |
| `lib/extensions/` | host | 扩展目录；`_` 开头的文件保留但不加载 |
| `lib/client.js` | browser | 唯一浏览器入口：注册 `sidebar.panellist` 与 `main` 两个 seam |
| `EXTENSIONS.md` | — | 扩展开发指南 |
| `tests/*.mjs` | — | 冒烟测试，独立于 DSH 运行 |

**为什么要 `lib/index.js` 这一层。** DSH 在进程启动时加载一次 host 半边，直接写在里面的代码改完必须
重启 App 才生效。所以除它以外的一切都放进会被重新 `import` 的模块里——`index.js` 每次请求递归扫描
`lib/**/*.js` 算指纹，指纹变了就换一个 `?v=<指纹>` 重新加载，**下一个请求就是新代码**。指纹是递归的，
所以新增一个扩展文件本身就会触发重载。只有 `index.js` 自身改动才需要重启。

浏览器半边由模块加载器在**页面加载时**取用，改完刷新页面即可。

## 给 AI 的接口

插件向 DSH 的 `tools` 服务注册十六个工具（经 `ctx.inject(['tools'], …)`，没有该服务时面板照常工作）：

| 工具 | 作用 |
| --- | --- |
| `novel_guide` | 读插件手册：`overview` / `data` / `extend` |
| `novel_library` | 建书、列书、改元信息、删书 |
| `novel_records` | 读写真个分区里的条目；`action: 'schema'` 先看分区在哪 |
| `novel_graph` | 取关系网；`kinds: 'list'` 看有哪些节点类型，传数组则只取那几类 |
| `novel_link` | 增删改一条关系；派生边改的是记录字段，各分区同步 |
| `novel_validate` | 跑一致性校验，返回错误 / 提醒 / 提示三档清单（只读） |
| `novel_export` | 渲染整本书并交回文本（md / txt / html / json），**不写盘** |
| `novel_publish` | 落盘到 `publish/`：`formats` / `list` / `write` / `delete` |
| `novel_extension` | 装扩展：`scaffold` 出模板 → `write` 写入 `lib/extensions/` |
| `novel_ai` | 在聊天里跑这本书的 AI 任务：`list` 看菜单 / `context` 预览会读到什么 / `run` 真跑一轮（同样支持 `pick` 与 `history`） |
| `novel_search` | 在整本书里找词：正文（含行号）、记录字段、文件名、原始 YAML，返回命中位置与片段 |
| `novel_chapters` | 读序计划（编号风格、断号 / 重号 / 未编号）、`reorder` 重排、`renumber` 重编号（`dryRun` 先看） |
| `novel_drafts` | 草稿箱：`list` / `read` / `save`（改章节前的快照）/ `restore`（冲突要 `force`）/ `delete` |
| `novel_progress` | 进度：`get` 拿总字数、今日 / 本周、连续天数、30 天历史与节奏；`set` 定目标字数与截止日 |
| `novel_import` | 导入：`list` 书内可导入的文件 / `backup` 读 JSON 备份（`describe` 先看内容）/ `markdown` 按标题切章 |
| `novel_extract` | 读一段正文并列出新条目：`recognize` 只给清单（不写盘）/ `apply` 把选中的条目补进各分区，只填空字段 |

`novel_extension` 的 `write` 会真的 `import` 一次做校验——语法错、顶层抛错、导出形状不对，都会把文件
**回滚删除**并说明原因。工具集合在指纹变化时重新同步，所以扩展新增的工具同样不需要重启。

## AI 联动

面板的「AI」标签把这本书的**真实数据**喂给模型，做本章续写、新章节续写、润色、大纲推演、一致性审稿。
取的是当前书的关系图、人物、世界规则、术语、故事线、情节节拍、章节索引和校验问题，不是让模型凭记忆猜。

跑一轮之前可以**勾选要喂进去的条目**：面板会按分区列出这本书已有的内容（人物、地点、势力、物品、
种族、文化、规则、术语、经济、年表事件、卷章结构、线索、伏笔、节拍、钩子、场景、面板各项……），
默认全选，取消勾选的条目不会进入提示词。分区列表由 `lib/schema.js` 推导，所以之后新增的分区
（包括扩展贡献的）会自动出现在勾选面板里。

| 路由 | 作用 |
| --- | --- |
| `GET /library/:book/ai/tasks` | 五个任务的可序列化菜单（`key` / `zh` / `needs` / `hint`） |
| `GET /library/:book/ai/context` | 「AI 会读到什么」的预览计数 + 勾选目录（`?pick=<json>` 反映当前选择，**不含正文**） |
| `POST /library/:book/ai` | 跑一个任务，`text/event-stream` 逐块回吐（body 里的 `pick` 决定读哪些条目） |

`pick` 的形状是 `{ 分区键: [条目 id, …] }`：数组表示只留这些条目，空数组或 `false` 表示整段不要，
`true` 表示整段都要，没提到的分区按默认（全要）处理。分区键就是分区路径（`characters`、
`world/locations`、`world/timeline`、`outline/beats`…）。形状不对会被**在开流之前**用 `400 bad-pick`
答掉，指向旧目录的未知分区键会被忽略。

**多轮对话**：body 里还可以带 `history: [{ role: 'user' | 'assistant', content: '…' }]`——
上几轮的问答会排在这次提示词之前一起交给模型，所以「续写」能顺着上一轮接着写。只保留最近
**12 轮**、每轮最多 **4000 字符**（超出截断并加 `…`）；角色只能是 `user` 或 `assistant`。同样在
**开流之前**校验：形状不对用 `400 bad-history` 答掉。面板的 AI 标签自己维护这份对话（每本书各自
一本账，换书即新账，可一键清空），HTTP 调用方自行传 `history` 即可。

**续写分成两条**：`continue`（本章续写）从当前章节的正文末尾接着往下写；`continue-new`（新章节续写）
从这一章的结尾往后**另起一章**——不写章节标题、不复述上一章，篇幅也给得更宽（2400 token 对 1600）。
选中哪一条，下面「存到」就跟着换：本章续写默认**追加进这一章**，新章节续写默认**写成新章节**，并
按这本书现有的编号猜一个下一章名（`第三章-…` 往后数）填在可编辑的输入框里。章节文件由宿主的建章
路由落盘，重名自动加后缀，所以猜错也不会覆盖任何已有章节。

**答案是你可以改的**：右侧答案框是文本框，不是打印件——名字写错、句子别扭，直接在上面改。写回章节、
存成素材、写成新章节、「识别材料」读的**都是你改过的这一版**（走的是同一份文字）。答案框有高度上限
并可上下拖动调整，所以一致性审稿那种长回答也不会把下面的按钮顶出屏幕。

**每本书自己的模型**：AI 默认跟着 `agentDefaultModel` 当前选的 provider / model 走，但每本书可以在
面板「AI」标签顶部换成自己的，存进 `book.yaml` 的 `aiModel: { provider, model, reasoningEffort? }`。
书与书之间、书与全局选择之间互不影响：`lib/ai.js` 的 `bookSelection(book, default)` 只把这本书的
选择并到默认之上，且 **`reasoningEffort` 只在路由完全相同时才继承**（同 provider 同 model）——
effort id 属于某个具体模型，搬到别的模型上只是猜。记录只填一半（有 provider 没 model）按「没选」
处理，于是这本书照旧跑默认。

**思考强度**（`reasoningEffort`）：模型能跑的档位由部署自己的模型登记表决定（本机 `deepseek-*` 是
`off / low / high / max`，模型自带默认 `high`），面板在模型选择旁列出「跟随模型默认」+ 这些档位。
选一档就照上面那样写进 `book.yaml`；选「跟随模型默认」就是不带这个字段、交回模型自己——这也是清除
的办法。档位来自 `GET /library/:book/efforts`，面板既不问也不猜；问不到（模型不可描述、旧宿主没有
这个接口）就不显示这一栏，而不是拿一个可能被 provider 拒掉的 id 去试。日常续写调低一档，省时间也省
token。

| 路由 | 作用 |
| --- | --- |
| `GET /library/:book/model` | 这本书自己的路由 + 它此刻会继承的默认 + 本机可用的模型目录 |
| `POST /library/:book/model` | `{ provider, model, reasoningEffort? }` 保存；`{ clear: true }` 交还给默认 |
| `GET /library/:book/efforts` | 这个模型能跑的思考强度档位 + 它自己的默认档（带 `?provider=&model=` 可查正在挑选、尚未保存的模型） |

**篇幅与用量**：body 里可以带 `words`（1–20000 的整数），提示词会追加一段「### 篇幅要求」，这一轮
的 `maxTokens` 也随之抬到 `min(8000, max(任务默认, N × 2))`；不是整数、或超出范围，用
`400 missing-argument` 答掉（空着就是不要求）。`start` 事件回传这一轮的 `words`，`done` 事件回传
`usage`。**开着流花的钱也算钱**：每本书一本 `usage.yaml`，只要这一轮报了 token 就记一笔，失败收尾
的那轮同样记；拼写按 provider 常见的几种归一化（`input_tokens` / `promptTokens` …），没有 `total`
就自己加。面板上分两层看：正文下面那行是**本轮**（跑完就刷新，下一轮开始时清零），**累计**藏在一个
可折叠的子面板里（「累计用量 Σ …」，展开时才重新读一遍账本，里面还有轮次、起始 / 最近时间与一键
归零）——写作时盯的是一轮花了多少，不是这本书一辈子的总数。

**费用面板里的归属**：`usage.yaml` 是面板自己的账，跟部署里的计价插件（`dsh-cost-meter`）是两本账。
插件挂在全局的 `llm/stream` 上，把每一次调用按 `options.sessionId` 分进「一个会话一行」，**没有
sessionId 的调用只进日 / 月合计、没有会话行**——小说区的调用是手搓的（没有 agent loop 认领），所以
过去只能趴在「无归属」里，按会话看费用时根本看不见。`lib/ai.js` 的 `attributionId(book, bookDir)`
现在给这类调用一个自己的会话 id（`novel-studio:<书名>`），补材料那次调用同样记在所属书的名下。
这个 id 会被 provider 直接写成 HTTP 头 `x-deepseek-harness-session-id`，而头值只能是 Latin-1 ——
非 ASCII 的书名（例如中文）会让**每一次**调用都以 `transport failed` 失败，所以字符集容不下的书名
统一落到共享的 `novel-studio` 一行（ASCII 书名自成一行）。每本书一行看起来更细，但费用面板对没有
标题的会话只显示 id 的前 14 个字符，`novel-studio:` 前缀就占了 13 个，所以强行编码成乱码反而更读不懂。

| 路由 | 作用 |
| --- | --- |
| `GET /library/:book/usage` | 这本书累计的输入 / 输出 / 缓存读 / 缓存写 / 合计 token 与轮次 |
| `POST /library/:book/usage` | `{ reset: true }` 把账本归零（别的 body 一律 `400 bad-request`） |

**写回正文后补材料**：AI 标签的写回条旁边有个默认勾上的「顺便补材料」开关——写回成功后，立刻用这
本书自己的模型读一遍刚写进去的那段，把新出现的人 / 地 / 物 / 规则列成清单。清单默认全勾，**只有点
「补充到各区域」才落盘**；落盘时**只填空字段、`tags` 取并集**，作者已经写好的那一行永不覆盖。识别这
一步本身不写任何东西，但它花的 token 同样记进这本书的账本。

**正文里的「识别材料」**：章节面板的动作行上多了一个同名按钮，勾选要读的章节再开始——一次读一章，
不必先把正文交给 AI 写回，也不用把整本书扫一遍。正在编辑的那一章读编辑器里的文字（含还没保存的
改动），其它章读已保存的正文；每一章各算一次调用、都记进同一本账，读回来的清单合并成一张表：同一个
条目在几章里都出现时并成一行，先出现那一章给出的值不会被后面的覆盖，只补它没写的字段。清单同样默认
全勾，只有点「补充到各区域」才落盘。

**一次提交的正文会被切片读**：一次调用要求模型给出一份长 JSON，而长回答正是最容易坏的一种——
回话被截断或裹上解释，整份清单就解析不出来（表现就是「模型没有按要求给出 JSON」）。所以正文按
1200 字（`SLICE_MAX_CHARS`）切成片、每片单独问、各自拿回一小份 JSON，再合并成上面那张表。某一片
读不懂就再问一次（`SLICE_TRIES`）；仍然读不懂时它被记成「有 N 个片段没能读懂」写在清单上方，
**不影响其它片段**——只有所有片段都读不懂才整批报错。`plan` 上因此多了 `slices`（片数）与
`skipped`（哪些片没读懂）。

**勾选章节的抽屉里也能换模型**：抽屉顶上就是这本书的模型与思考强度表单，和「AI」标签里的是
**同一个**组件，改一处两处同步；写回正文那一步用的也是这本书的路由。换书或换标签都不会碰到别
的书的设置。

| 路由 | 作用 |
| --- | --- |
| `POST /library/:book/extract` | `{ chapter?, passage }` 或 `{ chapters: [{ id, passage }] }`（一章一次调用，再合并）→ 用本书模型读出 `plan`（`entries` / `dropped` / `counts` / `slices` / `skipped`），**不写盘** |
| `POST /library/:book/extract/apply` | `{ entries: [...] }` 把选中的条目写进各分区，返回 `written` / `updated` / `skipped` |

哪些分区是候选由 schema 决定：`records` 或 `doc` 且声明了标题字段的单元，章节 / 素材 / 草稿不在其中；
扩展新加的分区自动成为候选。模型给出的区域名或字段名不在 schema 里就丢掉并记进 `dropped`，`select`
字段的值必须命中它自己的选项表，一次最多 60 条。

目录来自 host 的 `llm.listProviders()` / `llm.listModels(provider)`，在 `lib/index.js` 里由
`shapeCatalog()` 归一化（30 秒缓存）；没有 llm 服务、或某个 provider 列不出来时降级成空目录，
**绝不影响已经保存的路由**。`LlmProviderInfo` / `LlmModelInfo` 的字段名没有钉在宿主契约里，所以
`id` / `key` / `provider` 与 `id` / `model` / `key` 两种写法都读。

命中的 host 服务是 `llm`（`ctx.llm.stream(options)`）与 `agentDefaultModel`（`currentSelection()`
给出当前选的 provider / model）。两个都经 `ctx.inject(…)` 取得，**不进 `inject` 声明**——
可选依赖不该能让整个面板消失；`lib/index.js` 把句柄交给可重载的 api 层，所以它们随时可以缺席。

两条设计约束：

- **开流之前可能失败的一切，先用普通 JSON 答掉。** SSE 头一旦发出，未知章节或未选模型就只能
  报成「被截断的回答」。所以 `prepareTask`（取数 → 拼词 → 认路由）和 `streamPrepared`（开流）
  是分开的，后者只在万事俱备后才被调用。
- **请求先于部署被判断。** 缺参数、未知任务是调用方自己能改的（`400`）；这台机器上没有可用的
  llm 服务不是（`503`）。顺序因此是「取数 → 拼词 → 认路由 → 查服务」，坏请求永远不会被
  说成「服务缺失」。

提示词装配在 `lib/prompt.js` 里是**纯函数**：同样的输入永远得到同样的提示词，测试不需要联网。
每个区段都有字符预算，且**把截断讲给模型听**（`…（已截断，原文还有 N 字）`），避免它自信地编造
被切掉的人物。

## 检索、章节、草稿、进度、导入

这几块共用同一套约定：读走 `GET`，写走 `POST`，**凡是会大改文件的都先给一份 dry-run**，
业务拒绝一律是普通 JSON（`400` 参数问题 / `404` 没有这个条目 / `409` 需要确认），不是半截结果。

| 路由 | 作用 |
| --- | --- |
| `GET /library/:book/search` | `?q=&limit=&section=` 找词；每命中给分区、条目、字段、正文行号与片段 |
| `GET /library/:book/chapters` | 读序计划：章节、字数、编号风格，以及断号 / 重号 / 未编号 |
| `POST /library/:book/chapters/reorder` | `{ ids: [...] }` 把章节摆成这个顺序（必须是当前章节的一个排列） |
| `POST /library/:book/chapters/renumber` | `{ start, style, width, separator, dryRun, retitle }` 重编号 |
| `GET /library/:book/drafts` | 快照列表，新在前，带章节标题、字数、大小与时间 |
| `POST /library/:book/drafts` | `{ chapter, body?, note? }` 存一份；`body` 省略即取章节现文 |
| `POST /library/:book/drafts/restore` | `{ name, force? }` 退回去；内容有变先答 `409`，`force` 才覆盖 |
| `DELETE /library/:book/drafts/:name` | 删一份快照 |
| `GET /library/:book/progress` | 目标、总字数、今日 / 本周、连续天数、30 天历史、节奏推算 |
| `POST /library/:book/progress` | `{ words, deadline }` 设目标（`null` 清除；日期要 `YYYY-MM-DD`） |
| `GET /library/:book/settings` | 这本书的偏好 |
| `POST /library/:book/settings` | `{ theme, autosave, fontSize, wordGoal }` 浅合并保存 |
| `GET /library/:book/import` | 书里可导入的文件（`materials/`、`publish/`、`import/` 下的 md / txt / json） |
| `POST /library/:book/import` | `{ kind: 'backup' \| 'markdown' \| 'file', … }`，**默认 `dryRun: true`** |
| `DELETE /library/:book` | 把书**移入回收站**（改名进 `.trash/`，不销毁） |
| `GET /trash` | 回收站条目（`id` 是文件夹名、`name` 是原书名、`deletedAt` 删除时间），新在前 |
| `POST /trash/:entry/restore` | 恢复到书架；原名被占时拿 `-2` 后缀并同步改 `book.yaml` 的 `id` |
| `DELETE /trash/:entry` | 永久删除，不可撤销；`entry` 必须长得像 `<原名>__ts<时间戳>` |
| `GET /websites` | 面板空态的「网站接口」列表（`[{ name, url }]`），存配置文件；写坏的条目读时直接丢弃 |
| `POST /websites` | `{ items: [...] }` **整表替换**；非 `http(s)` 网址、缺名、超量（>100）都是 `400 bad-websites` |

**检索**不是全文搜索的简化版，而是把「这本书里所有能写东西的地方」都扫一遍：正文按行报位置，
记录按字段报，素材按文件名报，原始 YAML 按整段报；同一个字段里多个词都命中才算一条，
所以结果不会同一句话报两遍。`?section=` 可以只看一个分区。

**章节顺序**是文件名的一部分，所以重排与重编号真的会改文件名——因此采用两阶段改名
（先全部改成临时名再改成目标名），避免两个章节互换时撞名。`style` 支持 `cn`（第一章）、
`arabic`（第1章）、`prefix`（01-）；带着编号的标题只在原标题自带序号时才跟着改，
免得把「第一章 落幕」改成「第三章 落幕」。改完会同步平移 `progress.yaml` 里的章节键，
**不动历史产量**，否则重命名会被记成一次亏损。

**草稿箱**的存在理由是「改之前先留一份」。所以从草稿恢复时若章节已经被改过，先答 `409` 让你确认；
确认之后它做的第一件事是**把当前正文再存成一份自动快照**，然后才写回——退一步永远可退。

**进度**按每日净产出记账，而不是看文件 mtime（mtime 分不清「改了这一段」和「重写了整章」）。
删章节是负数。没有目标时只报已有的事实；设了目标才有「每天要写多少 / 哪天写完」。

**设置**存 `settings.yaml`（`theme` / `autosave` / `fontSize` / `wordGoal`），面板里改的是这几项；
未知键原样留着，所以扩展可以往同一个文件里加自己的偏好而不被清掉。`fontSize` 是**阅读字号**：
章节正文、AI 结果、AI 多轮记录、导出预览都跟着它走，所以「字太小」只需要改一个数字。

**放大预览**给每一处文本一个整窗的读法。面板本身是别人分给它的一个窄列，长文没地方展开——
导出预览本来就截到 4000 字、AI 结果只能在自己的小框里滚。现在 AI 结果、AI 多轮的每一轮答案、
章节正文、素材文件、整份 YAML、记录里的长字段、导出预览旁边都有一个「⤢ 放大」按钮，点开是一层
覆盖整个窗口的只读视图：按窗口宽度折行、滚动阅读，`Esc` 或点空白处关闭，`A－` / `A＋`（或键盘
`+` / `-`）调字号、`恢复`回 1:1、`复制全文`拿走。字号以本书设置里的阅读字号为基准再乘一个倍数，
倍数存在浏览器的 `localStorage`（`dsh-novel-studio.zoom`），下次打开还是这个大小。只读是刻意的：
它是一个视图，不是第二个编辑器，不可能从这里误写回正文。

## 开发

```bash
# 全部 12 套顺序跑一遍（约 10 秒，输出每套自己的逐项结果）
npm test

# 冒烟测试（不需要 DSH 在跑）
node tests/library.smoke.mjs   # 80 项 · 数据层、文件夹浏览、回收站与网站接口
node tests/units.smoke.mjs     # 53 项 · 条目读写
node tests/ops.smoke.mjs       # 99 项 · 操作层与扩展
node tests/graph.smoke.mjs     # 80 项 · 关系图与校验
node tests/export.smoke.mjs    # 70 项 · 导出格式与发布
node tests/edges.smoke.mjs     # 59 项 · 关系的增删改与字段回写
node tests/prompt.smoke.mjs    # 66 项 · 提示词装配、接地、可勾选分区的渲染与预算截断
node tests/ai.smoke.mjs        # 198 项 · 取数、勾选、多轮历史、路由、流式回吐、篇幅要求、token 账本、调用归属、AI 扩展缝（假 llm 桩，不联网）
node tests/extract.smoke.mjs   # 148 项 · 补材料：候选分区取舍、严格 JSON 解析与丢弃、只填空字段、tags 并集、长文切片与重试、按章连读与合并、账本（假 llm 桩）
node tests/bindings.smoke.mjs  # 23 项 · 多值字段（势力成员 / 物品持有者 / 面板归属）与多对多绑定、派生边
node tests/model.smoke.mjs     # 46 项 · 每书独立模型：归一化、继承规则、目录归一化、路由真的进了调用
node tests/studio.smoke.mjs    # 112 项 · 检索、章节重排与重编号、草稿箱、进度记账、导入 dry-run、设置、关系图、回收站与网站接口的浏览器半边文本契约、工作台总览与分组导航、导航收放与退出按钮、装载

# 对运行中的 DSH 打真实 HTTP
node tests/http.e2e.mjs        # 226 项 · 真实路由（含 /library/:book/model、/efforts、/extract（单段与按章）、/root 与 /folders、/trash 回收站全流程、/websites 网站接口）+ 热重载

# 安装到 desktop profile（本地 link）
dsh plugin --profile desktop add link:<此目录的绝对路径>
```

npm 包名是 **`dsh-novel-studio-lyjs`**（`dsh-novel-studio` 这个名字在 npm 上已被别人的另一个插件
占用），GitHub 仓库名仍是 `dsh-novel-studio`。装的时候命令里写的是**目录**，所以名字差别不影响本地安装。

安装后 `dsh.profile.bundles` 会加入 `dsh-novel-studio-lyjs`，`node_modules/dsh-novel-studio-lyjs` 是指回本目录的
Junction，因此改代码不需要重新安装。

## 进度

- **阶段 0 · 骨架** — 完成：侧栏图标、主面板、宿主路由、热重载载体。
- **阶段 1 · 数据层** — 完成：书库 CRUD、书架、总览真实计数。
- **阶段 2 · 核心面板与扩展面** — 完成：声明式分区树 + 通用条目读写 + 七个分区的界面 +
  统一操作层 + 四个 agent 工具 + 扩展目录（含模板与指南）。
- **阶段 3 · 关系图与校验** — 完成：关系网（人物 / 势力 / 地点 / 物品 + 字段自动连边 + 上下文节点）、
  13 条一致性规则、两个 agent 工具、两个面板标签页；`graphs` 与 `rules` 两个扩展缝。
- **阶段 4 · 导出与发布** — 完成：四种导出格式（Markdown / 纯文本 / 单页 HTML / JSON 备份）、
  `publish/` 产物清单与 `manifest.yaml`、面板「导出」标签、两个 agent 工具、`formats` 扩展缝。
- **阶段 5 · 关系图手动编辑** — 完成：图里直接连线建关系、改类型 / 强度 / 备注、删边；
  手写边写回 `relationships.yaml`，字段派生的边改写记录字段（`leader` / `region` / `owner`），
  所以人物卡与关系图永不打架；面板加编辑开关与关系列表，新增一个 agent 工具 `novel_link`。
- **阶段 6 · AI 联动** — 完成：五个任务（本章续写 / 新章节续写 / 润色 / 大纲推演 / 一致性审稿）、把书里的真实设定
  与关系喂进提示词、`text/event-stream` 流式回吐、面板「AI」标签（可选章节 / 想法 / 原文，
  结果可追加或替换回章节）；取数走 host 的 `llm` 与 `agentDefaultModel` 服务，两者缺席时面板
  照常工作，只是 AI 标签会说明为什么跑不了；`ai` 扩展缝——加第五个任务是一行 `frame()`。
- **阶段 7 · 聊天里的小说工具与多轮对话** — 完成：`novel_ai` 内建工具（`list` 任务菜单 /
  `context` 预览会读到什么 / `run` 真跑一轮，同样吃 `pick` 与 `history`，业务拒绝以
  `{ok:false, code, message}` 交回）；`POST /library/:book/ai` 接受 `history`（最近 12 轮、
  每轮 4000 字符，开流前用 `400 bad-history` 校验，排在这次提示词之前交给模型）；
  面板 AI 标签的「多轮对话」——每轮问答留档、下一轮自动带上、换书即新账、可一键清空。
- **阶段 8 · 人物档案与每书模型** — 完成：人物卡上的「档案」按钮打开右侧抽屉，把这个人绑到任意
  组多值归属字段（势力 `members` 与 `leader`、物品 `owner`、五个面板分组的 `owners`），一处解绑即
  一处解绑，一张档案同时列全部已绑定处与这个人的关系连线；多值字段落成 **tags**（数组或
  「老周、林望」这样的逗号串都读），图里每个名字各得一条 auto 边，所以一对多 / 多对一 / 多对多
  都是同一套读写。模型方面每本书各存各的（见上文，`book.yaml.aiModel` + `GET/POST
  /library/:book/model`），AI 标签顶部一行换书即换模型，换全局默认不影响已经选过的书；模型选择旁
  可以再挑**思考强度**，档位跟着模型走（`GET /library/:book/efforts`），不挑就交回模型自己的默认。
  这张表单是 `ModelForm`，AI 标签与「识别材料」的勾选抽屉共用同一个，两处永远一致。
- **阶段 9 · 检索与操持** — 完成：**全库检索**（正文带行号、记录字段、文件名、原始 YAML，
  命中即可跳到所属分区）；**导入与恢复**（JSON 备份整体回灌或恢复成新书、Markdown 按标题切章、
  书内文件直读，默认只预览，替换整本要二次确认，旧备份里没有正文的素材会被跳过并说明）；
  **章节重排与重编号**（两阶段改名，`cn` / `arabic` / `prefix` 三种风格，断号 / 重号 / 未编号诊断，
  重编号时标题只在原标题自带序号时才跟着改）；**草稿箱**（改章节前留快照，恢复前自动再存一份，
  冲突要确认）；**进度**（按每日净产出记账的 30 天历史、连续天数、目标与「哪天写完」的推算）；
  **设置**（`settings.yaml` 的 `theme` / `autosave` / `fontSize` / `wordGoal`，未知键留给扩展）；
  AI 结果多了一个出口——除回正文外可**存成记录**，`usage` 也显示在面板上；
  另有五个 agent 工具（`novel_search` / `novel_chapters` / `novel_drafts` / `novel_progress` /
  `novel_import`）与四个新面板标签。
- **阶段 9 追加 · 用量与补材料** — 完成：**每本书一本 token 账本**（`usage.yaml`，输入 / 输出 /
  缓存读 / 缓存写 / 合计与轮次，`GET|POST /library/:book/usage`）；面板分两层——正文下面只报**本轮
  用量**（`done` 事件到手才显示，下一轮开始时清零），**累计**收进可折叠的子面板（展开即重读账本，
  附轮次、起始 / 最近时间与归零）；**生成字数与
  规定字数**（面板数字框 → `words` 参数 → 提示词「### 篇幅要求」与 `maxTokens` 抬升，正文下方
  同时显示本轮实际字数与要求差多少）；**写回正文后补材料**（默认勾上的「顺便补材料」开关，用本书
  模型读一遍刚写进去的那段，列出新出现的人 / 地 / 物 / 规则，默认全勾，一键补进各分区，只填空
  字段）；另有第六个 agent 工具 `novel_extract`。
- **阶段 9 追加 · 费用归属** — 完成：小说区的模型调用在计价插件（`dsh-cost-meter`）的账本里终于
  有了自己的会话行——手搓调用借一个稳定 id `novel-studio:<书名>` 入账（`lib/ai.js` 的
  `attributionId`），补材料那次调用同样归到所属书；id 会被写成 HTTP 头，只能是 Latin-1，容不下的
  书名（中文）落到共享的 `novel-studio` 一行。
- **阶段 9 追加 · 书库位置** — 完成：书库根目录不再只能靠环境变量钉住——面板书架底部显示当前位置
  与来源，「更改」可直接换文件夹（可选把现有的书一起搬过去）。位置按「显式参数 → `DSH_NOVEL_ROOT`
  → 面板保存 → 默认」解析，环境变量压过面板并让面板只读（`locked`）；换位置**下一个请求生效，
  不用重启**；搬运用逐本 `rename`（跨盘拷贝 + 删除），撞名的书留在原处、**永不覆盖**；新位置必须
  是绝对路径，且不能套住当前书库或落在它里面。两个新路由 `GET|POST /root`，操作层 `root`
  （`get` / `set` / `reset`），**不加新 agent 工具**——搬书库是运维动作而不是写作动作。同一阶段
  还补了第三个新路由 `GET /folders`：它给面板的「浏览」当**回落**——正常路径是借客户端的
  `uiWorkspace` 服务（`ctx.get('uiWorkspace')`，可选依赖）调 `pickDirectory()`，弹出和「打开工作
  空间」同一个系统文件夹选择框，任意磁盘都能去；这台 Host 没有那个服务时才内嵌一个只读的文件夹
  浏览器（从「这台电脑」逐级点下去，或跳「上一级 / 磁盘 / 主目录」），选好按「用这个文件夹」填进
  输入框，两种路径都仍要按「切换」才生效。书架本身还能收放：标题旁的箭头把它折成一条竖边，选择记
  在浏览器的 `localStorage`（`dsh-novel-studio.shelf-folded`），**默认收起**。
- **阶段 9 追加 · 放大预览** — 完成：文本区终于能「拿起来看」——AI 结果、AI 多轮的每一轮答案、
  章节正文、素材文件、整份 YAML、记录里的长字段、导出预览各自多一个「⤢ 放大」按钮，点开是覆盖
  整个窗口的只读视图（折行、滚动、`Esc` 关闭、`A－` / `A＋` 调字号、`复制全文`），倍数是「本书
  阅读字号 × 一个存在 `localStorage` 的倍数」；同时把 `fontSize` 从「只管章节正文」扩成**阅读
  字号**：AI 结果与导出预览都跟着它走，导出预览的框也从固定的 `340px` 改成随窗口
  （`min(52vh, 520px)`）；小框里仍只放前 4000 字，**放大视图里是全文**。
- **阶段 9 追加 · 关系图缩放** — 完成：关系图从「固定 100% 画布」变成可缩放视口——缩放就是把 svg
  的宽度设成 `zoom×100%`，`.ns-graph-wrap` 转成 `overflow:auto`，平移借原生滚动条，零坐标换算；
  缩放条（－ / 百分比点击复位 / ＋）放在滚动框**之外**，`Ctrl/Cmd + 滚轮`每格 ×1.15（`passive:false`
  的原生监听，滚轮不再顺手滚面板），指针拖拽平移（位移超过 4px 就吞掉，不会误选节点），倍数夹在
  0.5×–4×；统计行随内容一起留在框外。
- **阶段 9 追加 · 回收站** — 完成：删书从 `rm -rf` 改成**改名进 `<书库>/.trash/<原名>__ts<时间戳>`**
  （同卷 `rename`，字节一个不动），三个新路由 `GET /trash`、`POST /trash/:entry/restore`、
  `DELETE /trash/:entry` 住在**顶层**而不是 `/library/…` 下——书本的 id 可以恰好叫 `trash`，功能名
  不能占它的位。恢复时若原名已被占用就拿 `-2` 后缀（和新建同规则），并同步改 `book.yaml` 里的 `id`
  （`readBook` 让存着的 id 压过文件夹名，不同步的话下一个请求就 404）。书架每行悬停出 🗑、底部出
  「回收站 (N)」切换按钮，回收分区里恢复 / 永久删除两个动作，删当前打开的书会顺手把它关掉；`.trash`
  是点目录，列表天然看不见它，搬书库时随行。
- **阶段 9 追加 · 网站接口** — 完成：右侧空面板变成**上架后台的发射台**——多条可自定义网址的卡片
  （每个小说平台各占一张），点一下 `window.open(url, '_blank', 'noopener,noreferrer')` 到浏览器；
  两个新顶层路由 `GET /websites` / `POST /websites`（**整表替换**，`400 bad-websites` 拒非 `http(s)`
  网址、缺名与超 100 条）。列表存进配置文件（和书库位置同居 `~/.dsh/novel-studio.yaml`），清浏览器
  数据不丢、保存失败原表保留；栅格 `repeat(auto-fill, minmax(174px, 1fr))`——书架折起右区变宽就
  自动多一列，**随书架一起缩放**。测试 library 80 / studio 112 / e2e 226。
- **阶段 9 追加 · 工作台总览** — 完成：总览页从「英文计数卡」重写成**工作台 + 分组导航**。上排四个
  widget 并取三份真数据（`progress` / `validate` / `unit/chapters`）：继续写作（末章一键回正文）、
  字数目标（百分比 + 今日 N 字 · 连续 N 天）、校验提醒（有问题整卡红字）、＋新章节（`nextChapterTitle`
  猜名直接建章）；下面三栏按「写 → 查 → 用」分组——创作流（正文 · 大纲 · AI 写作 · 面板）、资料库
  （人物 · 世界观 · 关系图 · 素材 · 草稿）、工具集（校验 · 检索 · 导出，底部小字行 导入 · 设置），
  卡片文案逐条属实（校验 = 悬空关系 · 未收束伏笔 · 章节断号 · 未完结线索；草稿 = 章节改前的快照；
  导出 = MD · TXT · HTML · JSON 备份 · 发布 · 网站接口，**不写不存在的 DOCX**），计数行改用 schema
  的中文分组名。栏宽 `repeat(auto-fit, minmax(240px, 1fr))` 窄屏自动折列，旧 16 Tab 条原样保留；
  网站接口同时嵌进导出页，写作过程中常驻可见。测试 studio 106。
- **阶段 9 追加 · 导航收放** — 完成：顶部 16 Tab 条与总览三栏分区**二选一**，根治「分区 UI 重复」。
  默认收起：Tab 条隐藏，一切入口从总览三栏进，正文页顶部一个「← 退出到总览」按钮直达总览；书名
  行（标题 + 标识 pill 同一行）跟着「展开导航 / 收起导航」切换（存 localStorage
  `dsh-novel-studio.nav-open`）——展开即恢复原来那种全局一排分区（三栏同时让位，避免再重复）。
  测试 studio 112。

## 约定

- 颜色一律走 `--dsw-alias-*` 主题令牌，字面量只作老宿主兜底；不写 `[data-theme]` 选择器。
- 中性边框统一 `0.5px`；高层级表面用 `box-shadow: var(--dsw-elevation-*)` 且 `border: 0`。
- 浏览器半边只能用 `require('react')` 这类裸名解析官方客户端包，**不能**写 ESM `import`。
- 向未声明的 slot 注册会抛错，注册一律包在 `safely()` 里，坏掉的 seam 不能拖垮 `apply()`。
- host 半边写文件一律经 `atomicWrite`（临时文件 + `rename`），不留半截文件。
- `invoke()` 从不抛异常：业务拒绝返回 `{ ok: false, code, message }`。
