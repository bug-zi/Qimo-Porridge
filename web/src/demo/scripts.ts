import type { AdjustmentProposal } from '../types'

export type DemoToolEvent = {
  name: string
  label: string
  summary: string
}

export type DemoAgentScript = {
  reply: string
  proposal?: AdjustmentProposal
  toolEvents: DemoToolEvent[]
}

/**
 * 演示模式的 AI 伴学脚本库：按关键词匹配返回预设回答。
 * 回复中的 {占位符}（如 {course}、{daysLeft}）由 demoApi 在运行时填充真实演示数据。
 * 语法刻意覆盖 Markdown 标题、列表、公式与表格，展示前端渲染能力。
 */

const TOOL_EVENTS: DemoToolEvent[] = [
  {
    name: 'search_knowledge',
    label: '正在检索课程资料…',
    summary: '找到 6 条相关资料片段',
  },
  {
    name: 'recall_memory',
    label: '正在回顾学习记录…',
    summary: '召回到 3 条历史学习偏好',
  },
  {
    name: 'update_workspace',
    label: '正在整理答案…',
    summary: '已结合当前课程进度生成回答',
  },
]

function planAdjustProposal(courseId: string, patch: { days?: number; dailyHours?: number }, examDate: string): AdjustmentProposal {
  const changes: string[] = []
  if (patch.days) changes.push(`复习天数调整为 ${patch.days} 天`)
  if (patch.dailyHours) changes.push(`每日投入调整为 ${patch.dailyHours} 小时`)
  return {
    id: `proposal-demo-${Date.now()}`,
    courseId,
    title: patch.dailyHours ? '调整每日复习时间' : '顺延考试日期并重排复习主线',
    reason: patch.dailyHours
      ? '你提到近期时间安排有变化，希望调整每天可用于复习的时间。调整后我会重新按知识点优先级装包每日任务。'
      : '你希望调整复习节奏。我会保持「先易后难、前置依赖优先」的顺序，把剩余任务重新均匀分布到新的日程上。',
    impact: `${changes.join('；')}，任务总量不变，仅重新排布到每天的任务包。`,
    status: 'pending',
    params: patch.days ? { days: patch.days, examDate } : { dailyHours: patch.dailyHours },
  }
}

const KNOWLEDGE_REPLY = `好的，我来结合 **{course}** 的复习主线讲讲这个问题。

### 核心结论

这个问题在考试中通常属于中高权重考点，建议按下面三步组织答案：

1. **先给定义**：用一句话说清它是什么，不要绕；
2. **再讲机制**：说明它为什么这样工作，最好配一个公式或流程；
3. **最后落到题型**：选择题考辨析，问答题考表述完整性。

### 可以直接套用的表述

> 该概念刻画了系统中「输入—处理—输出」的对应关系；当条件 $\\alpha$ 满足时，有
> $$F(x) = \\sum_{i=1}^{n} w_i \\cdot f_i(x)$$
> 其中各项权重由其考试频率与你的掌握度共同决定。

### 结合你的学习状态

- 你的整体进度约 **{progress}%**，距考试还有 **{daysLeft}** 天；
- 这个知识点所属的板块掌握度约 {mastery}%，建议优先完成对应的自测题确认；
- 相关任务已排入主线第 {todayDay} 天附近，今天就可以完成它。

如果想在演示里看「计划调整」能力，可以试试对我说：**“帮我推迟两天考试”** 或 **“每天多复习一小时”**。`

const PROGRESS_REPLY = `我看了下 **{course}** 的当前状态：

| 维度 | 数值 |
| --- | --- |
| 复习进度 | {progress}% |
| 今日是计划第 | {todayDay} / {maxDay} 天 |
| 今日计划时长 | {plannedToday} 分钟 |
| 今日已投入 | {spentToday} 分钟 |
| 距考试 | {daysLeft} 天 |

**建议**：今天的任务包还剩 {remaining} 分钟，优先完成高优先级任务；{overdueLine}

需要我帮你重排今天之后的任务，或调整每日复习时长吗？`

const DEFAULT_REPLY = `收到。这里是**演示模式**的预设回复——线上 Demo 不连接真实模型，仅回放本地快照数据。

在完整版里，我可以：

- 🔍 **检索课程资料**：引用你导入的课件片段回答问题；
- ✅ **直接落地操作**：帮你勾任务、记笔记、把学习时长记入日志；
- 📅 **计划调整提案**：理解“推迟考试”“每天多复习一小时”这类需求，生成待确认的提案；
- 🧠 **长期记忆**：跨会话记住你的薄弱点与学习偏好。

试着问我一个知识点（如“什么是死锁”），或让我**调整计划**看看提案流程。`

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term))
}

export function matchAgentScript(
  message: string,
  mode: 'chat' | 'agent',
  courseName: string,
): DemoAgentScript {
  const text = message.trim()

  if (includesAny(text, ['推迟', '顺延', '提前考', '延期', '考试日期', '重排', '多复习', '少复习', '每天', '计划调整', '调整计划', '增加时间', '减少时间'])) {
    const moreTime = includesAny(text, ['多', '增加', '提高']) || includesAny(text, ['一小时', '1小时'])
    const proposal = moreTime
      ? planAdjustProposal('', { dailyHours: 2.5 }, '')
      : planAdjustProposal('', { days: 6 }, '')
    return {
      reply: `明白，我来生成一份**计划调整提案**。

我的思路是：保持知识点的先后依赖顺序不变（前置先学、由易到难），只重新分配每天的“任务包”。调整前后对比已在提案卡片中展示，**你确认后我才会真正改动计划**。

- 📅 涉及参数：${moreTime ? '每日复习时长 → 2.5 小时' : '复习总天数 → 6 天'}
- 🔁 任务总量不变，日程重新装包
- ⚠️ 高优先级任务会尽量前置

请查看右侧的提案卡片，点击「应用」或「忽略」。`,
      proposal,
      toolEvents: mode === 'agent' ? TOOL_EVENTS.slice(0, 2) : [],
    }
  }

  if (includesAny(text, ['不考', '删除内容', '删掉', '移除'])) {
    return {
      reply: `好的，我理解你想缩小复习范围。

在完整版中，我会先**检索资料确认**这部分内容的考试权重，再生成一份「移除低价值任务」的提案：被移除的任务会连同其知识点权重一起释放，剩余任务按依赖顺序重新装包。演示模式下此提案仅作展示。

请在提案卡片中确认。`,
      proposal: {
        id: `proposal-demo-${Date.now()}`,
        title: '移除不考内容的关联任务',
        reason: '根据你的说明，该部分内容不在考试范围内，相关任务的学习价值为零。',
        impact: '预计移除 2-3 个任务，释放约 60 分钟/天的复习容量， redistributed 到薄弱知识点。',
        status: 'pending',
      },
      toolEvents: mode === 'agent' ? TOOL_EVENTS.slice(0, 2) : [],
    }
  }

  if (includesAny(text, ['进度', '怎么样了', '状态', '掌握', '还剩', '学得'])) {
    return {
      reply: PROGRESS_REPLY,
      toolEvents: mode === 'agent' ? TOOL_EVENTS.slice(0, 2) : [],
    }
  }

  if (text.includes('?') || text.includes('？') || includesAny(text, ['什么是', '解释', '为什么', '怎么', '如何', '讲讲', '说说', '是什么'])) {
    return {
      reply: KNOWLEDGE_REPLY.replace('{course}', courseName),
      toolEvents: mode === 'agent' ? TOOL_EVENTS : [],
    }
  }

  return {
    reply: DEFAULT_REPLY,
    toolEvents: mode === 'agent' ? TOOL_EVENTS.slice(0, 1) : [],
  }
}

/** 用演示 workspace 的实时数据填充脚本占位符 */
export function fillScriptPlaceholders(
  reply: string,
  stats: {
    course: string
    progress: number
    daysLeft: number
    mastery: number
    todayDay: number
    maxDay: number
    plannedToday: number
    spentToday: number
    remaining: number
    overdueCount: number
  },
): string {
  const overdueLine = stats.overdueCount > 0
    ? `另有 **${stats.overdueCount}** 个逾期任务，建议今天优先清掉至少一个。`
    : '当前没有逾期任务，节奏保持得不错。'
  return reply
    .replaceAll('{course}', stats.course)
    .replaceAll('{progress}', String(stats.progress))
    .replaceAll('{daysLeft}', String(stats.daysLeft))
    .replaceAll('{mastery}', String(stats.mastery))
    .replaceAll('{todayDay}', String(stats.todayDay))
    .replaceAll('{maxDay}', String(stats.maxDay))
    .replaceAll('{plannedToday}', String(stats.plannedToday))
    .replaceAll('{spentToday}', String(stats.spentToday))
    .replaceAll('{remaining}', String(stats.remaining))
    .replaceAll('{overdueLine}', overdueLine)
}
