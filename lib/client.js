// dsh-novel-studio — BROWSER half.
//
// How this bundle is loaded: package.json declares `dsh.client.inject` +
// `exports["./client"]`; the DSH module loader picks this file up into the
// client roster. Bare ESM `import` statements do NOT work here — the only way
// to reach an official client package is `require('<name>')`, which the loader
// resolves against the roster. React and the locale service are the two we use.
//
// This half registers exactly two seams:
//   sidebar.panellist  (list)  -> { id: 'novel' }  the global sidebar icon
//   main               (keyed) -> { key: 'novel' } the central panel it opens
// The sidebar owns the button; `id` is what addresses the matching `main` key.
//
// Multi-book shape: the sidebar holds ONE entry for the whole studio, not one
// per novel. Inside, the panel is three levels — a bookshelf, the seven
// sections of the selected book, then the units inside a section. Each book
// lives in its own directory on disk, so books never share characters,
// worldbuilding, outline or chapters.
//
// The UI is schema-driven: it fetches the section tree from GET /schema and
// renders lists and forms from whatever it finds there. A new panel added by an
// extension — or by an AI writing an extension — appears without touching this
// file. Sections that declare no `fields` get a form inferred from their data.

window.__ModuleLoader__.load({
  id: 'dsh-novel-studio-lyjs',
  factory: (require) => {
    const React = require('react')
    const { useState, useEffect, useCallback, useMemo, useRef } = React
    const h = React.createElement

    const API = '/novel-studio/api'
    const NS = 'novel-studio'

    // The Host's own folder dialog — the very one "open a workspace" uses. Asked
    // for on every click, so a service that arrives late still works; where it is
    // absent altogether the panel falls back to walking the filesystem over HTTP,
    // which needs no Host service at all.
    let hostCtx = null
    let hostPick = null

    // Order follows the workspace flow: the desktop bridge first, then the
    // `uiWorkspace` service (wired in apply(), with a lazy `ctx.get` as well).
    // Either may hand back a bare path or an envelope (`{ ok, value }`), so both
    // shapes are accepted.
    function hostPickDirectory() {
      const desktop = globalThis.__DSH_DIRECTORY_PICKER__
      if (desktop && typeof desktop.pick === 'function') return () => desktop.pick()
      if (typeof hostPick === 'function') return hostPick
      try {
        const ws = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('uiWorkspace') : null
        return ws && typeof ws.pickDirectory === 'function' ? () => ws.pickDirectory() : null
      } catch {
        return null
      }
    }

    function pickedPath(value) {
      if (typeof value === 'string') return value
      if (!value || typeof value !== 'object' || value.ok === false) return null
      const at = value.value || value.path || value.directory
      return typeof at === 'string' ? at : null
    }

    // ── locale ────────────────────────────────────────────────────────────
    let t = (k) => k

    const DICT = {
      zh: {
        nav: '小说',
        shelf: '书架',
        shelfHide: '收起书架',
        shelfShow: '展开书架',
        addBook: '新建作品',
        bookTrash: '移入回收站',
        bookTrashAsk: '把《{n}》移入回收站？书架上会把它拿掉，可在回收站恢复或永久删除。',
        bookTrashed: '《{n}》已移入回收站',
        shelfTrash: '回收站',
        trashBack: '返回书架',
        trashHint: '删掉的书会放在这里：「恢复」放回书架，「永久删除」从磁盘上抹掉，不可撤销。',
        trashEmpty: '回收站是空的。',
        trashRestore: '恢复',
        trashRestored: '《{n}》已放回书架',
        trashPurge: '永久删除',
        trashPurgeAsk: '永久删除《{n}》？这一步无法撤销。',
        trashPurged: '《{n}》已永久删除',
        websites: '网站接口',
        websitesHint: '常用的上架后台收在这里：点一下名字就在浏览器里打开，可以随时增删改。',
        websiteName: '名称',
        websiteUrl: '网址',
        websiteAdd: '添加接口',
        websiteEdit: '编辑',
        websiteRemove: '删除',
        websiteRemoveAsk: '删除「{n}」？',
        websiteEmpty: '还没有接口。添加一个你常去的平台后台。',
        websiteBadUrl: '网址要以 http:// 或 https:// 开头',
        websiteSaved: '已保存',
        // ── workbench overview & grouped navigation (layout rebuild) ──
        grpWrite: '创作流',
        grpLib: '资料库',
        grpTools: '工具集',
        wbContinue: '继续写作',
        wbNone: '还没有章节，先新建一章',
        wbNewChapter: '＋ 新章节',
        wbGoal: '字数目标',
        wbToday: '今日 {n} 字 · 连续 {d} 天',
        wbNoGoal: '未设目标 · 可在进度页设定',
        wbValidate: '校验提醒',
        wbIssues: '{e} 错误 · {w} 警告 · {i} 提示',
        wbClean: '没有发现问题',
        cdChapters: '章节管理 + 正文写作，统一入口',
        cdOutline: '线索 · 伏笔 · 节拍 · 钩子 · 场景',
        cdAi: '续写 / 润色 / 扩写 / 改写，结果可写回',
        cdPanels: '属性 · 技能 · 装备 · 任务 · 声望',
        cdCharacters: '登场人物 · 名片与小传',
        cdWorld: '地点 · 势力 · 物品 · 种族 · 文化 · 规则 · 术语 · 经济 · 年表',
        cdGraph: '自动生成，可缩放平移与连线编辑',
        cdMaterials: '外部资料，可被 AI 引用',
        cdDrafts: '章节改前的快照，可回退可另存',
        cdValidate: '悬空关系 · 未收束伏笔 · 章节断号 · 未完结线索',
        cdSearch: '全文搜索 · 高亮 · 跳转',
        cdExport: 'MD · TXT · HTML · JSON 备份 · 发布 · 网站接口',
        cdImport: 'JSON 备份回灌 · Markdown 切章 · 书内文件',
        cdSettings: '主题 · 阅读字号 · 自动保存 · 字数目标',
        navExpand: '展开导航',
        navCollapse: '收起导航',
        navExit: '← 退出到总览',
        closeBook: '✕ 关闭本书',
        sharedTab: '共享库',
        cdShared: '跨书人物 · 设定 · 素材 · 引入与提升',
        shBrowse: '浏览共享库',
        shLinks: '本书引用',
        shPromote: '提升入库',
        shImport: '引入',
        shFork: '派生',
        shStable: '稳定版',
        shDraft: '草稿',
        shFrom: '来自《{b}》',
        shImpact: '影响范围',
        shNoImpact: '还没有书引用它',
        shSync: '同步',
        shPin: '锁定',
        shUnpin: '解锁',
        shStale: '源已更新',
        shDrift: '本地已修改',
        shLocked: '已锁定',
        shGone: '源已删除',
        shModeLink: '链接',
        shModeFork: '派生副本',
        shEmpty: '共享库还是空的：在「提升入库」里把本书的条目发布进来，其它书就能引入。',
        shLinksEmpty: '本书还没有引用任何共享条目。',
        shNoSource: '本书还没有可提升的条目。',
        shUnit: '分类',
        shSource: '本书条目',
        shStatus: '入库状态',
        shDoPromote: '提升到共享库',
        shPromoted: '已提升入库',
        shImported: '已引入本书',
        shSynced: '已同步到最新',
        shPinned: '已锁定，不再跟随源更新',
        shUnpinned: '已解锁',
        shConfirmTitle: '覆盖会影响这些书',
        shConfirmDo: '确认覆盖',
        shConfirmNo: '取消',
        shAffected: '{n} 本书在引用',
        shScope: '存放层',
        shGlobal: '全局共享库',
        shNewSeries: '＋新建书系',
        shSeriesName: '书系名称',
        shSeriesCreate: '创建书系',
        shSeriesCreated: '书系已建好',
        shTemplates: '模板',
        shTplHint: '勾选条目、起个名字，存成可复用的模板',
        shTplPick: '模板名称',
        shTplSave: '存为模板',
        shTplSaved: '模板已保存',
        shTplDeleted: '模板已删除',
        shTplEmpty: '还没有模板：先勾选上面的条目存一个。',
        shTplMake: '从模板新建作品',
        shTplMade: '《{b}》已建好，模板条目已引入',
        shTplSkipped: '{n} 个条目没能引入',
        shTplMissing: '源已删除',
        shTplStart: '从模板新建作品',
        shOverride: '字段例外',
        shOverrideHint: '勾中的字段留在本地，其余字段同步时跟随源',
        shOverrideSave: '保存字段例外',
        shOverrideSaved: '字段例外已保存',
        shOvCount: '{n} 字段本地',
        shFos: '跨书伏笔',
        shFosEmpty: '还没有伏笔：在任意一本书的「大纲 → 伏笔」里记一条，这里就能跨书看到。',
        shFosPlant: '埋设处',
        shFosPayoff: '回收处',
        shBadge: '来自共享库',
        validateIssues: '一致性',
        readerTab: '读者报告',
        readerRun: '跑这一章的读者模拟',
        readerRunHint: '一章一次调用，结果存进这本书的报告里。',
        readerDone: '「{c}」的读者报告已生成',
        readerEmpty: '还没有读者报告：选一章跑一次，情绪曲线会随报告长出来。',
        readerPick: '章节',
        readerNoChapters: '（还没有章节）',
        readerCurve: '情绪曲线（每章四维，满分 10）',
        readerTension: '紧张度',
        readerFun: '爽感',
        readerCuriosity: '好奇心',
        readerImmersion: '代入感',
        readerExpectation: '读者此刻的预期',
        readerHighlight: '爽点',
        readerDrop: '弃书点',
        readerPoison: '毒点',
        readerHook: '悬念',
        coachTitle: '副驾驶：点开看校验详情',
        coachIssues: '副驾驶 {n}',
        coachClean: '副驾驶 ✓',
        coachDrop: '弃书风险 {c}',
        emptyShelf: '还没有作品。新建一部，或者把已有目录放进书库根目录。',
        rootTitle: '书库位置',
        rootChange: '更改',
        rootMove: '把现有的书一起搬过去',
        rootApply: '切换',
        rootDefault: '用默认位置',
        rootLocked: '由环境变量 DSH_NOVEL_ROOT 指定，面板改不了',
        rootSrcSettings: '面板设置的位置',
        rootSrcDefault: '默认位置',
        rootChanged: '已切换',
        rootMoved: '搬走 {n} 本',
        rootSkipped: '跳过 {n} 本',
        rootFailed: '没能切换：',
        rootHint: '粘贴一个文件夹路径，或者点「浏览」逐级找。书库就是普通文件，换位置不会改动书里的内容。',
        rootBrowse: '浏览',
        rootBrowseHint: '打开系统的文件夹选择框，可以直接挑任意磁盘上的文件夹；选好后再按「切换」才生效。',
        browseDrives: '这台电脑',
        browseRoot: '磁盘',
        browseHome: '主目录',
        browseUp: '上一级',
        browseChoose: '用这个文件夹',
        browseEmpty: '这个文件夹里没有子文件夹。',
        browseLoading: '读取中…',
        browseFailed: '打不开：',
        emptyPick: '从左边选一部作品，或者新建一部。',
        create: '创建',
        cancel: '取消',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        remove: '删除',
        confirmRemove: '确定删除吗？此操作会移除磁盘上的文件。',
        newEntry: '新建',
        newFile: '新建文本',
        unnamed: '（未命名）',
        loading: '载入中…',
        connected: '宿主已连接',
        disconnected: '宿主未连接',
        root: '书库根目录',
        untitledPrompt: '输入书名',
        noEntries: '这里还是空的。点「新建」开始。',
        pickEntry: '从左边选一条，或者新建一条。',
        binary: '二进制文件，暂不支持在面板里编辑。',
        rawHint: '整份 YAML 直接编辑。保存前会先校验语法。',
        body: '正文',
        words: '字',
        author: '作者',
        genre: '题材',
        logline: '一句话简介',
        stage: '阶段',
        chars: '字',
        overview: '总览',
        graph: '关系图',
        validate: '校验',
        allKinds: '全部',
        edit: '编辑',
        editHint: '开启后可以连线、改关系、删关系；改动会立刻写回各分区。',
        addRelation: '添加关系',
        from: '从',
        to: '到',
        relation: '关系',
        note: '备注',
        strength: '强度',
        save: '保存',
        cancel: '取消',
        remove: '删除',
        pickBoth: '请先选择两个节点',
        edgeSaved: '已保存',
        fieldDerived: '来自字段',
        storedEdge: '手动',
        noEdges: '还没有关系',
        rewire: '改指向',
        editDone: '完成编辑',
        confirmUnlink: '确定断开这条关系吗？',
        nodes: '节点',
        edges: '边',
        manual: '手动',
        auto: '自动',
        contextNode: '上下文',
        rerun: '重新检查',
        clean: '没有发现问题。',
        issueLevel: { error: '错误', warn: '警告', info: '提示' },
        issueCount: { error: '错误', warn: '警告', info: '提示' },
        scanned: '已扫描',
        problems: '图内异常',
        dangling: '悬空边',
        external: '外部',
        exportTab: '导出',
        format: '格式',
        preview: '预览',
        download: '下载',
        generating: '生成中…',
        copy: '复制',
        copied: '已复制',
        publish: '发布到 publish/',
        published: '已发布',
        noArtifacts: '还没有导出文件。选一个格式，点“发布到 publish/”。',
        publishHint: '生成的文件写进这本书的 publish/ 目录，不会改动正文。',
        bytes: '字节',
        chapterCount: '章',
        untracked: '手动放入',
        exportedAt: '生成于',
        aiTab: 'AI 写作',
        aiHint: '模型会先读这本书的设定与关系图，再动笔。结果不会自动落盘——你看过、改过，再决定要不要写回去。',
        aiTask: '任务',
        aiChapter: '基于哪一章',
        aiText: '要润色的段落',
        aiIdea: '你的想法',
        aiPaste: '要拆解的原文（来自别的书）',
        calTitle: '历法',
        calYearLen: '一年 {n} 天',
        calMonthUnit: '个月',
        calAssumed: '还没定义月表，按公历估算',
        calNow: '现在',
        calNowHint: '1024年3月5日',
        calApply: '查看',
        calWhen: '{y} 年 {m} 月 {d} 日',
        calAtQuery: '你指定的',
        calAtTimeline: '年表最新',
        calUnknown: '日期看不清',
        calToday: '就是今天',
        calIn: '还有 {n} 天',
        calAged: '{n} 岁',
        calDeclared: '设定写的是 {n} 岁',
        aiExtra: '额外要求（可选）',
        aiRun: '让 AI 跑一轮',
        aiStop: '停止',
        aiRunning: '生成中…',
        aiInsert: '追加到本章末尾',
        aiReplace: '替换本章正文',
        aiInserted: '已写回本章',
        aiNewChapterDone: '已建成新章节',
        aiReads: 'AI 会读到',
        aiReadChars: '人物',
        aiReadRules: '世界规则',
        aiReadChapters: '章节',
        aiReadEdges: '关系',
        aiOutEdit: '可以直接改这里的文字；写回与识别材料都用你改过的这一版。',
        aiNothing: '还没有结果。选一个任务，点「让 AI 跑一轮」。',
        aiNoModel: '还没有选定模型：请先在「设置 → 模型」里选一个。',
        aiNoChapter: '这本书还没有章节：先去「章节」分区新建一章，再来续写。',
        aiGrounding: '设定接地中…',
        aiPick: '选择要喂给 AI 的条目',
        aiPickHint: '默认全选；取消勾选的条目不会进入提示词。',
        aiPickOpen: '选择条目',
        aiPickClose: '收起选择',
        aiPickAll: '全选',
        aiPickNone: '全不选',
        aiPickReset: '恢复默认',
        aiPickCount: '已选',
        aiThread: '多轮对话',
        aiThreadHint: '上几轮的问答会一并交给模型，「继续写」可以顺着往下接；换书或点「清空」即重新开始。',
        aiThreadClear: '清空对话',
        dossier: '档案',
        dossierTitle: '人物档案',
        dossierClose: '关闭',
        dossierHint: '点已绑定的条目可以解绑；下拉框里选一个即绑定到本区条目。绑定、解绑都支持一对多与多对一。',
        dossierBind: '＋ 绑定…',
        dossierUnbind: '解绑',
        dossierPick: '选择条目',
        dossierLeader: '首领',
        dossierRelations: '关系连线',
        dossierRelationsHint: '只读视图；增删连线请到「关系图」分区。',
        dossierNoRel: '还没有连线。',
        dossierEmpty: '本分区还没有条目，先去新建。',
        aiModel: '模型',
        aiModelHint: '每本书各自独立，这里的选择只影响这本书；换书即换模型。',
        aiModelInherit: 'Harness 默认',
        aiModelUnset: '还没有为这本书选模型',
        aiModelSet: '更换模型',
        aiModelClear: '跟随默认',
        aiModelProvider: '服务商',
        aiModelName: '模型',
        aiModelEmpty: '这个部署没有可用的模型目录。',
        aiModelSaved: '模型已保存',
        aiModelCleared: '已恢复为跟随默认。',
        aiEffort: '思考强度',
        aiEffortHint: '不选就跟模型自己的默认（本模型现在默认是「{def}」）。日常续写调低一档，省时间也省 token。',
        aiEffortInherit: '跟随模型默认',
        aiEffortSaved: '思考强度已保存',
        aiEffortNone: '这个模型没有可调的思考强度。',
        confirmReplace: '确定用生成的内容替换本章正文吗？原正文会被覆盖。',
        aiWords: '规定字数',
        aiWordsHint: '留空表示不限制。填了会写进要求里，并相应抬高这一轮的出字预算。',
        aiCount: '本次输出',
        aiCountUnit: '字',
        aiCountAsk: '要求',
        aiCountOver: '超出',
        aiCountUnder: '还差',
        aiCountHit: '刚好',
        aiUsageTotal: '累计用量',
        aiUsageCache: '缓存读',
        aiUsageCacheWrite: '缓存写',
        aiUsageRuns: '次',
        aiUsageReset: '清空',
        aiUsageResetAsk: '确定清空这本书的 token 用量统计吗？',
        aiUsageRound: '本轮用量',
        aiUsageSince: '起始',
        aiUsageUpdated: '最近',
        aiUsageClose: '收起',
        aiUsageHint: '这本书跑过的每一轮都算在这里——换窗口、换工具、换个面板都是一本账。「清空」只清这本书记的数。',
        zoomOpen: '放大',
        zoomTitle: '放大预览',
        zoomBigger: '加大字号',
        zoomSmaller: '减小字号',
        zoomReset: '恢复',
        zoomCopy: '复制全文',
        zoomCopied: '已复制',
        zoomClose: '关闭',
        zoomHint: 'Esc 关闭 · ＋ / － 调字号（记在这台机器上）· 长文按窗口宽度折行，滚动阅读',
        zoomChars: '字',
        zoomFrom: '来自',
        graphZoomIn: '放大',
        graphZoomOut: '缩小',
        graphZoomReset: '还原 100%',
        graphZoomHint: 'Ctrl + 滚轮缩放 · 按住拖动平移',
        aiExtract: '顺便补材料',
        aiExtractHint: '写回正文后，用这本书的模型读一遍写进去的段落，把它新提到的人物、地点、物品、规则列出来，由你决定补哪些。',
        aiExtractNow: '识别材料',
        aiExtractTitle: '这段正文里的新材料',
        aiExtractIntro: '下面是从刚写进去的段落里认出来的条目。没把握的字段不会填，已有条目只补空着的字段，不会覆盖你自己写的内容。',
        aiExtractEmpty: '没有发现可以补充的条目。',
        aiExtractApply: '补充到各区域',
        aiExtractAll: '全选',
        aiExtractNone: '全不选',
        aiExtractNew: '新建',
        aiExtractMerge: '已有 · 只补空字段',
        aiExtractFields: '字段',
        aiExtractDoing: '正在读这段正文…',
        aiExtractApplying: '正在补充…',
        aiExtractDone: '已补充',
        aiExtractCount: '条',
        aiExtractFailed: '识别失败：',
        aiExtractReport: '新增',
        aiExtractUpdated: '补充',
        aiExtractSkipped: '跳过',
        chaptersExtract: '识别材料',
        chaptersExtractHint: '勾选要读的章节：一次读一章，不用把整本书扫一遍。正在编辑的这一章读编辑器里的文字（含还没保存的改动），其它章读已保存的正文。识别只是候选，你在下一步勾完才写进各区域。',
        chaptersExtractDo: '开始识别',
        chaptersExtractDoing: '正在读',
        chaptersExtractUnit: '章',
        aiExtractMissed: '有 {n} 个片段没能读懂，再点一次就能补上。',
        searchOpen: '检索',
        searchTitle: '全书检索',
        searchPlaceholder: '在整本书里查一个词…',
        searchRun: '检索',
        searchClose: '关闭',
        searchHint: '章节正文（含行号）、每条记录的每个字段、素材文件名与整段文本都会搜。多个词用空格分隔，需要全部命中。',
        searchEmpty: '没有命中。',
        searchScanned: '已扫描',
        searchTruncated: '结果太多，只显示前一部分。',
        searchUnit: '条目',
        searchEntries: '条记录',
        searchFields: '字段',
        searchLine: '第 {n} 行',
        searchSections: '分区',
        searchAll: '全部分区',
        settingsOpen: '设置',
        settingsTitle: '这本书的设置',
        settingsTheme: '主题',
        settingsThemeDefault: '默认',
        settingsThemeSepia: '护眼',
        settingsThemeDark: '深色',
        settingsFontSize: '正文字号',
        settingsAutosave: '自动保存',
        settingsAutosaveOn: '开启',
        settingsAutosaveOff: '关闭',
        settingsAutosaveHint: '正文里停下几秒后自动保存这一章；记录与大纲仍然手动保存。',
        settingsScope: '这些设置只影响当前这一本书。',
        progressOpen: '进度',
        progressTitle: '写作进度',
        progressGoal: '目标字数',
        progressDeadline: '截止日期',
        progressGoalSave: '保存目标',
        progressGoalClear: '清除目标',
        progressDone: '已完成',
        progressRemaining: '还差',
        progressPercent: '完成度',
        progressToday: '今日',
        progressWeek: '近 7 天',
        progressStreak: '连续',
        progressDays: '天',
        progressAvg: '近 7 天日均',
        progressPace: '按目前速度还需',
        progressPerDay: '每天需写',
        progressNoGoal: '还没有设目标。填一个字数，进度就有了衡量的尺子。',
        progressEmpty: '还没有章节。写出第一章，这里就有数字了。',
        progressHistory: '最近 30 天',
        progressLongest: '最长一章',
        progressTracked: '开始记录',
        importOpen: '导入 / 恢复',
        importTitle: '导入与恢复',
        importBackupTab: '整书备份',
        importMarkdownTab: '手稿 Markdown',
        importFileTab: '书内文件',
        importBackupHint: '粘贴由「导出」生成的整书备份（JSON）。先预览，确认后才写入。',
        importMarkdownHint: '粘贴一份手稿，按标题（# / ## / 第N章）切分成章节。',
        importFileHint: '直接读这本书内部已有的文件（materials/、publish/、import/）。',
        importPaste: '把内容粘到这里…',
        importPreview: '预览',
        importApply: '确认导入',
        importMode: '方式',
        importModeMerge: '合并（只新增）',
        importModeReplace: '替换（按备份对齐）',
        importDescribe: '这份备份有',
        importChapters: '章',
        importWords: '字',
        importSections: '个分区',
        importRestorable: '可恢复',
        importSkip: '跳过',
        importDryRun: '这只是预览，还没有写入任何东西。',
        importDone: '已写入',
        importWarnings: '提示',
        importFilePick: '选一个文件',
        importNeedText: '先粘贴内容或选择文件。',
        draftOpen: '快照',
        draftTitle: '草稿箱',
        draftTake: '存一份快照',
        draftNote: '备注（可选）',
        draftEmpty: '还没有快照。改写前存一份，就不怕改坏。',
        draftRestore: '恢复',
        draftRestoreAuto: '自动快照',
        draftConflict: '这一章在快照之后又改过。要用快照覆盖吗？',
        draftRestored: '已恢复，覆盖前的内容也存了一份。',
        draftSame: '章节内容与快照一致。',
        draftDeleteConfirm: '删除这份快照？',
        chapterMove: '调序',
        chapterUp: '上移',
        chapterDown: '下移',
        chapterRenumber: '重编号',
        chapterRenumberHint: '按当前顺序重新编号，可以只预览。',
        chapterRenumberDry: '预览编号',
        chapterRenumberGo: '执行',
        chapterStyle: '编号风格',
        chapterStyleCn: '中文（第一章）',
        chapterStyleDigit: '数字（第1章）',
        chapterIssues: '编号问题',
        chapterNoIssues: '编号连续，没有缺失或重复。',
        chapterGap: '缺号',
        chapterDupe: '重号',
        chapterBare: '无编号',
        chapterRenamed: '已重命名',
        aiUsage: '用量',
        aiUsageIn: '输入',
        aiUsageOut: '输出',
        aiSaveAs: '存为内容',
        aiSaveHint: '把这次的结果存成一条记录、一段素材或一份草稿。',
        aiSaveSection: '存到',
        aiSaveChapter: '章节正文',
        aiSaveNewChapter: '写成新章节',
        aiSaveMaterial: '素材文件',
        aiSaveDraft: '草稿箱',
        aiSaveRecord: '记录条目',
        aiSaveDo: '保存',
        aiSaved: '已保存',
        aiSaveEntry: '条目名',
        aiSaveFileName: '文件名',
        aiSaveChapterName: '新章节名',
        aiSaveNote: '备注',
      },
      en: {
        nav: 'Novel',
        shelf: 'Shelf',
        shelfHide: 'Hide the shelf',
        shelfShow: 'Show the shelf',
        addBook: 'New book',
        bookTrash: 'Move to the recycle bin',
        bookTrashAsk: 'Move "{n}" to the recycle bin? It leaves the shelf, and can be restored — or deleted for good — from there.',
        bookTrashed: '"{n}" moved to the recycle bin',
        shelfTrash: 'Recycle bin',
        trashBack: 'Back to the shelf',
        trashHint: 'Deleted books wait here: Restore puts one back on the shelf, Delete for good erases it from disk — that cannot be undone.',
        trashEmpty: 'The recycle bin is empty.',
        trashRestore: 'Restore',
        trashRestored: '"{n}" is back on the shelf',
        trashPurge: 'Delete for good',
        trashPurgeAsk: 'Delete "{n}" for good? This cannot be undone.',
        trashPurged: '"{n}" deleted for good',
        websites: 'Websites',
        websitesHint: 'Your publishing dashboards, kept here — click a name to open it in the browser; add, edit or remove entries any time.',
        websiteName: 'Name',
        websiteUrl: 'URL',
        websiteAdd: 'Add site',
        websiteEdit: 'Edit',
        websiteRemove: 'Remove',
        websiteRemoveAsk: 'Remove "{n}"?',
        websiteEmpty: 'No sites yet. Add a dashboard you visit often.',
        websiteBadUrl: 'The URL must start with http:// or https://',
        websiteSaved: 'Saved',
        // ── workbench overview & grouped navigation (layout rebuild) ──
        grpWrite: 'Workflow',
        grpLib: 'Library',
        grpTools: 'Toolkit',
        wbContinue: 'Continue writing',
        wbNone: 'No chapters yet — start one',
        wbNewChapter: '+ New chapter',
        wbGoal: 'Word goal',
        wbToday: '{n} words today · {d}-day streak',
        wbNoGoal: 'No goal yet — set it on Progress',
        wbValidate: 'Validation',
        wbIssues: '{e} errors · {w} warnings · {i} notes',
        wbClean: 'No problems found',
        cdChapters: 'Chapters and prose in one place',
        cdOutline: 'Threads · foreshadow · beats · hooks · scenes',
        cdAi: 'Continue / polish / expand / rewrite, results can be saved back',
        cdPanels: 'Stats · skills · gear · quests · reputation',
        cdCharacters: 'Cast with bios and relationships',
        cdWorld: 'Places · factions · items · races · culture · rules · terms · economy · timeline',
        cdGraph: 'Auto-built, zoom, pan and drag links',
        cdMaterials: 'Outside sources the AI can cite',
        cdDrafts: 'Pre-edit snapshots of chapters, restore or fork',
        cdValidate: 'Dangling edges · open threads · chapter gaps · loose ends',
        cdSearch: 'Full-text search, highlight, jump',
        cdExport: 'MD · TXT · HTML · JSON backup · publish · websites',
        cdImport: 'JSON restore · Markdown split · in-book files',
        cdSettings: 'Theme · reading size · autosave · word goal',
        navExpand: 'Expand nav',
        navCollapse: 'Collapse nav',
        navExit: '← Exit to overview',
        closeBook: '✕ Close book',
        sharedTab: 'Shared',
        cdShared: 'Cross-book people · settings · materials',
        shBrowse: 'Browse shared',
        shLinks: 'Book links',
        shPromote: 'Promote',
        shImport: 'Link in',
        shFork: 'Fork',
        shStable: 'Stable',
        shDraft: 'Draft',
        shFrom: 'From 《{b}》',
        shImpact: 'Impact',
        shNoImpact: 'No books reference it yet',
        shSync: 'Sync',
        shPin: 'Pin',
        shUnpin: 'Unpin',
        shStale: 'Source updated',
        shDrift: 'Edited locally',
        shLocked: 'Pinned',
        shGone: 'Source removed',
        shModeLink: 'Link',
        shModeFork: 'Forked copy',
        shEmpty: 'The shared library is empty. Publish entries from “Promote” and other books can link them in.',
        shLinksEmpty: 'This book does not reference any shared entries yet.',
        shNoSource: 'This book has nothing to promote yet.',
        shUnit: 'Category',
        shSource: 'Entry in this book',
        shStatus: 'Status',
        shDoPromote: 'Promote to shared library',
        shPromoted: 'Promoted',
        shImported: 'Imported into this book',
        shSynced: 'Synced',
        shPinned: 'Pinned — no longer follows the source',
        shUnpinned: 'Unlocked',
        shConfirmTitle: 'Overwriting affects these books',
        shConfirmDo: 'Overwrite',
        shConfirmNo: 'Cancel',
        shAffected: '{n} books reference this',
        shScope: 'Lives in',
        shGlobal: 'Global shared store',
        shNewSeries: '+ New series',
        shSeriesName: 'Series name',
        shSeriesCreate: 'Create series',
        shSeriesCreated: 'Series created',
        shTemplates: 'Templates',
        shTplHint: 'Tick entries, name it, keep it as a reusable template',
        shTplPick: 'Template name',
        shTplSave: 'Save as template',
        shTplSaved: 'Template saved',
        shTplDeleted: 'Template deleted',
        shTplEmpty: 'No templates yet: tick entries above and save one.',
        shTplMake: 'New book from template',
        shTplMade: '《{b}》 created, template entries brought in',
        shTplSkipped: '{n} entries could not be brought in',
        shTplMissing: 'Source gone',
        shTplStart: 'New book from template',
        shOverride: 'Field exceptions',
        shOverrideHint: 'Ticked fields stay local; the rest follow the source on sync',
        shOverrideSave: 'Save field exceptions',
        shOverrideSaved: 'Field exceptions saved',
        shOvCount: '{n} fields local',
        shFos: 'Cross-book foreshadowing',
        shFosEmpty: 'No foreshadowing yet: add one under Outline → Foreshadowing in any book.',
        shFosPlant: 'Planted',
        shFosPayoff: 'Payoff',
        shBadge: 'From the shared store',
        validateIssues: 'Consistency',
        readerTab: 'Readers',
        readerRun: 'Simulate a reader on this chapter',
        readerRunHint: 'One model call per chapter; the report is stored with the book.',
        readerDone: 'Reader report for 「{c}」 is ready',
        readerEmpty: 'No reader reports yet — run one chapter and the curve grows.',
        readerPick: 'Chapter',
        readerNoChapters: '(no chapters yet)',
        readerCurve: 'Emotion curve (four scores per chapter, out of 10)',
        readerTension: 'Tension',
        readerFun: 'Payoff',
        readerCuriosity: 'Curiosity',
        readerImmersion: 'Immersion',
        readerExpectation: 'What the reader expects now',
        readerHighlight: 'Best moment',
        readerDrop: 'Drop risk',
        readerPoison: 'Turn-off',
        readerHook: 'Hook',
        coachTitle: 'Co-pilot: open the consistency report',
        coachIssues: 'Co-pilot {n}',
        coachClean: 'Co-pilot ✓',
        coachDrop: 'Drop risk {c}',
        emptyShelf: 'No books yet. Create one, or drop a folder into the library root.',
        rootTitle: 'Library folder',
        rootChange: 'Change',
        rootMove: 'Take the books along',
        rootApply: 'Switch',
        rootDefault: 'Use the default folder',
        rootLocked: 'Pinned by the DSH_NOVEL_ROOT environment variable — change it there',
        rootSrcSettings: 'chosen here',
        rootSrcDefault: 'the default folder',
        rootChanged: 'Switched',
        rootMoved: 'moved {n}',
        rootSkipped: 'skipped {n}',
        rootFailed: 'Could not switch: ',
        rootHint: 'Paste a folder path, or browse to it. The library is plain files, so moving it leaves the books themselves untouched.',
        rootBrowse: 'Browse',
        rootBrowseHint: 'Opens the system folder dialog, so any drive is reachable; nothing happens until you press Switch.',
        browseDrives: 'This computer',
        browseRoot: 'Drives',
        browseHome: 'Home',
        browseUp: 'Up',
        browseChoose: 'Use this folder',
        browseEmpty: 'No sub-folders here.',
        browseLoading: 'Reading…',
        browseFailed: 'Cannot open: ',
        emptyPick: 'Pick a book on the left, or create one.',
        create: 'Create',
        cancel: 'Cancel',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        remove: 'Delete',
        confirmRemove: 'Delete this? Files on disk will be removed.',
        newEntry: 'New',
        newFile: 'New text file',
        unnamed: '(untitled)',
        loading: 'Loading…',
        connected: 'Host connected',
        disconnected: 'Host unreachable',
        root: 'Library root',
        untitledPrompt: 'Book title',
        noEntries: 'Nothing here yet. Hit “New” to start.',
        pickEntry: 'Pick an entry on the left, or create one.',
        binary: 'Binary file — not editable in the panel.',
        rawHint: 'Edit the whole YAML document. Syntax is checked on save.',
        body: 'Body',
        words: 'words',
        author: 'Author',
        genre: 'Genre',
        logline: 'Logline',
        stage: 'Stage',
        chars: 'chars',
        overview: 'Overview',
        graph: 'Relations',
        validate: 'Check',
        allKinds: 'All',
        edit: 'Edit',
        editHint: 'Connect, relabel and cut relations here; every change is written straight back to the sections.',
        addRelation: 'Add relation',
        from: 'From',
        to: 'To',
        relation: 'Relation',
        note: 'Note',
        strength: 'Strength',
        save: 'Save',
        cancel: 'Cancel',
        remove: 'Remove',
        pickBoth: 'Pick both ends first',
        edgeSaved: 'Saved',
        fieldDerived: 'from field',
        storedEdge: 'stored',
        noEdges: 'No relations yet',
        rewire: 'Point at',
        editDone: 'Done editing',
        confirmUnlink: 'Cut this relation?',
        nodes: 'nodes',
        edges: 'edges',
        manual: 'manual',
        auto: 'auto',
        contextNode: 'context',
        rerun: 'Re-check',
        clean: 'No problems found.',
        issueLevel: { error: 'Error', warn: 'Warning', info: 'Info' },
        issueCount: { error: 'errors', warn: 'warnings', info: 'notes' },
        scanned: 'Scanned',
        problems: 'Graph problems',
        dangling: 'dangling',
        external: 'external',
        exportTab: 'Export',
        format: 'Format',
        preview: 'Preview',
        download: 'Download',
        generating: 'Generating…',
        copy: 'Copy',
        copied: 'Copied',
        publish: 'Publish to publish/',
        published: 'Published',
        noArtifacts: 'Nothing published yet. Pick a format and hit “Publish”.',
        publishHint: 'Files are written to this book’s publish/ folder — your chapters are untouched.',
        bytes: 'bytes',
        chapterCount: 'chapters',
        untracked: 'dropped in',
        exportedAt: 'Created',
        aiTab: 'AI writing',
        aiHint: 'The model reads this book’s setting and relationship graph before it writes. Nothing is saved automatically — you review it first, then decide whether it goes back into the book.',
        aiTask: 'Task',
        aiChapter: 'Based on',
        aiText: 'Text to polish',
        aiIdea: 'Your idea',
        aiPaste: 'Text to take apart (from another book)',
        calTitle: 'Calendar',
        calYearLen: '{n} days a year',
        calMonthUnit: 'months',
        calAssumed: 'No month table yet — estimating with the Gregorian year',
        calNow: 'Now',
        calNowHint: '1024-03-05',
        calApply: 'Show',
        calWhen: '{y}-{m}-{d}',
        calAtQuery: 'yours',
        calAtTimeline: 'latest in the timeline',
        calUnknown: 'date unclear',
        calToday: 'today',
        calIn: 'in {n} days',
        calAged: '{n} years old',
        calDeclared: 'sheet says {n}',
        aiExtra: 'Extra instruction (optional)',
        aiRun: 'Run AI',
        aiStop: 'Stop',
        aiRunning: 'Generating…',
        aiInsert: 'Append to chapter',
        aiReplace: 'Replace chapter body',
        aiInserted: 'Written back to the chapter',
        aiNewChapterDone: 'Created a new chapter',
        aiReads: 'The AI will read',
        aiReadChars: 'characters',
        aiReadRules: 'world rules',
        aiReadChapters: 'chapters',
        aiReadEdges: 'relations',
        aiOutEdit: 'Edit this text freely — writing it in and reading material both use your version.',
        aiNothing: 'Nothing yet. Pick a task and hit “Run AI”.',
        aiNoModel: 'No model selected yet — pick one in Settings → Models.',
        aiNoChapter: 'This book has no chapters yet. Create one under “Chapters” first.',
        aiGrounding: 'Reading the book…',
        aiPick: 'Choose what the AI reads',
        aiPickHint: 'Everything is selected by default; unchecked entries stay out of the prompt.',
        aiPickOpen: 'Pick entries',
        aiPickClose: 'Hide picker',
        aiPickAll: 'All',
        aiPickNone: 'None',
        aiPickReset: 'Reset',
        aiPickCount: 'selected',
        aiThread: 'Conversation',
        aiThreadHint: 'Earlier rounds go to the model as history, so the next run continues from them; switching books or “Clear” starts fresh.',
        aiThreadClear: 'Clear conversation',
        dossier: 'Dossier',
        dossierTitle: 'Character dossier',
        dossierClose: 'Close',
        dossierHint: 'Click a bound entry to unbind; pick from the dropdown to bind more. One-to-many and many-to-one both work.',
        dossierBind: '＋ Bind…',
        dossierUnbind: 'Unbind',
        dossierPick: 'Pick an entry',
        dossierLeader: 'leader',
        dossierRelations: 'Graph edges',
        dossierRelationsHint: 'Read-only here; add or remove edges in the Graph tab.',
        dossierNoRel: 'No edges yet.',
        dossierEmpty: 'No entries in this section yet — create one first.',
        aiModel: 'Model',
        aiModelHint: 'Each book keeps its own — this choice affects only this book.',
        aiModelInherit: 'harness default',
        aiModelUnset: 'no model chosen for this book yet',
        aiModelSet: 'Change model',
        aiModelClear: 'Use default',
        aiModelProvider: 'Provider',
        aiModelName: 'Model',
        aiModelEmpty: 'This deployment lists no models.',
        aiModelSaved: 'Model saved',
        aiModelCleared: 'Back to the default.',
        aiEffort: 'Thinking',
        aiEffortHint: 'Leave it empty to follow the model’s own default (currently “{def}”). Lower it for routine writing — faster and cheaper.',
        aiEffortInherit: 'Model default',
        aiEffortSaved: 'Thinking level saved',
        aiEffortNone: 'This model offers no thinking levels.',
        confirmReplace: 'Replace this chapter’s body with the generated text? The current text will be overwritten.',
        aiWords: 'Target length',
        aiWordsHint: 'Empty means no requirement. A number goes into the prompt and lifts this round’s token budget.',
        aiCount: 'This answer',
        aiCountUnit: 'words',
        aiCountAsk: 'asked',
        aiCountOver: 'over',
        aiCountUnder: 'short by',
        aiCountHit: 'on target',
        aiUsageTotal: 'Total',
        aiUsageCache: 'cache read',
        aiUsageCacheWrite: 'cache write',
        aiUsageRuns: 'runs',
        aiUsageReset: 'Reset',
        aiUsageResetAsk: 'Clear this book’s token totals?',
        aiUsageRound: 'This round',
        aiUsageSince: 'since',
        aiUsageUpdated: 'last',
        aiUsageClose: 'Hide',
        aiUsageHint: 'Every round this book has ever run is counted here — any window, any tool, one ledger. Reset clears only what this book recorded.',
        zoomOpen: 'Enlarge',
        zoomTitle: 'Enlarged preview',
        zoomBigger: 'Bigger text',
        zoomSmaller: 'Smaller text',
        zoomReset: 'Reset',
        zoomCopy: 'Copy all',
        zoomCopied: 'Copied',
        zoomClose: 'Close',
        zoomHint: 'Esc closes · ＋ / － change the size (kept on this machine) · long text wraps to the window and scrolls',
        zoomChars: 'chars',
        zoomFrom: 'from',
        graphZoomIn: 'Zoom in',
        graphZoomOut: 'Zoom out',
        graphZoomReset: 'Back to 100%',
        graphZoomHint: 'Ctrl + wheel zooms · drag pans',
        aiExtract: 'Also file what is new',
        aiExtractHint: 'After the text is written into the chapter, this book’s model reads the passage and lists the people, places, items and rules it introduced — you decide what to file.',
        aiExtractNow: 'Read this passage',
        aiExtractTitle: 'New material in this passage',
        aiExtractIntro: 'These were recognised in the passage you just wrote. Fields the model was unsure about are left out, and an entry that already exists only gets the fields that are still empty — nothing you wrote yourself is overwritten.',
        aiExtractEmpty: 'Nothing new to file from this passage.',
        aiExtractApply: 'File the checked entries',
        aiExtractAll: 'All',
        aiExtractNone: 'None',
        aiExtractNew: 'New',
        aiExtractMerge: 'Exists · fills gaps only',
        aiExtractFields: 'fields',
        aiExtractDoing: 'Reading the passage…',
        aiExtractApplying: 'Filing…',
        aiExtractDone: 'Filed',
        aiExtractCount: 'entries',
        aiExtractFailed: 'Could not read the passage: ',
        aiExtractReport: 'added',
        aiExtractUpdated: 'updated',
        aiExtractSkipped: 'skipped',
        chaptersExtract: 'Read chapters',
        chaptersExtractHint: 'Check the chapters to read: one call each, no pass over the whole book. The chapter on screen is read from the editor, unsaved edits included; the others from what is saved. Nothing is filed until you check it in the next step.',
        chaptersExtractDo: 'Read them',
        chaptersExtractDoing: 'Reading',
        chaptersExtractUnit: 'chapters',
        aiExtractMissed: '{n} slice(s) could not be read — run it again to pick them up.',
        searchOpen: 'Search',
        searchTitle: 'Whole-book search',
        searchPlaceholder: 'Find a word across this book…',
        searchRun: 'Search',
        searchClose: 'Close',
        searchHint: 'Chapter prose (with line numbers), every field of every record, material file names and raw text are searched. Separate terms with spaces — all must match.',
        searchEmpty: 'No matches.',
        searchScanned: 'Scanned',
        searchTruncated: 'Too many matches; only the first part is shown.',
        searchUnit: 'entries',
        searchEntries: 'records',
        searchFields: 'fields',
        searchLine: 'line {n}',
        searchSections: 'Sections',
        searchAll: 'All sections',
        settingsOpen: 'Settings',
        settingsTitle: 'Settings for this book',
        settingsTheme: 'Theme',
        settingsThemeDefault: 'Default',
        settingsThemeSepia: 'Sepia',
        settingsThemeDark: 'Dark',
        settingsFontSize: 'Editor font size',
        settingsAutosave: 'Autosave',
        settingsAutosaveOn: 'On',
        settingsAutosaveOff: 'Off',
        settingsAutosaveHint: 'A few seconds after you stop typing, the chapter is saved by itself. Records and outline entries still save by hand.',
        settingsScope: 'These settings apply to this book only.',
        progressOpen: 'Progress',
        progressTitle: 'Writing progress',
        progressGoal: 'Target words',
        progressDeadline: 'Deadline',
        progressGoalSave: 'Save goal',
        progressGoalClear: 'Clear goal',
        progressDone: 'Written',
        progressRemaining: 'Remaining',
        progressPercent: 'Complete',
        progressToday: 'Today',
        progressWeek: 'Last 7 days',
        progressStreak: 'Streak',
        progressDays: 'days',
        progressAvg: 'Daily average (7d)',
        progressPace: 'At this pace',
        progressPerDay: 'Needed per day',
        progressNoGoal: 'No goal yet. A word target gives the numbers something to measure.',
        progressEmpty: 'No chapters yet. Write the first one and the numbers appear.',
        progressHistory: 'Last 30 days',
        progressLongest: 'Longest chapter',
        progressTracked: 'Tracking since',
        importOpen: 'Import',
        importTitle: 'Import and restore',
        importBackupTab: 'Whole-book backup',
        importMarkdownTab: 'Manuscript (Markdown)',
        importFileTab: 'A file in this book',
        importBackupHint: 'Paste a whole-book backup (JSON) produced by Export. It previews first; nothing is written until you confirm.',
        importMarkdownHint: 'Paste a manuscript; it is split into chapters on its own headings (# / ## / 第N章).',
        importFileHint: 'Read a file that already lives inside this book (materials/, publish/, import/).',
        importPaste: 'Paste the content here…',
        importPreview: 'Preview',
        importApply: 'Import',
        importMode: 'Mode',
        importModeMerge: 'Merge (add only)',
        importModeReplace: 'Replace (match the backup)',
        importDescribe: 'This backup holds',
        importChapters: 'chapters',
        importWords: 'words',
        importSections: 'sections',
        importRestorable: 'restorable',
        importSkip: 'skip',
        importDryRun: 'This is only a preview; nothing has been written.',
        importDone: 'Written',
        importWarnings: 'Notes',
        importFilePick: 'Pick a file',
        importNeedText: 'Paste some content or pick a file first.',
        draftOpen: 'Snapshots',
        draftTitle: 'Draft box',
        draftTake: 'Take a snapshot',
        draftNote: 'Note (optional)',
        draftEmpty: 'No snapshots yet. Take one before a rewrite and a bad edit stops being final.',
        draftRestore: 'Restore',
        draftRestoreAuto: 'Automatic snapshot',
        draftConflict: 'This chapter changed after the snapshot. Overwrite it with the snapshot?',
        draftRestored: 'Restored — what was overwritten was snapshotted too.',
        draftSame: 'The chapter already matches this snapshot.',
        draftDeleteConfirm: 'Delete this snapshot?',
        chapterMove: 'Order',
        chapterUp: 'Move up',
        chapterDown: 'Move down',
        chapterRenumber: 'Renumber',
        chapterRenumberHint: 'Renumber in the current order; preview first if you like.',
        chapterRenumberDry: 'Preview',
        chapterRenumberGo: 'Apply',
        chapterStyle: 'Numbering',
        chapterStyleCn: 'Chinese (第一章)',
        chapterStyleDigit: 'Digits (第1章)',
        chapterIssues: 'Numbering issues',
        chapterNoIssues: 'Numbering is continuous — no gaps, no duplicates.',
        chapterGap: 'missing',
        chapterDupe: 'duplicate',
        chapterBare: 'unnumbered',
        chapterRenamed: 'Renamed',
        aiUsage: 'Usage',
        aiUsageIn: 'in',
        aiUsageOut: 'out',
        aiSaveAs: 'Keep as content',
        aiSaveHint: 'Store this result as a record, a material file or a draft snapshot.',
        aiSaveSection: 'Store as',
        aiSaveChapter: 'Chapter body',
        aiSaveMaterial: 'Material file',
        aiSaveNewChapter: 'New chapter',
        aiSaveDraft: 'Draft snapshot',
        aiSaveRecord: 'Record entry',
        aiSaveDo: 'Save',
        aiSaved: 'Saved',
        aiSaveEntry: 'Entry name',
        aiSaveFileName: 'File name',
        aiSaveChapterName: 'Chapter name',
        aiSaveNote: 'Note',
      },
    }

    // ── styles ────────────────────────────────────────────────────────────
    const STYLE_ID = 'dsh-novel-studio-css'
    const css = `
.ns-root{display:flex;height:100%;min-height:0;font-size:13px;color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-base,#fff)}
.ns-shelf{width:212px;flex:none;display:flex;flex-direction:column;min-height:0;border-right:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,transparent)}
.ns-shelf-head{display:flex;align-items:center;gap:6px;padding:10px 12px 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-shelf-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ns-shelf-fold{flex:none;padding:1px 5px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1.3;cursor:pointer;opacity:.65}
.ns-shelf-fold:hover{opacity:1;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}
.ns-shelf[data-folded="1"]{width:32px}
.ns-shelf[data-folded="1"] .ns-shelf-head{justify-content:center;padding:10px 0}
.ns-shelf[data-folded="1"] .ns-shelf-title,.ns-shelf[data-folded="1"] .ns-books,.ns-shelf[data-folded="1"] .ns-shelf-foot{display:none}
.ns-books{flex:1;overflow:auto;padding:0 6px 6px;min-height:0}
.ns-book{display:block;width:100%;text-align:left;padding:7px 9px;margin:1px 0;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.ns-book:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.ns-book[data-on="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));font-weight:600}
.ns-book-row{display:flex;align-items:center;gap:4px}
.ns-book-row .ns-book{flex:1;min-width:0;width:auto}
.ns-book-del{flex:0 0 auto;padding:4px 7px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer;opacity:.4;transition:opacity .12s}
.ns-book-row:hover .ns-book-del,.ns-book-del:focus-visible{opacity:1}
.ns-trash-row{display:flex;align-items:center;gap:8px;padding:6px 8px;margin:3px 0;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10))}
.ns-trash-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.ns-trash-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ns-trash-when{font-size:10px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-trash-acts{display:flex;gap:6px;flex:0 0 auto}
.ns-shelf .ns-trash-acts .ns-btn{width:auto}
.ns-trash-open{margin-top:2px}
.ns-book small{display:block;font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ns-shelf-foot{padding:8px;border-top:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));max-height:70%;overflow:auto;min-height:0}
.ns-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.ns-top{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))}
.ns-title{font-size:15px;font-weight:650;margin:0}
.ns-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,#9ca3af);flex:none}
.ns-dot[data-ok="1"]{background:var(--dsw-alias-state-success-primary,#16a34a)}
.ns-dot[data-ok="0"]{background:var(--dsw-alias-state-error-primary,#dc2626)}
.ns-muted{color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-spacer{flex:1}
.ns-tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 10px;border-bottom:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));max-height:38vh;overflow:auto}
.ns-tab{border:0;background:transparent;color:inherit;font:inherit;padding:5px 11px;border-radius:6px;cursor:pointer}
.ns-tab:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.ns-tab[data-on="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));font-weight:600}
.ns-subtabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 10px 0}
.ns-subtab{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:12px;padding:4px 9px;border-radius:5px;cursor:pointer}
.ns-subtab[data-on="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}
.ns-body{flex:1;min-height:0;display:flex}
.ns-list{width:200px;flex:none;overflow:auto;border-right:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));padding:6px}
.ns-item{display:block;width:100%;text-align:left;padding:6px 9px;margin:1px 0;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ns-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.ns-item[data-on="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));font-weight:600}
.ns-item small{display:block;font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-pane{flex:1;min-width:0;min-height:0;overflow:auto;padding:14px 16px}
.ns-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px 14px}
.ns-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.ns-field-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end;margin-bottom:-2px}
.ns-label{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-input,.ns-textarea,.ns-select{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.18));background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit}
.ns-textarea{resize:vertical;min-height:70px;line-height:1.55}
.ns-textarea[data-body="1"]{min-height:320px;font-family:ui-monospace,Consolas,monospace}
.ns-actions{display:flex;align-items:center;gap:8px;padding-top:4px;flex-wrap:wrap}
.ns-btn{border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.18));background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));color:inherit;font:inherit;padding:6px 13px;border-radius:6px;cursor:pointer}
.ns-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.18))}
.ns-btn:disabled{opacity:.5;cursor:default}
.ns-btn[data-kind="primary"]{background:var(--dsw-alias-brand-primary,#2563eb);border-color:transparent;color:#fff}
.ns-btn[data-kind="danger"]{color:var(--dsw-alias-state-error-primary,#dc2626)}
.ns-shelf .ns-btn{width:100%}
.ns-err{margin:14px;padding:10px 12px;border-radius:8px;border:0.5px solid var(--dsw-alias-state-error-primary,#dc2626);color:var(--dsw-alias-state-error-primary,#dc2626);white-space:pre-wrap;word-break:break-word}
.ns-pill{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:12px}
.ns-card{padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.07));border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.ns-card b{display:block;font-size:20px;line-height:1.2}
.ns-card span{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-dl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:12px 0}
.ns-dl dt{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;align-self:center}
.ns-dl dd{margin:0;word-break:break-word}
.ns-empty{padding:26px 16px;color:var(--dsw-alias-label-secondary,#6b7280);text-align:center}
/* ── website shortcuts (empty pane launchpad) ── */
.ns-welcome{flex:1;min-height:0;overflow:auto;padding:0 18px 22px}
.ns-sites{max-width:860px;margin:0 auto;padding-top:8px}
.ns-sites-head{display:flex;align-items:center;gap:8px}
.ns-sites-title{margin:0;font-size:14px;font-weight:600}
.ns-sites-add{margin-left:auto}
.ns-sites-hint{margin:4px 0 10px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-sites-note{margin:0 0 8px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);word-break:break-all}
.ns-sites-empty{padding:14px 0;color:var(--dsw-alias-label-secondary,#6b7280);text-align:center;font-size:13px}
/* auto-fill keeps the grid in step with the pane: folding the shelf wider
   just adds a column instead of stranding the cards. */
.ns-sites-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(174px,1fr));gap:8px}
.ns-site{display:flex;align-items:center;gap:4px;min-width:0;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}
.ns-site-open{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ns-site-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ns-site-url{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ns-site-acts{display:flex;gap:1px;opacity:.35;transition:opacity .12s}
.ns-site:hover .ns-site-acts,.ns-site:focus-within .ns-site-acts{opacity:1}
.ns-site-act{padding:4px 5px;border:0;border-radius:5px;background:none;color:inherit;cursor:pointer;font-size:12px;line-height:1}
.ns-site-act:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.ns-site-act[data-kind="danger"]:hover{background:rgba(220,38,38,.12);color:#dc2626}
.ns-site-form{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding:10px;border:0.5px dashed var(--dsw-alias-border-l1,rgba(0,0,0,.14));border-radius:8px}
.ns-site-form .ns-input{flex:1 1 150px;width:auto;min-width:0}
.ns-site-form .ns-btn{padding:6px 10px}
/* workbench overview + grouped navigation (layout rebuild) */
.ns-wb-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(184px,1fr));gap:8px;margin:14px 0 0}
.ns-wb-widget{display:flex;flex-direction:column;gap:3px;align-items:flex-start;text-align:left;box-sizing:border-box;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));color:inherit;font:inherit;cursor:pointer;transition:border-color .12s}
.ns-wb-widget:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#2563eb)}
.ns-wb-widget:disabled{opacity:.55;cursor:default}
.ns-wb-widget b{font-size:15px;font-weight:650}
.ns-wb-widget small{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.ns-wb-widget[data-bad="1"] b{color:var(--dsw-alias-state-error-primary,#dc2626)}
.ns-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;align-items:start;margin-top:14px}
.ns-sh-group{margin-top:12px}
.ns-sh-unit{font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#6b7280);margin-bottom:6px}
.ns-sh-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:7px 9px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:8px;margin-bottom:6px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}
.ns-sh-row b{font-size:13px}
.ns-sh-row small{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-sh-pill{font-size:11px;line-height:1.5;padding:1px 7px;border-radius:99px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}
.ns-sh-pill[data-kind="stable"]{color:var(--dsw-alias-state-success-primary,#16a34a)}
.ns-sh-pill[data-kind="stale"],.ns-sh-pill[data-kind="drift"]{color:var(--dsw-alias-state-warning,#d97706)}
.ns-sh-pill[data-kind="gone"]{color:var(--dsw-alias-state-error-primary,#dc2626)}
.ns-sh-pill[data-kind="mode"]{color:var(--dsw-alias-brand-primary,#2563eb)}
.ns-sh-acts{margin-left:auto;display:flex;gap:6px}
.ns-sh-impact{flex-basis:100%;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);padding-top:2px}
.ns-sh-form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:12px}
.ns-sh-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-sh-form select{font:inherit;font-size:13px;padding:5px 8px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:7px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.9));color:inherit;max-width:260px}
.ns-sh-confirm{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px;margin:8px 0;border:0.5px solid var(--dsw-alias-state-warning,#d97706);border-radius:8px;font-size:12px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07))}
.ns-sh-layer{display:flex;flex-direction:column;gap:6px;padding:8px 0 2px}
.ns-sh-layerhead{font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#64748b);padding-bottom:4px;border-bottom:0.5px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.25))}
.ns-sh-newseries{display:flex;gap:6px;align-items:center;width:100%}
.ns-sh-newseries input{flex:1;min-width:140px}
.ns-sh-override{display:flex;flex-direction:column;gap:6px;width:100%;flex-basis:100%;padding:8px 10px;margin-top:4px;border:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07))}
.ns-sh-ovfields{display:flex;flex-wrap:wrap;gap:6px 12px}
.ns-sh-ovfield{display:flex;gap:5px;align-items:center;font-size:12px;cursor:pointer}
.ns-sh-tpl{display:flex;flex-direction:column;gap:8px}
.ns-sh-tplname{min-width:160px}
.ns-sh-tplpick{display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 10px;border:0.5px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:8px;max-height:180px;overflow:auto}
.ns-sh-badge{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:5px 8px;margin-bottom:8px;border:0.5px solid var(--dsw-alias-brand-primary,#2563eb);border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));font-size:12px}
.ns-sh-mini{margin-left:6px;font-size:11px;opacity:.75}
.ns-tplstart{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;padding:10px 12px;margin:10px 0;border:0.5px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.35));border-radius:10px}
.ns-tplstart-label{font-size:12px;font-weight:600}
.ns-coach{padding:3px 10px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.ns-coach:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.ns-coach[data-level=warn]{border-color:var(--dsw-alias-state-warning,#d97706);color:var(--dsw-alias-state-warning,#d97706)}
.ns-coach[data-level=error]{border-color:var(--dsw-alias-state-error,#dc2626);color:var(--dsw-alias-state-error,#dc2626)}
.ns-rd{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.ns-rd-head{font-size:12px;font-weight:700;letter-spacing:.03em;color:var(--dsw-alias-label-secondary,#64748b)}
.ns-rd-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px}
.ns-rd-key::before{content:'';display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;background:currentColor;opacity:.8}
.ns-rd-key[data-key=tension]{color:#dc2626}
.ns-rd-key[data-key=fun]{color:#d97706}
.ns-rd-key[data-key=curiosity]{color:#2563eb}
.ns-rd-key[data-key=immersion]{color:#059669}
.ns-rd-row{display:flex;align-items:center;gap:8px}
.ns-rd-ch{flex:0 0 96px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,#64748b)}
.ns-rd-bars{display:flex;align-items:flex-end;gap:3px;height:44px}
.ns-rd-bar{display:flex;align-items:flex-end;width:12px;height:100%;border-radius:3px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.ns-rd-bar i{display:block;width:100%;border-radius:3px;background:#2563eb;opacity:.85}
.ns-rd-bar[data-key=tension] i{background:#dc2626}
.ns-rd-bar[data-key=fun] i{background:#d97706}
.ns-rd-bar[data-key=curiosity] i{background:#2563eb}
.ns-rd-bar[data-key=immersion] i{background:#059669}
.ns-rd-list{display:flex;flex-direction:column;gap:8px}
.ns-rd-item{padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));border-radius:8px}
.ns-rd-item-head{display:flex;align-items:center;gap:8px;font-size:12px}
.ns-rd-line{font-size:12px;margin-top:4px;display:flex;gap:6px;align-items:baseline}
.ns-rd-line b{flex:0 0 auto;color:var(--dsw-alias-label-secondary,#64748b);font-weight:600}
.ns-rd-line[data-key=drop]{color:var(--dsw-alias-state-warning,#d97706)}
.ns-rd-line[data-key=poison]{color:var(--dsw-alias-state-error,#dc2626)}
.ns-cal{display:flex;flex-direction:column;gap:8px;margin:0 0 10px;padding:10px;border:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04))}
.ns-cal-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}
.ns-cal-title{font-weight:700;letter-spacing:.04em}
.ns-cal-sum{color:var(--dsw-alias-label-secondary,#64748b)}
.ns-cal-assumed{padding:2px 8px;border-radius:999px;border:0.5px solid var(--dsw-alias-state-warning,#d97706);color:var(--dsw-alias-state-warning,#d97706)}
.ns-cal-at{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px}
.ns-cal-lab{color:var(--dsw-alias-label-secondary,#64748b)}
.ns-cal-input{width:150px;box-sizing:border-box;padding:4px 8px;border:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.4));border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px}
.ns-cal-when{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#64748b)}
.ns-cal-months{display:flex;flex-wrap:wrap;gap:6px}
.ns-cal-month{display:inline-flex;align-items:baseline;gap:5px;padding:3px 8px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));font-size:12px}
.ns-cal-month b{font-weight:600}
.ns-cal-month i{font-style:normal;color:var(--dsw-alias-label-secondary,#64748b);font-variant-numeric:tabular-nums}
.ns-cal-month em{font-style:normal;font-size:11px;color:var(--dsw-alias-label-secondary,#64748b)}
.ns-cal-fests{display:flex;flex-direction:column;gap:4px}
.ns-cal-fest{display:flex;align-items:baseline;gap:8px;font-size:12px;padding:3px 0}
.ns-cal-fest[data-state=today] .ns-cal-fwhen{color:var(--dsw-alias-state-success-primary,#16a34a);font-weight:600}
.ns-cal-fest[data-state=unknown] .ns-cal-fdate{color:var(--dsw-alias-state-warning,#d97706)}
.ns-cal-fname{font-weight:600}
.ns-cal-fdate,.ns-cal-fwhen{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#64748b)}
.ns-cal-fnote{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,#64748b)}
.ns-cal-ages{display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}
.ns-cal-age{display:flex;align-items:baseline;gap:8px;font-size:12px;font-variant-numeric:tabular-nums}
.ns-cal-age[data-bad="1"] .ns-cal-adecl{color:var(--dsw-alias-state-warning,#d97706);font-weight:600}
.ns-cal-aname{font-weight:600;min-width:64px}
.ns-cal-aborn,.ns-cal-ayear{color:var(--dsw-alias-label-secondary,#64748b)}
.ns-cal-adecl{color:var(--dsw-alias-label-secondary,#94a3b8)}
.ns-sh-confirm b{font-size:12px}
.ns-group{min-width:0;padding:10px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}
.ns-group-title{font-size:13px;font-weight:700;letter-spacing:.04em;margin-bottom:8px;padding-bottom:6px;border-bottom:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))}
.ns-group[data-kind="write"] .ns-group-title{color:var(--dsw-alias-brand-primary,#2563eb)}
.ns-group[data-kind="lib"] .ns-group-title{color:var(--dsw-alias-state-success-primary,#16a34a)}
.ns-group[data-kind="tools"] .ns-group-title{color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-group-card{display:flex;flex-direction:column;gap:2px;width:100%;box-sizing:border-box;text-align:left;padding:8px 10px;margin-bottom:6px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:6px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05));color:inherit;font:inherit;cursor:pointer}
.ns-group-card:hover{border-color:var(--dsw-alias-brand-primary,#2563eb);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.ns-group-card b{font-size:13.5px;font-weight:650}
.ns-group-card small{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-group-foot{display:flex;gap:12px;padding-top:6px;border-top:0.5px dashed var(--dsw-alias-border-l1,rgba(0,0,0,.14))}
.ns-link{background:none;border:0;padding:4px 0;font-size:12.5px;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer}
.ns-link:hover{color:var(--dsw-alias-brand-primary,#2563eb)}
.ns-wb-counts{margin-top:14px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-nav-toggle,.ns-exit{padding:5px 12px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:6px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05));color:inherit;font:inherit;cursor:pointer}
.ns-nav-toggle:hover,.ns-exit:hover{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.ns-exit-bar{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.ns-hint{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);margin:0 0 10px}
.ns-root{margin-top:8px;display:flex;flex-direction:column;gap:3px}
.ns-root-title{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-root-title .ns-btn{margin-left:auto;width:auto;padding:2px 7px;font-size:11px}
.ns-root-path{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default}
.ns-root-meta{font-size:10px;color:var(--dsw-alias-label-secondary,#9ca3af)}
.ns-root-form{display:flex;flex-direction:column;gap:5px;margin-top:3px}
.ns-root-form .ns-input{font-size:11px;padding:4px 6px}
.ns-root-row{display:flex;gap:6px}
.ns-root-row .ns-input{flex:1;min-width:0}
.ns-root-row .ns-btn{width:auto;flex:1;padding:4px 6px;font-size:11px}
.ns-root-row .ns-root-pick{flex:0 0 auto;padding:4px 8px}
.ns-browser{display:flex;flex-direction:column;gap:5px;margin-top:4px;padding:6px;border-radius:7px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}
.ns-browser-head{display:flex;align-items:center;gap:5px;min-width:0}
.ns-browser-path{font-size:10.5px;color:var(--dsw-alias-label-secondary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default}
.ns-browser-path:empty{display:none}
.ns-browser-list{display:flex;flex-direction:column;gap:2px;max-height:190px;overflow:auto}
.ns-browser-item{display:block;width:100%;text-align:left;padding:3px 6px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;font-size:11.5px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ns-browser-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}
.ns-browser-item:disabled{opacity:.55;cursor:default}
.ns-root-check{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-root-note{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);word-break:break-word}
.ns-graph-bar{display:flex;align-items:center;gap:6px;padding:8px 16px 0;flex-wrap:wrap}
.ns-graph-wrap{position:relative;overflow:auto;max-height:min(78vh,720px);overscroll-behavior:contain}
.ns-graph{display:block;height:auto}
.ns-graph-node circle{fill:var(--dsw-alias-brand-primary,#2563eb);stroke:var(--dsw-alias-bg-base,#fff);stroke-width:1.5}
.ns-graph-node circle[data-external="1"]{fill:var(--dsw-alias-label-secondary,#6b7280);opacity:.75}
.ns-graph-node[data-kind="factions"] circle{fill:var(--dsw-alias-state-warn-primary,#d97706)}
.ns-graph-node[data-kind="locations"] circle{fill:var(--dsw-alias-state-success-primary,#16a34a)}
.ns-graph-node[data-kind="items"] circle{fill:var(--dsw-alias-state-idle-primary,#9ca3af)}
.ns-graph-node text{pointer-events:none}
.ns-graph-label{font-size:10px;fill:var(--dsw-alias-label-primary,#1f2328)}
.ns-graph-edge-label{font-size:9px;fill:var(--dsw-alias-label-secondary,#6b7280)}
.ns-graph-stats{display:flex;gap:14px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);padding:0 16px 12px}
.ns-graph-node[data-pick="1"] circle{stroke:var(--dsw-alias-brand-primary,#2563eb);stroke-width:3}
.ns-edge-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:0 16px 12px}
.ns-edge-tools label,.ns-edge-form label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-edge-tools select,.ns-edge-tools input,.ns-edge-form select,.ns-edge-form input{font-size:12px;padding:4px 6px;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,inherit)}
.ns-edge-list{display:flex;flex-direction:column;gap:4px;padding:0 16px 16px}
.ns-edge-row{display:flex;align-items:center;gap:8px;font-size:12px;padding:5px 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.07));border-left:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4))}
.ns-edge-row[data-source="auto"]{border-left-style:dashed}
.ns-edge-row[data-on="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.ns-edge-row .ns-btn{margin-left:auto}
.ns-edge-form{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:8px 10px;margin-top:2px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}
.ns-issues{margin-top:12px;display:flex;flex-direction:column;gap:4px}
.ns-issue{display:flex;align-items:baseline;gap:8px;font-size:12px;padding:5px 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.07));border-left:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4))}
.ns-issue[data-level="error"]{border-left-color:var(--dsw-alias-state-error-primary,#dc2626)}
.ns-issue[data-level="warn"]{border-left-color:var(--dsw-alias-state-warn-primary,#d97706)}
.ns-issue[data-level="info"]{border-left-color:var(--dsw-alias-state-idle-primary,#9ca3af)}
.ns-card[data-level="error"] b{color:var(--dsw-alias-state-error-primary,#dc2626)}
.ns-card[data-level="warn"] b{color:var(--dsw-alias-state-warn-primary,#d97706)}
.ns-pill[data-level="error"]{color:var(--dsw-alias-state-error-primary,#dc2626)}
.ns-pill[data-level="warn"]{color:var(--dsw-alias-state-warn-primary,#d97706)}
.ns-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:2px}
.ns-chip{border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.18));background:transparent;color:inherit;font:inherit;font-size:12px;padding:5px 12px;border-radius:999px;cursor:pointer}
.ns-chip:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}
.ns-chip[data-on="1"]{background:var(--dsw-alias-brand-primary,#2563eb);border-color:transparent;color:#fff}
.ns-chip:disabled{opacity:.5;cursor:default}
.ns-preview{margin:6px 0 0;padding:12px;max-height:min(52vh,520px);overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:var(--ns-body-size,13px);line-height:1.6;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.07));border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.ns-artifacts{margin-top:2px;display:flex;flex-direction:column;gap:4px}
.ns-artifact{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.07));border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.ns-artifact code{flex:1;font-size:12px;word-break:break-all}
.ns-section-title{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#6b7280);margin:16px 0 6px}
.ns-ai{flex:1;min-width:0;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:10px 14px;box-sizing:border-box}
.ns-ai-form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
.ns-ai-form label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-ai-form select,.ns-ai-form input,.ns-ai-form textarea{padding:5px 8px;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit}
.ns-ai-form textarea{min-width:340px;min-height:54px;resize:vertical}
.ns-ai-wide{flex:1 1 100%}
.ns-ai-wide textarea{width:100%;box-sizing:border-box}
.ns-ai-reads{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-ai-out{flex:1 1 240px;min-height:120px;max-height:min(46vh,440px);overflow:auto;margin:0;padding:12px;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:var(--ns-body-size,13px);line-height:1.75;resize:vertical;box-sizing:border-box;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.07))}
.ns-ai-out:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#3b82f6)}
.ns-ai-out[readonly]{opacity:.94}
.ns-ai-out[data-empty="1"]{color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-ai-caret{display:inline-block;width:7px;height:14px;vertical-align:-2px;background:var(--dsw-alias-brand-primary,#3b82f6);animation:ns-blink 1.1s steps(2,start) infinite}
@keyframes ns-blink{to{visibility:hidden}}
.ns-ai-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ns-ai-bar .ns-spacer{flex:1}
.ns-ai-note{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-ai-model{font-size:12px;font-weight:600;word-break:break-word}
.ns-ai-err{font-size:12px;padding:8px 10px;border-radius:6px;border:0.5px solid var(--dsw-alias-state-error-primary,#ef4444);color:var(--dsw-alias-state-error-primary,#ef4444)}
.ns-ai-pick{display:flex;flex-direction:column;gap:8px}
.ns-ai-pick-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ns-ai-pick-head .ns-spacer{flex:1}
.ns-ai-pools{display:flex;flex-direction:column;gap:10px;max-height:260px;overflow:auto;padding:10px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.07))}
.ns-ai-pool{display:flex;flex-direction:column;gap:5px}
.ns-ai-pool-head{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ns-ai-pool-head .ns-spacer{flex:1}
.ns-ai-pool-name{font-size:12px;font-weight:600}
.ns-ai-mini{font-size:11px;padding:2px 8px}
.ns-ai-chips{display:flex;flex-wrap:wrap;gap:6px}
.ns-ai-chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:3px 10px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.18));cursor:pointer;user-select:none;background:transparent}
.ns-ai-chip[data-on="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}
.ns-ai-chip input{margin:0;accent-color:var(--dsw-alias-brand-primary,#2563eb)}
.ns-ai-thread{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.07));max-height:300px;overflow:auto}
.ns-ai-thread-head{display:flex;gap:8px;align-items:center}
.ns-ai-thread-head .ns-spacer{flex:1}
.ns-ai-turn{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}
.ns-ai-turn-head{display:flex;gap:8px;align-items:baseline}
.ns-ai-turn-head .ns-spacer{flex:1}
.ns-ai-turn-ask{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);word-break:break-word}
.ns-ai-turn-answer{font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:7.5em;overflow:auto}
.ns-dossier{position:fixed;top:0;right:0;bottom:0;width:min(560px,92vw);z-index:60;display:flex;flex-direction:column;gap:10px;padding:14px 16px;box-sizing:border-box;overflow:auto;background:var(--dsw-alias-bg-base,#fff);border-left:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.14));box-shadow:-8px 0 24px rgba(0,0,0,.18)}
.ns-dossier-scrim{position:fixed;inset:0;z-index:59;background:rgba(0,0,0,.28)}
.ns-zoom-mask{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box;background:rgba(0,0,0,.44)}
.ns-zoom-card{display:flex;flex-direction:column;gap:8px;width:min(1000px,100%);height:min(88vh,1400px);padding:12px 14px;box-sizing:border-box;border-radius:12px;background:var(--dsw-alias-bg-base,#fff);border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.14));box-shadow:var(--dsw-elevation-lg,0 18px 48px rgba(0,0,0,.32))}
.ns-zoom-head,.ns-zoom-foot{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:0}
.ns-zoom-head .ns-spacer,.ns-zoom-foot .ns-spacer{flex:1}
.ns-zoom-title{font-size:13px;font-weight:600}
.ns-zoom-note{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-zoom-size{font-variant-numeric:tabular-nums}
.ns-zoom-text{flex:1;min-height:0;margin:0;padding:14px 16px;overflow:auto;white-space:pre-wrap;word-break:break-word;line-height:1.8;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.07))}
.ns-zoom-text::selection{background:var(--dsw-alias-brand-primary,#2563eb);color:#fff}
@media (max-width:720px){.ns-zoom-mask{padding:0}.ns-zoom-card{width:100%;height:100%;border-radius:0;border:0}}
.ns-dossier-head{display:flex;gap:8px;align-items:center}
.ns-dossier-head .ns-spacer{flex:1}
.ns-dossier-sec{display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.ns-dossier-bind{display:flex;gap:6px;align-items:center}
.ns-dossier-bind .ns-select{width:auto;flex:1}
.ns-dossier-nothing{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ns-actions .ns-spacer{flex:1}
.ns-searchbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ns-searchbar input{flex:1;min-width:180px}
.ns-search-hits{display:flex;flex-direction:column;gap:8px}
.ns-search-hit{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05));cursor:pointer}
.ns-search-hit[data-on="1"]{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.ns-search-where{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-search-snippet{font-size:13px;line-height:1.6;word-break:break-word;white-space:pre-wrap}
.ns-search-snippet mark{background:var(--dsw-alias-state-warn-primary,#f59e0b33);color:inherit;padding:0 1px;border-radius:2px}
.ns-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.ns-stat{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}
.ns-stat-n{font-size:20px;font-weight:600;line-height:1.2}
.ns-stat-k{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-spark{display:flex;align-items:flex-end;gap:2px;height:64px;padding:6px 8px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}
.ns-spark-bar{flex:1;min-width:3px;background:var(--dsw-alias-brand-primary,#2563eb);opacity:.75;border-radius:2px 2px 0 0}
.ns-spark-bar[data-zero="1"]{opacity:.18;min-height:2px}
.ns-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.18));overflow:hidden}
.ns-bar-fill{height:100%;background:var(--dsw-alias-brand-primary,#2563eb);border-radius:999px}
.ns-set-row{display:grid;grid-template-columns:130px 1fr;gap:10px;align-items:center}
.ns-import textarea{min-height:150px;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px}
.ns-import-list{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto}
.ns-import-file{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));cursor:pointer}
.ns-import-file[data-on="1"]{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.ns-import-file .ns-spacer{flex:1}
.ns-report{display:flex;flex-direction:column;gap:6px}
.ns-report-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px}
.ns-notes{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-drafts{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto}
.ns-draft{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))}
.ns-draft .ns-spacer{flex:1}
.ns-draft-when{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-usage{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ns-usage-panel{display:flex;flex-direction:column;gap:6px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:6px;padding:6px 8px;font-size:12px}
.ns-usage-panel-head{display:flex;align-items:center;gap:6px;min-width:0}
.ns-usage-detail{display:flex;flex-direction:column;gap:4px;padding-top:4px;border-top:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));font-variant-numeric:tabular-nums}
.ns-chapter-tools{display:flex;gap:4px;align-items:center}
.ns-move{font-size:11px;padding:1px 6px;line-height:1.6}
.ns-mini-form{display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center}
.ns-ai-save{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-top:2px}
.ns-ai-check{display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer}
.ns-ai-check input{cursor:pointer}
.ns-extract-group{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
.ns-pill-src{max-width:14em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ns-note{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));cursor:pointer}
.ns-note input{margin-top:3px;cursor:pointer}
.ns-note-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.ns-note-head{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ns-note .ns-muted{font-size:12px}
.ns-pill[data-exists="1"]{opacity:.72}
.ns-textarea[data-body="1"]{font-size:var(--ns-body-size,15px)}
.ns-root[data-theme="sepia"]{--dsw-alias-bg-base:#fbf3e2;--dsw-alias-bg-layer-1:#f4e9d3;--dsw-alias-bg-layer-2:#eedfc4;--dsw-alias-label-secondary:#6b5a3e;--dsw-alias-border-l1:rgba(107,90,62,.24)}
.ns-root[data-theme="sepia"] textarea,.ns-root[data-theme="sepia"] input,.ns-root[data-theme="sepia"] select{background:#fffaf0;color:#3b2f1c}
.ns-root[data-theme="dark"]{--dsw-alias-bg-base:#1c1c1f;--dsw-alias-bg-layer-1:#26262b;--dsw-alias-bg-layer-2:#32323a;--dsw-alias-label-secondary:#a1a1aa;--dsw-alias-border-l1:rgba(255,255,255,.16);color:#e6e6ea}
.ns-root[data-theme="dark"] textarea,.ns-root[data-theme="dark"] input,.ns-root[data-theme="dark"] select{background:#1a1a1e;color:#e6e6ea}
`
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID)) return
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = css
      document.head.appendChild(el)
    }

    // ── transport ─────────────────────────────────────────────────────────
    async function call(method, path, body) {
      const res = await fetch(API + path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      let data = null
      try {
        data = await res.json()
      } catch {
        /* empty or non-JSON */
      }
      if (!res.ok || (data && data.ok === false)) {
        throw new Error((data && data.error) || `${method} ${path} → HTTP ${res.status}`)
      }
      return data
    }

    /**
     * POST a request and read the `text/event-stream` it answers with.
     *
     * The server only opens the stream once the request is known to be good, so
     * a non-2xx reply is still ordinary JSON and is raised as a normal error —
     * that is why a missing model or an unknown chapter can show a real message
     * instead of a half-finished answer.
     */
    async function streamCall(path, body, onEvent, signal) {
      const res = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        let data = null
        try {
          data = await res.json()
        } catch {
          /* not JSON */
        }
        const err = new Error((data && data.error) || `POST ${path} → HTTP ${res.status}`)
        if (data && data.code) err.code = data.code
        throw err
      }
      if (!res.body || typeof res.body.getReader !== 'function') throw new Error('this browser cannot read a stream')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let cut = buffer.indexOf('\n\n')
        while (cut >= 0) {
          const block = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue
            const raw = line.slice(5).trim()
            if (!raw) continue
            let event = null
            try {
              event = JSON.parse(raw)
            } catch {
              continue
            }
            onEvent(event)
          }
          cut = buffer.indexOf('\n\n')
        }
      }
    }

    const enc = encodeURIComponent

    // ── small building blocks ─────────────────────────────────────────────

    /**
     * One shared reading view for every text surface in the panel.
     *
     * The studio lives in a column somebody else sized, so a long passage has
     * nowhere to go: the export preview stops at 340px and 4000 characters, an
     * AI answer scrolls inside its own small box, a chapter body is a textarea.
     * Any of them can hand its text to this overlay instead — the whole window,
     * wrapped, scrollable, with a size of its own (remembered on this machine)
     * so a chapter can be read at the size its author actually reads at.
     *
     * A tiny store rather than props: the surfaces that need it sit at every
     * depth of the tree, and only one of them is ever enlarged at a time.
     */
    const ZOOM_KEY = 'dsh-novel-studio.zoom'
    const ZOOM_MIN = 0.8
    const ZOOM_MAX = 3
    const zoomWatchers = new Set()
    let zoomView = null

    function openZoom(title, text) {
      const body = String(text === undefined || text === null ? '' : text)
      if (!body.trim()) return
      zoomView = { title: String(title || ''), text: body }
      zoomWatchers.forEach((watch) => watch(zoomView))
    }

    function closeZoom() {
      zoomView = null
      zoomWatchers.forEach((watch) => watch(null))
    }

    function readZoomLevel() {
      try {
        const kept = Number(window.localStorage.getItem(ZOOM_KEY))
        if (kept >= ZOOM_MIN && kept <= ZOOM_MAX) return kept
      } catch {
        /* a browser that refuses storage still gets a preview */
      }
      return 1.3
    }

    function useZoomView() {
      const [view, setView] = useState(zoomView)
      useEffect(() => {
        zoomWatchers.add(setView)
        setView(zoomView)
        return () => {
          zoomWatchers.delete(setView)
        }
      }, [])
      return view
    }

    /** The "read this bigger" button that sits next to a text surface. */
    function ZoomButton({ title, text, label }) {
      const body = String(text === undefined || text === null ? '' : text)
      return h('button', {
        className: 'ns-btn ns-ai-mini',
        title: `${t('zoomTitle')}：${title || ''}`,
        disabled: !body.trim(),
        onClick: () => openZoom(title, body),
      }, `⤢ ${label || t('zoomOpen')}`)
    }

    function Zoom({ base }) {
      const view = useZoomView()
      const [scale, setScale] = useState(readZoomLevel)
      const [copied, setCopied] = useState(false)

      useEffect(() => {
        try {
          window.localStorage.setItem(ZOOM_KEY, String(scale))
        } catch {
          /* the size is a preference, not a promise */
        }
      }, [scale])

      const step = useCallback((by) => {
        setScale((cur) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((cur + by) * 100) / 100)))
      }, [])

      useEffect(() => {
        if (!view) return undefined
        setCopied(false)
        const onKey = (event) => {
          if (event.key === 'Escape') closeZoom()
          else if (event.key === '+' || event.key === '=') step(0.1)
          else if (event.key === '-' || event.key === '_') step(-0.1)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [view, step])

      if (!view) return null
      // The book's own reading size is the base and the overlay only multiplies
      // it, so a setting of 16px still means something in here.
      const size = Math.round((Number(base) || 15) * scale)
      const count = (view.text.match(/[\u4e00-\u9fff]|[A-Za-z0-9]+/g) || []).length
      return h('div', {
        className: 'ns-zoom-mask',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('zoomTitle'),
        onClick: closeZoom,
      },
        h('div', { className: 'ns-zoom-card', onClick: (event) => event.stopPropagation() },
          h('div', { className: 'ns-zoom-head' },
            h('span', { className: 'ns-zoom-title' }, t('zoomTitle')),
            view.title ? h('span', { className: 'ns-zoom-note' }, `${t('zoomFrom')} ${view.title}`) : null,
            h('span', { className: 'ns-spacer' }),
            h('button', { className: 'ns-btn ns-ai-mini', title: t('zoomSmaller'), onClick: () => step(-0.1) }, 'A－'),
            h('span', { className: 'ns-zoom-note ns-zoom-size' }, `${size}px`),
            h('button', { className: 'ns-btn ns-ai-mini', title: t('zoomBigger'), onClick: () => step(0.1) }, 'A＋'),
            h('button', { className: 'ns-btn ns-ai-mini', onClick: () => setScale(1) }, t('zoomReset')),
            h('button', {
              className: 'ns-btn ns-ai-mini',
              onClick: () => {
                const writing = navigator.clipboard && navigator.clipboard.writeText(view.text)
                if (writing && writing.then) writing.then(() => setCopied(true)).catch(() => setCopied(false))
              },
            }, copied ? t('zoomCopied') : t('zoomCopy')),
            h('button', { className: 'ns-btn ns-ai-mini', onClick: closeZoom }, t('zoomClose'))),
          // Read-only on purpose: this is a view, never a second editor, so
          // nothing here can be written back by accident.
          h('pre', { className: 'ns-zoom-text', style: { fontSize: `${size}px` } }, view.text),
          h('div', { className: 'ns-zoom-foot' },
            h('span', { className: 'ns-zoom-note' }, t('zoomHint')),
            h('span', { className: 'ns-spacer' }),
            h('span', { className: 'ns-zoom-note ns-zoom-size' }, `${count} ${t('zoomChars')}`))))
    }

    function Field({ label, children }) {
      return h('label', { className: 'ns-field' }, h('span', { className: 'ns-label' }, label), children)
    }

    /** One declared (or inferred) field, rendered by type. */
    function Input({ field, value, onChange }) {
      const label = field.zh || field.en || field.k
      const text = value === undefined || value === null ? '' : String(value)

      if (field.type === 'textarea') {
        return h(Field, { label },
          h('div', { className: 'ns-field-bar' }, h(ZoomButton, { title: label, text })),
          h('textarea', {
            className: 'ns-textarea',
            value: text,
            onChange: (e) => onChange(e.target.value),
          }))
      }
      if (field.type === 'select') {
        return h(Field, { label }, h('select', {
          className: 'ns-select',
          value: text,
          onChange: (e) => onChange(e.target.value),
        }, h('option', { value: '' }, '—'), (field.options || []).map((o) =>
          h('option', { key: o.v, value: o.v }, o.zh || o.v))))
      }
      if (field.type === 'boolean') {
        return h(Field, { label }, h('input', {
          type: 'checkbox',
          checked: value === true || value === 'true',
          onChange: (e) => onChange(e.target.checked),
        }))
      }
      if (field.type === 'tags') {
        const arr = Array.isArray(value) ? value : text ? String(value).split(/[,，\s]+/).filter(Boolean) : []
        return h(Field, { label }, h('input', {
          className: 'ns-input',
          value: arr.join(', '),
          placeholder: 'a, b, c',
          onChange: (e) => onChange(e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean)),
        }))
      }
      if (field.type === 'number') {
        return h(Field, { label }, h('input', {
          className: 'ns-input',
          type: 'number',
          value: text,
          onChange: (e) => onChange(e.target.value === '' ? '' : Number(e.target.value)),
        }))
      }
      return h(Field, { label }, h('input', {
        className: 'ns-input',
        value: text,
        onChange: (e) => onChange(e.target.value),
      }))
    }

    /** Narrow fields flow in a responsive grid; wide ones get their own row. */
    function Form({ fields, draft, onChange }) {
      const wide = fields.filter((f) => f.type === 'textarea')
      const narrow = fields.filter((f) => f.type !== 'textarea')
      return h('div', null,
        narrow.length ? h('div', { className: 'ns-grid' }, narrow.map((f) =>
          h(Input, { key: f.k, field: f, value: draft[f.k], onChange: (v) => onChange(f.k, v) }))) : null,
        wide.map((f) => h(Input, { key: f.k, field: f, value: draft[f.k], onChange: (v) => onChange(f.k, v) })))
    }

    function InlineForm({ submitLabel, onSubmit, onCancel, busy }) {
      const [title, setTitle] = useState('')
      return h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        h('input', {
          className: 'ns-input',
          style: { flex: '1 1 100%' },
          value: title,
          autoFocus: true,
          placeholder: t('untitledPrompt'),
          onChange: (e) => setTitle(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter' && title.trim()) onSubmit(title.trim())
            if (e.key === 'Escape') onCancel()
          },
        }),
        h('button', { className: 'ns-btn', 'data-kind': 'primary', disabled: busy || !title.trim(), onClick: () => onSubmit(title.trim()) }, submitLabel || t('create')),
        h('button', { className: 'ns-btn', disabled: busy, onClick: onCancel }, t('cancel')))
    }

    // ── entries and units ─────────────────────────────────────────────────

    const FLAT_KINDS = new Set(['records', 'chapters', 'files'])
    const keyOf = (item, index, kind) => (FLAT_KINDS.has(kind) ? item.id : String(index))

    function titleOf(item, titleField, kind) {
      if (kind === 'files') return item.id
      const v = item?.[titleField]
      if (v) return String(v)
      for (const k of ['title', 'name', 'term', 'event', 'beat', 'faction', 'skill']) {
        if (item?.[k]) return String(item[k])
      }
      return item?.id ? String(item.id) : t('unnamed')
    }

    function subtitleOf(item, kind) {
      if (kind === 'chapters') return [item.status, item.words ? `${item.words} ${t('chars')}` : ''].filter(Boolean).join(' · ')
      if (kind === 'files') return typeof item.size === 'number' ? `${Math.max(1, Math.round(item.size / 1024))} KB` : ''
      return item?.role || item?.type || item?.scope || item?.kind || ''
    }

    /**
     * A guess at the next chapter's title, read off the ones already there: a
     * numbering head (第四章 / 第4章 / 04-) is carried on, and the highest number
     * in that style is stepped once. It is only ever a default in an editable
     * field — a book with no numbering gets an empty one, and a name that
     * already exists is renamed by the host rather than overwritten.
     */
    function nextChapterTitle(items) {
      const cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
      const cnOf = (n) => {
        if (n <= 10) return n === 10 ? '十' : cn[n]
        if (n < 20) return `十${cn[n % 10]}`
        if (n < 100) return `${cn[Math.floor(n / 10)]}十${n % 10 ? cn[n % 10] : ''}`
        return String(n)
      }
      const ids = (items || []).map((x) => String((x && x.id) || ''))
      const head = /^第(\d+)章/
      const cnHead = /^第([一二三四五六七八九十]+)章/
      const widthHead = /^(\d+)([-_.\s])/
      const best = (re, read) => {
        let max = 0
        let seen = false
        for (const id of ids) {
          const m = id.match(re)
          if (!m) continue
          seen = true
          max = Math.max(max, read(m))
        }
        return seen ? max : 0
      }
      const arabic = best(head, (m) => Number(m[1]))
      if (arabic) return `第${arabic + 1}章`
      const chinese = best(cnHead, (m) => {
        const digits = m[1].split('')
        let value = 0
        if (digits.includes('十')) {
          const [tens, ones] = m[1].split('十')
          value = (tens ? cn.indexOf(tens) : 1) * 10 + (ones ? cn.indexOf(ones) : 0)
        } else {
          value = Number(digits.map((d) => cn.indexOf(d)).join(''))
        }
        return Number.isFinite(value) ? value : 0
      })
      if (chinese) return `第${cnOf(chinese + 1)}章`
      const numbered = best(widthHead, (m) => Number(m[1]))
      if (numbered) {
        const pad = ids.map((id) => (id.match(widthHead) || [])[1] || '').find((n) => n.length > 1)
        const next = String(numbered + 1).padStart(pad ? pad.length : 1, '0')
        const sep = (ids.map((id) => (id.match(widthHead) || [])[2]).find(Boolean)) || '-'
        return `${next}${sep}`
      }
      return ''
    }

    /** One unit: list column + editor pane. Covers records, doc, chapters, files. */
    function UnitPane({ book, section, group, focus, settings }) {
      const kindHint = section.kind === 'groups' ? group.kind : section.kind
      const [state, setState] = useState({ loading: true, error: null, items: [], fields: [], kind: kindHint, titleField: 'name', extra: null, entryMeta: null })
      const [selected, setSelected] = useState(null)
      const [draft, setDraft] = useState({})
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      const [filter, setFilter] = useState('')
      const [dossier, setDossier] = useState(null)
      // false = closed, true = the snapshot box for the selected chapter.
      const [draftBox, setDraftBox] = useState(false)
      // Numbering preview from POST /renumber { dryRun } — shown, never written.
      const [renumber, setRenumber] = useState(null)
      // The chapter checklist in front of a recognition run, and the plan it
      // hands to the review drawer once it comes back.
      const [extractPick, setExtractPick] = useState(false)
      const [extractPlan, setExtractPlan] = useState(null)
      // This book's shared-library references — drives the scope badge on
      // linked entries (作用域徽标: nothing in the store stays invisible).
      const [sharedLinks, setSharedLinks] = useState(null)

      const base = `/library/${enc(book.id)}/unit/${enc(section.key)}` + (section.kind === 'groups' ? `/${enc(group.key)}` : '')
      // shared-library keys are keyed by the leaf unit (group.key when the
      // section is a group), the same way the store's unitCatalog flattens.
      const unitKey = section.kind === 'groups' ? group.key : section.key
      const linkFor = (id) => (sharedLinks || []).find((l) => l.key === `${unitKey}/${id}`) || null

      const reload = useCallback(async () => {
        try {
          const data = await call('GET', base)
          setState({
            loading: false,
            error: null,
            items: data.items || [],
            fields: data.fields || [],
            kind: data.kind || kindHint,
            titleField: data.titleField || 'name',
            extra: data.extra || null,
            entryMeta: null,
          })
          return data
        } catch (err) {
          setState((s) => ({ ...s, loading: false, error: String(err.message || err) }))
          return null
        }
      }, [base, kindHint])

      useEffect(() => {
        setSelected(null)
        setDraft({})
        setFilter('')
        setNote('')
        setDossier(null)
        setDraftBox(false)
        setRenumber(null)
        setExtractPick(false)
        setExtractPlan(null)
        reload()
      }, [reload])

      // this book's shared references, fetched once per book (scope badges)
      useEffect(() => {
        let alive = true
        call('GET', `/shared/links?book=${enc(book.id)}`)
          .then((res) => { if (alive) setSharedLinks(res.links || []) })
          .catch(() => { if (alive) setSharedLinks([]) })
        return () => { alive = false }
      }, [book.id])

      const items = state.items || []
      const kind = state.kind
      const selLink = selected === null ? null : linkFor(selected)
      const visible = useMemo(() => {
        if (!filter.trim()) return items
        const q = filter.trim().toLowerCase()
        return items.filter((it) => JSON.stringify(it).toLowerCase().includes(q))
      }, [items, filter])

      // What the recogniser offers: the chapter list, titles only. The prose is
      // fetched chapter by chapter, and only for the boxes that are ticked.
      const chapters = useMemo(
        () =>
          kind === 'chapters'
            ? items.map((it, i) => ({
                id: String(it.id ?? keyOf(it, i, 'chapters')),
                title: titleOf(it, state.titleField, 'chapters'),
              }))
            : [],
        [items, kind, state.titleField],
      )

      // A search hit elsewhere in the panel asks this pane to open one entry.
      useEffect(() => {
        if (!focus || focus.section !== section.key || !focus.id) return
        const want = String(focus.id)
        if (selected === want) return
        if (!items.some((it, i) => String(keyOf(it, i, state.kind) ?? '') === want)) return
        void open(want)
      }, [focus, items, selected, section.key, state.kind])

      // Autosave: a pause in the prose editor writes the chapter itself — a real
      // save, not another snapshot — so a lost tab costs at most one pause.
      // Records and outline entries still save by hand.
      const autosave = !settings || settings.autosave !== false
      const savedRef = useRef(null)
      useEffect(() => {
        if (!autosave || kind !== 'chapters' || !selected || selected === '__new__') return undefined
        if (draft.body === undefined || savedRef.current === draft.body) return undefined
        const pending = draft
        const timer = setTimeout(async () => {
          savedRef.current = pending.body
          try {
            await call('PUT', `${base}/${enc(selected)}`, pending)
            setNote(t('saved'))
          } catch {
            /* an autosave failure must never interrupt typing */
          }
        }, 4000)
        return () => clearTimeout(timer)
      }, [autosave, kind, selected, draft, base])

      const chapterIds = useCallback(
        () => items.map((it, i) => String(it.id ?? keyOf(it, i, 'chapters'))),
        [items],
      )

      // Reordering writes the whole order at once: the server checks it is a
      // permutation of the chapters that exist, so a stale list is refused
      // rather than silently dropping a chapter.
      const moveChapter = useCallback(
        async (key, delta) => {
          const ids = chapterIds()
          const from = ids.indexOf(String(key))
          const to = from + delta
          if (from < 0 || to < 0 || to >= ids.length) return
          const next = ids.slice()
          const [moved] = next.splice(from, 1)
          next.splice(to, 0, moved)
          setNote('')
          try {
            await call('POST', `/library/${enc(book.id)}/chapters/reorder`, { ids: next })
            await reload()
          } catch (e) {
            setNote(String((e && e.message) || e))
          }
        },
        [chapterIds, book.id, reload],
      )

      const planRenumber = useCallback(async () => {
        setNote('')
        try {
          setRenumber(await call('POST', `/library/${enc(book.id)}/chapters/renumber`, { dryRun: true }))
        } catch (e) {
          setNote(String((e && e.message) || e))
        }
      }, [book.id])

      const applyRenumber = useCallback(async () => {
        setNote('')
        try {
          const done = await call('POST', `/library/${enc(book.id)}/chapters/renumber`, {
            dryRun: false,
            start: renumber?.start ?? 1,
            style: renumber?.style,
            width: renumber?.width,
            separator: renumber?.separator,
          })
          setRenumber(null)
          await reload()
          setNote(`${t('chapterRenamed')} ${(done.renamed || []).length}`)
        } catch (e) {
          setNote(String((e && e.message) || e))
        }
      }, [book.id, renumber, reload])

      const takeSnapshot = useCallback(async () => {
        setNote('')
        try {
          const made = await call('POST', `/library/${enc(book.id)}/drafts`, { chapter: selected })
          setNote(`${t('saved')} · ${made.id || ''}`)
        } catch (e) {
          setNote(String((e && e.message) || e))
        }
      }, [book.id, selected])

      async function open(key) {
        setSelected(key)
        setNote('')
        try {
          const data = await call('GET', `${base}/${enc(key)}`)
          savedRef.current = data.data && data.data.body
          setDraft({ ...(data.data || {}) })
          setState((s) => ({
            ...s,
            kind: data.meta?.binary ? 'binary' : s.kind,
            extra: data.extra || s.extra,
            entryMeta: data.meta || null,
            fields: data.fields && data.fields.length ? data.fields : s.fields,
          }))
        } catch (err) {
          setNote(String(err.message || err))
        }
      }

      async function save() {
        setBusy(true)
        setNote('')
        try {
          if (selected === '__new__') {
            const created = await call('POST', base, draft)
            await reload()
            if (created.id !== undefined && created.id !== null) await open(String(created.id))
            else setSelected(null)
          } else {
            await call('PUT', `${base}/${enc(selected)}`, draft)
            await reload()
            setNote(t('saved'))
          }
        } catch (err) {
          setNote(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }

      async function remove() {
        if (selected === '__new__' || selected === null) return
        if (!window.confirm(t('confirmRemove'))) return
        setBusy(true)
        try {
          await call('DELETE', `${base}/${enc(selected)}`)
          setSelected(null)
          setDraft({})
          await reload()
        } catch (err) {
          setNote(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }

      if (state.loading) return h('div', { className: 'ns-empty' }, t('loading'))
      if (state.error) return h('div', { className: 'ns-err' }, state.error)

      // raw documents are a single text blob, not a list of entries
      if (kind === 'raw') return h(RawPane, { base, text: state.extra?.text ?? '', hint: t('rawHint') })

      const isFiles = kind === 'files'
      const fields = state.fields || []

      return h('div', { className: 'ns-body' },
        h('div', { className: 'ns-list' },
          h('input', {
            className: 'ns-input',
            placeholder: '🔍',
            value: filter,
            onChange: (e) => setFilter(e.target.value),
            style: { marginBottom: 6 },
          }),
          h('button', {
            className: 'ns-btn',
            style: { width: '100%', marginBottom: 6 },
            onClick: () => {
              setSelected('__new__')
              setDraft({})
              setNote('')
            },
          }, isFiles ? `＋ ${t('newFile')}` : `＋ ${t('newEntry')}`),
          kind === 'chapters' && items.length
            ? h('button', {
                className: 'ns-btn ns-move',
                style: { width: '100%', marginBottom: 6 },
                onClick: () => (renumber ? setRenumber(null) : void planRenumber()),
              }, renumber ? t('cancel') : t('chapterRenumber'))
            : null,
          renumber
            ? h('div', { className: 'ns-card', style: { marginBottom: 6, fontSize: 12 } },
                h('div', null, t('chapterRenumberHint')),
                h('div', { className: 'ns-muted', style: { marginTop: 4 } },
                  `${(renumber.renamed || []).length} / ${renumber.plan ?? 0}`),
                (renumber.renamed || []).slice(0, 10).map((r) => h('div', { key: r.from, className: 'ns-muted' },
                  `${r.from} → ${r.to}`)),
                h('button', { className: 'ns-btn', style: { marginTop: 6 }, onClick: applyRenumber }, t('chapterRenumberGo')))
            : null,
          !items.length ? h('div', { className: 'ns-empty', style: { padding: '14px 6px', fontSize: 12 } }, t('noEntries')) : null,
          visible.map((it) => {
            const key = keyOf(it, items.indexOf(it), kind)
            const sub = subtitleOf(it, kind)
            return h('button', {
              key,
              className: 'ns-item',
              'data-on': selected === key ? '1' : '0',
              title: titleOf(it, state.titleField, kind),
              onClick: () => open(key),
            }, titleOf(it, state.titleField, kind), sub ? h('small', null, sub) : null,
              linkFor(key) ? h('span', { className: 'ns-sh-mini', title: t('shBadge') }, '🔗') : null)
          })),
        h('div', { className: 'ns-pane' },
          selected === null
            ? h('div', { className: 'ns-empty' }, t('pickEntry'))
            : h(React.Fragment, null,
                selLink && !selLink.orphan
                  ? h('div', { className: 'ns-sh-badge' },
                      h('span', { className: 'ns-sh-pill', 'data-kind': 'mode' },
                        selLink.mode === 'fork' ? t('shModeFork') : t('shModeLink')),
                      selLink.series ? h('span', { className: 'ns-muted' }, selLink.series) : null,
                      selLink.sourceExists && selLink.stale
                        ? h('span', { className: 'ns-sh-pill', 'data-kind': 'stale' }, t('shStale'))
                        : null,
                      !selLink.sourceExists
                        ? h('span', { className: 'ns-sh-pill', 'data-kind': 'gone' }, t('shGone'))
                        : null,
                      selLink.drift ? h('span', { className: 'ns-sh-pill', 'data-kind': 'drift' }, t('shDrift')) : null,
                      selLink.pin ? h('span', { className: 'ns-sh-pill', 'data-kind': 'pin' }, t('shLocked')) : null,
                      (selLink.overrides || []).length
                        ? h('span', { className: 'ns-muted' }, t('shOvCount').replace('{n}', selLink.overrides.length))
                        : null)
                  : null,
                isFiles ? null : h(Form, { fields, draft, onChange: (k, v) => setDraft((d) => ({ ...d, [k]: v })) }),
                kind === 'chapters' ? h(Field, { label: t('body') },
                  h('div', { className: 'ns-field-bar' },
                    h(ZoomButton, { title: titleOf(draft, state.titleField, kind), text: draft.body })),
                  h('textarea', {
                    className: 'ns-textarea',
                    'data-body': '1',
                    value: draft.body || '',
                    onChange: (e) => setDraft((d) => ({ ...d, body: e.target.value })),
                  }),
                  h('div', { className: 'ns-hint', style: { marginTop: 4 } },
                    `${(String(draft.body || '').match(/[\u4e00-\u9fff]|[A-Za-z0-9]+/g) || []).length} ${t('chars')}`)) : null,
                isFiles ? h(FilePane, { draft, setDraft, meta: state.entryMeta }) : null,
                h('div', { className: 'ns-actions' },
                  h('button', { className: 'ns-btn', 'data-kind': 'primary', disabled: busy, onClick: save }, busy ? t('saving') : t('save')),
                  kind === 'chapters'
                    ? h('button', {
                        className: 'ns-btn',
                        disabled: busy || !items.length,
                        title: t('chaptersExtractHint'),
                        onClick: () => setExtractPick(true),
                      }, t('chaptersExtract'))
                    : null,
                  kind === 'chapters' && selected && selected !== '__new__'
                    ? h(React.Fragment, null,
                        h('button', { className: 'ns-btn ns-move', title: t('chapterUp'), onClick: () => moveChapter(selected, -1) }, '↑'),
                        h('button', { className: 'ns-btn ns-move', title: t('chapterDown'), onClick: () => moveChapter(selected, 1) }, '↓'),
                        h('button', { className: 'ns-btn', disabled: busy, onClick: takeSnapshot }, t('draftTake')),
                        h('button', { className: 'ns-btn', 'data-on': draftBox ? '1' : '0', onClick: () => setDraftBox(!draftBox) }, t('draftOpen')))
                    : null,
                  section.key === 'characters' && selected && selected !== '__new__' && (draft.name || '').trim()
                    ? h('button', {
                        className: 'ns-btn',
                        disabled: busy,
                        onClick: () => setDossier({ name: String(draft.name).trim(), id: selected }),
                      }, t('dossier'))
                    : null,
                  selected !== '__new__' ? h('button', { className: 'ns-btn', 'data-kind': 'danger', disabled: busy, onClick: remove }, t('remove')) : null,
                  note ? h('span', { className: 'ns-muted' }, note) : null))),
        dossier ? h(Dossier, { book, name: dossier.name, id: dossier.id, onClose: () => setDossier(null) }) : null,
        draftBox && kind === 'chapters' ? h(DraftBox, {
          book,
          chapter: selected,
          onClose: () => setDraftBox(false),
          onRestored: async () => {
            if (selected && selected !== '__new__') await open(selected)
            await reload()
          },
        }) : null,
        extractPick ? h(ExtractPicker, {
          book,
          chapters,
          currentId: selected && selected !== '__new__' ? selected : '',
          currentText: draft.body,
          onClose: () => setExtractPick(false),
          onPlanned: (plan) => {
            setExtractPick(false)
            setExtractPlan(plan)
          },
        }) : null,
        extractPlan ? h(ExtractBox, {
          book,
          plan: extractPlan,
          onClose: () => setExtractPlan(null),
          onFiled: async (report) => {
            const n = (report.written || []).length + (report.updated || []).length
            setNote(`${t('aiExtractDone')} ${n} ${t('aiExtractCount')}`)
            await reload()
          },
        }) : null)
    }

    /**
     * Character dossier: one person's bindings across sections (panel slots,
     * items, factions) plus their graph edges. Bind and unbind both support
     * one-to-many and many-to-one: a person can sit in many entries, and one
     * entry (faction members, an item's holders) can hold many people.
     */
    function Dossier({ book, name, id, onClose }) {
      const [tick, setTick] = useState(0)
      const [st, setSt] = useState({ loading: true, error: null, specs: [], rels: [], nodes: {} })
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')

      const lib = `/library/${enc(book.id)}`
      const listOf = (v) => (Array.isArray(v) ? v : v ? String(v).split(/[,，\s]+/).filter(Boolean) : [])

      useEffect(() => {
        let alive = true
        async function load() {
          setSt((s) => ({ ...s, loading: true, error: null }))
          try {
            const schema = await call('GET', '/schema')
            const secs = schema.sections || []
            const panels = secs.find((s) => s.key === 'panels')
            const world = secs.find((s) => s.key === 'world')
            const specs = []
            for (const g of (panels?.groups || [])) {
              if ((g.fields || []).some((fl) => fl.k === 'owners')) {
                specs.push({ section: 'panels', group: g.key, title: g.zh || g.key, field: 'owners', mode: 'list' })
              }
            }
            const itemG = (world?.groups || []).find((g) => (g.fields || []).some((fl) => fl.k === 'owner'))
            if (itemG) specs.push({ section: 'world', group: itemG.key, title: itemG.zh || itemG.key, field: 'owner', mode: 'list' })
            const facG = (world?.groups || []).find((g) => (g.fields || []).some((fl) => fl.k === 'members'))
            if (facG) specs.push({ section: 'world', group: facG.key, title: facG.zh || facG.key, field: 'members', mode: 'faction' })
            const full = await Promise.all(specs.map(async (sp) => {
              try {
                const res = await call('GET', `${lib}/unit/${enc(sp.section)}/${enc(sp.group)}`)
                return { ...sp, kind: res.kind || 'records', titleField: res.titleField || 'name', items: res.items || [], error: null }
              } catch (err) {
                return { ...sp, kind: 'records', titleField: 'name', items: [], error: String(err.message || err) }
              }
            }))
            let nodes = {}
            let rels = []
            try {
              const g = await call('GET', `${lib}/graph`)
              for (const n of g.nodes || []) nodes[n.id] = n.label || n.id
              rels = (g.edges || []).filter((e) => e.from === id || e.to === id || e.from === name || e.to === name)
            } catch { /* the graph is optional here */ }
            if (alive) setSt({ loading: false, error: null, specs: full, rels, nodes })
          } catch (err) {
            if (alive) setSt((s) => ({ ...s, loading: false, error: String(err.message || err) }))
          }
        }
        load()
        return () => { alive = false }
      }, [lib, id, name, tick])

      function isBound(sp, item) {
        if (sp.mode === 'faction') return String(item.leader || '').trim() === name || listOf(item.members).includes(name)
        return listOf(item[sp.field]).includes(name)
      }

      async function put(sp, key, body) {
        setBusy(true)
        setNote('')
        try {
          await call('PUT', `${lib}/unit/${enc(sp.section)}/${enc(sp.group)}/${enc(key)}`, body)
          setNote(t('saved'))
          setTick((k) => k + 1)
        } catch (err) {
          setNote(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }

      function findKey(sp, key) {
        const idx = sp.items.findIndex((it, i) => keyOf(it, i, sp.kind) === key)
        return idx < 0 ? null : sp.items[idx]
      }

      function bind(sp, key) {
        const item = findKey(sp, key)
        if (!item) return
        if (sp.mode === 'faction') {
          const mem = listOf(item.members)
          if (!mem.includes(name)) mem.push(name)
          put(sp, key, { members: mem })
        } else {
          const cur = listOf(item[sp.field])
          if (!cur.includes(name)) cur.push(name)
          put(sp, key, { [sp.field]: cur })
        }
      }

      function unbind(sp, key) {
        const item = findKey(sp, key)
        if (!item) return
        if (sp.mode === 'faction') {
          const body = { members: listOf(item.members).filter((x) => x !== name) }
          if (String(item.leader || '').trim() === name) body.leader = ''
          put(sp, key, body)
        } else {
          put(sp, key, { [sp.field]: listOf(item[sp.field]).filter((x) => x !== name) })
        }
      }

      return h(React.Fragment, null,
        h('div', { className: 'ns-dossier-scrim', onClick: onClose }),
        h('div', { className: 'ns-dossier' },
          h('div', { className: 'ns-dossier-head' },
            h('strong', null, `${t('dossierTitle')} · ${name}`),
            h('span', { className: 'ns-spacer' }),
            note ? h('span', { className: 'ns-muted' }, note) : null,
            h('button', { className: 'ns-btn', disabled: busy, onClick: onClose }, t('dossierClose'))),
          h('div', { className: 'ns-hint' }, t('dossierHint')),
          st.loading && !st.specs.length
            ? h('div', { className: 'ns-empty' }, t('loading'))
            : st.error
              ? h('div', { className: 'ns-err' }, st.error)
              : h(React.Fragment, null,
                  st.specs.map((sp) => {
                    const rows = sp.items.map((it, i) => ({ item: it, key: keyOf(it, i, sp.kind) }))
                    const bound = rows.filter((r) => isBound(sp, r.item))
                    const free = rows.filter((r) => !isBound(sp, r.item))
                    return h('div', { key: `${sp.section}/${sp.group}`, className: 'ns-dossier-sec' },
                      h('div', { className: 'ns-section-title', style: { margin: 0 } }, sp.title),
                      sp.error
                        ? h('div', { className: 'ns-hint' }, sp.error)
                        : h(React.Fragment, null,
                            !rows.length
                              ? h('div', { className: 'ns-dossier-nothing' }, t('dossierEmpty'))
                              : h('div', { className: 'ns-chips' },
                                  bound.map(({ item, key }) => h('button', {
                                    key,
                                    className: 'ns-chip',
                                    'data-on': '1',
                                    disabled: busy,
                                    title: t('dossierUnbind'),
                                    onClick: () => unbind(sp, key),
                                  },
                                    titleOf(item, sp.titleField, sp.kind),
                                    sp.mode === 'faction' && String(item.leader || '').trim() === name
                                      ? h('span', { className: 'ns-muted' }, ` · ${t('dossierLeader')}`)
                                      : null))),
                            free.length
                              ? h('div', { className: 'ns-dossier-bind' },
                                  h('select', {
                                    className: 'ns-select',
                                    value: '',
                                    disabled: busy,
                                    onChange: (e) => { const k = e.target.value; if (k) bind(sp, k) },
                                  },
                                    h('option', { value: '' }, t('dossierBind')),
                                    free.map(({ item, key }) => h('option', { key, value: key }, titleOf(item, sp.titleField, sp.kind)))))
                              : null))
                  }),
                  h('div', { className: 'ns-dossier-sec' },
                    h('div', { className: 'ns-section-title', style: { margin: 0 } }, t('dossierRelations')),
                    h('div', { className: 'ns-hint' }, t('dossierRelationsHint')),
                    st.rels.length
                      ? h('div', { className: 'ns-chips' },
                          st.rels.map((e, i) => h('span', { key: String(e.id || i), className: 'ns-chip' },
                            `${st.nodes[e.from] || e.from} —${e.type || '·'}→ ${st.nodes[e.to] || e.to}`)))
                      : h('div', { className: 'ns-dossier-nothing' }, t('dossierNoRel'))))))
    }

    /** Editing a text file in the materials browser. */
    function FilePane({ draft, setDraft, meta }) {
      if (meta && meta.binary) return h('div', { className: 'ns-empty' }, t('binary'))
      return h(Field, { label: 'text' },
        h('div', { className: 'ns-field-bar' },
          h(ZoomButton, { title: meta && meta.file, text: draft.text })),
        h('textarea', {
          className: 'ns-textarea',
          'data-body': '1',
          value: draft.text || '',
          onChange: (e) => setDraft((d) => ({ ...d, text: e.target.value })),
        }))
    }

    /** A whole YAML document edited as text. */
    function RawPane({ base, text, hint }) {
      const [value, setValue] = useState(text)
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      useEffect(() => {
        setValue(text)
      }, [text, base])
      async function save() {
        setBusy(true)
        setNote('')
        try {
          await call('PUT', base, { text: value })
          setNote(t('saved'))
        } catch (err) {
          setNote(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }
      return h('div', { className: 'ns-pane' },
        h('div', { className: 'ns-hint' }, hint),
        h('div', { className: 'ns-field-bar' }, h(ZoomButton, { title: base, text: value })),
        h('textarea', {
          className: 'ns-textarea',
          'data-body': '1',
          value,
          onChange: (e) => setValue(e.target.value),
        }),
        h('div', { className: 'ns-actions' },
          h('button', { className: 'ns-btn', 'data-kind': 'primary', disabled: busy, onClick: save }, busy ? t('saving') : t('save')),
          note ? h('span', { className: 'ns-muted' }, note) : null))
    }

    // ── section renderers ─────────────────────────────────────────────────

    /**
     * The landing page: a small workbench over the grouped navigation.
     *
     * Phase 1 of the layout rebuild — the top row answers "what was I doing"
     * (continue, goal, validation, quick new chapter); the columns below are
     * the old flat tab list grouped by what you do with it.
     */
    function Overview({ book, counts, root, sections, navOpen, onGo }) {
      const rows = [
        ['author', t('author'), book.author],
        ['genre', t('genre'), book.genre],
        ['logline', t('logline'), book.logline],
        ['updated', 'updated', book.updatedAt],
      ].filter((r) => r[2])
      const [wb, setWb] = useState({ progress: null, report: null, chapters: null })
      const [mkBusy, setMkBusy] = useState(false)
      const [mkErr, setMkErr] = useState(null)

      useEffect(() => {
        let alive = true
        ;(async () => {
          const [progress, report, chapters] = await Promise.all([
            call('GET', `/library/${enc(book.id)}/progress`).catch(() => null),
            call('GET', `/library/${enc(book.id)}/validate`).catch(() => null),
            call('GET', `/library/${enc(book.id)}/unit/chapters`).catch(() => null),
          ])
          if (alive) setWb({ progress, report, chapters })
        })()
        return () => { alive = false }
      }, [book.id])

      const items = (wb.chapters && wb.chapters.items) || []
      const last = items.length ? items[items.length - 1] : null
      const prog = wb.progress
      const rep = wb.report
      const goal = (prog && prog.goal && prog.goal.words) || 0
      const lv = (rep && rep.counts) || {}
      const er = Number(lv.error) || 0
      const wr = Number(lv.warn) || 0
      const ir = Number(lv.info) || 0

      async function newChapter() {
        setMkBusy(true)
        setMkErr(null)
        try {
          await call('POST', `/library/${enc(book.id)}/unit/chapters`, { title: nextChapterTitle(items), body: '' })
          onGo('chapters')
        } catch (e) {
          setMkErr(String((e && e.message) || e))
        } finally {
          setMkBusy(false)
        }
      }

      // card titles: nav keys first, then whatever the schema sections declare
      const labelOf = {
        overview: t('overview'), graph: t('graph'), validate: t('validate'),
        ai: t('aiTab'), export: t('exportTab'), search: t('searchOpen'),
        progress: t('progressOpen'), import: t('importOpen'), settings: t('settingsOpen'),
        shared: t('sharedTab'),
      }
      for (const s of sections || []) {
        if (s.key) labelOf[s.key] = s.zh || s.key
        for (const g of s.groups || []) labelOf[g.key] = g.zh || g.key
      }
      const columns = [
        {
          kind: 'write', title: t('grpWrite'),
          cards: [
            { key: 'chapters', desc: t('cdChapters') },
            { key: 'outline', desc: t('cdOutline') },
            { key: 'ai', desc: t('cdAi') },
            { key: 'panels', desc: t('cdPanels') },
          ],
        },
        {
          kind: 'lib', title: t('grpLib'),
          cards: [
            { key: 'characters', desc: t('cdCharacters') },
            { key: 'world', desc: t('cdWorld') },
            { key: 'graph', desc: t('cdGraph') },
            { key: 'materials', desc: t('cdMaterials') },
            { key: 'drafts', desc: t('cdDrafts') },
            { key: 'shared', desc: t('cdShared') },
          ],
        },
        {
          kind: 'tools', title: t('grpTools'),
          cards: [
            { key: 'validate', desc: t('cdValidate') },
            { key: 'search', desc: t('cdSearch') },
            { key: 'export', desc: t('cdExport') },
          ],
          foot: [{ key: 'import' }, { key: 'settings' }],
        },
      ]
      const order = ['characters', 'chapters', 'locations', 'factions', 'scenes', 'materials', 'drafts']
      return h('div', { className: 'ns-pane' },
        h('div', { className: 'ns-wb-top' },
          h('button', { className: 'ns-wb-widget', disabled: !last, onClick: () => onGo('chapters') },
            h('b', null, t('wbContinue')),
            h('small', null, last ? String(last.title || last.id) : t('wbNone'))),
          h('button', { className: 'ns-wb-widget', onClick: () => onGo('progress') },
            h('b', null, prog ? (goal ? `${prog.percent}%` : `${prog.done} ${t('words')}`) : '…'),
            h('small', null, prog ? (goal ? `${t('wbGoal')} ${goal} ${t('words')}` : t('wbNoGoal')) : t('loading')),
            goal && prog ? h('small', null, t('wbToday').replace('{n}', prog.today).replace('{d}', prog.streak)) : null),
          h('button', {
            className: 'ns-wb-widget',
            'data-bad': rep && (er + wr + ir) ? '1' : '0',
            onClick: () => onGo('validate'),
          },
          h('b', null, t('wbValidate')),
          h('small', null, !rep ? t('loading') : rep.ok ? t('wbClean') : t('wbIssues')
            .replace('{e}', er).replace('{w}', wr).replace('{i}', ir))),
          h('button', { className: 'ns-wb-widget', disabled: mkBusy, onClick: newChapter },
            h('b', null, t('wbNewChapter')),
            h('small', null, mkBusy ? t('loading') : nextChapterTitle(items)))),
        mkErr ? h('div', { className: 'ns-err', style: { margin: '8px 0' } }, mkErr) : null,
        navOpen ? null : h('div', { className: 'ns-groups' }, columns.map((col) =>
          h('div', { key: col.kind, className: 'ns-group', 'data-kind': col.kind },
            h('div', { className: 'ns-group-title' }, col.title),
            col.cards.map((c) =>
              h('button', { key: c.key, className: 'ns-group-card', onClick: () => onGo(c.key) },
                h('b', null, labelOf[c.key] || c.key),
                h('small', null, c.desc))),
            col.foot ? h('div', { className: 'ns-group-foot' }, col.foot.map((f) =>
              h('button', { key: f.key, className: 'ns-link', onClick: () => onGo(f.key) }, labelOf[f.key] || f.key))) : null))),
        rows.length ? h('dl', { className: 'ns-dl', style: { marginTop: 14 } }, rows.flatMap(([k, label, v]) => [
          h('dt', { key: `${k}t` }, label), h('dd', { key: `${k}d` }, String(v)),
        ])) : null,
        h('div', { className: 'ns-wb-counts' }, order.map((k, i) =>
          h('span', { key: k }, i ? ' · ' : '', `${labelOf[k] || k} ${String(counts?.[k] ?? 0)}`))),
        h('p', { className: 'ns-hint', style: { marginTop: 12 } }, `${t('root')}: ${root}`))
    }

    // ── calendar (活历法) ─────────────────────────────────────────────────

    /**
     * The book's own calendar, shown above the month and festival lists.
     *
     * The numbers come from the host, from the same module the consistency
     * report uses, so what the writer reads here and what the checker says
     * cannot drift apart. The "现在" box is what the ages are measured at;
     * left empty it follows the newest year in the timeline, and the caption
     * says which of the two happened rather than passing one off as the other.
     */
    function CalendarNote({ book }) {
      const [data, setData] = useState(null)
      const [at, setAt] = useState('')
      const [err, setErr] = useState(null)

      const reload = useCallback(async (value) => {
        try {
          const q = value ? `?at=${encodeURIComponent(value)}` : ''
          const r = await call('GET', `/library/${enc(book.id)}/calendar${q}`)
          setData(r.calendar || null)
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }, [book.id])

      useEffect(() => {
        setData(null)
        setAt('')
        reload('')
      }, [reload])

      if (err) return h('div', { className: 'ns-cal' }, h('div', { className: 'ns-err' }, err))
      if (!data) return null

      const months = data.months || []
      const festivals = data.festivals || []
      const ages = data.ages || []
      const when = (d) => t('calWhen').replace('{y}', String(d.year ?? '?')).replace('{m}', String(d.month ?? 1)).replace('{d}', String(d.day ?? 1))

      return h('div', { className: 'ns-cal' },
        h('div', { className: 'ns-cal-head' },
          h('span', { className: 'ns-cal-title' }, t('calTitle')),
          h('span', { className: 'ns-cal-sum' },
            `${t('calYearLen').replace('{n}', String(data.yearDays))} · ${months.length} ${t('calMonthUnit')}`),
          data.assumed ? h('span', { className: 'ns-cal-assumed' }, t('calAssumed')) : null),
        h('div', { className: 'ns-cal-at' },
          h('span', { className: 'ns-cal-lab' }, t('calNow')),
          h('input', {
            className: 'ns-cal-input',
            value: at,
            placeholder: t('calNowHint'),
            onChange: (e) => setAt(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') reload(at.trim()) },
          }),
          h('button', { className: 'ns-btn', onClick: () => reload(at.trim()) }, t('calApply')),
          data.at ? h('span', { className: 'ns-cal-when' },
            `${when(data.at)} · ${data.atSource === 'query' ? t('calAtQuery') : t('calAtTimeline')}`) : null),
        months.length ? h('div', { className: 'ns-cal-months' }, months.map((m) =>
          h('span', { key: m.n, className: 'ns-cal-month', title: `${m.from}–${m.to}` },
            h('b', null, m.name),
            h('i', null, String(m.days)),
            m.season ? h('em', null, m.season) : null))) : null,
        festivals.length ? h('div', { className: 'ns-cal-fests' }, festivals.map((f) =>
          h('div', {
            key: `${f.name}|${f.date}`,
            className: 'ns-cal-fest',
            'data-state': f.daysAway === null ? 'unknown' : (f.daysAway === 0 ? 'today' : ''),
          },
          h('span', { className: 'ns-cal-fname' }, f.name),
          h('span', { className: 'ns-cal-fdate' }, f.date || '—'),
          h('span', { className: 'ns-cal-fwhen' }, f.daysAway === null
            ? t('calUnknown')
            : (f.daysAway === 0 ? t('calToday') : t('calIn').replace('{n}', String(f.daysAway)))),
          f.note ? h('span', { className: 'ns-cal-fnote' }, f.note) : null))) : null,
        ages.length ? h('div', { className: 'ns-cal-ages' }, ages.map((a) =>
          h('div', {
            key: `${a.name}|${a.birthYear}`,
            className: 'ns-cal-age',
            'data-bad': a.declared !== null && a.age !== null && Math.abs(a.declared - a.age) >= 2 ? '1' : '0',
          },
          h('span', { className: 'ns-cal-aname' }, a.name),
          h('span', { className: 'ns-cal-aborn' }, String(a.birthYear)),
          h('span', { className: 'ns-cal-ayear' }, a.age === null ? '—' : t('calAged').replace('{n}', String(a.age))),
          a.declared !== null && a.age !== null && a.declared !== a.age
            ? h('span', { className: 'ns-cal-adecl' }, t('calDeclared').replace('{n}', String(a.declared)))
            : null))) : null)
    }

    function GroupPane({ book, section, group, onGroup }) {
      // Two of the world's groups are pure calendar data: the note above them
      // is what turns a month table into something you can read at a glance.
      const calendarish = group && (group.key === 'calendar' || group.key === 'festivals')
      return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
        h('div', { className: 'ns-subtabs' }, (section.groups || []).map((g) =>
          h('button', {
            key: g.key,
            className: 'ns-subtab',
            'data-on': g.key === group.key ? '1' : '0',
            onClick: () => onGroup(g.key),
          }, g.zh || g.key))),
        calendarish ? h(CalendarNote, { book }) : null,
        h(UnitPane, { book, section, group }))
    }

    // ── graph ─────────────────────────────────────────────────────────────

    /**
     * Nodes are laid out on a circle in kind order. A force simulation would look
     * livelier but would also move under the reader's eyes on every reload, so the
     * position of a node stays stable for as long as the cast does.
     */
    function GraphPane({ book }) {
      const [data, setData] = useState(null)
      const [picked, setPicked] = useState([])
      const [err, setErr] = useState(null)
      const [busy, setBusy] = useState(false)
      const [editing, setEditing] = useState(false)
      const [sel, setSel] = useState(null)
      const [draft, setDraft] = useState({ from: '', to: '', type: '', strength: 2 })
      const [form, setForm] = useState(null)
      const [flash, setFlash] = useState(null)
      // Zooming scales the drawing inside a frame that scrolls, so the scrollbars
      // do the panning and no coordinate maths is needed: 100% is the circle
      // exactly as it always was, 50% fits a large cast, 400% reads the edges.
      const [zoom, setZoom] = useState(1)
      const [panning, setPanning] = useState(false)
      const wrapRef = useRef(null)
      const pan = useRef(null)
      const dragged = useRef(false)

      const clampZoom = (z) => Math.min(4, Math.max(0.5, Math.round(z * 100) / 100))
      const stepZoom = (dir) => setZoom((z) => clampZoom(z * (dir > 0 ? 1.25 : 0.8)))

      // React registers wheel as passive, so an onWheel prop could never stop the
      // browser from zooming the whole page along with the graph; this listener is
      // added by hand so Ctrl+wheel belongs to the graph alone.
      useEffect(() => {
        const el = wrapRef.current
        if (!el) return undefined
        const onWheel = (ev) => {
          if (!ev.ctrlKey && !ev.metaKey) return
          ev.preventDefault()
          setZoom((z) => clampZoom(z * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)))
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
      }, [])

      // Dragging the frame pans it; a real drag also swallows the click that
      // follows, so panning can never pick a node while editing.
      function panDown(ev) {
        const el = wrapRef.current
        if (!el || ev.button !== 0) return
        dragged.current = false
        pan.current = { x: ev.clientX, y: ev.clientY, left: el.scrollLeft, top: el.scrollTop }
        setPanning(true)
        try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch { /* nothing to capture */ }
      }
      function panMove(ev) {
        const el = wrapRef.current
        const p = pan.current
        if (!el || !p) return
        const dx = ev.clientX - p.x
        const dy = ev.clientY - p.y
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragged.current = true
        el.scrollLeft = p.left - dx
        el.scrollTop = p.top - dy
      }
      function panUp() {
        pan.current = null
        setPanning(false)
      }

      const load = useCallback(async (kinds) => {
        setBusy(true)
        try {
          const q = kinds && kinds.length ? `?kinds=${kinds.map(enc).join(',')}` : ''
          setData(await call('GET', `/library/${enc(book.id)}/graph${q}`))
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }, [book.id])

      useEffect(() => { load([]) }, [load])

      function toggle(key) {
        const next = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]
        setPicked(next)
        load(next)
      }

      const nodes = data?.nodes || []
      const edges = data?.edges || []
      const menu = data?.kinds || []
      const W = 520
      const H = 460
      const cx = W / 2
      const cy = H / 2 - 6
      const R = Math.min(W, H) / 2 - 52

      const ordered = [...nodes].sort((a, b) =>
        (a.kind === b.kind ? String(a.label).localeCompare(String(b.label)) : String(a.kind).localeCompare(String(b.kind))))
      const at = new Map()
      ordered.forEach((n, i) => {
        const a = (i / Math.max(ordered.length, 1)) * Math.PI * 2 - Math.PI / 2
        at.set(n.id, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, n })
      })
      const labelOf = new Map(ordered.map((n) => [n.id, n.label]))
      const seen = new Set()
      const drawn = edges.filter((e) => {
        const k = [e.from, e.to].sort().join('\u0000') + '|' + (e.type || '')
        if (seen.has(k)) return false
        seen.add(k)
        return at.has(e.from) && at.has(e.to)
      })

      // One relation is addressed by all four of its parts; the same pair may run
      // two different relations, and a row and a derived edge may even coexist.
      const ekey = (e) => [e.from, e.to, e.type || '', e.source || ''].join('\u0000')

      async function send(payload) {
        setBusy(true)
        try {
          await call('POST', `/library/${enc(book.id)}/graph/edges`, payload)
          setFlash({ level: 'ok', text: t('edgeSaved') })
          setSel(null)
          setForm(null)
          setDraft({ from: '', to: '', type: '', strength: 2 })
          await load(picked)
        } catch (e) {
          // A refused edit must not blank the drawing, so it lands in the flash
          // line instead of the load-error slot.
          setFlash({ level: 'err', text: String((e && e.message) || e) })
        } finally {
          setBusy(false)
        }
      }

      function pickNode(id) {
        if (dragged.current) { dragged.current = false; return }
        if (!editing) return
        setFlash(null)
        setDraft((d) => {
          if (!d.from) return { ...d, from: id }
          if (!d.to) return d.from === id ? { ...d, from: '' } : { ...d, to: id }
          return { ...d, from: id, to: '' }
        })
      }

      function nodeSelect(value, onPick) {
        return h('select', { value, onChange: (ev) => onPick(ev.target.value) },
          h('option', { value: '' }, '—'),
          ordered.map((n) => h('option', { key: n.id, value: n.id }, n.label)))
      }

      function edgeForm(e) {
        const auto = e.source === 'auto'
        const f = form || {}
        const val = (name, fallback) => (f[name] !== undefined ? f[name] : fallback)
        return h('div', { className: 'ns-edge-form' },
          h('label', null, auto ? t('rewire') : t('from'),
            nodeSelect(val('from', e.from), (v) => setForm({ ...f, from: v }))),
          auto ? null : h('label', null, t('to'),
            nodeSelect(val('to', e.to), (v) => setForm({ ...f, to: v }))),
          auto ? null : h('label', null, t('relation'),
            h('input', { value: val('type', e.type), onChange: (ev) => setForm({ ...f, type: ev.target.value }) })),
          auto ? null : h('label', null, t('note'),
            h('input', { value: val('note', e.note), onChange: (ev) => setForm({ ...f, note: ev.target.value }) })),
          auto ? null : h('label', null, t('strength'),
            h('input', {
              type: 'number', min: 1, max: 5, style: { width: 56 },
              value: val('strength', e.strength),
              onChange: (ev) => setForm({ ...f, strength: ev.target.value }),
            })),
          h('button', {
            className: 'ns-btn', 'data-kind': 'primary', disabled: busy,
            onClick: () => {
              // Send the edge as it stands, plus the changes: the host matches on
              // the former and only writes the latter.
              const patch = auto
                ? { from: val('from', e.from) }
                : {
                    from: val('from', e.from),
                    to: val('to', e.to),
                    type: val('type', e.type),
                    note: val('note', e.note),
                    strength: val('strength', e.strength),
                  }
              send({ action: 'update', from: e.from, to: e.to, type: e.type, source: e.source, patch })
            },
          }, t('save')),
          h('button', {
            className: 'ns-btn', disabled: busy,
            onClick: () => {
              if (!window.confirm(t('confirmUnlink'))) return
              send({ action: 'delete', from: e.from, to: e.to, type: e.type, source: e.source })
            },
          }, t('remove')),
          auto ? h('span', { className: 'ns-hint' }, `${t('fieldDerived')} ${e.owner} · ${e.field}`) : null)
      }

      if (err) return h('div', { className: 'ns-pane' }, h('div', { className: 'ns-err' }, err))

      return h('div', { className: 'ns-pane', style: { padding: 0 } },
        h('div', { className: 'ns-subtabs' },
          h('button', {
            className: 'ns-subtab',
            'data-on': picked.length ? '0' : '1',
            onClick: () => { setPicked([]); load([]) },
          }, t('allKinds')),
          menu.map((k) => h('button', {
            key: k.key,
            className: 'ns-subtab',
            'data-on': picked.includes(k.key) ? '1' : '0',
            onClick: () => toggle(k.key),
          }, k.zh || k.key)),
          h('button', {
            className: 'ns-subtab',
            'data-on': editing ? '1' : '0',
            onClick: () => {
              setEditing(!editing)
              setSel(null)
              setForm(null)
              setFlash(null)
              setDraft({ from: '', to: '', type: '', strength: 2 })
            },
          }, editing ? t('editDone') : t('edit'))),
        editing ? h('div', { className: 'ns-edge-tools' },
          h('label', null, t('from'), nodeSelect(draft.from, (v) => setDraft({ ...draft, from: v }))),
          h('label', null, t('to'), nodeSelect(draft.to, (v) => setDraft({ ...draft, to: v }))),
          h('label', null, t('relation'),
            h('input', {
              list: 'ns-edge-types', style: { width: 120 },
              value: draft.type,
              onChange: (ev) => setDraft({ ...draft, type: ev.target.value }),
            })),
          h('datalist', { id: 'ns-edge-types' },
            [...new Set(edges.map((e) => e.type).filter(Boolean))].map((v) => h('option', { key: v, value: v }))),
          h('label', null, t('strength'),
            h('input', {
              type: 'number', min: 1, max: 5, style: { width: 56 },
              value: draft.strength,
              onChange: (ev) => setDraft({ ...draft, strength: ev.target.value }),
            })),
          h('button', {
            className: 'ns-btn', 'data-kind': 'primary', disabled: busy,
            onClick: () => {
              if (!draft.from || !draft.to) { setFlash({ level: 'err', text: t('pickBoth') }); return }
              send({ action: 'create', from: draft.from, to: draft.to, type: draft.type, strength: draft.strength })
            },
          }, t('addRelation')),
          h('span', { className: 'ns-hint' }, t('editHint'))) : null,
        h('div', { className: 'ns-graph-bar' },
          h('span', { className: 'ns-hint', style: { marginRight: 'auto' } }, t('graphZoomHint')),
          h('button', {
            className: 'ns-btn ns-ai-mini', 'data-graph-zoom': 'out',
            title: t('graphZoomOut'), disabled: zoom <= 0.5,
            onClick: () => stepZoom(-1),
          }, '－'),
          h('button', {
            className: 'ns-btn ns-ai-mini', 'data-graph-zoom': 'pct',
            title: t('graphZoomReset'),
            onClick: () => setZoom(1),
          }, `${Math.round(zoom * 100)}%`),
          h('button', {
            className: 'ns-btn ns-ai-mini', 'data-graph-zoom': 'in',
            title: t('graphZoomIn'), disabled: zoom >= 4,
            onClick: () => stepZoom(1),
          }, '＋')),
        h('div', {
          className: 'ns-graph-wrap',
          ref: wrapRef,
          'data-zoom': `${Math.round(zoom * 100)}`,
          style: { cursor: zoom > 1 ? (panning ? 'grabbing' : 'grab') : undefined },
          onPointerDown: panDown,
          onPointerMove: panMove,
          onPointerUp: panUp,
          onPointerCancel: panUp,
        },
          !nodes.length && !busy ? h('div', { className: 'ns-empty' }, t('noEntries')) : null,
          h('svg', { className: 'ns-graph', viewBox: `0 0 ${W} ${H}`, width: `${zoom * 100}%` },
            drawn.map((e) => {
              const a = at.get(e.from)
              const b = at.get(e.to)
              return h('line', {
                key: `e:${e.id}`,
                x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                stroke: 'var(--dsw-alias-border-l2,rgba(127,127,127,.5))',
                strokeWidth: Math.max(1, Number(e.strength) || 1) * 0.9,
                strokeDasharray: e.source === 'auto' ? '3 3' : undefined,
              })
            }),
            drawn.map((e) => {
              const a = at.get(e.from)
              const b = at.get(e.to)
              return e.type ? h('text', {
                key: `t:${e.id}`,
                x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 3,
                textAnchor: 'middle',
                className: 'ns-graph-edge-label',
              }, e.type) : null
            }),
            ordered.map((n) => {
              const p = at.get(n.id)
              const on = editing && (draft.from === n.id || draft.to === n.id)
              return h('g', {
                key: `n:${n.id}`,
                className: 'ns-graph-node',
                'data-kind': n.kind,
                'data-pick': on ? '1' : '0',
                style: editing ? { cursor: 'pointer' } : undefined,
                onClick: editing ? () => pickNode(n.id) : undefined,
              },
                h('circle', {
                  cx: p.x, cy: p.y,
                  r: n.external ? 5 : 8,
                  'data-external': n.external ? '1' : '0',
                }, h('title', null, [n.id, n.role, n.summary].filter(Boolean).join('\n'))),
                h('text', { x: p.x, y: p.y + (n.external ? 14 : 20), textAnchor: 'middle', className: 'ns-graph-label' },
                  n.external ? `${n.label} · ${t('external')}` : n.label))
            }))),
        h('div', { className: 'ns-graph-stats' },
          h('span', null, `${nodes.length} ${t('nodes')}`),
          h('span', null, `${edges.length} ${t('edges')}`),
          h('span', null, `${(data?.stats?.manual ?? 0)} ${t('manual')}`),
          h('span', null, `${(data?.stats?.auto ?? 0)} ${t('auto')}`)),
        flash ? h('div', { className: 'ns-hint', style: { padding: '0 16px 10px', color: flash.level === 'err' ? 'var(--dsw-alias-state-error-primary,#dc2626)' : undefined } }, flash.text) : null,
        // The drawing is a picture of the data; this list is the data itself, so
        // it stays available for reading even when nothing is being edited.
        h('div', { className: 'ns-edge-list' },
          !edges.length ? h('div', { className: 'ns-hint' }, t('noEdges')) : null,
          edges.map((e) => {
            const k = ekey(e)
            const on = sel === k
            return h('div', { key: k },
              h('div', {
                className: 'ns-edge-row',
                'data-on': on ? '1' : '0',
                'data-source': e.source,
                style: { cursor: editing ? 'pointer' : 'default' },
                onClick: () => { if (editing) { setSel(on ? null : k); setForm(null); setFlash(null) } },
              },
                h('span', null, labelOf.get(e.from) || e.from),
                h('span', { className: 'ns-pill' }, e.type || '·'),
                h('span', null, labelOf.get(e.to) || e.to),
                h('span', { className: 'ns-hint' }, e.source === 'auto' ? `${t('fieldDerived')} ${e.owner} · ${e.field}` : t('storedEdge'))),
              on ? edgeForm(e) : null)
          })),
        (data?.problems || []).length
          ? h('div', { className: 'ns-issues' },
              h('div', { className: 'ns-hint', style: { marginBottom: 4 } }, t('problems')),
              (data.problems || []).map((p, i) => h('div', { key: i, className: 'ns-issue', 'data-level': 'warn' },
                h('span', { className: 'ns-pill' }, p.code), String(p.message || ''))))
          : null)
    }

    // ── validate ──────────────────────────────────────────────────────────

    /** The consistency report itself — the 校验 sub-tab. */
    function IssueReport({ book }) {
      const [report, setReport] = useState(null)
      const [err, setErr] = useState(null)
      const [busy, setBusy] = useState(false)

      const run = useCallback(async () => {
        setBusy(true)
        try {
          setReport(await call('GET', `/library/${enc(book.id)}/validate`))
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }, [book.id])

      useEffect(() => { run() }, [run])

      if (err) return h('div', { className: 'ns-err' }, err)
      if (!report) return h('div', { className: 'ns-empty' }, t('loading'))

      const levels = ['error', 'warn', 'info']
      const counts = report.counts || {}
      const issues = report.issues || []
      const scanned = report.scanned || {}

      return h(React.Fragment, null,
        h('div', { className: 'ns-actions', style: { marginTop: 0 } },
          h('button', { className: 'ns-btn', 'data-kind': 'primary', disabled: busy, onClick: run }, busy ? t('loading') : t('rerun')),
          h('span', { className: 'ns-muted' },
            `${t('scanned')}: ${scanned.units ?? 0} sections · ${scanned.entries ?? 0} entries · ${scanned.nodes ?? 0} nodes · ${scanned.edges ?? 0} edges`)),
        h('div', { className: 'ns-cards', style: { marginTop: 10 } }, levels.map((lv) =>
          h('div', { key: lv, className: 'ns-card', 'data-level': lv },
            h('b', null, String(counts[lv] ?? 0)), h('span', null, t('issueCount')[lv] || lv)))),
        report.ok ? h('p', { className: 'ns-hint' }, t('clean')) : null,
        issues.length
          ? h('div', { className: 'ns-issues' }, issues.map((it, i) =>
              h('div', { key: i, className: 'ns-issue', 'data-level': it.level },
                h('span', { className: 'ns-pill', 'data-level': it.level }, t('issueLevel')[it.level] || it.level),
                h('span', { className: 'ns-muted', style: { marginRight: 6 } }, it.rule),
                String(it.message || ''))))
          : (report.ok ? null : h('div', { className: 'ns-empty' }, t('loading'))))
    }

    /**
     * 审稿 pane: the consistency report and the simulated readers, side by side
     * because both answer "what is wrong with this book right now".
     */
    function ValidatePane({ book }) {
      const [tab, setTab] = useState('issues') // issues | reader
      return h('div', { className: 'ns-pane' },
        h('div', { className: 'ns-subtabs' },
          h('button', { className: 'ns-subtab', 'data-on': tab === 'issues' ? '1' : '0', onClick: () => setTab('issues') }, t('validateIssues')),
          h('button', { className: 'ns-subtab', 'data-on': tab === 'reader' ? '1' : '0', onClick: () => setTab('reader') }, t('readerTab'))),
        tab === 'issues' ? h(IssueReport, { book }) : h(ReaderPane, { book }))
    }

    /**
     * 读者模拟: one stored report per chapter plus the curve they draw.
     *
     * Running one costs a model call, so the pane never runs on its own — the
     * writer picks a chapter and pays for exactly that chapter.
     */
    function ReaderPane({ book }) {
      const [data, setData] = useState(null) // { reports, curve }
      const [chapters, setChapters] = useState([])
      const [chapter, setChapter] = useState('')
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      const [err, setErr] = useState(null)

      const reload = useCallback(async () => {
        try {
          const [rd, ch] = await Promise.all([
            call('GET', `/library/${enc(book.id)}/reader`),
            call('GET', `/library/${enc(book.id)}/unit/chapters`),
          ])
          setData({ reports: rd.reports || [], curve: rd.curve || [] })
          const items = (ch.items || []).filter((it) => it.id)
          setChapters(items)
          setChapter((cur) => (items.some((it) => String(it.id) === cur) ? cur : String(items[0]?.id || '')))
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }, [book.id])

      useEffect(() => {
        setData(null)
        setNote('')
        setErr(null)
        reload()
      }, [reload])

      async function runReader() {
        if (!chapter) return
        setBusy(true)
        setNote('')
        try {
          await call('POST', `/library/${enc(book.id)}/reader`, { chapter })
          setNote(t('readerDone').replace('{c}', chapter))
          await reload()
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      async function dropReader(id) {
        setBusy(true)
        try {
          await call('DELETE', `/library/${enc(book.id)}/reader/${enc(id)}`)
          await reload()
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      if (err) return h('div', { className: 'ns-err' }, err)
      if (!data) return h('div', { className: 'ns-empty' }, t('loading'))

      const metrics = [
        ['tension', 'readerTension'],
        ['fun', 'readerFun'],
        ['curiosity', 'readerCuriosity'],
        ['immersion', 'readerImmersion'],
      ]
      const quotes = [
        ['expectation', 'readerExpectation'],
        ['highlight', 'readerHighlight'],
        ['drop', 'readerDrop'],
        ['poison', 'readerPoison'],
        ['hook', 'readerHook'],
      ]
      const worth = (v) => v && !/^(无|没有|none|n\/a|-|—)$/i.test(String(v).trim())

      return h(React.Fragment, null,
        h('div', { className: 'ns-actions', style: { marginTop: 0 } },
          h('label', null, t('readerPick'),
            h('select', { value: chapter, onChange: (e) => setChapter(e.target.value) },
              chapters.length
                ? chapters.map((it) => h('option', { key: it.id, value: it.id }, it.title || it.id))
                : h('option', { value: '' }, t('readerNoChapters')))),
          h('button', { className: 'ns-btn', 'data-kind': 'primary', disabled: busy || !chapter, onClick: runReader },
            busy ? t('loading') : t('readerRun')),
          h('span', { className: 'ns-muted' }, t('readerRunHint'))),
        note ? h('div', { className: 'ns-hint' }, note) : null,
        data.reports.length
          ? h('div', { className: 'ns-rd' },
              h('div', { className: 'ns-rd-head' }, t('readerCurve')),
              h('div', { className: 'ns-rd-legend' }, metrics.map(([key, label]) =>
                h('span', { key, className: 'ns-rd-key', 'data-key': key }, t(label)))),
              data.curve.map((row) => h('div', { key: row.chapter, className: 'ns-rd-row' },
                h('span', { className: 'ns-rd-ch', title: row.chapter }, row.chapter),
                h('span', { className: 'ns-rd-bars' }, metrics.map(([key, label]) =>
                  h('span', { key, className: 'ns-rd-bar', 'data-key': key, title: `${t(label)} ${row[key] ?? 0}` },
                    h('i', { style: { height: `${Math.max(3, (Number(row[key]) || 0) * 10)}%` } })))))),
              h('div', { className: 'ns-rd-list' }, data.reports.map((r) =>
                h('div', { key: r.chapter, className: 'ns-rd-item' },
                  h('div', { className: 'ns-rd-item-head' },
                    h('b', null, r.chapter),
                    h('span', { className: 'ns-muted' },
                      metrics.map(([key, label]) => `${t(label)} ${r.scores?.[key] ?? 0}`).join(' · ')),
                    h('button', { className: 'ns-btn', disabled: busy, onClick: () => dropReader(r.chapter) }, t('remove'))),
                  quotes.filter(([key]) => worth(r[key])).map(([key, label]) =>
                    h('div', { key, className: 'ns-rd-line', 'data-key': key },
                      h('b', null, t(label)), r[key]))))))
          : h('div', { className: 'ns-empty' }, t('readerEmpty')))
    }

    /**
     * One model call, grounded in this book's own files.
     *
     * The pane never writes anything back on its own: it streams a draft and
     * the author decides whether that draft belongs in the chapter.
     */
    function AiPane({ book }) {
      const [tasks, setTasks] = useState(null)
      const [task, setTask] = useState('continue')
      const [chapters, setChapters] = useState([])
      const [chapter, setChapter] = useState('')
      const [text, setText] = useState('')
      const [idea, setIdea] = useState('')
      // 拆书 pastes someone else's prose, which can be a whole chapter, so it
      // gets its own box rather than sharing the one-line idea field.
      const [paste, setPaste] = useState('')
      const [extra, setExtra] = useState('')
      const [out, setOut] = useState('')
      // Token accounting for the last round (the host passes the provider's
      // own usage object through unchanged), and where a result may be kept.
      const [usage, setUsage] = useState(null)
      // Whether the cumulative ledger is unfolded. The line under the answer is
      // this round only; everything the book has ever spent lives behind this
      // toggle, because a per-round figure is what a writer checks while writing.
      const [usageOpen, setUsageOpen] = useState(false)
      // How long this round's answer should be ('' = the writer left it open),
      // and the book's own running ledger — the host keeps it, so switching
      // windows or reloading the page does not reset the total.
      const [words, setWords] = useState('')
      const [total, setTotal] = useState(null)
      // Reading a passage back into the record regions. `extractOn` is the
      // "顺便补材料" switch in the write-back bar (on by default), `found` is a
      // plan the writer has not filed yet, and the two busy flags cover the
      // model call and the write — they are separate so filing can be slow
      // without the panel pretending it is reading the passage again.
      const [extractOn, setExtractOn] = useState(true)
      const [found, setFound] = useState(null)
      const [finding, setFinding] = useState(false)
      const [foundNote, setFoundNote] = useState('')
      const [saveAs, setSaveAs] = useState('material')
      const [saveName, setSaveName] = useState('')
      const [saving, setSaving] = useState(false)
      const [running, setRunning] = useState(false)
      const [err, setErr] = useState(null)
      const [note, setNote] = useState('')
      const [preview, setPreview] = useState(null)
      // null = the default: every entry the book has. Once the writer toggles
      // anything it becomes { poolKey: [id, …] }, and a pool whose every entry
      // is checked drops back out so "default" and "all checked" stay the same
      // thing on the wire.
      const [pick, setPick] = useState(null)
      const [pickerOpen, setPickerOpen] = useState(false)
      // Rounds already finished, kept as conversation history. A round is
      // folded in just before the next one starts, so the log above always
      // shows rounds already spent while the out-pane shows the round in hand.
      const [thread, setThread] = useState([])
      const pendingRef = useRef(null)

      const ctl = useRef(null)
      const outRef = useRef(null)

      // The answer box is bounded so a long review cannot swallow the panel; a
      // round therefore has to keep its own newest line in view.
      useEffect(() => {
        const el = outRef.current
        if (!el || !running) return
        el.scrollTop = el.scrollHeight
      }, [out, running])

      const meta = (tasks || []).find((x) => x.key === task) || null
      const needs = meta ? meta.needs : 'none'
      const catalog = (preview && preview.catalog) || []
      const itemTotal = catalog.reduce((n, p) => n + (p.items || []).length, 0)
      // What the writer asked this round to be, in words — 0 when they left it
      // open, which is also the value that keeps `words` off the wire entirely.
      const askedWords = Math.max(0, Math.round(Number(String(words).trim()))) || 0

      useEffect(() => {
        let alive = true
        // History is book-specific; a different shelf-item starts a fresh log.
        pendingRef.current = null
        setThread([])
        setWords('')
        ;(async () => {
          try {
            const data = await call('GET', `/library/${enc(book.id)}/ai/tasks`)
            if (alive) setTasks(data.tasks || [])
          } catch (e) {
            if (alive) setErr(String((e && e.message) || e))
          }
        })()
        ;(async () => {
          try {
            const data = await call('GET', `/library/${enc(book.id)}/unit/chapters`)
            if (!alive) return
            const items = data.items || []
            setChapters(items)
            setChapter(items.length ? items[items.length - 1].id : '')
          } catch {
            /* tasks that need no chapter still work without this */
          }
        })()
        ;(async () => {
          try {
            const data = await call('GET', `/library/${enc(book.id)}/usage`)
            if (alive) setTotal(data.usage || null)
          } catch {
            /* a host without a ledger just shows no totals */
          }
        })()
        return () => {
          alive = false
        }
      }, [book.id])

      // What the model would actually read, refreshed as the form changes.
      useEffect(() => {
        let alive = true
        const q = new URLSearchParams({ task })
        if (chapter) q.set('chapter', chapter)
        if (pick) q.set('pick', JSON.stringify(pick))
        ;(async () => {
          try {
            const data = await call('GET', `/library/${enc(book.id)}/ai/context?${q.toString()}`)
            if (alive) setPreview(data.context || null)
          } catch {
            if (alive) setPreview(null)
          }
        })()
        return () => {
          alive = false
        }
      }, [book.id, task, chapter, pick])

      const stop = useCallback(() => {
        try {
          if (ctl.current) ctl.current.abort()
        } catch {
          /* already finished */
        }
      }, [])

      // ── the picker ──────────────────────────────────────────────────────
      // `pick` is the exception list, not the full selection: a pool the
      // writer never touched is simply absent, which is exactly what the host
      // reads as "keep everything".
      const isOn = useCallback(
        (poolKey, id) => {
          if (!pick || !Object.prototype.hasOwnProperty.call(pick, poolKey)) return true
          const value = pick[poolKey]
          if (value === false) return false
          return Array.isArray(value) ? value.includes(id) : true
        },
        [pick],
      )

      const applyPick = useCallback(
        (mutate) => {
          setPick((prev) => {
            const state = {}
            for (const pool of catalog) {
              const has = prev && Object.prototype.hasOwnProperty.call(prev, pool.key)
              const value = has ? prev[pool.key] : true
              state[pool.key] = value === false ? [] : Array.isArray(value) ? value.slice() : (pool.items || []).map((i) => i.id)
            }
            mutate(state)
            const out = {}
            for (const pool of catalog) {
              const ids = state[pool.key] || []
              const all = (pool.items || []).length
              if (ids.length === all) continue // fully checked means "default"
              out[pool.key] = ids
            }
            return Object.keys(out).length ? out : null
          })
        },
        [catalog],
      )

      const toggleItem = useCallback(
        (poolKey, id) => {
          applyPick((state) => {
            const cur = state[poolKey] || []
            state[poolKey] = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
          })
        },
        [applyPick],
      )

      const setPool = useCallback(
        (poolKey, on) => {
          applyPick((state) => {
            const pool = catalog.find((p) => p.key === poolKey)
            state[poolKey] = on ? (pool?.items || []).map((i) => i.id) : []
          })
        },
        [applyPick, catalog],
      )

      const pickedTotal = catalog.reduce((n, pool) => n + (pool.items || []).filter((i) => isOn(pool.key, i.id)).length, 0)

      // Re-read the book's ledger. Declared before `run` because `run` names it
      // in its dependency list, and a dependency array is evaluated during the
      // render that builds the callback.
      const refreshTotal = useCallback(async () => {
        try {
          const data = await call('GET', `/library/${enc(book.id)}/usage`)
          setTotal(data.usage || null)
        } catch {
          /* the ledger is a nicety: losing it must not disturb the answer */
        }
      }, [book.id])

      const run = useCallback(async () => {
        setRunning(true)
        setErr(null)
        setNote('')
        setOut('')
        setUsage(null)

        // Fold the previous round into the log first: this run is what makes
        // it history, and its answer is what the model should see below.
        let rounds = thread
        if (pendingRef.current) {
          rounds = [...thread, pendingRef.current].slice(-6)
          pendingRef.current = null
          setThread(rounds)
        }

        const body = { task }
        if (extra.trim()) body.instruction = extra.trim()
        if (askedWords) body.words = askedWords
        if (needs === 'chapter' && chapter) body.chapter = chapter
        if (needs === 'text') body.text = text
        if (needs === 'paste') body.text = paste
        if (needs === 'input') body.input = idea
        if (pick) body.pick = pick
        if (rounds.length) {
          body.history = rounds.flatMap((r) => [
            { role: 'user', content: r.ask },
            { role: 'assistant', content: r.answer },
          ])
        }

        // The compact "what was asked" kept for the log — the full prompt is
        // rebuilt by the host each round, so only the author's own words and
        // the task/chapter labels travel as the user turn.
        const ask = [
          meta ? meta.zh || meta.key : task,
          needs === 'chapter' && chapter
            ? ((chapters.find((c) => c.id === chapter) || {}).title || chapter)
            : '',
          extra.trim(),
          needs === 'input' ? idea.trim() : '',
          needs === 'text' ? text.trim().slice(0, 160) : '',
          needs === 'paste' ? paste.trim().slice(0, 160) : '',
        ]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 600)

        const controller = new AbortController()
        ctl.current = controller
        let acc = ''
        let failed = false
        try {
          await streamCall(
            `/library/${enc(book.id)}/ai`,
            body,
            (event) => {
              if (event.type === 'delta') {
                acc += event.text
                setOut((s) => s + event.text)
              } else if (event.type === 'done') {
                if (event.usage) setUsage(event.usage)
              } else if (event.type === 'error') {
                failed = true
                setErr(event.code === 'no-model' ? t('aiNoModel') : event.error || 'error')
              }
            },
            controller.signal,
          )
          // Only a completed round becomes history; a failure or a stop leaves
          // its partial text on screen without replaying it to the model.
          if (!failed && acc.trim()) pendingRef.current = { ask, answer: acc }
        } catch (e) {
          if (e && e.name === 'AbortError') {
            /* the text already on screen is what the author asked to keep */
          } else {
            setErr(e && e.code === 'no-model' ? t('aiNoModel') : String((e && e.message) || e))
          }
        } finally {
          ctl.current = null
          setRunning(false)
          // The host writes the ledger before the last frame goes out, so by now
          // this round is already counted — re-reading shows the new total
          // without waiting for a reload.
          refreshTotal()
        }
      }, [book.id, task, chapter, text, idea, extra, needs, pick, thread, meta, chapters, askedWords, refreshTotal])

      // Read a passage with the book's own model and open the plan for review.
      // Nothing is written here: recognising is a proposal, and the switch that
      // calls it can be turned off without losing the writing itself.
      const recognize = useCallback(
        async (passage, chapterId) => {
          const body = String(passage ?? '').trim()
          if (!body) return null
          const into = chapterId || chapter
          setFinding(true)
          setFound(null)
          setFoundNote('')
          try {
            const got = await call('POST', `/library/${enc(book.id)}/extract`, { chapter: into, passage: body })
            const plan = got.plan || null
            setFound(plan)
            if (!plan || !(plan.entries || []).length) setFoundNote(t('aiExtractEmpty'))
            // The pass itself is billed to this book, so the running total moved.
            refreshTotal()
            return plan
          } catch (e) {
            setErr(String((e && e.message) || e))
            return null
          } finally {
            setFinding(false)
          }
        },
        [book.id, chapter, refreshTotal],
      )

      const writeBack = useCallback(
        async (mode) => {
          if (!chapter || !out.trim()) return
          if (mode === 'replace' && !window.confirm(t('confirmReplace'))) return
          setErr(null)
          setNote('')
          try {
            const base = `/library/${enc(book.id)}/unit/chapters/${enc(chapter)}`
            const got = await call('GET', base)
            const data = got.data || {}
            const prev = String(data.body || '').trim()
            const body = mode === 'replace' ? out.trim() : [prev, out.trim()].filter(Boolean).join('\n\n')
            await call('PUT', base, { ...data, body })
            setNote(t('aiInserted'))
            // The text that just went in is the text that gets read back: on
            // append that is the generated paragraph, on replace the new body.
            if (extractOn) recognize(out.trim())
          } catch (e) {
            setErr(String((e && e.message) || e))
          }
        },
        [book.id, chapter, out, extractOn, recognize],
      )

      // Counts read better grouped once they pass four digits, and a provider
      // that reported nothing reads as a dash instead of a confident zero.
      function fmtN(value) {
        const n = Number(value)
        if (!Number.isFinite(n)) return '—'
        return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      }

      // Provider usage objects differ; accept the usual spellings and stay
      // silent rather than inventing numbers when nothing recognisable arrives.
      function tokenLine(u) {
        if (!u || typeof u !== 'object') return null
        const pick = (...keys) => {
          for (const k of keys) if (typeof u[k] === 'number') return u[k]
          return null
        }
        const inN = pick('promptTokens', 'inputTokens', 'prompt_tokens', 'input_tokens', 'input')
        const outN = pick('completionTokens', 'outputTokens', 'completion_tokens', 'output_tokens', 'output')
        const sum = (inN ?? 0) + (outN ?? 0)
        const tot = pick('totalTokens', 'total_tokens', 'total') ?? (sum || null)
        if (inN == null && outN == null && tot == null) return null
        return `${t('aiUsageRound')} · ${t('aiUsageIn')} ${inN == null ? '—' : fmtN(inN)} · ${t('aiUsageOut')} ${outN == null ? '—' : fmtN(outN)}${tot != null ? ` · Σ ${fmtN(tot)}` : ''}`
      }

      // The same definition the host counts chapters with (records.js
      // countWords): every CJK character is one word, a run of latin letters or
      // digits is one word. Copied rather than guessed at, so the number under
      // the answer always agrees with the number on the chapter.
      function countWords(text) {
        return (String(text ?? '').match(/[\u4e00-\u9fff]|[A-Za-z0-9]+/g) || []).length
      }

      // What this round produced, against what it was asked for. Shown while the
      // answer streams, so the writer can stop a run that is going to overshoot.
      function countLine(text) {
        const n = countWords(text)
        if (!n && !askedWords) return null
        if (!askedWords) return `${t('aiCount')} ${n} ${t('aiCountUnit')}`
        const diff = n - askedWords
        const verdict = diff === 0 ? t('aiCountHit') : diff > 0 ? `${t('aiCountOver')} ${diff}` : `${t('aiCountUnder')} ${-diff}`
        return `${t('aiCount')} ${n} ${t('aiCountUnit')} · ${t('aiCountAsk')} ${askedWords} · ${verdict}`
      }

      // The book's cumulative ledger — every round the host has ever run for it,
      // from any window or tool, which is why it is not derived from this one.
      // Rounds and dates are shown by the panel around this line, not in it.
      function totalLine(u) {
        if (!u) return null
        const parts = [`${t('aiUsageIn')} ${fmtN(u.input ?? 0)}`, `${t('aiUsageOut')} ${fmtN(u.output ?? 0)}`]
        if (u.cacheRead) parts.push(`${t('aiUsageCache')} ${fmtN(u.cacheRead)}`)
        if (u.cacheWrite) parts.push(`${t('aiUsageCacheWrite')} ${fmtN(u.cacheWrite)}`)
        parts.push(`Σ ${fmtN(u.total ?? 0)}`)
        return parts.join(' · ')
      }

      // ISO timestamps cut down to "YYYY-MM-DD HH:MM" — a panel wants the day,
      // not the milliseconds (and an absent one stays absent).
      function stamp(value) {
        if (typeof value !== 'string' || !value) return null
        return value.replace('T', ' ').slice(0, 16)
      }

      async function resetTotal() {        if (!window.confirm(t('aiUsageResetAsk'))) return
        try {
          const data = await call('POST', `/library/${enc(book.id)}/usage`, { reset: true })
          setTotal(data.usage || null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }

      // Switching destination by hand. A new chapter is the only one that needs
      // a name up front, so the book's own numbering is guessed the moment it is
      // picked — the field stays editable and nothing is written until Save.
      function chooseSaveAs(next) {
        setSaveAs(next)
        if (next === 'newchapter' && !saveName.trim()) setSaveName(nextChapterTitle(chapters))
      }

      // The answer as a chapter of its own. Its title doubles as the file name;
      // a name the book already has is renamed by the host ("-2") rather than
      // overwritten, so a guess can never cost an existing chapter.
      const saveNewChapter = useCallback(
        async (text) => {
          setSaving(true)
          setErr(null)
          setNote('')
          try {
            const title = (saveName || '').trim() || nextChapterTitle(chapters)
            const made = await call('POST', `/library/${enc(book.id)}/unit/chapters`, { title, body: text })
            const id = String(made.id ?? title)
            setChapters((list) => (list.some((c) => String(c.id) === id) ? list : [...list, { id, title: id }]))
            setChapter(id)
            setNote(`${t('aiNewChapterDone')} · ${id}`)
            // A new chapter is still a chapter, so the "read it back" switch
            // applies to the text that just landed in it.
            if (extractOn) recognize(text, id)
          } catch (e) {
            setErr(String((e && e.message) || e))
          } finally {
            setSaving(false)
          }
        },
        [saveName, chapters, book.id, extractOn, recognize],
      )

      // The result is text; everything else is a destination. Materials and
      // drafts are new files, the chapter is the one already on screen.
      const saveAsResult = useCallback(async () => {
        const text = out.trim()
        if (!text) return
        if (saveAs === 'chapter') return writeBack('append')
        if (saveAs === 'replace') return writeBack('replace')
        if (saveAs === 'newchapter') return saveNewChapter(text)
        setSaving(true)
        setErr(null)
        setNote('')
        try {
          if (saveAs === 'material') {
            const name = (saveName || '').trim() || `ai-${Date.now()}.md`
            await call('PUT', `/library/${enc(book.id)}/unit/materials/${encodeURIComponent(name)}`, { text })
            setNote(`${t('aiSaved')} · materials/${name}`)
          } else {
            const made = await call('POST', `/library/${enc(book.id)}/drafts`, {
              chapter: chapter || 'ai',
              body: text,
              note: task,
            })
            setNote(`${t('aiSaved')} · ${made.id || ''}`)
          }
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setSaving(false)
        }
      }, [out, saveAs, saveName, book.id, chapter, task, writeBack, saveNewChapter])

      const banner = needs === 'chapter' && !chapters.length ? t('aiNoChapter') : null
      const readsText = preview
        ? [
            `${t('aiReadChars')} ${preview.characters.length}`,
            `${t('aiReadRules')} ${preview.rules}`,
            `${t('aiReadChapters')} ${preview.chapters}`,
            `${t('aiReadEdges')} ${preview.edges}`,
          ].join(' · ')
        : t('aiGrounding')

      return h('div', { className: 'ns-ai' },
        h('div', { className: 'ns-ai-note' }, t('aiHint')),
        h(ModelForm, { key: book.id, book }),
        h('div', { className: 'ns-ai-form' },
          h('label', null, t('aiTask'),
            h('select', {
              value: task,
              onChange: (e) => {
                const next = e.target.value
                setTask(next)
                setOut('')
                setNote('')
                setErr(null)
                // The two continuations differ in where their text belongs: one
                // lengthens the chapter on screen, the other starts another.
                if (next === 'continue-new') chooseSaveAs('newchapter')
                else if (next === 'continue') setSaveAs('chapter')
                else setSaveAs('material')
              },
            }, (tasks || []).map((x) => h('option', { key: x.key, value: x.key }, x.zh || x.key)))),
          needs === 'chapter' && chapters.length
            ? h('label', null, t('aiChapter'),
                h('select', { value: chapter, onChange: (e) => setChapter(e.target.value) },
                  chapters.map((c) => h('option', { key: c.id, value: c.id }, c.title || c.id))))
            : null,
          needs === 'input'
            ? h('label', { className: 'ns-ai-wide' }, t('aiIdea'),
                h('input', { value: idea, onChange: (e) => setIdea(e.target.value) }))
            : null,
          h('label', { className: 'ns-ai-wide' }, t('aiExtra'),
            h('input', { value: extra, onChange: (e) => setExtra(e.target.value) })),
          // A length for this round. Blank means "whatever the task defaults to";
          // anything else travels as `words` and is voiced in the prompt.
          h('label', { className: 'ns-ai-wide' }, t('aiWords'),
            h('input', {
              type: 'number',
              min: 1,
              max: 20000,
              placeholder: t('aiWordsHint'),
              value: words,
              onChange: (e) => setWords(e.target.value),
            })),
          needs === 'text'
            ? h('label', { className: 'ns-ai-wide' }, t('aiText'),
                h('textarea', { value: text, onChange: (e) => setText(e.target.value) }))
            : null,
          needs === 'paste'
            ? h('label', { className: 'ns-ai-wide' }, t('aiPaste'),
                h('textarea', { value: paste, onChange: (e) => setPaste(e.target.value) }))
            : null),
        itemTotal
          ? h('div', { className: 'ns-ai-pick' },
              h('div', { className: 'ns-ai-pick-head' },
                h('button', { className: 'ns-btn', onClick: () => setPickerOpen((v) => !v) }, pickerOpen ? t('aiPickClose') : t('aiPickOpen')),
                pick ? h('button', { className: 'ns-btn', onClick: () => setPick(null) }, t('aiPickReset')) : null,
                h('span', { className: 'ns-spacer' }),
                h('span', { className: 'ns-ai-note' }, `${t('aiPickCount')} ${pick ? pickedTotal : itemTotal}/${itemTotal}`)),
              pickerOpen
                ? h('div', { className: 'ns-ai-pools' },
                    h('div', { className: 'ns-ai-note' }, t('aiPickHint')),
                    catalog.map((pool) =>
                      h('div', { key: pool.key, className: 'ns-ai-pool' },
                        h('div', { className: 'ns-ai-pool-head' },
                          h('span', { className: 'ns-ai-pool-name' },
                            `${pool.zh} ${(pool.items || []).filter((i) => isOn(pool.key, i.id)).length}/${(pool.items || []).length}`),
                          h('span', { className: 'ns-spacer' }),
                          h('button', { className: 'ns-btn ns-ai-mini', onClick: () => setPool(pool.key, true) }, t('aiPickAll')),
                          h('button', { className: 'ns-btn ns-ai-mini', onClick: () => setPool(pool.key, false) }, t('aiPickNone'))),
                        h('div', { className: 'ns-ai-chips' },
                          (pool.items || []).map((it) =>
                            h('label', { key: it.id, className: 'ns-ai-chip', 'data-on': isOn(pool.key, it.id) ? '1' : '0' },
                              h('input', { type: 'checkbox', checked: isOn(pool.key, it.id), onChange: () => toggleItem(pool.key, it.id) }),
                              h('span', null, it.label || it.id)))))))
                : null)
          : null,
        thread.length || pendingRef.current
          ? h('div', { className: 'ns-ai-thread' },
              h('div', { className: 'ns-ai-thread-head' },
                h('span', { className: 'ns-ai-note' }, `${t('aiThread')} · ${thread.length + (pendingRef.current ? 1 : 0)}`),
                h('span', { className: 'ns-spacer' }),
                h('button', {
                  className: 'ns-btn ns-ai-mini',
                  disabled: running,
                  onClick: () => {
                    pendingRef.current = null
                    setThread([])
                  },
                }, t('aiThreadClear'))),
              h('div', { className: 'ns-ai-note' }, t('aiThreadHint')),
              thread.map((r, i) =>
                h('div', { key: i, className: 'ns-ai-turn' },
                  h('div', { className: 'ns-ai-turn-head' },
                    h('div', { className: 'ns-ai-turn-ask' }, r.ask),
                    h('span', { className: 'ns-spacer' }),
                    h(ZoomButton, { title: t('aiThread'), text: r.answer })),
                  h('div', { className: 'ns-ai-turn-answer' }, r.answer))))
          : null,
        h('div', { className: 'ns-ai-bar' },
          h('button', {
            className: 'ns-btn',
            'data-kind': 'primary',
            disabled: running || Boolean(banner) || (needs === 'chapter' && !chapter) || (needs === 'paste' && !paste.trim()),
            onClick: run,
          }, running ? t('aiRunning') : t('aiRun')),
          running ? h('button', { className: 'ns-btn', onClick: stop }, t('aiStop')) : null,
          h('span', { className: 'ns-spacer' }),
          h('span', { className: 'ns-ai-note' }, `${t('aiReads')}：${readsText}`)),
        banner ? h('div', { className: 'ns-ai-note' }, banner) : null,
        err ? h('div', { className: 'ns-ai-err' }, err) : null,
        // The answer is the author's to fix: it is a text box, not a printout,
        // so a wrong name or a clumsy line is repaired here — and every path
        // that leaves this pane (written back to a chapter, filed as material,
        // read for new entries) reads this same text.
        h('textarea', {
          className: 'ns-ai-out',
          'data-empty': out ? '0' : '1',
          'data-ai-out': '1',
          ref: outRef,
          value: out,
          readOnly: running,
          spellCheck: false,
          placeholder: running ? '' : t('aiNothing'),
          onChange: (e) => setOut(e.target.value),
        }),
        running
          ? h('div', { className: 'ns-ai-bar' },
              h('span', { className: 'ns-ai-caret' }),
              h('span', { className: 'ns-ai-note' }, t('aiRunning')))
          : out.trim()
            ? h('div', { className: 'ns-ai-bar' },
                h('span', { className: 'ns-ai-note' }, t('aiOutEdit')))
            : null,
        // The answer is generated text, so it gets the same enlarged read as
        // everything else — no copying it out to see the whole thing. Only once
        // the round has settled: a snapshot taken mid-stream would look like a
        // generation that stopped.
        out.trim() && !running
          ? h('div', { className: 'ns-ai-bar' },
              h(ZoomButton, { title: t('aiTab'), text: out }))
          : null,
        // The answer's own length, counted live and by the same definition the
        // chapter list uses, so "how long is this" needs no copying into a file.
        countLine(out) ? h('div', { className: 'ns-usage' }, countLine(out)) : null,
        tokenLine(usage) ? h('div', { className: 'ns-usage' }, tokenLine(usage)) : null,
        // What this book has spent altogether sits behind a toggle rather than
        // in the author's face every round: the line above is this round, this
        // panel is the whole book. Read afresh on opening, so rounds run in
        // another window are in it.
        total
          ? h('div', { className: 'ns-usage-panel' },
              h('div', { className: 'ns-usage-panel-head' },
                h('button', {
                  className: 'ns-btn ns-ai-mini',
                  'aria-expanded': usageOpen ? 'true' : 'false',
                  onClick: () => {
                    const next = !usageOpen
                    setUsageOpen(next)
                    if (next) refreshTotal()
                  },
                }, `${usageOpen ? '▾' : '▸'} ${t('aiUsageTotal')} Σ ${fmtN(total.total)}`),
                usageOpen
                  ? h('button', { className: 'ns-btn ns-ai-mini', onClick: resetTotal }, t('aiUsageReset'))
                  : null,
                h('span', { className: 'ns-spacer' }),
                h('span', { className: 'ns-ai-note' }, `${total.runs ?? 0} ${t('aiUsageRuns')}`)),
              usageOpen
                ? h('div', { className: 'ns-usage-detail' },
                    h('div', null, totalLine(total) || ''),
                    h('div', { className: 'ns-ai-note' },
                      [
                        stamp(total.since) ? `${t('aiUsageSince')} ${stamp(total.since)}` : null,
                        stamp(total.updatedAt) ? `${t('aiUsageUpdated')} ${stamp(total.updatedAt)}` : null,
                      ].filter(Boolean).join(' · ')),
                    h('div', { className: 'ns-ai-note' }, t('aiUsageHint')),
                    h('div', null,
                      h('button', { className: 'ns-btn ns-ai-mini', onClick: () => setUsageOpen(false) }, t('aiUsageClose'))))
                : null)
          : null,
        h('div', { className: 'ns-ai-bar' },
          out.trim() && chapter && (task === 'continue' || task === 'polish')
            ? h(React.Fragment, null,
                h('button', { className: 'ns-btn', 'data-kind': 'primary', onClick: () => writeBack('append') }, t('aiInsert')),
                h('button', { className: 'ns-btn', onClick: () => writeBack('replace') }, t('aiReplace')))
            : null,
          // The switch sits next to the write-back buttons because that is what
          // it follows: writing the text in is what triggers reading it back.
          out.trim()
            ? h('label', { className: 'ns-ai-check', title: t('aiExtractHint') },
                h('input', { type: 'checkbox', checked: extractOn, onChange: (e) => setExtractOn(e.target.checked) }),
                h('span', null, t('aiExtract')))
            : null,
          out.trim()
            ? h('button', {
                className: 'ns-btn ns-ai-mini',
                disabled: finding,
                title: t('aiExtractHint'),
                onClick: () => recognize(out),
              }, finding ? t('aiExtractDoing') : t('aiExtractNow'))
            : null,
          note ? h('span', { className: 'ns-ai-note' }, note) : null),
        h('div', { className: 'ns-ai-save' },
          h('span', { className: 'ns-label' }, t('aiSaveAs')),
          h('select', {
            className: 'ns-select',
            style: { width: 'auto' },
            value: saveAs,
            onChange: (e) => chooseSaveAs(e.target.value),
          },
            h('option', { value: 'material' }, t('aiSaveMaterial')),
            h('option', { value: 'draft' }, t('aiSaveDraft')),
            h('option', { value: 'newchapter' }, t('aiSaveNewChapter')),
            h('option', { value: 'chapter' }, t('aiSaveChapter')),
            h('option', { value: 'replace' }, t('aiReplace'))),
          saveAs === 'material' || saveAs === 'newchapter'
            ? h('input', {
                className: 'ns-input',
                style: { width: 180 },
                placeholder: saveAs === 'newchapter' ? t('aiSaveChapterName') : t('aiSaveFileName'),
                value: saveName,
                onChange: (e) => setSaveName(e.target.value),
              })
            : null,
          h('button', {
            className: 'ns-btn',
            disabled: !out.trim() || saving,
            onClick: saveAsResult,
          }, saving ? t('saving') : t('aiSaveDo')),
          h('span', { className: 'ns-ai-note' }, t('aiSaveHint'))),
        foundNote ? h('div', { className: 'ns-ai-note' }, foundNote) : null,
        found
          ? h(ExtractBox, {
              book,
              plan: found,
              onClose: () => {
                setFound(null)
                setFoundNote('')
              },
              onFiled: (report) => {
                const n = (report.written || []).length + (report.updated || []).length
                setFoundNote(`${t('aiExtractDone')} ${n} ${t('aiExtractCount')}`)
              },
            })
          : null)
    }

    /**
     * The chapter list in front of a recognition run: the author picks which
     * chapters to read, each one gets its own call, and the plans come back
     * merged into the review list. Nothing is read until the boxes are ticked,
     * so a long book is never swept in one pass.
     */
    /**
     * This book's own model route, settable wherever a round is about to be
     * spent.
     *
     * The AI tab and the reading drawer render this same form, so a route
     * picked in either place is the route this book uses everywhere — and it
     * stays this book's own choice, never the harness-wide selection.
     */
    function ModelForm({ book }) {
      const [own, setOwn] = useState(null)
      const [inherit, setInherit] = useState(null)
      const [catalog, setCatalog] = useState([])
      const [open, setOpen] = useState(false)
      const [pick, setPick] = useState({ provider: '', model: '', reasoningEffort: '' })
      // The thinking levels this deployment supports for the picked model, as
      // `{ key, list, def }` — keyed by the route it describes, so an answer for
      // another model is never shown against the current pick.
      const [efforts, setEfforts] = useState(null)
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)

      useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const data = await call('GET', `/library/${enc(book.id)}/model`)
            if (!alive) return
            const providers = (data.catalog && data.catalog.providers) || []
            const mine = data.model || null
            const fallback = data.fallback || null
            setOwn(mine)
            setInherit(fallback)
            setCatalog(providers)
            const provider = (mine && mine.provider) || (fallback && fallback.provider) || (providers[0] && providers[0].id) || ''
            const entry = providers.find((p) => p.id === provider)
            setPick({
              provider,
              model: (mine && mine.model) || (fallback && fallback.model) || (entry && entry.models[0] && entry.models[0].id) || '',
              // Only the book's own choice is echoed back. An effort inherited
              // from the deployment default is not this book's to keep, and
              // prefilling it would silently pin it on the next save.
              reasoningEffort: (mine && mine.reasoningEffort) || '',
            })
          } catch {
            /* an older host without this route still runs on the default */
          }
        })()
        return () => {
          alive = false
        }
      }, [book.id])

      // The menu follows the *picker*, not the saved route, so switching
      // provider in the form immediately shows what that model can do.
      useEffect(() => {
        const provider = pick.provider
        const name = pick.model
        if (!open || !provider || !name) return undefined
        let alive = true
        ;(async () => {
          const key = `${provider}/${name}`
          try {
            const data = await call(
              'GET',
              `/library/${enc(book.id)}/efforts?provider=${enc(provider)}&model=${enc(name)}`,
            )
            if (alive) setEfforts({ key, list: data.efforts || [], def: data.defaultEffort || '' })
          } catch {
            if (alive) setEfforts({ key, list: [], def: '' })
          }
        })()
        return () => {
          alive = false
        }
      }, [open, pick.provider, pick.model, book.id])

      const menu = efforts && efforts.key === `${pick.provider}/${pick.model}` ? efforts : null
      const tag = (route) =>
        route && route.reasoningEffort ? ` · ${t('aiEffort')} ${route.reasoningEffort}` : ''

      // Saving the book's own route; clearing hands the book back to the
      // deployment default. Either way only this book is written.
      const save = async (next) => {
        if (busy) return
        setBusy(true)
        setNote('')
        try {
          const data = await call(
            'POST',
            `/library/${enc(book.id)}/model`,
            next
              ? {
                  provider: next.provider,
                  model: next.model,
                  // Absent means "the model's own default" — which is also how
                  // a saved effort is cleared again.
                  ...(next.reasoningEffort ? { reasoningEffort: next.reasoningEffort } : {}),
                }
              : { clear: true },
          )
          setOwn(data.model || null)
          if (data.fallback !== undefined) setInherit(data.fallback || null)
          setNote(next ? t('aiModelSaved') : t('aiModelCleared'))
        } catch (e) {
          setNote(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      return h('div', null,
        h('div', { className: 'ns-ai-bar' },
          h('span', { className: 'ns-ai-note' }, `${t('aiModel')}：`),
          h('span', { className: 'ns-ai-model' },
            own
              ? `${own.provider} · ${own.model}${tag(own)}`
              : inherit
                ? `${inherit.provider} · ${inherit.model}（${t('aiModelInherit')}）${tag(inherit)}`
                : t('aiModelUnset')),
          h('span', { className: 'ns-spacer' }),
          h('button', { className: 'ns-btn ns-ai-mini', onClick: () => setOpen((v) => !v) },
            open ? t('aiPickClose') : t('aiModelSet')),
          own ? h('button', { className: 'ns-btn ns-ai-mini', onClick: () => save(null) }, t('aiModelClear')) : null),
        open
          ? h('div', { className: 'ns-ai-form' },
              h('div', { className: 'ns-ai-wide ns-ai-note' }, t('aiModelHint')),
              catalog.length
                ? h(React.Fragment, null,
                    h('label', null, t('aiModelProvider'),
                      h('select', {
                        value: pick.provider,
                        onChange: (e) => {
                          const provider = e.target.value
                          const entry = catalog.find((p) => p.id === provider)
                          // A different model is a different effort menu, so the
                          // level starts over rather than carrying across.
                          setPick({
                            provider,
                            model: (entry && entry.models[0] && entry.models[0].id) || '',
                            reasoningEffort: '',
                          })
                        },
                      }, catalog.map((p) => h('option', { key: p.id, value: p.id }, p.name || p.id)))),
                    h('label', null, t('aiModelName'),
                      h('select', {
                        value: pick.model,
                        onChange: (e) => setPick((v) => ({ ...v, model: e.target.value, reasoningEffort: '' })),
                      }, (((catalog.find((p) => p.id === pick.provider) || {}).models) || [])
                        .map((m) => h('option', { key: m.id, value: m.id }, m.name || m.id)))),
                    menu && menu.list.length
                      ? h('label', null, t('aiEffort'),
                          h('select', {
                            value: pick.reasoningEffort,
                            onChange: (e) => setPick((v) => ({ ...v, reasoningEffort: e.target.value })),
                          }, [h('option', { key: '__inherit', value: '' }, t('aiEffortInherit'))].concat(
                            menu.list.map((x) =>
                              h('option', { key: x.id, value: x.id, title: x.description || '' }, x.name || x.id)))))
                      : null,
                    menu && menu.list.length
                      ? h('div', { className: 'ns-ai-wide ns-ai-note' },
                          t('aiEffortHint').replace('{def}', menu.def || t('aiEffortInherit')))
                      : menu
                        ? h('div', { className: 'ns-ai-wide ns-ai-note' }, t('aiEffortNone'))
                        : null,
                    h('button', {
                      className: 'ns-btn',
                      'data-kind': 'primary',
                      disabled: busy || !pick.provider || !pick.model,
                      onClick: () => save(pick),
                    }, t('save')))
                : h('div', { className: 'ns-ai-wide ns-ai-note' }, t('aiModelEmpty')))
          : null,
        note ? h('div', { className: 'ns-ai-note' }, note) : null)
    }

    function ExtractPicker({ book, chapters, currentId, currentText, onClose, onPlanned }) {
      const list = chapters || []
      const [keep, setKeep] = useState(() => (currentId && list.some((c) => c.id === currentId) ? [currentId] : []))
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)

      const chosen = list.filter((c) => keep.includes(c.id))
      const toggle = (id) => setKeep((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id)))

      // The chapter on screen is read as it stands — unsaved edits included —
      // and only the others are fetched from the book on disk.
      const readOne = useCallback(
        async (one) => {
          if (one.id === currentId && String(currentText || '').trim()) return String(currentText)
          const got = await call('GET', `/library/${enc(book.id)}/unit/chapters/${enc(one.id)}`)
          return String((got && got.data && got.data.body) || '')
        },
        [book.id, currentId, currentText],
      )

      const run = useCallback(
        async () => {
          const picked = list.filter((c) => keep.includes(c.id))
          if (!picked.length || busy) return
          setBusy(true)
          setErr(null)
          try {
            const passages = []
            for (const one of picked) passages.push({ id: one.id, passage: await readOne(one) })
            const got = await call('POST', `/library/${enc(book.id)}/extract`, { chapters: passages })
            const plan = got.plan || null
            if (!plan || !(plan.entries || []).length) {
              setErr(t('aiExtractEmpty'))
              return
            }
            onPlanned(plan)
          } catch (e) {
            setErr(`${t('aiExtractFailed')}${String((e && e.message) || e)}`)
          } finally {
            setBusy(false)
          }
        },
        [book.id, busy, keep, list, onPlanned, readOne],
      )

      return h(React.Fragment, null,
        h('div', { className: 'ns-dossier-scrim', onClick: busy ? undefined : onClose }),
        h('div', { className: 'ns-dossier' },
          h('div', { className: 'ns-dossier-head' },
            h('strong', null, t('chaptersExtract')),
            h('span', { className: 'ns-spacer' }),
            h('span', { className: 'ns-muted' }, `${chosen.length}/${list.length}`),
            h('button', { className: 'ns-btn', disabled: busy, onClick: onClose }, t('dossierClose'))),
          h('div', { className: 'ns-hint' }, t('chaptersExtractHint')),
          // The round about to be spent is this book's own route; it can be
          // set here rather than remembered from the AI tab.
          h(ModelForm, { key: book.id, book }),
          err ? h('div', { className: 'ns-err' }, err) : null,
          h('div', { className: 'ns-actions' },
            h('button', { className: 'ns-btn ns-ai-mini', disabled: busy, onClick: () => setKeep(list.map((c) => c.id)) }, t('aiExtractAll')),
            h('button', { className: 'ns-btn ns-ai-mini', disabled: busy, onClick: () => setKeep([]) }, t('aiExtractNone'))),
          list.length
            ? h('div', { className: 'ns-notes' },
                list.map((one) =>
                  h('label', { key: one.id, className: 'ns-note' },
                    h('input', {
                      type: 'checkbox',
                      checked: keep.includes(one.id),
                      disabled: busy,
                      onChange: () => toggle(one.id),
                    }),
                    h('div', { className: 'ns-note-body' },
                      h('div', { className: 'ns-note-head' },
                        h('strong', null, one.title || one.id),
                        one.id === currentId ? h('span', { className: 'ns-pill' }, t('body')) : null)))))
            : h('div', { className: 'ns-empty' }, t('noEntries')),
          h('div', { className: 'ns-ai-bar' },
            busy
              ? h('span', { className: 'ns-muted' }, `${t('chaptersExtractDoing')} ${chosen.length} ${t('chaptersExtractUnit')}…`)
              : null,
            h('button', {
              className: 'ns-btn',
              'data-kind': 'primary',
              disabled: busy || !chosen.length,
              onClick: run,
            }, busy ? `${t('chaptersExtractDoing')}…` : `${t('chaptersExtractDo')} (${chosen.length})`))))
    }

    /**
     * The review drawer for one recognition plan: every entry the model found in
     * the passage, checked by default, listed under the region it would land in.
     * Nothing has been written while it is open — this is where a row is dropped
     * before it becomes a record, and a plan already filed turns into a report.
     */
    function ExtractBox({ book, plan, onClose, onFiled }) {
      const entries = (plan && plan.entries) || []
      const [keep, setKeep] = useState(() => entries.map((_, i) => i))
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const [report, setReport] = useState(null)

      const chosen = keep.map((i) => entries[i]).filter(Boolean)

      const toggle = (index) =>
        setKeep((cur) => (cur.includes(index) ? cur.filter((x) => x !== index) : cur.concat(index)))

      const apply = useCallback(async () => {
        const rows = keep.map((i) => entries[i]).filter(Boolean)
        if (!rows.length) return
        setBusy(true)
        setErr(null)
        try {
          // Only the identity of a row is sent back; the host re-checks every
          // field against the schema, so a tampered body cannot invent one.
          const got = await call('POST', `/library/${enc(book.id)}/extract/apply`, {
            entries: rows.map((e) => ({ key: e.key, name: e.name, fields: e.fields })),
          })
          setReport(got)
          if (typeof onFiled === 'function') onFiled(got)
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }, [book.id, entries, keep, onFiled])

      const show = (value) => (Array.isArray(value) ? value.join('、') : String(value ?? ''))

      function reportRows(rep) {
        const rows = []
        const add = (label, list) => {
          if (!list || !list.length) return
          rows.push(
            h('div', { key: label, className: 'ns-report-row' },
              h('span', { className: 'ns-pill' }, label),
              h('span', { className: 'ns-muted' }, list.map((x) => x.name || x.key || '?').join('、'))),
          )
        }
        add(t('aiExtractReport'), rep.written)
        add(t('aiExtractUpdated'), rep.updated)
        add(t('aiExtractSkipped'), rep.skipped)
        return h(React.Fragment, null,
          h('div', { className: 'ns-hint' }, `${t('aiExtractDone')} ${(rep.written || []).length + (rep.updated || []).length} ${t('aiExtractCount')}`),
          rows)
      }

      // Rows keep the model's order inside each region, so the list reads the
      // way the passage did.
      const groups = []
      entries.forEach((entry, index) => {
        let group = groups.find((g) => g.key === entry.key)
        if (!group) {
          group = { key: entry.key, zh: entry.zh, rows: [] }
          groups.push(group)
        }
        group.rows.push({ entry, index })
      })

      return h(React.Fragment, null,
        h('div', { className: 'ns-dossier-scrim', onClick: busy ? undefined : onClose }),
        h('div', { className: 'ns-dossier' },
          h('div', { className: 'ns-dossier-head' },
            h('strong', null, t('aiExtractTitle')),
            h('span', { className: 'ns-spacer' }),
            h('span', { className: 'ns-muted' }, `${chosen.length}/${entries.length}`),
            h('button', { className: 'ns-btn', disabled: busy, onClick: onClose }, t('dossierClose'))),
          h('div', { className: 'ns-hint' }, t('aiExtractIntro')),
          plan && (plan.skipped || []).length
            ? h(
                'div',
                { className: 'ns-hint', style: { color: 'var(--dsw-alias-state-warn-primary,#d97706)' } },
                t('aiExtractMissed').replace('{n}', String(plan.skipped.length)),
              )
            : null,
          err ? h('div', { className: 'ns-err' }, err) : null,
          report
            ? h('div', { className: 'ns-report' }, reportRows(report))
            : h(React.Fragment, null,
                h('div', { className: 'ns-actions' },
                  h('button', { className: 'ns-btn ns-ai-mini', onClick: () => setKeep(entries.map((_, i) => i)) }, t('aiExtractAll')),
                  h('button', { className: 'ns-btn ns-ai-mini', onClick: () => setKeep([]) }, t('aiExtractNone'))),
                entries.length
                  ? h('div', { className: 'ns-notes' },
                      groups.map((group) =>
                        h('div', { key: group.key, className: 'ns-extract-group' },
                          h('div', { className: 'ns-hint' }, group.zh || group.key),
                          group.rows.map(({ entry, index }) =>
                            h('label', { key: index, className: 'ns-note' },
                              h('input', { type: 'checkbox', checked: keep.includes(index), onChange: () => toggle(index) }),
                              h('div', { className: 'ns-note-body' },
                                h('div', { className: 'ns-note-head' },
                                  h('strong', null, entry.name),
                                  entry.from && entry.from.length
                                    ? h('span', { className: 'ns-pill ns-pill-src', title: entry.from.join('、') }, entry.from.join('、'))
                                    : null,
                                  h('span', { className: 'ns-pill', 'data-exists': entry.exists ? '1' : '0' },
                                    entry.exists ? t('aiExtractMerge') : t('aiExtractNew'))),
                                h('div', { className: 'ns-muted' },
                                  Object.keys(entry.fields)
                                    .map((k) => `${(entry.fieldLabels || {})[k] || k}：${show(entry.fields[k])}`)
                                    .join(' · ')),
                                entry.reason ? h('div', { className: 'ns-muted' }, entry.reason) : null))))))
                  : h('div', { className: 'ns-empty' }, t('aiExtractEmpty'))),
          h('div', { className: 'ns-ai-bar' },
            report
              ? h('button', { className: 'ns-btn', 'data-kind': 'primary', onClick: onClose }, t('dossierClose'))
              : h('button', {
                  className: 'ns-btn',
                  'data-kind': 'primary',
                  disabled: busy || !chosen.length,
                  onClick: apply,
                }, busy ? t('aiExtractApplying') : `${t('aiExtractApply')} (${chosen.length})`))))
    }

    function ExportPane({ book }) {
      const [formats, setFormats] = useState(null)
      const [format, setFormat] = useState('md')
      const [preview, setPreview] = useState(null)
      const [artifacts, setArtifacts] = useState([])
      const [err, setErr] = useState(null)
      const [busy, setBusy] = useState('')

      const loadArtifacts = useCallback(async () => {
        try {
          const data = await call('GET', `/library/${enc(book.id)}/publish`)
          setArtifacts(data.artifacts || [])
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }, [book.id])

      const render = useCallback(async (key) => {
        setFormat(key)
        setBusy('render')
        try {
          setPreview(await call('GET', `/library/${enc(book.id)}/export?format=${encodeURIComponent(key)}`))
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy('')
        }
      }, [book.id])

      useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const list = await call('GET', `/library/${enc(book.id)}/export/formats`)
            if (!alive) return
            setFormats(list.formats || [])
            void render(list.formats?.[0]?.key || 'md')
          } catch (e) {
            if (alive) setErr(String((e && e.message) || e))
          }
        })()
        void loadArtifacts()
        return () => { alive = false }
      }, [book.id, loadArtifacts, render])

      const publish = useCallback(async () => {
        setBusy('publish')
        try {
          await call('POST', `/library/${enc(book.id)}/publish`, { format })
          await loadArtifacts()
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy('')
        }
      }, [book.id, format, loadArtifacts])

      const drop = useCallback(async (name) => {
        if (!window.confirm(t('confirmRemove'))) return
        setBusy('delete')
        try {
          await call('DELETE', `/library/${enc(book.id)}/publish/${encodeURIComponent(name)}`)
          await loadArtifacts()
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy('')
        }
      }, [book.id, loadArtifacts])

      // The rendered text is already in hand, so a download needs no second request.
      const download = useCallback(() => {
        if (!preview) return
        const blob = new Blob([preview.text || ''], { type: preview.mime || 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = preview.filename || `${book.id}.txt`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, [preview, book.id])

      if (!formats) {
        return h('div', { className: 'ns-pane' },
          err ? h('div', { className: 'ns-err' }, err) : h('div', { className: 'ns-empty' }, t('loading')))
      }

      return h('div', { className: 'ns-pane' },
        h('div', { className: 'ns-chips' }, formats.map((f) =>
          h('button', {
            key: f.key,
            className: 'ns-chip',
            'data-on': format === f.key ? '1' : '0',
            disabled: !!busy,
            title: f.mime,
            onClick: () => render(f.key),
          }, f.zh || f.key))),
        h('div', { className: 'ns-actions', style: { marginTop: 10 } },
          h('button', { className: 'ns-btn', 'data-kind': 'primary', disabled: !!busy, onClick: publish },
            busy === 'publish' ? t('generating') : t('publish')),
          h('button', { className: 'ns-btn', disabled: !preview, onClick: download }, t('download')),
          preview && String(preview.text || '').trim()
            ? h(ZoomButton, { title: preview.filename, text: preview.text })
            : null,
          h('span', { className: 'ns-muted' }, preview
            ? `${preview.filename} · ${preview.bytes ?? 0} ${t('bytes')} · ${preview.chapters ?? 0} ${t('chapterCount')} · ${preview.words ?? 0} ${t('words')}`
            : '')),
        h('p', { className: 'ns-hint', style: { marginTop: 8 } }, t('publishHint')),
        err ? h('div', { className: 'ns-err', style: { margin: '8px 0' } }, err) : null,
        h('div', { className: 'ns-section-title' }, t('preview')),
        preview
          ? h('pre', { className: 'ns-preview' }, String(preview.text || '').slice(0, 4000))
          : h('div', { className: 'ns-empty' }, t('loading')),
        h('div', { className: 'ns-section-title' }, t('published')),
        artifacts.length
          ? h('div', { className: 'ns-artifacts' }, artifacts.map((a) =>
              h('div', { key: a.file, className: 'ns-artifact' },
                h('code', null, a.file),
                h('span', { className: 'ns-muted' }, a.untracked
                  ? t('untracked')
                  : `${a.words ?? 0} ${t('words')} · ${a.bytes ?? 0} ${t('bytes')}`),
                h('button', { className: 'ns-btn', 'data-kind': 'danger', disabled: !!busy, onClick: () => drop(a.file) }, t('remove')))))
          : h('div', { className: 'ns-empty' }, t('noArtifacts')),
        h('div', { style: { marginTop: 16 } }, h(Websites, null)))
    }

    // ── root ──────────────────────────────────────────────────────────────

    /**
     * Draft box: snapshots taken from the chapter editor. A restore is always
     * preceded by an automatic snapshot, so restoring is itself undoable.
     */
    function DraftBox({ book, chapter, onClose, onRestored }) {
      const [list, setList] = useState(null)
      const [err, setErr] = useState(null)
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        try {
          const data = await call('GET', `/library/${enc(book.id)}/drafts`)
          setList(data.drafts || [])
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }, [book.id])

      useEffect(() => { void load() }, [load])

      const restore = useCallback(async (name, force) => {
        setBusy(true)
        setNote('')
        try {
          const got = await call('POST', `/library/${enc(book.id)}/drafts/restore`, { name, force })
          if (got.changed === false) {
            setNote(t('draftSame'))
          } else if (got.conflict) {
            if (!force) {
              const yes = window.confirm(`${t('draftConflict')}${got.message ? `\n\n${got.message}` : ''}`)
              setBusy(false)
              if (yes) return await restore(name, true)
              setNote(got.message || '')
              return
            }
            setNote(got.message || '')
          } else {
            setNote(t('draftRestored'))
            await onRestored()
          }
        } catch (e) {
          setNote(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }, [book.id, onRestored])

      const drop = useCallback(async (name) => {
        if (!window.confirm(t('draftDeleteConfirm'))) return
        setBusy(true)
        try {
          await call('DELETE', `/library/${enc(book.id)}/drafts/${encodeURIComponent(name)}`)
          await load()
        } catch (e) {
          setNote(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }, [book.id, load])

      const mine = (list || []).filter((d) => !chapter || d.chapter === chapter)

      return h(React.Fragment, null,
        h('div', { className: 'ns-dossier-scrim', onClick: onClose }),
        h('aside', { className: 'ns-dossier' },
          h('div', { className: 'ns-dossier-head' },
            h('b', null, chapter ? `${t('draftTitle')} · ${chapter}` : t('draftTitle')),
            h('span', { className: 'ns-spacer' }),
            h('span', { className: 'ns-muted', style: { fontSize: 12 } }, `${mine.length}`),
            h('button', { className: 'ns-btn', onClick: onClose }, t('searchClose'))),
          h('div', { className: 'ns-hint' }, t('draftEmpty')),
          note ? h('div', { className: 'ns-muted' }, note) : null,
          err ? h('div', { className: 'ns-err' }, err) : null,
          !list
            ? h('div', { className: 'ns-empty' }, t('loading'))
            : !mine.length
              ? h('div', { className: 'ns-empty' }, t('draftEmpty'))
              : h('div', { className: 'ns-drafts' }, mine.map((d) =>
                  h('div', { key: d.id, className: 'ns-draft' },
                    h('span', { className: 'ns-draft-when' }, d.id),
                    d.note ? h('span', { className: 'ns-muted', style: { fontSize: 12 } }, d.note) : null,
                    h('span', { className: 'ns-spacer' }),
                    h('span', { className: 'ns-muted', style: { fontSize: 12 } }, `${d.words ?? 0}`),
                    h('button', { className: 'ns-btn ns-move', disabled: busy, onClick: () => restore(d.id, false) }, t('draftRestore')),
                    h('button', { className: 'ns-btn ns-move', 'data-kind': 'danger', disabled: busy, onClick: () => drop(d.id) }, t('remove')))))))
    }

    /**
     * Whole-book search. Every hit names where it came from, so the panel can
     * jump straight to that entry — the one thing a per-pane filter cannot do.
     */
    function SearchPane({ book, sections, onOpen }) {
      const [q, setQ] = useState('')
      const [section, setSection] = useState('')
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)

      const run = useCallback(async () => {
        const query = q.trim()
        if (!query) {
          setData(null)
          return
        }
        setBusy(true)
        try {
          const params = new URLSearchParams({ q: query })
          if (section) params.set('section', section)
          setData(await call('GET', `/library/${enc(book.id)}/search?${params.toString()}`))
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }, [book.id, q, section])

      const terms = (data && data.terms) || []
      const lower = new Set(terms.map((x) => String(x).toLowerCase()))
      const labelOf = useCallback((key) => {
        const hit = sections.find((s) => s.key === key)
        return (hit && hit.zh) || key
      }, [sections])

      function marked(text) {
        const s = String(text ?? '')
        if (!terms.length) return s
        const re = new RegExp(`(${terms.map((x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
        return s.split(re).map((part, i) => (lower.has(part.toLowerCase()) ? h('mark', { key: i }, part) : part))
      }

      return h('div', { className: 'ns-pane' },
        h('div', { className: 'ns-searchbar' },
          h('input', {
            className: 'ns-input',
            placeholder: t('searchPlaceholder'),
            value: q,
            onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') void run() },
          }),
          h('select', {
            className: 'ns-select',
            style: { width: 'auto' },
            value: section,
            onChange: (e) => setSection(e.target.value),
          },
            h('option', { value: '' }, t('searchAll')),
            sections.map((s) => h('option', { key: s.key, value: s.key }, s.zh || s.key))),
          h('button', { className: 'ns-btn', 'data-kind': 'primary', disabled: busy, onClick: run },
            busy ? t('loading') : t('searchRun'))),
        h('div', { className: 'ns-hint' }, t('searchHint')),
        err ? h('div', { className: 'ns-err' }, err) : null,
        !data
          ? h('div', { className: 'ns-empty' }, t('searchEmpty'))
          : h(React.Fragment, null,
              h('div', { className: 'ns-search-where' },
                h('span', null, `${t('searchScanned')} ${data.scanned?.units ?? 0} ${t('searchUnit')} · ${data.scanned?.entries ?? 0} ${t('searchEntries')}`),
                h('span', { className: 'ns-spacer' }),
                h('span', null, `${data.total ?? 0}`),
                data.truncated ? h('span', { className: 'ns-pill' }, t('searchTruncated')) : null),
              !(data.hits || []).length
                ? h('div', { className: 'ns-empty' }, t('searchEmpty'))
                : h('div', { className: 'ns-search-hits' }, (data.hits || []).map((hit, i) =>
                    h('div', {
                      key: `${hit.section}:${hit.id}:${hit.field}:${i}`,
                      className: 'ns-search-hit',
                      onClick: () => onOpen(hit.section, hit.id),
                    },
                      h('div', { className: 'ns-search-where' },
                        h('span', { className: 'ns-pill' }, labelOf(hit.section)),
                        h('span', null, hit.title || hit.id),
                        hit.field ? h('span', { className: 'ns-muted' }, hit.field) : null,
                        hit.line ? h('span', { className: 'ns-muted' }, t('searchLine').replace('{n}', String(hit.line))) : null),
                      h('div', { className: 'ns-search-snippet' }, marked(hit.snippet)))))))
    }

    /** Writing progress: goal, totals, 30 days of tracked output, pace. */
    function ProgressPane({ book, onChanged }) {
      const [st, setSt] = useState(null)
      const [err, setErr] = useState(null)
      const [note, setNote] = useState('')
      const [words, setWords] = useState('')
      const [deadline, setDeadline] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        try {
          const data = await call('GET', `/library/${enc(book.id)}/progress`)
          setSt(data)
          setWords(data.goal?.words ? String(data.goal.words) : '')
          setDeadline(data.goal?.deadline || '')
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }, [book.id])

      useEffect(() => { void load() }, [load])

      const save = useCallback(async (patch) => {
        setBusy(true)
        setNote('')
        try {
          const data = await call('POST', `/library/${enc(book.id)}/progress`, patch)
          setSt(data)
          setNote(t('saved'))
          await onChanged()
        } catch (e) {
          setNote(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }, [book.id, onChanged])

      if (err) return h('div', { className: 'ns-err' }, err)
      if (!st) return h('div', { className: 'ns-empty' }, t('loading'))

      const history = st.history || []
      const top = Math.max(1, ...history.map((d) => Math.abs(d.words || 0)))
      const stat = (n, k) => h('div', { className: 'ns-stat' },
        h('span', { className: 'ns-stat-n' }, n),
        h('span', { className: 'ns-stat-k' }, k))

      return h('div', { className: 'ns-pane' },
        h('div', { className: 'ns-stats' },
          stat(st.done ?? 0, t('progressDone')),
          stat(st.goal?.words ? st.remaining : '—', t('progressRemaining')),
          stat(`${st.percent ?? 0}%`, t('progressPercent')),
          stat(st.today ?? 0, t('progressToday')),
          stat(st.week ?? 0, t('progressWeek')),
          stat(`${st.streak ?? 0} ${t('progressDays')}`, t('progressStreak')),
          stat(st.average?.day7 ?? 0, t('progressAvg')),
          stat(st.chapters?.count ?? 0, t('searchFields'))),
        h('div', { className: 'ns-hint', style: { marginTop: 10 } }, t('progressHistory')),
        h('div', { className: 'ns-spark' }, history.map((d) =>
          h('div', {
            key: d.date,
            className: 'ns-spark-bar',
            'data-zero': (d.words || 0) <= 0 ? '1' : '0',
            title: `${d.date} · ${d.words}`,
            style: { height: `${Math.max((Math.abs(d.words || 0) / top) * 100, 3)}%` },
          }))),
        h('div', { className: 'ns-field', style: { marginTop: 14 } },
          h('span', { className: 'ns-label' }, t('progressTitle')),
          st.goal?.words
            ? h('div', { className: 'ns-report' },
                h('div', { className: 'ns-bar' }, h('div', { className: 'ns-bar-fill', style: { width: `${Math.min(st.percent || 0, 100)}%` } })),
                h('div', { className: 'ns-report-row' },
                  h('span', null, `${t('progressPerDay')} ${st.pace?.perDayNeeded ?? '—'}`),
                  h('span', null, `${t('progressPace')} ${st.pace?.daysLeft != null ? `${st.pace.daysLeft} ${t('progressDays')}` : '—'}`),
                  st.pace?.projectedFinish ? h('span', null, st.pace.projectedFinish) : null))
            : h('div', { className: 'ns-muted' }, t('progressNoGoal'))),
        h('div', { className: 'ns-mini-form' },
          h('span', { className: 'ns-label' }, t('progressGoal')),
          h('input', {
            className: 'ns-input',
            type: 'number',
            min: '0',
            value: words,
            onChange: (e) => setWords(e.target.value),
          }),
          h('span', { className: 'ns-label' }, t('progressDeadline')),
          h('input', {
            className: 'ns-input',
            type: 'date',
            value: deadline,
            onChange: (e) => setDeadline(e.target.value),
          })),
        h('div', { className: 'ns-actions', style: { marginTop: 10 } },
          h('button', {
            className: 'ns-btn',
            'data-kind': 'primary',
            disabled: busy,
            onClick: () => save({ words: Number(words) || 0, deadline: deadline || '' }),
          }, t('progressGoalSave')),
          h('button', {
            className: 'ns-btn',
            disabled: busy,
            onClick: () => { setWords(''); setDeadline(''); void save({ words: 0, deadline: '' }) },
          }, t('progressGoalClear')),
          note ? h('span', { className: 'ns-muted' }, note) : null),
        !(st.chapters?.count)
          ? h('div', { className: 'ns-empty' }, t('progressEmpty'))
          : h('div', { className: 'ns-notes', style: { marginTop: 8 } },
              st.tracked?.since ? h('span', null, `${t('progressTracked')} ${st.tracked.since}`) : null,
              st.chapters?.longest ? h('span', null, `${t('progressLongest')} ${st.chapters.longest}`) : null,
              st.chapters?.average ? h('span', null, `${t('searchFields')} ${st.chapters.average}`) : null))
    }

    /** Per-book settings. Only this book's settings.yaml is written. */
    function SettingsPane({ book, settings, onChange }) {
      const [st, setSt] = useState(settings || null)
      const [err, setErr] = useState(null)
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)

      useEffect(() => {
        let alive = true
        if (settings) return undefined
        ;(async () => {
          try {
            const data = await call('GET', `/library/${enc(book.id)}/settings`)
            if (alive) setSt(data.settings || {})
          } catch (e) {
            if (alive) setErr(String((e && e.message) || e))
          }
        })()
        return () => { alive = false }
      }, [book.id, settings])

      const put = useCallback(async (patch) => {
        setBusy(true)
        setNote('')
        try {
          const data = await call('POST', `/library/${enc(book.id)}/settings`, patch)
          setSt(data.settings || {})
          onChange(data.settings || {})
          setNote(t('saved'))
        } catch (e) {
          setNote(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }, [book.id, onChange])

      if (err) return h('div', { className: 'ns-err' }, err)
      if (!st) return h('div', { className: 'ns-empty' }, t('loading'))
      const cur = st

      return h('div', { className: 'ns-pane' },
        h('div', { className: 'ns-hint' }, t('settingsScope')),
        h('div', { className: 'ns-set-row' },
          h('span', { className: 'ns-label' }, t('settingsTheme')),
          h('select', {
            className: 'ns-select',
            value: cur.theme || 'default',
            disabled: busy,
            onChange: (e) => put({ theme: e.target.value }),
          },
            h('option', { value: 'default' }, t('settingsThemeDefault')),
            h('option', { value: 'sepia' }, t('settingsThemeSepia')),
            h('option', { value: 'dark' }, t('settingsThemeDark')))),
        h('div', { className: 'ns-set-row', style: { marginTop: 10 } },
          h('span', { className: 'ns-label' }, t('settingsFontSize')),
          h('input', {
            className: 'ns-input',
            type: 'number',
            min: '11',
            max: '24',
            value: cur.fontSize ?? 15,
            disabled: busy,
            onChange: (e) => setSt({ ...cur, fontSize: Number(e.target.value) }),
            onBlur: (e) => put({ fontSize: Number(e.target.value) }),
          })),
        h('div', { className: 'ns-set-row', style: { marginTop: 10 } },
          h('span', { className: 'ns-label' }, t('settingsAutosave')),
          h('label', null,
            h('input', {
              type: 'checkbox',
              checked: cur.autosave !== false,
              disabled: busy,
              onChange: (e) => put({ autosave: e.target.checked }),
            }),
            ' ',
            cur.autosave !== false ? t('settingsAutosaveOn') : t('settingsAutosaveOff'))),
        h('div', { className: 'ns-hint', style: { marginTop: 10 } }, t('settingsAutosaveHint')),
        note ? h('div', { className: 'ns-muted' }, note) : null)
    }

    /**
     * Import and restore. Every write is previewed first: the panel sends
     * `dryRun: true`, shows the report, and only a second, explicit call writes.
     */
    function ImportPane({ book, onImported }) {
      const [tab, setTab] = useState('backup')
      const [text, setText] = useState('')
      const [mode, setMode] = useState('merge')
      const [skipTitle, setSkipTitle] = useState(true)
      const [files, setFiles] = useState([])
      const [pick, setPick] = useState(null)
      const [report, setReport] = useState(null)
      const [confirmed, setConfirmed] = useState(false)
      const [err, setErr] = useState(null)
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState('')

      useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const data = await call('GET', `/library/${enc(book.id)}/import`)
            if (alive) setFiles(data.files || [])
          } catch {
            /* the file list is a convenience; paste still works */
          }
        })()
        return () => { alive = false }
      }, [book.id])

      const send = useCallback(async (dryRun) => {
        setBusy(dryRun ? 'preview' : 'apply')
        setErr(null)
        setNote('')
        setConfirmed(!dryRun)
        try {
          const body = tab === 'backup'
            ? { kind: 'backup', text, mode, dryRun }
            : tab === 'markdown'
              ? { kind: 'markdown', text, mode, dryRun, confirm: true, skipTitle }
              : { kind: 'file', dir: pick?.dir, name: pick?.name, mode, dryRun, confirm: true, skipTitle }
          if (tab !== 'backup' && !text.trim() && tab !== 'file') {
            setNote(t('importNeedText'))
            return
          }
          if (tab === 'file' && !pick) {
            setNote(t('importFilePick'))
            return
          }
          const got = await call('POST', `/library/${enc(book.id)}/import`, body)
          setReport(got)
          if (!dryRun) {
            setNote(t('importDone'))
            await onImported()
          }
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy('')
        }
      }, [tab, text, mode, skipTitle, pick, book.id, onImported])

      const tabBtn = (key, label) => h('button', {
        className: 'ns-chip',
        'data-on': tab === key ? '1' : '0',
        onClick: () => { setTab(key); setReport(null); setErr(null) },
      }, label)

      return h('div', { className: 'ns-pane ns-import' },
        h('div', { className: 'ns-chips' },
          tabBtn('backup', t('importBackupTab')),
          tabBtn('markdown', t('importMarkdownTab')),
          tabBtn('file', t('importFileTab'))),
        h('div', { className: 'ns-hint' },
          tab === 'backup' ? t('importBackupHint') : tab === 'markdown' ? t('importMarkdownHint') : t('importFileHint')),
        tab === 'file'
          ? (files.length
              ? h('div', { className: 'ns-import-list' }, files.map((f) =>
                  h('div', {
                    key: f.path || `${f.dir}/${f.name}`,
                    className: 'ns-import-file',
                    'data-on': pick && pick.name === f.name && pick.dir === f.dir ? '1' : '0',
                    onClick: () => setPick({ dir: f.dir, name: f.name }),
                  },
                    h('span', { className: 'ns-pill' }, f.dir),
                    h('span', null, f.name),
                    h('span', { className: 'ns-spacer' }),
                    h('span', { className: 'ns-muted', style: { fontSize: 12 } }, f.kind || ''))))
              : h('div', { className: 'ns-empty' }, t('searchEmpty')))
          : h('textarea', {
              className: 'ns-textarea',
              placeholder: t('importPaste'),
              value: text,
              onChange: (e) => { setText(e.target.value); setReport(null) },
            }),
        h('div', { className: 'ns-mini-form', style: { marginTop: 10 } },
          h('span', { className: 'ns-label' }, t('importMode')),
          h('select', {
            className: 'ns-select',
            value: mode,
            onChange: (e) => setMode(e.target.value),
          },
            h('option', { value: 'merge' }, t('importModeMerge')),
            h('option', { value: 'replace' }, t('importModeReplace')))),
        tab === 'markdown'
          ? h('label', { className: 'ns-report-row', style: { marginTop: 8 } },
              h('input', { type: 'checkbox', checked: skipTitle, onChange: (e) => setSkipTitle(e.target.checked) }),
              h('span', { className: 'ns-muted' }, t('importMarkdownTab')))
          : null,
        h('div', { className: 'ns-actions', style: { marginTop: 10 } },
          h('button', { className: 'ns-btn', disabled: !!busy, onClick: () => send(true) },
            busy === 'preview' ? t('loading') : t('importPreview')),
          report && !confirmed
            ? h('button', { className: 'ns-btn', 'data-kind': 'primary', disabled: !!busy, onClick: () => send(false) },
                busy === 'apply' ? t('loading') : t('importApply'))
            : null,
          note ? h('span', { className: 'ns-muted' }, note) : null),
        err ? h('div', { className: 'ns-err' }, err) : null,
        report
          ? h('div', { className: 'ns-report', style: { marginTop: 12 } },
              h('div', { className: 'ns-report-row' },
                h('span', null, `${t('importDescribe')} ${report.chapters ?? 0} ${t('importChapters')}`),
                report.written != null ? h('span', null, `${t('importDone')} ${report.written}`) : null,
                report.dryRun ? h('span', { className: 'ns-pill' }, t('importDryRun')) : null),
              (report.sections || []).map((s) => h('div', { key: s.key, className: 'ns-report-row' },
                h('span', { className: 'ns-pill' }, s.zh || s.key),
                h('span', null, `${s.written ?? 0}`),
                s.skipped ? h('span', { className: 'ns-muted' }, `${t('importSkip')} ${s.skipped}`) : null,
                s.removed ? h('span', { className: 'ns-muted' }, `-${s.removed}`) : null)),
              (report.warnings || []).length
                ? h('div', { className: 'ns-notes' },
                    h('b', null, t('importWarnings')),
                    report.warnings.map((w, i) => h('span', { key: i }, w)))
                : null)
          : null)
    }

    // Where the shelf's folded/unfolded choice is kept between visits.
    const SHELF_FOLDED = 'dsh-novel-studio.shelf-folded'

    function Shelf({ books, selected, onPick, onCreate, refresh, root, info, onRoot, busy }) {
      const [adding, setAdding] = useState(false)
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState('')
      const [move, setMove] = useState(true)
      const [switching, setSwitching] = useState(false)
      const [note, setNote] = useState(null)
      // The folder walk behind the path field: null while it is closed, otherwise
      // the level being shown. Kept apart from `draft` on purpose — browsing is
      // looking, and only "use this folder" writes the path the form would send.
      const [browse, setBrowse] = useState(null)
      const [browseBusy, setBrowseBusy] = useState(false)
      const [browseErr, setBrowseErr] = useState(null)
      const [picking, setPicking] = useState(false)
      // The shelf is wide enough to eat a third of the panel, so it folds down to
      // an arrow — and it starts folded: the books are one click away, the width
      // is not. The choice is remembered in the browser (best-effort: a browser
      // that refuses storage just forgets it next visit).
      const [folded, setFolded] = useState(() => {
        try {
          return window.localStorage.getItem(SHELF_FOLDED) !== '0'
        } catch {
          return true
        }
      })
      function fold(next) {
        setFolded(next)
        try {
          window.localStorage.setItem(SHELF_FOLDED, next ? '1' : '0')
        } catch {
          /* a browser that will not remember, or no storage at all */
        }
      }

      const locked = Boolean(info && info.locked)
      const source = (info && info.source) || 'default'

      // The recycle bin. `trash` stays null until it has been fetched once — the
      // shelf asks for the count right after mounting so the toggle can say how
      // many books are waiting in there, and every action refetches it. Deleting
      // is a rename on the host side, so none of this touches file contents.
      const [trashOpen, setTrashOpen] = useState(false)
      const [trash, setTrash] = useState(null)
      const [actBusy, setActBusy] = useState(null)

      async function loadTrash() {
        const res = await call('GET', '/trash')
        setTrash(res.entries || [])
      }

      useEffect(() => { loadTrash().catch(() => {}) }, [])

      async function toggleTrash() {
        if (trashOpen) { setTrashOpen(false); return }
        setNote(null)
        setTrashOpen(true)
        try {
          await loadTrash()
        } catch (err) {
          setNote(String((err && err.message) || err))
        }
      }

      async function trashBookOf(b) {
        const name = b.title || b.id
        if (!window.confirm(t('bookTrashAsk').replace('{n}', name))) return
        setActBusy(b.id)
        try {
          await call('DELETE', `/library/${enc(b.id)}`)
          // Trashing the open book closes it: there is nothing left to show.
          if (selected === b.id) await onPick(null)
          await refresh()
          await loadTrash()
          setNote(t('bookTrashed').replace('{n}', name))
        } catch (err) {
          setNote(String((err && err.message) || err))
        } finally {
          setActBusy(null)
        }
      }

      async function restoreOf(e) {
        setActBusy(e.id)
        try {
          const res = await call('POST', `/trash/${enc(e.id)}/restore`)
          await refresh()
          await loadTrash()
          setNote(t('trashRestored').replace('{n}', (res && res.id) || e.name))
        } catch (err) {
          setNote(String((err && err.message) || err))
        } finally {
          setActBusy(null)
        }
      }

      async function purgeOf(e) {
        if (!window.confirm(t('trashPurgeAsk').replace('{n}', e.name))) return
        setActBusy(e.id)
        try {
          await call('DELETE', `/trash/${enc(e.id)}`)
          await loadTrash()
          setNote(t('trashPurged').replace('{n}', e.name))
        } catch (err) {
          setNote(String((err && err.message) || err))
        } finally {
          setActBusy(null)
        }
      }

      // The host owns the path — it is the one that must create the folder and,
      // if asked, walk the books across — so this only sends the request and
      // reports what came back. A refusal is shown as it was worded: "not an
      // absolute path" is far more useful than "something went wrong".
      async function switchTo(value, opts) {
        setSwitching(true)
        setNote(null)
        try {
          const res = await onRoot(value, opts)
          const moved = ((res && res.move && res.move.moved) || []).length
          const skipped = ((res && res.move && res.move.skipped) || []).length
          const parts = [t('rootChanged')]
          if (moved) parts.push(t('rootMoved').replace('{n}', String(moved)))
          if (skipped) parts.push(t('rootSkipped').replace('{n}', String(skipped)))
          setNote(parts.join(' · '))
          setEditing(false)
        } catch (err) {
          setNote(`${t('rootFailed')}${String((err && err.message) || err)}`)
        } finally {
          setSwitching(false)
        }
      }

      // The Host's own folder dialog first: it is the picker the workspace flow
      // uses, it remembers where it last was, and it reaches every drive. It
      // answers null when the writer cancels, which is not a failure. `true`
      // means the dialog was ours to handle; `false` means there is none here and
      // the caller should fall back to walking folders over HTTP.
      async function browseNative() {
        const pick = hostPickDirectory()
        if (!pick) return false
        setPicking(true)
        setNote(null)
        try {
          const picked = pickedPath(await pick())
          if (picked) {
            setDraft(picked)
            setBrowse(null)
          }
          return true
        } catch (err) {
          setNote(`${t('rootFailed')}${String((err && err.message) || err)}`)
          return true
        } finally {
          setPicking(false)
        }
      }

      // Walking the filesystem one folder at a time. Only the host can see
      // native paths, so every step asks it; a refusal is shown where the list
      // would be, and the escape hatches (drives / home / up) stay reachable.
      async function open(at) {
        setBrowseBusy(true)
        setBrowseErr(null)
        try {
          const data = await call('GET', at ? `/folders?path=${encodeURIComponent(at)}` : '/folders')
          setBrowse({
            path: data.path || '',
            parent: data.parent === undefined ? null : data.parent,
            home: data.home || '',
            items: data.items || [],
          })
        } catch (err) {
          setBrowseErr(String((err && err.message) || err))
          setBrowse((prev) => prev || { path: '', parent: null, home: '', items: [] })
        } finally {
          setBrowseBusy(false)
        }
      }

      // The open folder, drawn where the path field is. Everything here is a
      // read: descending, going up, and the two shortcuts the writer actually
      // reaches for (the drives, the home directory).
      function browserPanel() {
        const at = browse.path
        return h('div', { className: 'ns-browser' },
          h('div', { className: 'ns-browser-head' },
            h('span', { className: 'ns-browser-path', title: at || t('browseDrives') }, at || t('browseDrives')),
            h('span', { className: 'ns-spacer' }),
            h('button', {
              className: 'ns-btn ns-root-pick',
              disabled: browseBusy || !at,
              onClick: () => open(browse.parent || ''),
            }, t('browseUp')),
            h('button', {
              className: 'ns-btn ns-root-pick',
              disabled: browseBusy || !at,
              onClick: () => open(''),
            }, t('browseRoot')),
            browse.home
              ? h('button', {
                  className: 'ns-btn ns-root-pick',
                  disabled: browseBusy,
                  onClick: () => open(browse.home),
                }, t('browseHome'))
              : null),
          browseBusy ? h('div', { className: 'ns-root-meta' }, t('browseLoading')) : null,
          browseErr ? h('div', { className: 'ns-root-note' }, `${t('browseFailed')}${browseErr}`) : null,
          h('div', { className: 'ns-browser-list' },
            browse.items.length
              ? browse.items.map((it) => h('button', {
                  key: it.path,
                  className: 'ns-browser-item',
                  disabled: browseBusy,
                  title: it.path,
                  onClick: () => open(it.path),
                }, `📁 ${it.name}`))
              : h('div', { className: 'ns-root-meta' }, t('browseEmpty'))),
          h('div', { className: 'ns-root-row' },
            h('button', {
              className: 'ns-btn',
              'data-kind': 'primary',
              disabled: browseBusy || !at,
              onClick: () => {
                setDraft(at)
                setNote(null)
                setBrowse(null)
              },
            }, t('browseChoose')),
            h('button', { className: 'ns-btn', disabled: browseBusy, onClick: () => setBrowse(null) }, t('cancel'))),
          h('div', { className: 'ns-root-meta' }, t('rootBrowseHint')))
      }

      const form = h('div', { className: 'ns-root-form' },
        h('div', { className: 'ns-root-row' },
          h('input', {
            className: 'ns-input',
            value: draft,
            autoFocus: true,
            spellCheck: false,
            placeholder: t('rootTitle'),
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter' && draft.trim()) switchTo(draft.trim(), { move })
            },
          }),
          h('button', {
            className: 'ns-btn ns-root-pick',
            disabled: browseBusy || picking,
            onClick: async () => {
              if (browse) {
                setBrowse(null)
                return
              }
              if (await browseNative()) return
              await open(draft.trim() || root || '')
            },
          }, picking ? t('browseLoading') : t('rootBrowse'))),
        browse ? browserPanel() : null,
        books.length
          ? h('label', { className: 'ns-root-check' },
              h('input', { type: 'checkbox', checked: move, onChange: (e) => setMove(e.target.checked) }),
              t('rootMove'))
          : null,
        h('div', { className: 'ns-root-row' },
          h('button', {
            className: 'ns-btn',
            'data-kind': 'primary',
            disabled: switching || !draft.trim(),
            onClick: () => switchTo(draft.trim(), { move }),
          }, switching ? t('saving') : t('rootApply')),
          h('button', { className: 'ns-btn', disabled: switching, onClick: () => setEditing(false) }, t('cancel'))),
        source === 'settings'
          ? h('div', { className: 'ns-root-row' },
              h('button', {
                className: 'ns-btn',
                disabled: switching,
                onClick: () => switchTo(null, { reset: true }),
              }, t('rootDefault')))
          : null,
        h('div', { className: 'ns-root-meta' }, t('rootHint')))

      return h('aside', { className: 'ns-shelf', 'data-folded': folded ? '1' : '0' },
        h('div', { className: 'ns-shelf-head' },
          h('span', { className: 'ns-shelf-title' }, t('shelf')),
          h('button', {
            className: 'ns-shelf-fold',
            title: folded ? t('shelfShow') : t('shelfHide'),
            'aria-expanded': folded ? 'false' : 'true',
            'aria-label': folded ? t('shelfShow') : t('shelfHide'),
            onClick: () => fold(!folded),
          }, folded ? '›' : '‹')),
        h('div', { className: 'ns-books' },
          // The recycle bin and the shelf are two faces of the same list, so the
          // whole area flips: bin rows when it is open, book rows otherwise.
          trashOpen
            ? [
                h('div', { key: 'hint', className: 'ns-root-note', style: { padding: '4px 2px 6px' } }, t('trashHint')),
                !trash
                  ? h('div', { key: 'loading', className: 'ns-empty', style: { fontSize: 12 } }, t('loading'))
                  : null,
                trash && !trash.length
                  ? h('div', { key: 'empty', className: 'ns-empty', style: { fontSize: 12 } }, t('trashEmpty'))
                  : null,
                (trash || []).map((e) => h('div', { key: e.id, className: 'ns-trash-row' },
                  h('div', { className: 'ns-trash-info' },
                    h('span', { className: 'ns-trash-name', title: e.name }, e.name),
                    h('small', { className: 'ns-trash-when' }, String(e.deletedAt || '').slice(0, 16).replace('T', ' '))),
                  h('div', { className: 'ns-trash-acts' },
                    h('button', {
                      className: 'ns-btn',
                      disabled: actBusy === e.id,
                      onClick: () => restoreOf(e),
                    }, t('trashRestore')),
                    h('button', {
                      className: 'ns-btn',
                      'data-kind': 'danger',
                      disabled: actBusy === e.id,
                      onClick: () => purgeOf(e),
                    }, t('trashPurge'))))),
              ]
            : [
                !books.length && !adding ? h('div', { key: 'empty', className: 'ns-empty', style: { fontSize: 12 } }, t('emptyShelf')) : null,
                books.map((b) => {
                  // The id is the folder name and usually the title itself, so the
                  // second line only appears when it adds something the label lacks.
                  const label = b.title || b.id
                  const sub = [b.author, b.genre].filter(Boolean).join(' · ') || (label !== b.id ? b.id : '')
                  return h('div', { key: b.id, className: 'ns-book-row' },
                  h('button', {
                    className: 'ns-book',
                    'data-on': b.id === selected ? '1' : '0',
                    onClick: () => onPick(b.id),
                  }, label, sub ? h('small', null, sub) : null),
                  h('button', {
                    className: 'ns-book-del',
                    title: t('bookTrash'),
                    'aria-label': t('bookTrash'),
                    disabled: actBusy === b.id,
                    onClick: () => trashBookOf(b),
                  }, '🗑'))
                }),
              ]),
        h('div', { className: 'ns-shelf-foot' },
          adding
            ? h(InlineForm, {
                busy,
                onSubmit: async (title) => {
                  await onCreate(title)
                  setAdding(false)
                },
                onCancel: () => setAdding(false),
              })
            : h('button', { className: 'ns-btn', onClick: () => setAdding(true) }, `＋ ${t('addBook')}`),
          h('button', {
            className: 'ns-btn ns-trash-open',
            'data-open': trashOpen ? '1' : '0',
            disabled: busy || actBusy,
            onClick: toggleTrash,
          }, trashOpen
            ? t('trashBack')
            : `🗑 ${t('shelfTrash')}${trash && trash.length ? ` (${trash.length})` : ''}`),
          h('div', { className: 'ns-root' },
            h('div', { className: 'ns-root-title' },
              t('rootTitle'),
              locked || editing ? null : h('button', {
                className: 'ns-btn',
                onClick: () => {
                  setDraft(root || '')
                  setNote(null)
                  setEditing(true)
                },
              }, t('rootChange'))),
            h('div', { className: 'ns-root-path', title: root }, root || '—'),
            h('div', { className: 'ns-root-meta' }, locked
              ? t('rootLocked')
              : source === 'settings' ? t('rootSrcSettings') : t('rootSrcDefault')),
            note ? h('div', { className: 'ns-root-note' }, note) : null,
            editing && !locked ? form : null)))
    }

    // ── website shortcuts — the empty pane's launchpad ──────────────────
    // A writer works across several platforms, each with its own publishing
    // backend ("上架后台"). The list is saved through the API into the studio's
    // config file, so it outlives a browser-data clear; a card opens the URL
    // in a fresh tab, with `noopener` keeping the opened page from reaching
    // back at this app. The grid is auto-fill, so widening the pane — folding
    // the shelf, say — simply adds columns: the section scales with the
    // layout instead of fighting it.
    // The cross-book shared library: browse what any book has published,
    // bring an entry into this book (引入 = linked and syncable, 派生 = a
    // private copy), sync or pin what this book already references, and
    // 提升 one of this book's own records into the store. One new pane plus
    // one new overview card — every existing view stays as it was.
    function SharedPane({ book, onCreated }) {
      const [tab, setTab] = useState('browse') // browse | links | promote | templates | fos
      const [data, setData] = useState(null) // { units, entries, series } | null
      const [links, setLinks] = useState(null) // [...] | null
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)
      const [openKey, setOpenKey] = useState(null)
      const [impact, setImpact] = useState({}) // key → books[]
      const [confirm, setConfirm] = useState(null) // { unit, id, scope, books } before an overwrite
      const [srcUnit, setSrcUnit] = useState('')
      const [srcItems, setSrcItems] = useState([])
      const [srcPick, setSrcPick] = useState('')
      const [srcStatus, setSrcStatus] = useState('stable')
      const [srcScope, setSrcScope] = useState('') // '' = global store, else a series sid
      const [seriesName, setSeriesName] = useState('') // draft behind ＋新建书系
      const [templates, setTemplates] = useState(null) // [...] | null
      const [tplName, setTplName] = useState('')
      const [tplItems, setTplItems] = useState([]) // entry keys ticked for a template
      const [fos, setFos] = useState(null) // [...] | null
      const [ov, setOv] = useState(null) // { key, unit, id, route, fields, picked } | null

      async function reload() {
        try {
          const [shared, own] = await Promise.all([
            call('GET', '/shared'),
            call('GET', `/shared/links?book=${enc(book.id)}`),
          ])
          setData({ units: shared.units || [], entries: shared.entries || [], series: shared.series || {} })
          setLinks(own.links || [])
        } catch (err) {
          setNote(String(err.message || err))
        }
      }

      useEffect(() => {
        setData(null)
        setLinks(null)
        setNote('')
        setConfirm(null)
        setOpenKey(null)
        reload()
      }, [book.id])

      // templates & foreshadowing load on the first visit to their sub-tab
      useEffect(() => {
        if (tab !== 'templates' || templates !== null) return
        let alive = true
        call('GET', '/shared/templates')
          .then((res) => { if (alive) setTemplates(res.templates || []) })
          .catch((err) => { if (alive) setNote(String(err.message || err)) })
        return () => { alive = false }
      }, [tab, templates])

      useEffect(() => {
        if (tab !== 'fos' || fos !== null) return
        let alive = true
        call('GET', '/shared/foreshadowing')
          .then((res) => { if (alive) setFos(res.groups || []) })
          .catch((err) => { if (alive) setNote(String(err.message || err)) })
        return () => { alive = false }
      }, [tab, fos])

      // always keep a category selected so the promote form is usable
      useEffect(() => {
        if (!data) return
        if (!srcUnit || !data.units.some((u) => u.key === srcUnit)) setSrcUnit(data.units[0]?.key || '')
      }, [data])

      // this book's own entries for the chosen category (the promote picker)
      useEffect(() => {
        if (tab !== 'promote' || !srcUnit || !data) {
          setSrcItems([])
          setSrcPick('')
          return
        }
        const route = data.units.find((u) => u.key === srcUnit)?.route || srcUnit
        let alive = true
        setSrcItems([])
        setSrcPick('')
        call('GET', `/library/${enc(book.id)}/unit/${route}`)
          .then((res) => {
            if (!alive) return
            const items = (res.items || []).filter((i) => !String(i.id ?? i.name ?? '').includes('/'))
            setSrcItems(items)
            setSrcPick(String(items[0]?.id ?? items[0]?.name ?? ''))
          })
          .catch((err) => { if (alive) setNote(String(err.message || err)) })
        return () => { alive = false }
      }, [tab, srcUnit, data, book.id])

      async function run(path, body, okMsg) {
        setBusy(true)
        setNote('')
        try {
          await call('POST', path, body)
          await reload()
          if (okMsg) setNote(okMsg)
          return true
        } catch (err) {
          setNote(String(err.message || err))
          return false
        } finally {
          setBusy(false)
        }
      }

      async function showImpact(key) {
        if (openKey === key) {
          setOpenKey(null)
          return
        }
        try {
          const res = await call('GET', `/shared/impact?key=${encodeURIComponent(key)}`)
          setImpact((m) => ({ ...m, [key]: res.books || [] }))
          setOpenKey(key)
        } catch (err) {
          setNote(String(err.message || err))
        }
      }

      function doImport(entry, mode) {
        run('/shared/import', { book: book.id, unit: entry.unit, id: entry.id, mode, scope: entry.scope || '' }, t('shImported'))
      }

      async function doPromote() {
        if (!srcUnit || !srcPick || srcScope === '__new__') return
        const base = `${srcUnit}/${srcPick}`
        const key = srcScope ? `series:${srcScope}:${base}` : base
        const already = (data?.entries || []).some((e) => e.key === key)
        if (already) {
          // overwriting something other books reference: ask first, naming
          // exactly who would be affected (防污染: 改共享体前提示影响范围)
          try {
            const res = await call('GET', `/shared/impact?key=${encodeURIComponent(key)}`)
            const books = res.books || []
            if (books.length) {
              setConfirm({ unit: srcUnit, id: srcPick, scope: srcScope, books })
              return
            }
          } catch (err) {
            setNote(String(err.message || err))
            return
          }
        }
        await run('/shared/promote', {
          book: book.id, unit: srcUnit, id: srcPick, status: srcStatus, scope: srcScope,
        }, t('shPromoted'))
      }

      async function confirmOverwrite() {
        if (!confirm) return
        const ok = await run('/shared/promote', {
          book: book.id,
          unit: confirm.unit,
          id: confirm.id,
          status: srcStatus,
          scope: confirm.scope || '',
        }, t('shPromoted'))
        if (ok) setConfirm(null)
      }

      async function doCreateSeries() {
        const name = seriesName.trim()
        if (!name) return
        setBusy(true)
        setNote('')
        try {
          const res = await call('POST', '/shared/series', { name })
          await reload()
          setSrcScope(res.sid || '')
          setSeriesName('')
          setNote(t('shSeriesCreated'))
        } catch (err) {
          setNote(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }

      async function doSaveTemplate() {
        if (!tplName.trim() || !tplItems.length) return
        setBusy(true)
        setNote('')
        try {
          await call('POST', '/shared/templates', { name: tplName.trim(), items: tplItems })
          const res = await call('GET', '/shared/templates')
          setTemplates(res.templates || [])
          setTplName('')
          setTplItems([])
          setNote(t('shTplSaved'))
        } catch (err) {
          setNote(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }

      async function makeFromTemplate(tp) {
        setBusy(true)
        setNote('')
        try {
          const res = await call('POST', '/shared/from-template', { title: tp.name, tid: tp.tid })
          const skipped = (res.skipped || []).length
          await reload()
          setNote(t('shTplMade').replace('{b}', res.book?.title || tp.name)
            + (skipped ? ` · ${t('shTplSkipped').replace('{n}', skipped)}` : ''))
          if (onCreated && res.book?.id) onCreated(res.book.id)
        } catch (err) {
          setNote(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }

      // the 字段例外 panel: read the record's field list, keep a local pick
      async function openOverride(l) {
        if (ov?.key === l.key) {
          setOv(null)
          return
        }
        try {
          const res = await call('GET', `/library/${enc(book.id)}/unit/${enc(l.route)}`)
          const fields = (res.fields || []).map((f) => f.k ?? f.key ?? String(f)).filter(Boolean)
          setOv({ key: l.key, unit: l.unit, id: l.id, route: l.route, fields, picked: l.overrides || [] })
        } catch (err) {
          setNote(String(err.message || err))
        }
      }

      async function saveOverride() {
        if (!ov) return
        const ok = await run('/shared/override', { book: book.id, unit: ov.unit, id: ov.id, fields: ov.picked }, t('shOverrideSaved'))
        if (ok) setOv(null)
      }

      const badge = (text, kind) => h('span', { className: 'ns-sh-pill', 'data-kind': kind }, text)
      const modeBadge = (l) => badge(l.mode === 'fork' ? t('shModeFork') : t('shModeLink'), 'mode')

      function impactRow(key) {
        if (openKey !== key) return null
        const books = impact[key] || []
        return h('div', { className: 'ns-sh-impact' },
          books.length
            ? books.map((b) => h('span', { key: b.id }, `${b.title} · ${b.mode === 'fork' ? t('shModeFork') : t('shModeLink')}`))
            : h('span', null, t('shNoImpact')))
      }

      const entries = data?.entries || []
      const units = data?.units || []
      const seriesMap = data?.series || {}
      const layerNames = ['', ...Object.keys(seriesMap).sort()]
      const browse = !data
        ? h('div', { className: 'ns-empty' }, t('loading'))
        : !entries.length
          ? h('div', { className: 'ns-empty' }, t('shEmpty'))
          : layerNames.map((sc) => {
              const scoped = entries.filter((e) => (e.scope || '') === sc)
              if (!scoped.length) return null
              return h('div', { key: sc || '_global', className: 'ns-sh-layer' },
                h('div', { className: 'ns-sh-layerhead' }, sc ? (seriesMap[sc]?.name || sc) : t('shGlobal')),
                units.map((u) => {
                  const rows = scoped.filter((e) => e.unit === u.key)
                  if (!rows.length) return null
                  return h('div', { key: u.key, className: 'ns-sh-group' },
                    h('div', { className: 'ns-sh-unit' }, u.zh || u.key),
                    rows.map((e) => h('div', { key: e.key, className: 'ns-sh-row' },
                      h('b', null, e.title || e.id),
                      badge(e.status === 'draft' ? t('shDraft') : t('shStable'), e.status),
                      e.origin?.book ? h('small', null, t('shFrom').replace('{b}', e.origin.book)) : null,
                      h('span', { className: 'ns-sh-acts' },
                        h('button', {
                          className: 'ns-btn',
                          disabled: busy || e.status !== 'stable',
                          title: e.status !== 'stable' ? t('shDraft') : '',
                          onClick: () => doImport(e, 'link'),
                        }, t('shImport')),
                        h('button', { className: 'ns-btn', disabled: busy, onClick: () => doImport(e, 'fork') }, t('shFork')),
                        h('button', { className: 'ns-btn', onClick: () => showImpact(e.key) }, t('shImpact'))),
                      impactRow(e.key))))
                }))
            })

      function ovPanel(l) {
        if (!ov || ov.key !== l.key) return null
        return h('div', { className: 'ns-sh-override' },
          h('span', { className: 'ns-muted' }, t('shOverrideHint')),
          h('div', { className: 'ns-sh-ovfields' },
            ov.fields.map((k) => h('label', { key: k, className: 'ns-sh-ovfield' },
              h('input', {
                type: 'checkbox',
                checked: ov.picked.includes(k),
                onChange: (e) => setOv((s) => ({
                  ...s,
                  picked: e.target.checked ? [...s.picked, k] : s.picked.filter((x) => x !== k),
                })),
              }), k))),
          h('span', { className: 'ns-sh-acts' },
            h('button', { className: 'ns-btn', disabled: busy, onClick: saveOverride }, t('shOverrideSave')),
            h('button', { className: 'ns-btn', onClick: () => setOv(null) }, t('shConfirmNo'))))
      }

      const linksView = links === null
        ? h('div', { className: 'ns-empty' }, t('loading'))
        : !links.length
          ? h('div', { className: 'ns-empty' }, t('shLinksEmpty'))
          : links.map((l) => h(React.Fragment, { key: l.key },
              h('div', { className: 'ns-sh-row' },
                h('b', null, l.title || l.key),
                l.orphan
                  ? badge(t('shGone'), 'gone')
                  : modeBadge(l),
                l.series ? badge(l.series, 'mode') : null,
                l.orphan ? null : !l.sourceExists
                  ? badge(t('shGone'), 'gone')
                  : l.stale ? badge(t('shStale'), 'stale') : null,
                !l.orphan && l.drift ? badge(t('shDrift'), 'drift') : null,
                !l.orphan && l.pin ? badge(t('shLocked'), 'pin') : null,
                !l.orphan && (l.overrides || []).length
                  ? badge(t('shOvCount').replace('{n}', l.overrides.length), 'stale')
                  : null,
                h('span', { className: 'ns-sh-acts' },
                  !l.orphan && l.sourceExists && l.stale && !l.pin && l.mode !== 'fork'
                    ? h('button', {
                        className: 'ns-btn',
                        disabled: busy,
                        onClick: () => run('/shared/sync', { book: book.id, unit: l.unit, id: l.id }, t('shSynced')),
                      }, t('shSync'))
                    : null,
                  !l.orphan && l.mode !== 'fork'
                    ? h('button', {
                        className: 'ns-btn',
                        disabled: busy,
                        onClick: () => run('/shared/pin', { book: book.id, unit: l.unit, id: l.id, pin: !l.pin },
                          l.pin ? t('shUnpinned') : t('shPinned')),
                      }, l.pin ? t('shUnpin') : t('shPin'))
                    : null,
                  !l.orphan && l.mode !== 'fork'
                    ? h('button', {
                        className: 'ns-btn',
                        disabled: busy,
                        onClick: () => openOverride(l),
                      }, ov?.key === l.key ? t('shConfirmNo') : t('shOverride'))
                    : null)),
              ovPanel(l)))

      const promoteView = !data
        ? h('div', { className: 'ns-empty' }, t('loading'))
        : h('div', { className: 'ns-sh-form' },
            h('label', null, t('shUnit'),
              h('select', { value: srcUnit, onChange: (e) => setSrcUnit(e.target.value) },
                units.map((u) => h('option', { key: u.key, value: u.key }, u.zh || u.key)))),
            h('label', null, t('shScope'),
              h('select', { value: srcScope, onChange: (e) => setSrcScope(e.target.value) },
                h('option', { value: '' }, t('shGlobal')),
                Object.keys(seriesMap).sort().map((sid) =>
                  h('option', { key: sid, value: sid }, seriesMap[sid]?.name || sid)),
                h('option', { value: '__new__' }, t('shNewSeries')))),
            srcScope === '__new__'
              ? h('div', { className: 'ns-sh-newseries' },
                  h('input', {
                    value: seriesName,
                    placeholder: t('shSeriesName'),
                    onChange: (e) => setSeriesName(e.target.value),
                  }),
                  h('button', {
                    className: 'ns-btn',
                    disabled: busy || !seriesName.trim(),
                    onClick: doCreateSeries,
                  }, t('shSeriesCreate')))
              : null,
            h('label', null, t('shSource'),
              h('select', { value: srcPick, onChange: (e) => setSrcPick(e.target.value) },
                srcItems.length
                  ? srcItems.map((i) => {
                      const id = String(i.id ?? i.name ?? '')
                      return h('option', { key: id, value: id }, String(i.name || i.title || id))
                    })
                  : h('option', { value: '' }, t('shNoSource')))),
            h('label', null, t('shStatus'),
              h('select', { value: srcStatus, onChange: (e) => setSrcStatus(e.target.value) },
                h('option', { value: 'stable' }, t('shStable')),
                h('option', { value: 'draft' }, t('shDraft')))),
            h('button', {
              className: 'ns-btn',
              disabled: busy || !srcUnit || !srcPick || srcScope === '__new__',
              onClick: doPromote,
            }, t('shDoPromote')))

      const templatesView = templates === null
        ? h('div', { className: 'ns-empty' }, t('loading'))
        : h('div', { className: 'ns-sh-tpl' },
            h('div', { className: 'ns-sh-form' },
              h('input', {
                className: 'ns-sh-tplname',
                value: tplName,
                placeholder: t('shTplPick'),
                onChange: (e) => setTplName(e.target.value),
              }),
              h('button', {
                className: 'ns-btn',
                disabled: busy || !tplName.trim() || !tplItems.length,
                onClick: doSaveTemplate,
              }, t('shTplSave')),
              h('span', { className: 'ns-muted' }, t('shTplHint'))),
            h('div', { className: 'ns-sh-tplpick' },
              entries.length
                ? entries.map((e) => h('label', { key: e.key, className: 'ns-sh-ovfield' },
                    h('input', {
                      type: 'checkbox',
                      checked: tplItems.includes(e.key),
                      onChange: (ev) => setTplItems((arr) =>
                        ev.target.checked ? [...arr, e.key] : arr.filter((k) => k !== e.key)),
                    }),
                    h('span', null, `${e.title || e.id}${e.series ? `（${e.series}）` : ''}`)))
                : h('div', { className: 'ns-empty' }, t('shEmpty'))),
            templates.length
              ? templates.map((tp) => h('div', { key: tp.tid, className: 'ns-sh-row' },
                  h('b', null, tp.name),
                  h('small', null, `${(tp.items || []).filter((i) => !i.missing).length} 项`),
                  (tp.items || []).some((i) => i.missing) ? badge(t('shTplMissing'), 'gone') : null,
                  h('span', { className: 'ns-sh-acts' },
                    h('button', {
                      className: 'ns-btn',
                      disabled: busy,
                      onClick: () => makeFromTemplate(tp),
                    }, t('shTplMake')),
                    h('button', {
                      className: 'ns-btn',
                      disabled: busy,
                      onClick: async () => {
                        try {
                          await call('DELETE', `/shared/templates/${enc(tp.tid)}`)
                          setTemplates((list) => (list || []).filter((x) => x.tid !== tp.tid))
                          setNote(t('shTplDeleted'))
                        } catch (err) {
                          setNote(String(err.message || err))
                        }
                      },
                    }, t('remove')))))
              : h('div', { className: 'ns-empty' }, t('shTplEmpty')))

      const fosView = fos === null
        ? h('div', { className: 'ns-empty' }, t('loading'))
        : !fos.length
          ? h('div', { className: 'ns-empty' }, t('shFosEmpty'))
          : fos.map((g) => h('div', { key: g.book, className: 'ns-sh-group' },
              h('div', { className: 'ns-sh-unit' }, g.title || g.book),
              g.items.map((it, i) => h('div', { key: i, className: 'ns-sh-row' },
                h('b', null, it.title),
                it.planted ? h('small', null, `${t('shFosPlant')}：${it.planted}`) : null,
                it.payoff ? h('small', null, `${t('shFosPayoff')}：${it.payoff}`) : null,
                it.status ? badge(it.status, it.status === '已回收' ? 'stable' : 'mode') : null))))

      return h('div', { className: 'ns-pane' },
        h('div', { className: 'ns-subtabs' },
          h('button', { className: 'ns-subtab', 'data-on': tab === 'browse' ? '1' : '0', onClick: () => setTab('browse') }, t('shBrowse')),
          h('button', { className: 'ns-subtab', 'data-on': tab === 'links' ? '1' : '0', onClick: () => setTab('links') }, t('shLinks')),
          h('button', { className: 'ns-subtab', 'data-on': tab === 'promote' ? '1' : '0', onClick: () => setTab('promote') }, t('shPromote')),
          h('button', { className: 'ns-subtab', 'data-on': tab === 'templates' ? '1' : '0', onClick: () => setTab('templates') }, t('shTemplates')),
          h('button', { className: 'ns-subtab', 'data-on': tab === 'fos' ? '1' : '0', onClick: () => setTab('fos') }, t('shFos'))),
        note ? h('div', { className: 'ns-err', style: { margin: '8px 0' } }, note) : null,
        confirm
          ? h('div', { className: 'ns-sh-confirm' },
              h('b', null, `${t('shConfirmTitle')} — ${t('shAffected').replace('{n}', confirm.books.length)}`),
              h('span', null, confirm.books.map((b) => h('span', { key: b.id }, `${b.title}（${b.mode === 'fork' ? t('shModeFork') : t('shModeLink')}）`))),
              h('span', { className: 'ns-sh-acts' },
                h('button', { className: 'ns-btn', disabled: busy, onClick: confirmOverwrite }, t('shConfirmDo')),
                h('button', { className: 'ns-btn', onClick: () => setConfirm(null) }, t('shConfirmNo'))))
          : null,
        tab === 'browse' ? browse
          : tab === 'links' ? linksView
            : tab === 'promote' ? promoteView
              : tab === 'templates' ? templatesView
                : fosView)
    }

    // Welcome-page shortcut: start a new book straight from a saved template
    // (题材模板 → 从模板新建作品), without opening any book first.
    function TemplateStart({ onCreated }) {
      const [tpls, setTpls] = useState(null)
      const [pick, setPick] = useState('')
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')

      useEffect(() => {
        call('GET', '/shared/templates')
          .then((res) => {
            const list = res.templates || []
            setTpls(list)
            setPick(list[0]?.tid || '')
          })
          .catch(() => setTpls([]))
      }, [])

      async function make() {
        if (!pick) return
        setBusy(true)
        setNote('')
        try {
          const res = await call('POST', '/shared/from-template', { tid: pick })
          const skipped = (res.skipped || []).length
          setNote(t('shTplMade').replace('{b}', res.book?.title || '')
            + (skipped ? ` · ${t('shTplSkipped').replace('{n}', skipped)}` : ''))
          if (res.book?.id) onCreated(res.book.id)
        } catch (err) {
          setNote(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }

      if (tpls === null || !tpls.length) return null
      return h('div', { className: 'ns-tplstart' },
        h('span', { className: 'ns-tplstart-label' }, t('shTplStart')),
        h('select', { value: pick, onChange: (e) => setPick(e.target.value) },
          tpls.map((tp) => h('option', { key: tp.tid, value: tp.tid }, tp.name))),
        h('button', { className: 'ns-btn', disabled: busy || !pick, onClick: make }, t('shTplMake')),
        note ? h('span', { className: 'ns-muted' }, note) : null)
    }

    function Websites() {
      const [items, setItems] = useState(null) // null = still loading
      const [draft, setDraft] = useState(null) // null | { index?, name, url }
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')

      useEffect(() => {
        let alive = true
        call('GET', '/websites')
          .then((res) => { if (alive) setItems(Array.isArray(res.items) ? res.items : []) })
          .catch((err) => { if (alive) { setItems([]); setNote(String(err.message || err)) } })
        return () => { alive = false }
      }, [])

      // The whole list is saved at once — it is small — so a failed save has
      // no partial state to reconcile: the previous list simply stays put.
      async function persist(next) {
        setBusy(true)
        setNote('')
        try {
          const res = await call('POST', '/websites', { items: next })
          setItems(Array.isArray(res.items) ? res.items : next)
          return true
        } catch (err) {
          setNote(String(err.message || err))
          return false
        } finally {
          setBusy(false)
        }
      }

      function submit(event) {
        event.preventDefault()
        if (!draft || busy) return
        const name = String(draft.name || '').trim()
        const url = String(draft.url || '').trim()
        if (!name || !/^https?:\/\/\S+$/i.test(url)) {
          setNote(t('websiteBadUrl'))
          return
        }
        const next = (items || []).slice()
        if (typeof draft.index === 'number') next[draft.index] = { name, url }
        else next.push({ name, url })
        persist(next).then((ok) => {
          if (ok) {
            setDraft(null)
            setNote(t('websiteSaved'))
          }
        })
      }

      const loading = items === null
      const rows = items || []
      return h('section', { className: 'ns-sites' },
        h('div', { className: 'ns-sites-head' },
          h('h2', { className: 'ns-sites-title' }, t('websites')),
          h('button', {
            className: 'ns-btn ns-sites-add',
            disabled: loading || busy || !!draft,
            onClick: () => { setNote(''); setDraft({ name: '', url: '' }) },
          }, `＋ ${t('websiteAdd')}`)),
        h('p', { className: 'ns-sites-hint' }, t('websitesHint')),
        note ? h('div', { className: 'ns-sites-note' }, note) : null,
        loading
          ? h('div', { className: 'ns-sites-empty' }, t('loading'))
          : !rows.length && !draft
            ? h('div', { className: 'ns-sites-empty' }, t('websiteEmpty'))
            : h('div', { className: 'ns-sites-grid' },
                rows.map((it, index) => h('div', { key: `${index}-${it.url}`, className: 'ns-site' },
                  h('button', {
                    className: 'ns-site-open',
                    title: it.url,
                    onClick: () => window.open(it.url, '_blank', 'noopener,noreferrer'),
                  },
                    h('span', { className: 'ns-site-name' }, it.name),
                    h('small', { className: 'ns-site-url' }, it.url.replace(/^https?:\/\//i, ''))),
                  h('span', { className: 'ns-site-acts' },
                    h('button', {
                      className: 'ns-site-act',
                      title: t('websiteEdit'),
                      disabled: busy,
                      onClick: () => { setNote(''); setDraft({ index, name: it.name, url: it.url }) },
                    }, '✎'),
                    h('button', {
                      className: 'ns-site-act',
                      'data-kind': 'danger',
                      title: t('websiteRemove'),
                      disabled: busy,
                      onClick: () => {
                        if (!window.confirm(t('websiteRemoveAsk').replace('{n}', it.name))) return
                        persist(rows.filter((_, i) => i !== index))
                      },
                    }, '🗑'))))),
        draft ? h('form', { className: 'ns-site-form', onSubmit: submit },
          h('input', {
            className: 'ns-input',
            placeholder: t('websiteName'),
            value: draft.name,
            disabled: busy,
            onInput: (e) => setDraft({ ...draft, name: e.target.value }),
          }),
          h('input', {
            className: 'ns-input',
            placeholder: t('websiteUrl'),
            value: draft.url,
            disabled: busy,
            onInput: (e) => setDraft({ ...draft, url: e.target.value }),
          }),
          h('button', { className: 'ns-btn', type: 'submit', disabled: busy }, t('save')),
          h('button', { className: 'ns-btn', type: 'button', disabled: busy, onClick: () => { setDraft(null); setNote('') } }, t('cancel')),
        ) : null)
    }

    // Navigation strip: opt-in, persisted like the shelf fold. Collapsed (the
    // default) enters everything from the overview and exits with a back
    // button; expanded restores the original one-row tab strip.
    const NAV_OPEN = 'dsh-novel-studio.nav-open'

    function NovelStudio() {
      const [sections, setSections] = useState([])
      const [status, setStatus] = useState({ ok: false, text: '' })
      const [books, setBooks] = useState([])
      const [selected, setSelected] = useState(null)
      const [detail, setDetail] = useState(null)
      const [active, setActive] = useState('overview')
      const [groups, setGroups] = useState({})
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [root, setRoot] = useState('')
      const [rootMeta, setRootMeta] = useState(null)
      // The schema stage the host reports (never a number written into a label),
      // this book's own settings, and the entry a search hit asked to open.
      const [stage, setStage] = useState(null)
      const [settings, setSettings] = useState(null)
      const [focus, setFocus] = useState(null)
      const [navOpen, setNavOpen] = useState(() => window.localStorage.getItem(NAV_OPEN) === '1')
      // 副驾驶: the whole-book consistency report plus the chapters a simulated
      // reader flagged, fetched once per opened book so the top bar can say how
      // much is waiting without the writer opening the panel first.
      const [coach, setCoach] = useState(null)
      const toggleNav = useCallback(() => setNavOpen((v) => {
        const next = !v
        window.localStorage.setItem(NAV_OPEN, next ? '1' : '0')
        return next
      }), [])

      const loadShelf = useCallback(async () => {
        try {
          const boot = await call('GET', '/bootstrap')
          setRoot(boot.root || '')
          setRootMeta(boot.rootInfo || null)
          setStage(boot.stage ?? null)
          setStatus({ ok: true, text: t('connected') })
          setError(null)
          setBooks(boot.books || [])
          return boot
        } catch (err) {
          setStatus({ ok: false, text: t('disconnected') })
          setError(String(err.message || err))
          return null
        }
      }, [])

      // Changing the library folder re-reads the shelf: the books that matter are
      // the ones in the folder that is now current.
      const changeRoot = useCallback(async (value, opts) => {
        const body = opts && opts.reset ? { reset: true } : { root: value, move: Boolean(opts && opts.move) }
        const res = await call('POST', '/root', body)
        await loadShelf()
        return res
      }, [loadShelf])

      useEffect(() => {
        loadShelf()
        call('GET', '/schema')
          .then((s) => setSections((s.sections || []).filter((x) => x.key !== 'overview')))
          .catch(() => {})
      }, [loadShelf])

      const openBook = useCallback(async (id) => {
        // Nothing selected: the open book was trashed from under the panel, so
        // the view empties instead of asking the host for a book called "null".
        if (id === null || id === undefined || id === '') {
          setSelected(null)
          setDetail(null)
          setSettings(null)
          setFocus(null)
          setError(null)
          return
        }
        setSelected(id)
        setDetail(null)
        setError(null)
        setFocus(null)
        setSettings(null)
        try {
          setDetail(await call('GET', `/library/${enc(id)}`))
        } catch (err) {
          setError(String(err.message || err))
        }
        try {
          const got = await call('GET', `/library/${enc(id)}/settings`)
          setSettings(got.settings || {})
        } catch {
          /* a book without settings.yaml still opens */
        }
      }, [])

      async function createBook(title) {
        setBusy(true)
        try {
          const made = await call('POST', '/library', { title })
          await loadShelf()
          await openBook(made.book.id)
        } catch (err) {
          setError(String(err.message || err))
        } finally {
          setBusy(false)
        }
      }

      // Keep the top-bar reminder in step with the book in front of the writer.
      useEffect(() => {
        if (!selected) {
          setCoach(null)
          return undefined
        }
        let alive = true
        Promise.all([
          call('GET', `/library/${enc(selected)}/validate`).catch(() => null),
          call('GET', `/library/${enc(selected)}/reader`).catch(() => null),
        ]).then(([v, rd]) => {
          if (!alive) return
          const counts = v?.counts || null
          const top = (v?.issues || []).filter((it) => it.level !== 'info').slice(0, 3)
          const drops = (rd?.reports || [])
            .filter((r) => r.drop && !/^(无|没有|none|n\/a|-|—)$/i.test(String(r.drop).trim()))
            .map((r) => r.chapter)
          if (!counts && !drops.length) {
            setCoach(null)
            return
          }
          setCoach({ counts, top, drops })
        })
        return () => { alive = false }
      }, [selected])

      const activeSection = sections.find((s) => s.key === active)
      return h('div', {
        className: 'ns-root',
        'data-theme': (settings && settings.theme) || 'default',
        style: { '--ns-body-size': `${(settings && settings.fontSize) || 15}px` },
      },
        h(Shelf, { books, selected, onPick: openBook, onCreate: createBook, refresh: loadShelf, root, info: rootMeta, onRoot: changeRoot, busy }),
        h('main', { className: 'ns-main' },
          h('div', { className: 'ns-top' },
            h('span', { className: 'ns-dot', 'data-ok': status.ok ? '1' : '0', title: status.text }),
            h('h1', { className: 'ns-title' }, detail?.book?.title || selected || t('nav')),
            selected
              ? h('button', { className: 'ns-nav-toggle', onClick: toggleNav },
                  navOpen ? t('navCollapse') : t('navExpand'))
              : null,
            selected
              ? h('button', {
                  className: 'ns-nav-toggle',
                  onClick: () => { setActive('overview'); openBook(null) },
                  title: t('closeBook'),
                }, t('closeBook'))
              : null,
            h('span', { className: 'ns-muted' }, status.text),
            h('span', { className: 'ns-spacer' }),
            coach
              ? h('button', {
                  className: 'ns-coach',
                  'data-level': coach.counts?.error ? 'error' : coach.counts?.warn ? 'warn' : 'info',
                  title: [
                    t('coachTitle'),
                    ...coach.top.map((it) => `· ${it.message}`),
                    ...(coach.drops.length ? [t('coachDrop').replace('{c}', coach.drops.join('、'))] : []),
                  ].join('\n'),
                  onClick: () => setActive('validate'),
                }, (coach.counts?.error ?? 0) + (coach.counts?.warn ?? 0) > 0
                  ? t('coachIssues').replace('{n}', (coach.counts?.error ?? 0) + (coach.counts?.warn ?? 0))
                  : t('coachClean'))
              : null,
            h('span', { className: 'ns-pill' }, `${t('stage')} ${stage ?? '—'}`)),
          error ? h('div', { className: 'ns-err' }, error) : null,
          !selected
            ? h('div', { className: 'ns-welcome' },
                h('div', { className: 'ns-empty' }, t('emptyPick')),
                h(TemplateStart, { onCreated: (id) => { loadShelf(); openBook(id) } }),
                h(Websites))
            : h(React.Fragment, null,
                active !== 'overview'
                  ? h('div', { className: 'ns-exit-bar' },
                      h('button', { className: 'ns-exit', onClick: () => setActive('overview') }, t('navExit')))
                  : null,
                navOpen ? h('div', { className: 'ns-tabs' },
                  h('button', { className: 'ns-tab', 'data-on': active === 'overview' ? '1' : '0', onClick: () => setActive('overview') }, t('overview')),
                  sections.map((s) => h('button', {
                    key: s.key,
                    className: 'ns-tab',
                    'data-on': active === s.key ? '1' : '0',
                    onClick: () => setActive(s.key),
                  }, s.zh || s.key)),
                  h('button', {
                    className: 'ns-tab',
                    'data-on': active === 'shared' ? '1' : '0',
                    onClick: () => setActive('shared'),
                  }, t('sharedTab')),
                  h('button', {
                    className: 'ns-tab',
                    'data-on': active === 'graph' ? '1' : '0',
                    onClick: () => setActive('graph'),
                  }, t('graph')),
                  h('button', {
                    className: 'ns-tab',
                    'data-on': active === 'validate' ? '1' : '0',
                    onClick: () => setActive('validate'),
                  }, t('validate')),
                  h('button', {
                    className: 'ns-tab',
                    'data-on': active === 'ai' ? '1' : '0',
                    onClick: () => setActive('ai'),
                  }, t('aiTab')),
                  h('button', {
                    className: 'ns-tab',
                    'data-on': active === 'export' ? '1' : '0',
                    onClick: () => setActive('export'),
                  }, t('exportTab')),
                  h('button', {
                    className: 'ns-tab',
                    'data-on': active === 'search' ? '1' : '0',
                    onClick: () => setActive('search'),
                  }, t('searchOpen')),
                  h('button', {
                    className: 'ns-tab',
                    'data-on': active === 'progress' ? '1' : '0',
                    onClick: () => setActive('progress'),
                  }, t('progressOpen')),
                  h('button', {
                    className: 'ns-tab',
                    'data-on': active === 'import' ? '1' : '0',
                    onClick: () => setActive('import'),
                  }, t('importOpen')),
                  h('button', {
                    className: 'ns-tab',
                    'data-on': active === 'settings' ? '1' : '0',
                    onClick: () => setActive('settings'),
                  }, t('settingsOpen'))) : null,
                !detail
                  ? h('div', { className: 'ns-empty' }, t('loading'))
                  : active === 'overview'
                    ? h(Overview, { book: detail.book, counts: detail.counts, root, sections, navOpen, onGo: (k) => setActive(k) })
                    : active === 'graph'
                      ? h(GraphPane, { book: detail.book })
                      : active === 'shared'
                        ? h(SharedPane, { book: detail.book, onCreated: (id) => { loadShelf(); openBook(id) } })
                        : active === 'ai'
                        ? h(AiPane, { book: detail.book })
                        : active === 'validate'
                          ? h(ValidatePane, { book: detail.book })
                          : active === 'export'
                            ? h(ExportPane, { book: detail.book })
                            : active === 'search'
                              ? h(SearchPane, {
                                  book: detail.book,
                                  sections,
                                  onOpen: (sec, key) => {
                                    setActive(sec)
                                    setFocus({ section: sec, id: key, at: Date.now() })
                                  },
                                })
                              : active === 'progress'
                                ? h(ProgressPane, { book: detail.book, onChanged: () => openBook(detail.book.id) })
                                : active === 'import'
                                  ? h(ImportPane, {
                                      book: detail.book,
                                      onImported: async () => {
                                        await loadShelf()
                                        await openBook(detail.book.id)
                                      },
                                    })
                                  : active === 'settings'
                                    ? h(SettingsPane, { book: detail.book, settings, onChange: setSettings })
                                    : !activeSection
                          ? h('div', { className: 'ns-empty' }, t('loading'))
                          : activeSection.kind === 'groups'
                            ? (() => {
                                const current = groups[activeSection.key] || activeSection.groups?.[0]?.key
                                const group = (activeSection.groups || []).find((g) => g.key === current)
                                if (!group) return h('div', { className: 'ns-empty' }, t('loading'))
                                return h(GroupPane, {
                                  book: detail.book,
                                  section: activeSection,
                                  group,
                                  onGroup: (k) => setGroups((g) => ({ ...g, [activeSection.key]: k })),
                                })
                              })()
            : h(UnitPane, { book: detail.book, section: activeSection, group: activeSection, focus, settings }))),
        // Enlarging is a view of the panel, not a section of it, so it is mounted
        // once here and any surface can open it.
        h(Zoom, { base: (settings && settings.fontSize) || 15 }))
    }

    function NovelIcon({ size = 20, active }) {
      const s = Math.max(14, Math.min(size, 28))
      return h('svg', {
        width: s,
        height: s,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: active ? 1.9 : 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        style: { display: 'block' },
      },
        h('path', { d: 'M12 6.5C10.6 5.2 8.6 4.6 6 4.6c-.9 0-1.7.1-2.4.3v13c.7-.2 1.5-.3 2.4-.3 2.6 0 4.6.6 6 1.9' }),
        h('path', { d: 'M12 6.5c1.4-1.3 3.4-1.9 6-1.9.9 0 1.7.1 2.4.3v13c-.7-.2-1.5-.3-2.4-.3-2.6 0-4.6.6-6 1.9' }),
        h('path', { d: 'M12 6.5v13' }))
    }

    // ── plugin ────────────────────────────────────────────────────────────

    function safely(label, fn) {
      try {
        return fn() || (() => {})
      } catch (err) {
        console.error(`[novel-studio] ${label} failed:`, err)
        return () => {}
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ensureStyle()
        ctx.effect(() => ctx.locale.register(NS, DICT), 'novel-studio: dicts')
        t = ctx.locale.bind(NS)
        // Kept for the folder dialog, resolved lazily on each click because the
        // workspace service may be registered after this panel.
        hostCtx = ctx
        safely('workspace-picker', () => ctx.inject(['uiWorkspace'], (scope) => {
          hostPick = () => scope.uiWorkspace.pickDirectory()
        }))

        safely('panellist', () => ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'novel', order: 50, label: () => t('nav'), locale: NS }, NovelIcon)))

        safely('main', () => ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'novel', locale: NS }, NovelStudio)))
      },
    }
  },
})
