import React, { createContext, useContext, useState } from 'react'
import { BookOpen, Compass, DatabaseBackup, LibraryBig, Palette, PenLine, Sparkles, Waypoints } from 'lucide-react'

export const GuideContext = createContext(null)

const topics = [
  { id: 'shelf', title: '书架与作品', icon: LibraryBig, items: [
    ['新建与继续', '在书架新建或打开作品。再次打开时会回到上次编辑的章节。'],
    ['书库管理', '从书架右上角进入书库管理，可打开备份、AI 模型设置和页面配色。'],
    ['网站快捷入口', '通过「常用网站」保存投稿后台或常用写作网站。点击网站名称，在浏览器里打开。'],
  ] },
  { id: 'writing', title: '章节与写作', icon: PenLine, items: [
    ['切章与拉伸', '点目录切章。宽屏可拖动目录、工具区和正文／预览之间的分隔线；双击恢复默认，方向键可以微调。点「填满」可放宽纸面。'],
    ['工具与返回', '书内点创作板块会在旁边或底部打开。需要整页时点「在独立板块打开」，再用页顶「返回正文」回到本章。'],
    ['全屏专注', '点「专注模式」进入全屏。退出按钮、Esc 或 Android 返回键会恢复写作布局。'],
    ['保存正文', '底栏显示保存状态。用保存按钮或 Ctrl+S 手动保存。'],
    ['选段工具', '拖选正文并松开左键，拖住手柄可移动工具胶囊。「更多」可以整理文字、做声音明信片，或转到分岔宇宙试写。'],
    ['快照与替换', '从「工具」进入快照或查找替换。应用替换、改写或快照前，可以先对照正文。'],
  ] },
  { id: 'spaces', title: '创作空间', icon: Waypoints, items: [
    ['用 AI 起草', '打开当前板块的 AI 操作，按需补充要求和选择思考强度。核对预览后再应用。模型沿用应用的 AI 模型设置。'],
    ['策展漫游馆', '拖放展项并添加展签，点「漫游展览」可直接点选画布上的任意展项。'],
    ['声音明信片', '保存文字和来源，给八拍分别选音符或休止，点「播放旋律」试听。'],
    ['分岔宇宙', '先写两种方案，再并排记录近期后果和长期隐患。来自正文的选段可以打开对照，确认后再写回。'],
    ['取舍实验室', '为选项打分和设置权重，临时拿掉一个指标，看看排名会不会变。'],
    ['行动沙盘', '填写可投入工时和任务估时。移动任务时，顶部会按尚未完成的工时更新余量。'],
    ['即兴排演厅', '准备提示卡，用顺序走台或随机抽题，结束后查看每张卡的用时。'],
    ['规则生态舱', '点亮细胞，选一种生灭规则；逐代观察或自动演化，可以保存并回到检查点。'],
    ['卦象工坊', '选择卦术和起卦方式，保存原始排盘，或把卦象送入分岔宇宙试写。'],
  ] },
  { id: 'divination', title: '卦象工坊', icon: Compass, items: [
    ['离线起卦', '写下一个创作问题，选卦术与起卦方式，按提示填写时间或数字。原始排盘和走向权重由本地规则计算。'],
    ['AI 解读与复看', '生成创作解读或继续追问，选「采纳到笔记」保存解读。也可单独保存排盘，之后从工坊顶部打开笔记。'],
    ['送入分岔宇宙', '在卦象结果页点击发送并确认。书内打开时可接着在工具区写推演，独立板块的「返回正文」会回到原章。'],
  ] },
  { id: 'reference', title: '资料与前情', icon: Waypoints, items: [
    ['查阅作品设定', '「本章」显示当前相关的人物、地点、场景和伏笔。到「资料」查看整部作品的设定。'],
    ['前情摘要', '在「前情」编辑和确认摘要。AI 写作时，可在前情预览里确认这轮采用的内容。'],
    ['搜索工具', '按 Ctrl+K 或点顶栏的搜索图标，按名称查找功能。进入子面板后，用左上角箭头返回。'],
  ] },
  { id: 'ai', title: 'AI 与模型', icon: Sparkles, items: [
    ['设置应用默认模型', '打开「AI 模型设置」，填写服务地址和 API Key，识别并保存后可测试连接。'],
    ['更换本次生成的模型', '在「AI」点「更换模型」。可设为作品默认、仅用于下轮，或回到应用默认。'],
    ['核对生成结果', '结果上方显示该轮请求的模型。自动路由返回具体模型时，会另列实际模型。核对结果后再写入正文。'],
  ] },
  { id: 'transfer', title: '导入、导出与备份', icon: DatabaseBackup, items: [
    ['导入手稿', '在写作工具里打开导入。选择文件或粘贴 Markdown，核对预览后再写入作品。'],
    ['导出与恢复', '在「导出」保存作品，在书库管理的「备份与恢复」导出整库 ZIP，或预览备份并恢复。'],
  ] },
  { id: 'appearance', title: '昼夜与配色', icon: Palette, items: [
    ['切换昼夜', '用顶栏选择白天、夜晚或跟随系统。'],
    ['自定义颜色', '在「页面配色」分别编辑白天、夜晚的界面和纸面颜色。预览满意后点保存。'],
  ] },
]

export function GuideButton({ topic = 'writing', floating = false }) {
  const open = useContext(GuideContext)
  if (!open) return null
  return <button type="button" aria-label="使用说明" aria-haspopup="dialog"
    className={'guide-button' + (floating ? ' guide-floating' : '')} onClick={() => open(topic)}>
    <BookOpen size={17} aria-hidden /> <span><span className="guide-prefix">使用</span>说明</span>
  </button>
}

export function GuideContents({ initial }) {
  const [active, setActive] = useState(initial)
  const { icon: Icon, title, items } = topics.find(({ id }) => id === active) || topics[0]
  return <div className="studio-guide">
    <nav className="guide-topics" aria-label="说明分区">
      {topics.map(({ id, title, icon: TopicIcon }) => <button key={id} type="button" aria-pressed={active === id}
        onClick={() => setActive(id)}><TopicIcon size={16} aria-hidden />{title}</button>)}
    </nav>
    <section className="guide-section" aria-label={title}>
      <h3><Icon size={21} aria-hidden />{title}</h3>
      <dl>{items.map(([name, body]) => <div key={name}><dt>{name}</dt><dd>{body}</dd></div>)}</dl>
    </section>
  </div>
}
