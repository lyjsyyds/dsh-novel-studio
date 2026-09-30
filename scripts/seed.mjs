// dsh-novel-studio — one-shot random filler for testing.
//
// Fills the EMPTY (or under-target) sections of a book with plausible sample
// content so the panel can be exercised end to end: forms, list views, the
// relationship graph, validation, export, and the AI pane's context picker.
// Existing entries are never touched — it only tops a section up to its target.
//
//   node scripts/seed.mjs                 # first book in the library
//   node scripts/seed.mjs <book-id>       # a specific book
//
// Uses the same invoke() layer as HTTP/tools, so nothing here can write
// outside the book directory.

import { invoke } from '../lib/ops.js'

const bookArg = process.argv[2]
const listed = await invoke('books', { action: 'list' })
if (!listed.ok) throw new Error(listed.message)
const book = bookArg || listed.books[0]?.id
if (!book) {
  console.log('library is empty — create a book in the panel first')
  process.exit(0)
}

const pick = (n, pool) => {
  const shuffled = pool.slice().sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

// ── candidate pools (theme follows 星海拾遗: orbital junk, memory trade) ───

const P = {
  characters: [
    { name: '苏晚', aliases: ['晚姐'], role: '配角', age: '29', gender: '女',
      appearance: '短发，左眼下有一道旧伤，工装袖口永远磨得发白。',
      personality: '话少，记账一样记着每个人欠她什么；答应的事一定办到。',
      habits: '紧张时用拇指摩挲腕上的旧表带；喝东西只喝温的。',
      background: '在第七码头做了十年调度，见过太多船一去不回。',
      goal: '攒够一笔钱，把弟弟从地面接上来。',
      arc: '从只信数字到愿意赌一次活人。' },
    { name: '黑鹭', aliases: ['鹭爷'], role: '反派', age: '41', gender: '男',
      appearance: '永远穿着笔挺的管理局制服，领口别一只银质鹭鸟扣。',
      personality: '礼貌、克制、极端记仇；把所有交易都当成收网前的喂食。',
      background: '轨道管理局稽查司副司长，靠着记忆芯片的禁令坐稳位置。',
      goal: '把私贩记忆的渠道全部收归自己手里。',
      arc: '越想抓住轨道，越被轨道抛下。' },
    { name: '小满', role: '路人', age: '14', gender: '女',
      appearance: '营养不良的瘦，眼睛大得不合比例，头发用鱼线扎着。',
      personality: '嘴快、腿快，相信所有给她糖吃的人，除了穿制服的。',
      habits: '把偷听来的消息编成顺口溜在码头卖。',
      goal: '活下去，顺便弄清楚自己是从哪条船上来的。' },
    { name: '何三刀', aliases: ['老何'], role: '配角', age: '53', gender: '男',
      appearance: '少了两根手指的右手，围裙上全是焊点烫出的洞。',
      personality: '嘴碎心软，修东西比修人有耐心。',
      background: '退役的船体检修师，现在给拾荒帮修推进器。',
      goal: '在拆掉自己之前，把手艺传给一个不嫌脏的人。' },
  ],
  locations: [
    { name: '碎环带', type: '自然', region: '外轨道', summary: '报废空间站的坟场，也是拾荒帮的粮仓。',
      description: '绵延三百公里的金属残骸带，昼夜温差能烤熟鸡蛋也能冻裂扳手。灯一关，里面全是捡便宜的船。' },
    { name: '白塔交易所', type: '建筑', region: '中轨道', summary: '记忆芯片唯一合法的挂牌交易场。',
      description: '六角形大厅，中央悬着实时滚动的芯片行情。进去要交枪，出来要交税。' },
    { name: '地面·落霞港', type: '城市', region: '地表', summary: '所有上行票的起点，也是回不去的人的终点。',
      description: '海水常年泛着铁锈色，码头的告示牌上贴满寻人启事，一半是找上面的人，一半是找下面的人。' },
    { name: '旧引航塔', type: '遗迹', region: '外轨道', summary: '第一次轨道战争留下的哑巴哨所。',
      description: '外壳上还留着弹痕和褪色的标语，里面的时间比外面慢半拍——没人知道为什么。' },
  ],
  factions: [
    { name: '拾穗会', type: '商会', base: '白塔交易所三层', goal: '把记忆当成粮食一样定价、囤积、放贷。',
      description: '明面上是记忆芯片的合规商，实际上控制着黑市七成的估价权。' },
    { name: '守夜人', type: '组织', base: '旧引航塔', goal: '阻止任何人把整段记忆打包出售。',
      description: '成员互不相识，只靠一首换调的童谣接头。认为记忆一旦被卖，人就死了一半。' },
    { name: '林氏船族', type: '家族', base: '碎环带·三号船坞', goal: '保住家族最后一条还在跑的货船。',
      description: '三代人都在轨道上跑运输，家训是“船在人在，账不赖”。' },
  ],
  items: [
    { name: '潮汐匕首', type: '武器', rarity: '稀有', owner: '林望',
      description: '刃口用陨铁锻的，据说能切开焊死的记忆舱。刀柄上刻着潮汐表。' },
    { name: '伪轨通行证', type: '道具', rarity: '精良', owner: '苏晚',
      description: '把伪造的轨道坐标写进证件芯片，能骗过大部分闸口——除了黑鹭那种会背航线的。' },
    { name: '空芯片', type: '材料', rarity: '普通', owner: '',
      description: '没有写入任何记忆的空白芯片，黑市上按克卖。拾荒帮的硬通货。' },
    { name: '引航灯', type: '法宝', rarity: '传说', owner: '',
      description: '旧引航塔的备用信标。点亮后，所有迷航的船都会朝它转过来，包括不该来的。' },
  ],
  races: [
    { name: '环生人', traits: '在轨道出生的人，骨密度只有地面人的一半，回到地面会碎。', homeland: '各空间站',
      description: '他们管地面叫“底仓”，管重力叫“刑”。三代以上就算纯血。' },
    { name: '打捞族', traits: '常年在碎环带作业，能靠金属回声判断残骸里有没有人。', homeland: '碎环带',
      description: '不登记、不落地，孩子第一次进舱要亲手敲一块残骸。' },
  ],
  cultures: [
    { name: '码头赊账礼', customs: '借钱可以不打欠条，但必须当着第三个人的面把利息念出来。', language: '通用语·港口方言',
      taboos: '不能当着送葬船的面数钱。' },
    { name: '记忆葬', customs: '人死后，家属把他的记忆芯片拆下来，敲碎撒进碎环带。', language: '通用语·轨道敬语',
      taboos: '禁止观看别人芯片的封存仪式；偷看等于盗墓。' },
  ],
  scenes: [
    { title: '闸口对峙', chapter: '第三章', location: '白塔交易所', characters: ['林望', '黑鹭'],
      goal: '用假通行证把空芯片运出闸口。', conflict: '黑鹭亲自验票，还背出了林望家船的注册号。',
      outcome: '苏晚中途切断了监控，两人擦汗过关，但被记进了黑名单。' },
    { title: '塔里的童谣', chapter: '第三章', location: '旧引航塔', characters: ['阿枝', '小满'],
      goal: '找到守夜人的接头人。', conflict: '小满把接头暗号编成了顺口溜到处卖，接头人因此不敢现身。',
      outcome: '阿枝用一段改调的童谣换来了第一次会面。' },
    { title: '修船夜话', chapter: '第二章', location: '三号船坞', characters: ['林望', '何三刀'],
      goal: '凑钱修好推进器。', conflict: '何三刀认出推进器是黑鹭查封过的那批货。',
      outcome: '修好了船，也接下了一单不该接的活。' },
  ],
  panelsStatus: [
    { name: '体力', value: '72', max: '100', note: '连着熬了两夜，上限暂时掉到 90。' },
    { name: '意志', value: '85', max: '100', note: '看到旧影像时会扣。' },
    { name: '伤势', value: '18', max: '100', note: '右肩的贯穿伤还没好利索。' },
    { name: '饱食', value: '60', max: '100', note: '码头的合成蛋白，管饱不管香。' },
  ],
  panelsSkills: [
    { name: '拆解', level: 'Lv.7', type: '生活', description: '三分钟拆掉一枚焊死的记忆舱，不触发警报。' },
    { name: '辨伪', level: 'Lv.5', type: '感知', description: '看芯片封装的气泡分布就能认出仿品。' },
    { name: '谈判', level: 'Lv.4', type: '社交', description: '习惯先报一个自己都不信的价。' },
  ],
  panelsEquipment: [
    { name: '潮汐匕首', type: '主手', equipped: true, description: '刃口能切开焊死的记忆舱。' },
    { name: '磨损的舱外服', type: '外套', equipped: true, description: '补丁摞补丁，气密性靠运气。' },
    { name: '伪轨通行证', type: '证件', equipped: true, description: '一次性的，用过就作废。' },
  ],
  panelsTasks: [
    { title: '把空芯片运出闸口', status: '进行中', reward: '三百信用点 + 一张上行票', description: '苏晚的活，期限三天。' },
    { title: '查明弟弟的下落', status: '进行中', reward: '无', description: '最后出现在第七码头的登船记录里。' },
    { title: '替何三刀送一封口信', status: '未接', reward: '一顿热饭', description: '送到碎环带三号船坞，别问内容。' },
    { title: '黑鹭的稽查令', status: '已失败', reward: '—', description: '上一次交手留下的案底。' },
  ],
  panelsReputation: [
    { faction: '拾荒帮', value: 45, note: '帮里人认林望的手艺，不认他的姓。' },
    { faction: '轨道管理局', value: -20, note: '黑名单边缘，再犯一次就上通缉。' },
    { faction: '守夜人', value: 10, note: '还没通过考验，只算听过他们的歌。' },
  ],
  rules: [
    { name: '记忆守恒', scope: '全体', description: '一段记忆被完整取走，本人会留下对应的空白与钝痛；空白可以被填补，但填的永远不是原来那段。' },
    { name: '轨道重力差', scope: '外轨道', description: '碎环带的重力只有地面的六分之一，环生人落地超过七天会骨裂。' },
    { name: '芯片封存律', scope: '管理局辖域', description: '未经登记的记忆交易按走私论处；被查获的芯片一律敲碎，不归还失主。' },
  ],
  glossary: [
    { term: '空芯片', definition: '未写入任何记忆的空白存储体，黑市按克计价。' },
    { term: '打捞', definition: '进入残骸带回收物资或人员的行为，也指顺手牵羊。' },
    { term: '上行票', definition: '地面前往轨道的单程船票，价格随潮汐（实际是随关系）浮动。' },
    { term: '底仓', definition: '环生人对地面的蔑称，字面意思是货舱最下层。' },
    { term: '换调', definition: '守夜人接头童谣的变调方式，一段旋律七种暗号。' },
  ],
  economy: [
    { name: '信用点', unit: '点', rate: '1 点 ≈ 0.8 地面元', description: '轨道通用记账单位，无法匿名提现。' },
    { name: '芯片克价', unit: '信用点/克', rate: '随行情浮动，封存令期间暴涨', description: '黑市真正的硬通货指标。' },
    { name: '热饭券', unit: '顿', rate: '1 券 = 1 顿现做热食', description: '码头的社交货币，比信用点管用。' },
  ],
  timeline: [
    { when: '轨道历 41 年', event: '第一次轨道战争', description: '旧引航塔在战后被废弃，双方都宣称守住了航线。' },
    { when: '轨道历 57 年', event: '记忆禁令颁布', description: '管理局将未登记记忆交易定为走私，黑市随之诞生。' },
    { when: '轨道历 63 年·春', event: '第七码头大拆迁', description: '林望的弟弟在这次搬迁的登船记录里消失了。' },
    { when: '轨道历 63 年·秋', event: '碎环带发现空芯片矿脉', description: '拾穗会的股价翻了四倍，拾荒帮死了七个人。' },
  ],
  tree: [
    { title: '第一卷 · 拾荒', from: '第1章', to: '第8章', summary: '林望在碎环带捡到一枚不该存在的芯片，平静的账房生活结束。' },
    { title: '第二卷 · 换调', from: '第9章', to: '第20章', summary: '守夜人、管理局、拾穗会三方角力，林望在其中选边。' },
    { title: '第三卷 · 潮汐', from: '第21章', to: '第30章', summary: '引航灯被点亮，所有迷航的船转向同一片空域。' },
  ],
  threads: [
    { title: '芯片里的第八个人', kind: '主线', status: '进行中', summary: '那枚芯片里存着七段记忆，可封存编号是八。' },
    { title: '弟弟的下落', kind: '主线', status: '进行中', summary: '登船记录被人为抹掉了一行，抹的人姓黑。' },
    { title: '苏晚的账本', kind: '感情', status: '未开始', summary: '她记着所有人的账，唯独不记林望欠她多少。' },
    { title: '顺口溜是谁教的', kind: '悬念', status: '进行中', summary: '小满卖的暗号顺口溜，源头是一个不该会唱童谣的人。' },
  ],
  foreshadowing: [
    { title: '腕上的旧表带', planted: '第一章', payoff: '第十一章', status: '未回收',
      notes: '苏晚摩挲的表带里藏着白塔交易所的备用密钥。' },
    { title: '慢半拍的引航塔', planted: '第二章', payoff: '第二十二章', status: '未回收',
      notes: '塔内时间异常与引航灯的能量回流有关。' },
    { title: '敲残骸的规矩', planted: '第一章', payoff: '第八章', status: '已回收',
      notes: '打捞族孩子敲残骸不是祈福，是在听里面有没有活人。' },
  ],
  beats: [
    { chapter: '第一章', beat: '捡到芯片', purpose: '开篇钩子：封存编号与内容数不符。' },
    { chapter: '第二章', beat: '修船夜话', purpose: '建立何三刀的善意与管理局的阴影。' },
    { chapter: '第二章', beat: '苏晚收账', purpose: '引出感情线与她的账本习惯。' },
    { chapter: '第三章', beat: '闸口对峙', purpose: '第一次正面冲突，进黑名单。' },
    { chapter: '第三章', beat: '塔里的童谣', purpose: '把守夜人从传说拉进现实。' },
  ],
  hooks: [
    { title: '编号八的芯片', kind: '开篇', description: '第一段记忆的主人还活着——按封存记录，他应该死了三年。' },
    { title: '黑名单上的名字', kind: '章节末', description: '第三章末，闸口大屏上刷出林望的名字与“稽查”二字。' },
    { title: '童谣换调', kind: '卷末', description: '第一卷末，小满哼出的调子让黑鹭第一次失态。' },
  ],
  materials: [
    { name: '灵感速记.md', text: '# 灵感速记\n\n- 记忆按克计价的世界，穷人的记忆反而最便宜——因为没人想买普通人的日子。\n- 童谣换调：一段旋律七种暗号，旋律本身不能变，变的是停顿。\n- 闸口的黑名单是公开的，羞辱本身就是执法手段。\n' },
    { name: '设定参考.md', text: '# 设定参考\n\n- 轨道历 63 年秋，空芯片矿脉发现，克价从 12 涨到 40。\n- 环生人地面停留上限 7 天。\n- 守夜人接头暗号见「换调」，第一次接头在旧引航塔。\n- 记忆守恒律：空白可以填补，但填的不是原来那段（这是全书的哲学底座）。\n' },
  ],
  chapters: [
    { title: '第三章 白塔的行情', status: '写作中', summary: '带着空芯片过闸，黑鹭亲自验票。',
      body: '白塔交易所的行情屏从不熄灯，林望抬头时正好看见空芯片的克价跳了一个点。\n\n他把通行证捏在手心，汗把芯片边角泡得发软。队伍往前挪了一步，苏晚在后面轻轻踢了他的脚跟一下——不是催，是告诉他：别看屏幕，看人。\n\n看人是对的。闸口那头站着的人穿得笔挺，领口别着一只银质鹭鸟。\n\n“证件。”黑鹭说。他没有伸手，只是把验票机的屏幕转过来，让林望自己看那行正在被核对的注册号。\n\n林望家那条船的注册号，他倒着都会背。\n\n——他深吸一口气，把通行证放了上去。\n' },
  ],
}

// ── targets: fill until the section reaches this many entries ───────────────

const RECORD_TARGETS = {
  // Existing books are topped up to the target, never wiped: 星海拾遗 already
  // ships 4 characters / 2 locations / 2 factions / 1 item, so the targets sit
  // just above those counts to guarantee something new lands.
  characters: 6,
  'world/locations': 4, 'world/factions': 4, 'world/items': 4,
  'world/races': 2, 'world/cultures': 2, 'outline/scenes': 3,
}
const DOC_TARGETS = {
  'world/rules': P.rules.length, 'world/glossary': P.glossary.length,
  'world/economy': P.economy.length, 'world/timeline': P.timeline.length,
  'outline/tree': P.tree.length, 'outline/threads': P.threads.length,
  'outline/foreshadowing': P.foreshadowing.length, 'outline/beats': P.beats.length,
  'outline/hooks': P.hooks.length,
  'panels/status': P.panelsStatus.length, 'panels/skills': P.panelsSkills.length,
  'panels/equipment': P.panelsEquipment.length, 'panels/tasks': P.panelsTasks.length,
  'panels/reputation': P.panelsReputation.length,
}
const POOL = {
  characters: P.characters,
  'world/locations': P.locations, 'world/factions': P.factions, 'world/items': P.items,
  'world/races': P.races, 'world/cultures': P.cultures, 'outline/scenes': P.scenes,
  'world/rules': P.rules, 'world/glossary': P.glossary, 'world/economy': P.economy,
  'world/timeline': P.timeline, 'outline/tree': P.tree, 'outline/threads': P.threads,
  'outline/foreshadowing': P.foreshadowing, 'outline/beats': P.beats, 'outline/hooks': P.hooks,
  'panels/status': P.panelsStatus, 'panels/skills': P.panelsSkills,
  'panels/equipment': P.panelsEquipment, 'panels/tasks': P.panelsTasks,
  'panels/reputation': P.panelsReputation,
}

let written = 0
const note = (ok, label) => {
  if (!ok) console.log(`  ! ${label}`)
}

for (const [target, section] of [
  ...Object.entries(RECORD_TARGETS).map(([section, target]) => [target, section, null]),
  ...Object.entries(DOC_TARGETS).map(([section, target]) => [target, section, null]),
]) {
  const [sectionKey, groupKey] = section.includes('/') ? section.split('/') : [section, undefined]
  const have = await invoke('records', { action: 'list', book, section: sectionKey, group: groupKey })
  if (!have.ok) { console.log(`  ! list ${section}: ${have.message}`); continue }
  const missing = target - have.count
  if (missing <= 0) continue
  for (const data of pick(missing, POOL[section])) {
    const res = await invoke('records', { action: 'write', book, section: sectionKey, group: groupKey, data })
    note(res.ok, `${section} write: ${res.message}`)
    if (res.ok) written += 1
  }
}

// materials — files kind, addressed by name
for (const file of P.materials) {
  const res = await invoke('records', {
    action: 'write', book, section: 'materials', entry: file.name, data: { text: file.text },
  })
  if (res.ok) written += 1
  else if (!/exist/i.test(res.message)) note(false, `materials ${file.name}: ${res.message}`)
}

// chapters — a third one, so「续写」and the multi-turn thread have something to chew on
const chapters = await invoke('records', { action: 'list', book, section: 'chapters' })
if (chapters.ok && chapters.count < 3) {
  for (const data of pick(3 - chapters.count, P.chapters)) {
    const res = await invoke('records', { action: 'write', book, section: 'chapters', data })
    note(res.ok, `chapters write: ${res.message}`)
    if (res.ok) written += 1
  }
}

// a couple of manual graph edges, so 关系图 has both manual and derived rows.
// Node refs are display names (the alias map resolves them); every ref is
// checked against what actually exists first, because the pick above is random
// and an edge to a node that didn't land would just be refused.
const names = new Set()
for (const [sectionKey, groupKey] of [['characters'], ['world', 'factions'], ['world', 'locations']]) {
  const got = await invoke('records', { action: 'list', book, section: sectionKey, group: groupKey })
  if (got.ok) for (const item of got.items) names.add(item.name || item.id)
}
const edgeSeed = [
  { from: '林望', to: '苏晚', type: '搭档', note: '她记账，他跑腿', strength: 4 },
  { from: '林望', to: '拾荒帮', type: '隶属', note: '编外人员', strength: 3 },
  { from: '黑鹭', to: '轨道管理局', type: '任职', note: '稽查司副司长', strength: 5 },
  { from: '阿枝', to: '老周', type: '旧识', note: '码头认识的老交情', strength: 3 },
].filter((e) => names.has(e.from) && names.has(e.to))
let manualEdges = 0
for (const e of edgeSeed) {
  const res = await invoke('edges', { action: 'create', book, ...e })
  if (res.ok) manualEdges += 1
  else if (res.code !== 'duplicate-edge') note(false, `edge ${e.from}→${e.to}: ${res.message}`)
}

const report = await invoke('validate', { book })
const counts = await invoke('books', { action: 'get', book })
console.log(`\nbook ${book}: +${written} entries, +${manualEdges} manual edges`)
if (counts.ok) console.log('counts:', JSON.stringify(counts.counts))
if (report.ok !== undefined && report.counts) {
  console.log(`validate: ${report.counts.error} errors, ${report.counts.warn} warnings, ${report.counts.info} infos`)
  for (const x of report.issues.slice(0, 10)) console.log(`  [${x.level}] ${x.message}`)
}
