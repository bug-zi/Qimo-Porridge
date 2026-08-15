import { Suspense, lazy, type ChangeEvent, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowRight,
  ArchiveRestore,
  BarChart3,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  Clock3,
  ExternalLink,
  Eye,
  FileText,
  Flame,
  FolderOpen,
  Gauge,
  GraduationCap,
  Lightbulb,
  Link2,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Target,
  TimerReset,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { formatReviewDays, reviewSessionDays } from '../utils/reviewSchedule'
import type {
  AdjustmentProposal,
  AgentJob,
  ArchiveItem,
  Course,
  CourseOnboarding,
  DailyProgress,
  ExternalSource,
  KnowledgePoint,
  LearningModule,
  Material,
  MaterialMemory,
  MaterialPreview,
  McpServer,
  MockAnswer,
  MockResultRecord,
  ModelProfile,
  PlanParamsAdjustRequest,
  PlanTask,
  PracticeAnswerRecord,
  QuizQuestion,
  StudyGuide,
  StudyWorkedExample,
  StudyWorkspace,
  StrategyDocuments,
  TimeLogEntry,
  UiFont,
  UiFontSize,
  WrongAnswer,
} from '../types'
import {
  approveCourseExternalSource,
  dismissCourseExternalSource,
  getCourseExternalSource,
  getCourseMaterialConvertedFileUrl,
  getCourseMaterialFileUrl,
  getCourseMaterialPreview,
  listMcpServers,
  submitCourseExternalSource,
} from '../api'
import { SettingsView } from './SettingsView'
import { PlanningView } from './PlanningView'

const CourseMindMapView = lazy(() => import('./CourseMindMapView').then((module) => ({ default: module.CourseMindMapView })))

type ModuleViewProps = {
  activeModule: LearningModule
  course: Course
  courses?: Course[]
  courseWorkspaces?: Record<string, StudyWorkspace>
  courseProgress: number
  completedTasks: number
  tasks: PlanTask[]
  knowledgePoints: KnowledgePoint[]
  practiceQuestions: QuizQuestion[]
  mockQuestions: QuizQuestion[]
  practiceAnswers?: Record<string, PracticeAnswerRecord>
  mockResult?: MockResultRecord | null
  materials: Material[]
  materialMemory?: MaterialMemory
  assessmentProfile: {
    summary: string
    questionTypes: string[]
  }
  diagnostic: {
    estimatedScore: string
    message: string
  }
  diagnosticReviewAnswers?: Record<string, number> | null
  wrongAnswers: WrongAnswer[]
  archiveItems: ArchiveItem[]
  note: string
  onboarding?: CourseOnboarding
  strategyDocuments?: StrategyDocuments
  strategyGenerationJob?: {
    courseId: string
    job: AgentJob
    elapsedSeconds: number
  } | null
  diagnosticQuestions?: QuizQuestion[]
  onTasksChange: (tasks: PlanTask[]) => void
  onWrongAnswersChange: (wrongAnswers: WrongAnswer[]) => void
  onDeleteWrongAnswer: (wrongAnswer: WrongAnswer) => void
  onRestoreArchiveItem: (archiveId: string) => void
  onNoteChange: (note: string) => void
  modelProfile: ModelProfile
  onModelProfileChange: (modelProfile: ModelProfile) => void
  theme: 'light' | 'dark'
  uiFont: UiFont
  uiFontSize: UiFontSize
  onThemeChange: (theme: 'light' | 'dark') => void
  onUiFontChange: (font: UiFont) => void
  onUiFontSizeChange: (fontSize: UiFontSize) => void
  onModuleChange: (module: LearningModule) => void
  onRescanMaterials: () => Promise<void>
  onUploadMaterials: (files: FileList) => Promise<void>
  onDeleteMaterial: (material: Material) => Promise<void>
  onSaveCourseSetup: (payload: {
    courseName: string
    examDate: string
    targetScore: number
    targetText: string
    dailyHours: number
    days: number
    reviewCount: number
    examFormat: string
    remarks: string
  }) => Promise<void>
  onSubmitDiagnostic: (answers: Record<string, number>) => Promise<void>
  onGenerateStrategyDocuments: () => Promise<void>
  onApproveStrategyDocuments: (payload: {
    reviewPlan: string
    coursePrompt: string
    reviewPlanVersion: number
    coursePromptVersion: number
  }) => Promise<void>
  onRefreshWorkspace: () => Promise<void>
  onRepairStrategyGeneration: () => Promise<void>
  onSaveCoursePrompt: (coursePrompt: string, version: number) => Promise<void>
  onMaterialPreviewOpenChange: (isOpen: boolean) => void
  materialPreviewPath: string | null
  onMaterialPreviewRequestHandled: () => void
  onSubmitPractice: (
    questionId: string,
    answerIndex: number,
    mode?: '主线学习' | '刷题练习',
  ) => Promise<{
    correct: boolean
    explanation: string
    mastery: number
    generatedSimilarCount: number
  }>
  onSubmitWrongAnswer: (wrongAnswerId: string, answerIndex: number) => Promise<{
    correct: boolean
    explanation: string
    mastery: number
    generatedSimilarCount: number
  }>
  onSubmitMock: (answers: Record<string, MockAnswer>) => Promise<{
    score: number
    total: number
    results: Array<{ id: string; correct: boolean; earnedScore?: number; explanation: string; mastery: number; generatedSimilarCount: number }>
  }>
  onClearPracticeAnswer?: (questionId: string) => Promise<void> | void
  onClearMockResult?: () => Promise<void> | void
  onActiveStudyTaskChange?: (taskId: string | null) => void
  planStartDate?: string
  timeLog?: TimeLogEntry[]
  dailyProgress?: DailyProgress
  pendingProposals?: AdjustmentProposal[]
  onRecordTime?: (taskId: string | null, minutes: number, date?: string, note?: string) => Promise<void>
  onDeleteTime?: (entryId: string) => Promise<void>
  onApplyProposal?: (proposalId: string) => Promise<void>
  onDismissProposal?: (proposalId: string) => Promise<void>
  onAdjustPlanParams?: (payload: PlanParamsAdjustRequest) => Promise<void>
}

const moduleTitles: Record<LearningModule, { title: string; subtitle: string }> = {
  overview: { title: '学习总览', subtitle: '先看全局，再攻重点' },
  materials: { title: '资料库', subtitle: '课程资料、真题和解析记录' },
  planning: { title: '规划', subtitle: '按月查看每日复习节奏' },
  mindmap: { title: '知识地图', subtitle: '无限画布里的课程结构和薄弱点' },
  plan: { title: '数据结构 · 复习主线', subtitle: '根据你的掌握度动态排序' },
  practice: { title: '刷题练习', subtitle: '围绕高权重薄弱点进行定向训练' },
  mock: { title: '模拟卷演练', subtitle: '在接近真实考试的节奏里验证掌握度' },
  notes: { title: '复习笔记', subtitle: '把易错结论沉淀成自己的语言' },
  errors: { title: '错题回顾', subtitle: '弄清为什么错，比再做一遍更重要' },
  archive: { title: '归档', subtitle: '删除内容先暂存 7 天' },
  settings: { title: '设置', subtitle: '模型、界面和本地数据偏好' },
}

const UNKNOWN_CHOICE_LABEL = '不会'

type CourseSetupDraft = {
  courseName: string
  examDate: string
  targetText: string
  targetTextIsCustom: boolean
  targetScore: string
  days: string
  reviewCount: string
  dailyHours: string
  examFormat: string
  remarks: string
}

function courseSetupDraftKey(courseId: string) {
  return `final-congee-course-setup-draft:${courseId}`
}

function defaultTargetText(targetScore: string | number) {
  const normalizedScore = String(targetScore).trim()
  return normalizedScore ? `保证 ${normalizedScore} 分` : ''
}

function calculateReviewDaysFromExamDate(examDate: string, now = new Date()) {
  const match = examDate.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const examDay = new Date(year, month - 1, day)
  if (examDay.getFullYear() !== year || examDay.getMonth() !== month - 1 || examDay.getDate() !== day) {
    return null
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayMilliseconds = 24 * 60 * 60 * 1000
  return Math.min(30, Math.max(1, Math.ceil((examDay.getTime() - today.getTime()) / dayMilliseconds)))
}

function isDefaultTargetText(targetText: string) {
  return /^保证\s*\d+(?:\.\d+)?\+?\s*(?:分)?(?:\s*不挂科)?$/.test(targetText.trim())
}

function readCourseSetupDraft(courseId: string): CourseSetupDraft | null {
  try {
    const savedDraft = window.sessionStorage.getItem(courseSetupDraftKey(courseId))
    if (!savedDraft) return null
    const parsedDraft = JSON.parse(savedDraft) as CourseSetupDraft
    if (
      typeof parsedDraft.courseName !== 'string'
      || typeof parsedDraft.examDate !== 'string'
      || typeof parsedDraft.targetText !== 'string'
      || typeof parsedDraft.targetTextIsCustom !== 'boolean'
      || typeof parsedDraft.targetScore !== 'string'
      || typeof parsedDraft.days !== 'string'
      || typeof parsedDraft.reviewCount !== 'string'
      || typeof parsedDraft.dailyHours !== 'string'
      || typeof parsedDraft.examFormat !== 'string'
      || typeof parsedDraft.remarks !== 'string'
    ) {
      return null
    }
    return parsedDraft
  } catch {
    return null
  }
}

function saveCourseSetupDraft(courseId: string, draft: CourseSetupDraft) {
  try {
    window.sessionStorage.setItem(courseSetupDraftKey(courseId), JSON.stringify(draft))
  } catch {
    // 浏览器禁用会话存储时保留当前页面状态，不阻断课程初始化。
  }
}

function clearCourseSetupDraft(courseId: string) {
  try {
    window.sessionStorage.removeItem(courseSetupDraftKey(courseId))
  } catch {
    // 浏览器禁用会话存储时无需额外处理。
  }
}

function ProgressRing({ value, size = 54 }: { value: number; size?: number }) {
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference
  return (
    <span className="progress-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="ring-track" cx="22" cy="22" r={radius} />
        <circle
          className="ring-value"
          cx="22"
          cy="22"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <b>{value}%</b>
    </span>
  )
}

function KnowledgeBars({ knowledgePoints }: { knowledgePoints: KnowledgePoint[] }) {
  const tones = ['rose', 'amber', 'orange']
  const rows = [...knowledgePoints]
    .sort((left, right) => left.mastery - right.mastery || right.weight - left.weight)
    .slice(0, 3)
    .map((point, index) => ({ name: point.name, value: point.mastery, tone: tones[index] }))
  return (
    <div className="knowledge-bars">
      {rows.map((row, index) => (
        <div className="knowledge-row" key={row.name}>
          <span className={`rank-badge ${row.tone}`}>{index + 1}</span>
          <span className="knowledge-name">{row.name}</span>
          <span className="knowledge-bar"><i style={{ width: `${row.value}%` }}></i></span>
          <b>{row.value}%</b>
        </div>
      ))}
    </div>
  )
}

function TaskRow({
  task,
  onStudy,
  onPractice,
}: {
  task: PlanTask
  onStudy: () => void
  onPractice: () => void
}) {
  const isCompleted = task.status === 'completed'
  const isContentPending = Boolean(task.contentQualityWarning && !task.studyGuide)
  const actionLabel = isContentPending ? '内容生成中' : isCompleted ? '复习巩固' : task.status === 'in-progress' ? '继续学习' : '开始学习'
  const guidePreview = task.studyGuide?.examPoints?.length
    ? `本节覆盖：${task.studyGuide.examPoints.map((point) => point.title).join('、')}`
    : task.studyGuide?.objectives?.[0]

  return (
    <article className={`plan-task ${task.status === 'completed' ? 'is-completed' : ''}`}>
      <div className={`task-order ${task.priority}`}>
        {isCompleted ? <Check size={17} /> : task.order}
      </div>
      <div className="task-details">
        <div className="task-title-line">
          <h3>{task.title}</h3>
          <span>权重 {task.weight}%</span>
          {task.priority === 'high' && <em>高优先级</em>}
        </div>
        <p>{task.description}</p>
        {guidePreview && <small>速成讲解：{guidePreview}</small>}
        {task.schedulingReason && <small className="task-scheduling-reason">为什么排在这：{task.schedulingReason}</small>}
        {task.contentQualityWarning && <small className="task-content-warning">{task.contentQualityWarning}</small>}
      </div>
      <div className="task-progress">
        <span><Clock3 size={14} /> 预计 {task.duration} 分钟</span>
        <div className="task-progress-line"><i style={{ width: `${task.progress}%` }}></i></div>
        <b>进度 {task.progress}%</b>
      </div>
      <div className="task-actions">
        <button className="soft-action" type="button" disabled={isContentPending} onClick={onStudy}>
          {isCompleted ? <RotateCcw size={15} /> : <Play size={15} />}
          {actionLabel}
        </button>
        <button className="soft-action" type="button" disabled={isContentPending} onClick={onPractice}>
          <Target size={15} /> 进入练习
        </button>
      </div>
    </article>
  )
}

function OverviewView({
  course,
  courseProgress,
  completedTasks,
  tasks,
  knowledgePoints,
  diagnostic,
  assessmentProfile,
  dailyProgress,
  onModuleChange,
  onStudyTask,
}: Pick<
  ModuleViewProps,
  | 'course'
  | 'courseProgress'
  | 'completedTasks'
  | 'tasks'
  | 'knowledgePoints'
  | 'diagnostic'
  | 'assessmentProfile'
  | 'dailyProgress'
  | 'onModuleChange'
> & {
  onStudyTask: (taskId: string) => void
}) {
  // “今天”对应第几天由 dailyProgress.todayDay 决定，不能写死第 1 天，
  // 否则学到第 2 天及以后时，总览仍只显示第 1 天的任务（看起来“课程不完全”）。
  const todayDay = dailyProgress?.todayDay ?? 1
  const todayTasks = tasks.filter((task) => task.day === todayDay)
  const todayMinutes = todayTasks.reduce((sum, task) => sum + task.duration, 0)
  const todayCompleted = todayTasks.filter((task) => task.status === 'completed').length

  return (
    <div className="module-page overview-page">
      <section className="overview-head">
        <div>
          <p className="page-kicker"><Sparkles size={15} /> 已为你更新今日优先级</p>
          <h1>把有限时间，花在最会提分的地方。</h1>
          <p className="overview-intro">当前课程是 <strong>{course.name}</strong>。完成下面的高优任务后，系统会根据你的表现重新安排明天。</p>
        </div>
        <button className="primary-button" type="button" onClick={() => onModuleChange('plan')}>
          查看复习主线 <ArrowRight size={16} />
        </button>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <span>预期分数</span>
          <strong>{diagnostic.estimatedScore.replace(' 分', '')} <small>分</small></strong>
          <p><BarChart3 size={14} /> 目标 {course.targetScore}+ 分</p>
        </article>
        <article className="metric-card">
          <span>复习进度</span>
          <strong>{courseProgress}<small>%</small></strong>
          <p><ListChecks size={14} /> 已完成 {completedTasks} 项任务</p>
        </article>
        <article className="metric-card">
          <span>薄弱知识点</span>
          <strong>{Math.min(3, knowledgePoints.length)} <small>个</small></strong>
          <p><CircleAlert size={14} /> {knowledgePoints.slice().sort((a, b) => a.mastery - b.mastery).slice(0, 2).map((point) => point.name).join('、')}</p>
        </article>
        <article className="metric-card">
          <span>今日可用</span>
          <strong>{course.dailyHours}<small>h</small></strong>
          <p><Clock3 size={14} /> 已安排 {Math.floor(todayMinutes / 60)} 小时</p>
        </article>
      </section>

      <section className="content-panel diagnostic-panel">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">自适应摸底结果</span>
            <h2>你的分数卡在这些地方</h2>
          </div>
          <button type="button" onClick={() => onModuleChange('practice')}>查看详情 <ChevronRight size={15} /></button>
        </header>
        <div className="diagnostic-content">
          <div className="weakness-block">
            <span>薄弱点 TOP 3</span>
            <KnowledgeBars knowledgePoints={knowledgePoints} />
          </div>
          <div className="recommendation-block">
            <span>优化建议</span>
            <ul>
              <li><Lightbulb size={16} /> {assessmentProfile.summary.slice(0, 150)}{assessmentProfile.summary.length > 150 ? '…' : ''}</li>
              <li><Flame size={16} /> {diagnostic.message.slice(0, 120)}{diagnostic.message.length > 120 ? '…' : ''}</li>
              <li><Target size={16} /> 每天严格控制在 {course.dailyHours} 小时，优先完成高权重任务</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="plan-preview">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">今天的主线</span>
            <h2>先保底，再冲分</h2>
          </div>
          <span className="plan-summary">{todayCompleted}/{todayTasks.length} 已完成</span>
        </header>
        <div className="task-list">
          {todayTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onStudy={() => onStudyTask(task.id)}
              onPractice={() => onModuleChange('practice')}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function RebalanceProposalCard({
  proposal,
  onApply,
  onDismiss,
}: {
  proposal: AdjustmentProposal
  onApply: (proposalId: string) => Promise<void> | void
  onDismiss: (proposalId: string) => Promise<void> | void
}) {
  const [pending, setPending] = useState<'apply' | 'dismiss' | null>(null)
  const before = (proposal.before ?? {}) as { totalMinutes?: number; tasks?: unknown[] }
  const after = (proposal.after ?? {}) as { totalMinutes?: number; tasks?: unknown[] }
  const beforeMinutes = typeof before.totalMinutes === 'number' ? before.totalMinutes : null
  const afterMinutes = typeof after.totalMinutes === 'number' ? after.totalMinutes : null

  async function handleApply() {
    setPending('apply')
    try {
      await onApply(proposal.id)
    } finally {
      setPending(null)
    }
  }

  async function handleDismiss() {
    setPending('dismiss')
    try {
      await onDismiss(proposal.id)
    } finally {
      setPending(null)
    }
  }

  return (
    <article className="rebalance-proposal">
      <header>
        <span className="rebalance-badge"><TimerReset size={14} /> 计划调整建议</span>
        <h4>{proposal.title}</h4>
      </header>
      <div className="rebalance-body">
        <p><strong>原因：</strong>{proposal.reason}</p>
        <p><strong>效果：</strong>{proposal.impact}</p>
        {beforeMinutes !== null && afterMinutes !== null && beforeMinutes !== afterMinutes && (
          <p className="rebalance-delta">
            计划总时长：{beforeMinutes}m → <strong>{afterMinutes}m</strong>
            （{afterMinutes > beforeMinutes ? `+${afterMinutes - beforeMinutes}` : afterMinutes - beforeMinutes}m）
          </p>
        )}
      </div>
      <footer>
        <button className="secondary-button" type="button" disabled={pending !== null} onClick={handleDismiss}>
          {pending === 'dismiss' ? <LoaderCircle className="is-spinning" size={15} /> : <X size={15} />}
          暂不调整
        </button>
        <button className="primary-button" type="button" disabled={pending !== null} onClick={handleApply}>
          {pending === 'apply' ? <LoaderCircle className="is-spinning" size={15} /> : <Check size={15} />}
          采纳调整
        </button>
      </footer>
    </article>
  )
}

type PlanDraft = {
  duration: number
  day: number
  removed: boolean
}

function AdjustTodayPlanDialog({
  open,
  onClose,
  tasks,
  knowledgePoints,
  dailyProgress,
  onTasksChange,
  onRefreshWorkspace,
}: {
  open: boolean
  onClose: () => void
  tasks: PlanTask[]
  knowledgePoints?: KnowledgePoint[]
  dailyProgress?: DailyProgress
  onTasksChange: (tasks: PlanTask[]) => void
  onRefreshWorkspace: () => Promise<void> | void
}) {
  const todayDay = dailyProgress?.todayDay ?? 1
  const focusTasks = tasks.filter((task) => (task.day ?? todayDay) <= todayDay)
  const otherTasks = tasks.filter((task) => (task.day ?? todayDay) > todayDay)
  // 前置依赖提示：任务草稿 day 早于其未完成前置知识点任务的最大 day 时，行内提示会被后端自动顺延。
  const prereqGateByTask: Record<string, number> = {}
  if (knowledgePoints?.length) {
    const tasksByKp = new Map<string, PlanTask[]>()
    for (const task of tasks) {
      if (!task.knowledgePointId) continue
      tasksByKp.set(task.knowledgePointId, [...(tasksByKp.get(task.knowledgePointId) ?? []), task])
    }
    for (const task of tasks) {
      const point = knowledgePoints.find((item) => item.id === task.knowledgePointId)
      if (!point?.prerequisites?.length) continue
      let gateDay = 0
      for (const prereqId of point.prerequisites) {
        for (const prereqTask of tasksByKp.get(prereqId) ?? []) {
          if (prereqTask.status === 'completed') continue
          gateDay = Math.max(gateDay, prereqTask.day ?? todayDay)
        }
      }
      if (gateDay > 0) prereqGateByTask[task.id] = gateDay
    }
  }
  const [drafts, setDrafts] = useState<Record<string, PlanDraft>>({})
  const [pulledTaskId, setPulledTaskId] = useState('')
  const [isAiReplanning, setIsAiReplanning] = useState(false)

  useEffect(() => {
    if (!open) return
    const nextDrafts: Record<string, PlanDraft> = {}
    for (const task of tasks) {
      nextDrafts[task.id] = { duration: task.duration, day: task.day ?? todayDay, removed: false }
    }
    setDrafts(nextDrafts)
    setPulledTaskId('')
  }, [open, tasks])

  if (!open) return null

  function patchTask(taskId: string, patch: Partial<PlanDraft>) {
    setDrafts((current) => ({
      ...current,
      [taskId]: { ...(current[taskId] ?? { duration: 0, day: todayDay, removed: false }), ...patch },
    }))
  }

  function applyEdits() {
    const remaining: PlanTask[] = []
    for (const task of tasks) {
      const draft = drafts[task.id]
      if (!draft || draft.removed) continue
      const nextDay = Math.max(1, Math.min(30, Number(draft.day) || task.day || todayDay))
      const nextDuration = Math.max(5, Math.min(720, Number(draft.duration) || task.duration))
      remaining.push({ ...task, day: nextDay, duration: nextDuration })
    }
    remaining.sort((left, right) => (left.day ?? todayDay) - (right.day ?? todayDay) || left.order - right.order)
    const dayOrder: Record<number, number> = {}
    for (const task of remaining) {
      const taskDay = task.day ?? todayDay
      dayOrder[taskDay] = (dayOrder[taskDay] ?? 0) + 1
      task.order = dayOrder[taskDay]
    }
    onTasksChange(remaining)
    onClose()
  }

  async function askAiReplan() {
    setIsAiReplanning(true)
    try {
      await onRefreshWorkspace()
    } finally {
      setIsAiReplanning(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="adjust-plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adjust-plan-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="adjust-plan-head">
          <div>
            <h2 id="adjust-plan-title">调整今日计划</h2>
            <p>
              第 {todayDay} 天
              {dailyProgress ? ` · 已学 ${dailyProgress.spentToday}m / 计划 ${dailyProgress.plannedToday}m · 剩余 ${dailyProgress.remaining}m` : ''}
            </p>
          </div>
          <button className="icon-close" type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="adjust-plan-body">
          <section className="adjust-plan-group">
            <span className="adjust-plan-group-title">今天及之前的任务</span>
            {focusTasks.length === 0 && <p className="adjust-plan-empty">今天没有安排任务。</p>}
            {focusTasks.map((task) => {
              const draft = drafts[task.id] ?? { duration: task.duration, day: task.day, removed: false }
              return (
                <div className={`adjust-plan-row ${draft.removed ? 'is-removed' : ''}`} key={task.id}>
                  <label className="adjust-plan-remove">
                    <input
                      type="checkbox"
                      checked={draft.removed}
                      onChange={(event) => patchTask(task.id, { removed: event.target.checked })}
                    />
                  </label>
                  <div className="adjust-plan-row-title">
                    <strong>{task.title}</strong>
                    <small>第 {task.day} 天 · 当前 {task.duration}m</small>
                  </div>
                  <label className="adjust-plan-field">
                    <span>时长(m)</span>
                    <input
                      type="number"
                      min={5}
                      max={720}
                      value={draft.duration}
                      onChange={(event) => patchTask(task.id, { duration: Number(event.target.value) })}
                    />
                  </label>
                  <label className="adjust-plan-field">
                    <span>移至第几天</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={draft.day}
                      onChange={(event) => patchTask(task.id, { day: Number(event.target.value) })}
                    />
                    {(prereqGateByTask[task.id] ?? 0) > draft.day && (
                      <small className="adjust-plan-prereq-hint">
                        有未完成前置知识点，保存后将被自动顺延到第 {prereqGateByTask[task.id]} 天之后
                      </small>
                    )}
                  </label>
                </div>
              )
            })}
          </section>

          {otherTasks.length > 0 && (
            <section className="adjust-plan-pull">
              <span className="adjust-plan-group-title">把后续任务拉到今天</span>
              <div className="adjust-plan-pull-row">
                <select value={pulledTaskId} onChange={(event) => setPulledTaskId(event.target.value)}>
                  <option value="">选择一个任务…</option>
                  {otherTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      第 {task.day} 天 · {task.title}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!pulledTaskId}
                  onClick={() => {
                    if (pulledTaskId) patchTask(pulledTaskId, { day: todayDay })
                    setPulledTaskId('')
                  }}
                >
                  拉到今天
                </button>
              </div>
            </section>
          )}
        </div>

        <footer className="adjust-plan-actions">
          <button className="secondary-button" type="button" disabled={isAiReplanning} onClick={askAiReplan}>
            {isAiReplanning ? <LoaderCircle className="is-spinning" size={15} /> : <Sparkles size={15} />}
            让 AI 重新规划
          </button>
          <div className="adjust-plan-actions-right">
            <button className="secondary-button" type="button" onClick={onClose}>取消</button>
            <button className="primary-button" type="button" onClick={applyEdits}>
              <Check size={15} /> 保存调整
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function AdjustPlanParamsDialog({
  open,
  onClose,
  course,
  onboarding,
  dailyProgress,
  onAdjustPlanParams,
}: {
  open: boolean
  onClose: () => void
  course: Course
  onboarding?: CourseOnboarding
  dailyProgress?: DailyProgress
  onAdjustPlanParams: (payload: PlanParamsAdjustRequest) => Promise<void>
}) {
  const currentExam = course.examDate ?? ''
  const currentHours = course.dailyHours ?? 2
  const currentDays = onboarding?.days ?? calculateReviewDaysFromExamDate(currentExam) ?? 14
  const todayDay = dailyProgress?.todayDay ?? 1

  const [examDate, setExamDate] = useState(currentExam)
  const [days, setDays] = useState(String(currentDays))
  const [dailyHours, setDailyHours] = useState(String(currentHours))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setExamDate(currentExam)
    setDays(String(currentDays))
    setDailyHours(String(currentHours))
    setError('')
  }, [open, currentExam, currentDays, currentHours])

  if (!open) return null

  const trimmedExam = examDate.trim()
  const nextDays = Math.max(1, Math.min(30, Number(days) || currentDays))
  const nextHours = Math.max(0.5, Math.min(12, Number(dailyHours) || currentHours))
  const examChanged = trimmedExam !== currentExam.trim()
  const daysChanged = nextDays !== currentDays
  const hoursChanged = Math.abs(nextHours - currentHours) > 1e-9
  const willReplan = daysChanged || hoursChanged
  const hasChange = examChanged || daysChanged || hoursChanged
  const overCompress = nextDays < todayDay
  const estimatedFromExam = trimmedExam ? calculateReviewDaysFromExamDate(trimmedExam) : null

  async function submit() {
    if (!hasChange || isSubmitting) return
    setError('')
    setIsSubmitting(true)
    try {
      const payload: PlanParamsAdjustRequest = {}
      if (examChanged) payload.examDate = trimmedExam
      if (daysChanged) payload.days = nextDays
      if (hoursChanged) payload.dailyHours = nextHours
      await onAdjustPlanParams(payload)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '调整失败，请稍后再试。')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="adjust-plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adjust-plan-params-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="adjust-plan-head">
          <div>
            <h2 id="adjust-plan-params-title">调整复习参数</h2>
            <p>修改考试日期、复习天数或每日时间。已完成任务与已生成讲义不受影响。</p>
          </div>
          <button className="icon-close" type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="adjust-plan-body">
          <section className="adjust-plan-group">
            <span className="adjust-plan-group-title">复习参数</span>
            <label className="adjust-plan-field">
              <span>考试日期</span>
              <input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
            </label>
            {examChanged && estimatedFromExam !== null && !daysChanged && (
              <p className="adjust-plan-empty">按新考试日期推算约 {estimatedFromExam} 天，如需同步请手动改复习天数。</p>
            )}
            <label className="adjust-plan-field">
              <span>复习天数（1–30）</span>
              <input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            </label>
            <label className="adjust-plan-field">
              <span>每日复习时间（小时，0.5–12）</span>
              <input
                type="number"
                min={0.5}
                max={12}
                step={0.5}
                value={dailyHours}
                onChange={(event) => setDailyHours(event.target.value)}
              />
            </label>
          </section>

          <section className="adjust-plan-group">
            <span className="adjust-plan-group-title">影响预估</span>
            <p className="adjust-plan-empty">
              当前：第 {todayDay} 天 · 共 {currentDays} 天 · 每日 {currentHours}h（{Math.round(currentHours * 60)}m）
            </p>
            {(daysChanged || hoursChanged) && (
              <p className="adjust-plan-empty">
                调整后：共 {nextDays} 天 · 每日 {nextHours}h（{Math.round(nextHours * 60)}m）
              </p>
            )}
            {overCompress && (
              <p className="today-time-warning"><CircleAlert size={14} /> 剩余任务会被压缩到近期，可能超额。</p>
            )}
            {willReplan ? (
              <p className="adjust-plan-empty">天数或每日时间变化，将生成「重新编排方案」，预览后再决定是否采纳。</p>
            ) : examChanged ? (
              <p className="adjust-plan-empty">仅考试日期变化，保存后刷新复习计划文档，不重排任务。</p>
            ) : null}
          </section>
        </div>

        {error && (
          <p className="today-time-warning" role="alert"><CircleAlert size={14} /> {error}</p>
        )}

        <footer className="adjust-plan-actions">
          <button className="secondary-button" type="button" disabled={isSubmitting} onClick={onClose}>取消</button>
          <button className="primary-button" type="button" disabled={!hasChange || isSubmitting} onClick={submit}>
            {isSubmitting ? <LoaderCircle className="is-spinning" size={15} /> : <SlidersHorizontal size={15} />}
            {willReplan ? '生成重新编排方案' : '保存'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function PlanView({
  course,
  tasks,
  knowledgePoints,
  onboarding,
  strategyGenerationJob,
  onModuleChange,
  onRefreshWorkspace,
  onRepairStrategyGeneration,
  onStudyTask,
  dailyProgress,
  pendingProposals,
  onTasksChange,
  onApplyProposal,
  onDismissProposal,
  onAdjustPlanParams,
}: Pick<
  ModuleViewProps,
  | 'course'
  | 'tasks'
  | 'knowledgePoints'
  | 'onboarding'
  | 'strategyGenerationJob'
  | 'onModuleChange'
  | 'onRefreshWorkspace'
  | 'onRepairStrategyGeneration'
  | 'dailyProgress'
  | 'pendingProposals'
  | 'onTasksChange'
  | 'onApplyProposal'
  | 'onDismissProposal'
  | 'onAdjustPlanParams'
> & {
  onStudyTask: (taskId: string) => void
}) {
  const [isRefreshingGeneration, setIsRefreshingGeneration] = useState(false)
  const [isRepairingGeneration, setIsRepairingGeneration] = useState(false)
  const [generationActionError, setGenerationActionError] = useState('')
  const activeGenerationJob = strategyGenerationJob?.courseId === course.id ? strategyGenerationJob : null
  const isGeneratingPlan = activeGenerationJob && ['queued', 'running'].includes(activeGenerationJob.job.status)
  const pendingContentCount = tasks.filter((task) => task.contentQualityWarning && !task.studyGuide).length
  const completedContentCount = tasks.filter((task) => task.studyGuide).length
  const [isAdjustDialogOpen, setIsAdjustDialogOpen] = useState(false)
  const [isParamsDialogOpen, setIsParamsDialogOpen] = useState(false)
  const todayDay = dailyProgress?.todayDay ?? 1
  const todayTasks = tasks.filter((task) => task.day === todayDay)
  const todayMinutes = todayTasks.reduce((sum, task) => sum + task.duration, 0)
  const spentToday = dailyProgress?.spentToday ?? 0
  const plannedToday = dailyProgress?.plannedToday ?? todayMinutes
  const remainingToday = dailyProgress?.remaining ?? Math.max(0, todayMinutes - spentToday)
  const overdueCount = dailyProgress?.overdue?.length ?? 0
  const overBudget = Boolean(dailyProgress?.overBudget)
  const progressPercent = plannedToday > 0 ? Math.min(100, Math.round((spentToday / plannedToday) * 100)) : 0
  const activeProposals = pendingProposals ?? []
  const highPriorityCount = tasks.filter((task) => task.priority === 'high' && task.status !== 'completed').length

  async function refreshGenerationStatus() {
    setIsRefreshingGeneration(true)
    setGenerationActionError('')
    try {
      await onRefreshWorkspace()
    } catch (refreshError) {
      setGenerationActionError(refreshError instanceof Error ? refreshError.message : '刷新生成状态失败')
    } finally {
      setIsRefreshingGeneration(false)
    }
  }

  async function repairGeneration() {
    setIsRepairingGeneration(true)
    setGenerationActionError('')
    try {
      await onRepairStrategyGeneration()
    } catch (repairError) {
      setGenerationActionError(repairError instanceof Error ? repairError.message : '重新生成失败')
    } finally {
      setIsRepairingGeneration(false)
    }
  }

  return (
    <div className="module-page plan-page">
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><Target size={15} /> 考试权重 × 掌握度 × 时间压力</p>
          <h1>{course.name} · 复习主线</h1>
          <p>优先完成标记为高优先级的任务。每次练习后，计划会产生新的调整建议。</p>
        </div>
        <div className="plan-heading-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="secondary-button" type="button" onClick={() => setIsParamsDialogOpen(true)}>
            <SlidersHorizontal size={16} /> 调整复习参数
          </button>
          <button className="secondary-button" type="button" onClick={() => setIsAdjustDialogOpen(true)}>
            <TimerReset size={16} /> 调整今日计划
          </button>
        </div>
      </section>

      {(activeGenerationJob || pendingContentCount > 0) && (
        <section className={`plan-generation-status is-${activeGenerationJob?.job.status ?? 'partial'}`}>
          <div className="plan-generation-status-icon">
            {isGeneratingPlan || !activeGenerationJob ? <RefreshCw className={isGeneratingPlan ? 'is-spinning' : ''} size={20} /> : <CheckCircle2 size={20} />}
          </div>
          <div>
            <strong>
              {activeGenerationJob?.job.status === 'failed'
                ? '复习主线后台生成失败'
                : activeGenerationJob?.job.status === 'completed'
                  ? '复习主线已生成完成'
                  : activeGenerationJob
                    ? '复习主线正在后台生成'
                    : '复习主线内容正在分批补齐'}
            </strong>
            <p>
              {activeGenerationJob
                ? `已运行 ${activeGenerationJob.elapsedSeconds} 秒 · 已完成 ${completedContentCount}/${completedContentCount + pendingContentCount} 节`
                : `已完成 ${completedContentCount} 项，待补齐 ${pendingContentCount} 项`}
              {activeGenerationJob?.job.status === 'running' ? ` · 第 ${activeGenerationJob.job.attempts} 次执行` : ''}
              {activeGenerationJob?.job.status === 'queued' ? ' · 等待后台 worker 接手' : ''}
            </p>
            {activeGenerationJob?.job.error && <p role="alert">{activeGenerationJob.job.error}</p>}
            {generationActionError && <p role="alert">{generationActionError}</p>}
          </div>
          <div className="plan-generation-actions">
            <button className="secondary-button" type="button" disabled={isRefreshingGeneration} onClick={refreshGenerationStatus}>
              <RefreshCw className={isRefreshingGeneration ? 'is-spinning' : ''} size={16} /> {isRefreshingGeneration ? '刷新中' : '刷新状态'}
            </button>
            {(activeGenerationJob?.job.status === 'failed' || pendingContentCount > 0) && (
              <button className="primary-button" type="button" disabled={Boolean(isGeneratingPlan) || isRepairingGeneration} onClick={repairGeneration}>
                <RotateCcw size={16} /> {isRepairingGeneration ? '正在修复' : '修复生成'}
              </button>
            )}
          </div>
        </section>
      )}

      <section className={`today-time-panel ${overBudget ? 'is-over-budget' : ''}`}>
        <div className="today-time-stats">
          <div className="today-time-stat">
            <span>今天</span>
            <strong>第 {todayDay} 天</strong>
          </div>
          <div className="today-time-stat">
            <span>已学 / 计划</span>
            <strong>{spentToday}m / {plannedToday}m</strong>
          </div>
          <div className="today-time-stat">
            <span>{overBudget ? '超出' : '剩余'}</span>
            <strong>{overBudget ? `${spentToday - plannedToday}m` : `${remainingToday}m`}</strong>
          </div>
          <div className="today-time-stat">
            <span>高优任务</span>
            <strong>{highPriorityCount} 项</strong>
          </div>
        </div>
        <div className="today-time-bar" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${progressPercent}%` }}></i>
          {overBudget && <em>已超额 {spentToday - plannedToday}m，后续可减负</em>}
        </div>
        {overdueCount > 0 && (
          <p className="today-time-warning">
            <CircleAlert size={14} /> 有 {overdueCount} 项第 {todayDay} 天之前的任务未完成，AI 已生成顺延建议供你确认。
          </p>
        )}
        <button type="button" onClick={() => onModuleChange('practice')}>开始定向练习 <ArrowRight size={15} /></button>
      </section>

      {activeProposals.length > 0 && (
        <section className="rebalance-proposals">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">每日时间核对</span>
              <h2>AI 建议的滚动调整</h2>
            </div>
          </header>
          {activeProposals.map((proposal) => (
            <RebalanceProposalCard
              key={proposal.id}
              proposal={proposal}
              onApply={(proposalId) => onApplyProposal?.(proposalId)}
              onDismiss={(proposalId) => onDismissProposal?.(proposalId)}
            />
          ))}
        </section>
      )}

      <section className="plan-preview">
        <div className="task-list">
          {!tasks.length && isGeneratingPlan && (
            <div className="plan-empty-generation">
              <LoaderCircle className="is-spinning" size={18} />
              <span>正在生成首批学习任务，完成后会自动刷新到这里。</span>
            </div>
          )}
          {tasks
            .slice()
            .sort((a, b) => (a.day ?? 999) - (b.day ?? 999) || a.order - b.order)
            .map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onStudy={() => onStudyTask(task.id)}
              onPractice={() => onModuleChange('practice')}
            />
          ))}
        </div>
      </section>

      <AdjustTodayPlanDialog
        open={isAdjustDialogOpen}
        onClose={() => setIsAdjustDialogOpen(false)}
        tasks={tasks}
        knowledgePoints={knowledgePoints}
        dailyProgress={dailyProgress}
        onTasksChange={(nextTasks) => onTasksChange(nextTasks)}
        onRefreshWorkspace={onRefreshWorkspace}
      />

      {onAdjustPlanParams && (
        <AdjustPlanParamsDialog
          open={isParamsDialogOpen}
          onClose={() => setIsParamsDialogOpen(false)}
          course={course}
          onboarding={onboarding}
          dailyProgress={dailyProgress}
          onAdjustPlanParams={onAdjustPlanParams}
        />
      )}
    </div>
  )
}

function CourseOnboardingView({
  course,
  materials,
  onboarding,
  diagnosticQuestions,
  onModuleChange,
  onSaveCourseSetup,
  onSubmitDiagnostic,
}: Pick<
  ModuleViewProps,
  | 'course'
  | 'materials'
  | 'onboarding'
  | 'diagnosticQuestions'
  | 'onModuleChange'
  | 'onSaveCourseSetup'
  | 'onSubmitDiagnostic'
>) {
  const savedDraft = readCourseSetupDraft(course.id)
  const initialTargetScore = savedDraft?.targetScore ?? String(onboarding?.targetScore ?? course.targetScore ?? 60)
  const onboardingTargetTextIsCustom = onboarding?.targetText !== undefined && !isDefaultTargetText(onboarding.targetText)
  const initialTargetTextIsCustom = savedDraft?.targetTextIsCustom ?? onboardingTargetTextIsCustom
  const initialExamDate = savedDraft?.examDate ?? onboarding?.examDate ?? course.examDate ?? ''
  const [courseName, setCourseName] = useState(savedDraft?.courseName ?? onboarding?.courseName ?? course.name ?? '未命名课程')
  const [examDate, setExamDate] = useState(initialExamDate)
  const [targetText, setTargetText] = useState(
    savedDraft?.targetText
      ?? (initialTargetTextIsCustom ? onboarding?.targetText ?? '' : defaultTargetText(initialTargetScore)),
  )
  const [targetTextIsCustom, setTargetTextIsCustom] = useState(initialTargetTextIsCustom)
  const [targetScore, setTargetScore] = useState(initialTargetScore)
  const [days, setDays] = useState(String(calculateReviewDaysFromExamDate(initialExamDate) ?? savedDraft?.days ?? onboarding?.days ?? 3))
  const [reviewCount, setReviewCount] = useState(savedDraft?.reviewCount ?? String(onboarding?.reviewCount ?? calculateReviewDaysFromExamDate(initialExamDate) ?? savedDraft?.days ?? onboarding?.days ?? 3))
  const [dailyHours, setDailyHours] = useState(savedDraft?.dailyHours ?? String(onboarding?.dailyHours ?? course.dailyHours ?? 2))
  const [examFormat, setExamFormat] = useState(savedDraft?.examFormat ?? onboarding?.examFormat ?? '')
  const [remarks, setRemarks] = useState(savedDraft?.remarks ?? onboarding?.remarks ?? '')
  const [setupError, setSetupError] = useState('')
  const [isSavingSetup, setIsSavingSetup] = useState(false)
  const [diagnosticAnswers, setDiagnosticAnswers] = useState<Record<string, number>>({})
  const [isSubmittingDiagnostic, setIsSubmittingDiagnostic] = useState(false)
  const [initializationProgress, setInitializationProgress] = useState(0)
  const hasMaterials = materials.length > 0
  const isDiagnosticReady = onboarding?.status === 'diagnostic' && Boolean(diagnosticQuestions?.length)

  useEffect(() => {
    saveCourseSetupDraft(course.id, {
      courseName,
      examDate,
      targetText,
      targetTextIsCustom,
      targetScore,
      days,
      reviewCount,
      dailyHours,
      examFormat,
      remarks,
    })
  }, [course.id, courseName, dailyHours, days, examDate, examFormat, remarks, reviewCount, targetScore, targetText, targetTextIsCustom])

  useEffect(() => {
    if (!isSubmittingDiagnostic) {
      setInitializationProgress(0)
      return
    }

    setInitializationProgress(8)
    const timer = window.setInterval(() => {
      setInitializationProgress((current) => {
        if (current < 55) return current + 7
        if (current < 82) return current + 3
        if (current < 94) return current + 1
        return current
      })
    }, 900)
    return () => window.clearInterval(timer)
  }, [isSubmittingDiagnostic])

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedTargetScore = Number(targetScore)
    const calculatedDays = calculateReviewDaysFromExamDate(examDate)
    const parsedDays = calculatedDays ?? Number(days)
    const parsedDailyHours = Number(dailyHours)
    const rawReviewCount = Number(reviewCount)
    const parsedReviewCount = Number.isFinite(rawReviewCount) ? Math.max(1, Math.min(parsedDays, Math.floor(rawReviewCount))) : parsedDays
    if (!hasMaterials) {
      setSetupError('请先到资料库导入复习资料。')
      return
    }
    if (!courseName.trim() || !Number.isFinite(parsedTargetScore) || !Number.isFinite(parsedDays) || !Number.isFinite(parsedDailyHours) || !Number.isFinite(rawReviewCount)) {
      setSetupError('请完整填写课程名称、目标分数、复习天数、复习次数和每日时间。')
      return
    }
    if (rawReviewCount < 1 || rawReviewCount > parsedDays) {
      setSetupError(`复习次数应在 1 到 ${parsedDays} 之间。`)
      return
    }
    setIsSavingSetup(true)
    setSetupError('')
    try {
      await onSaveCourseSetup({
        courseName: courseName.trim(),
        examDate: examDate.trim(),
        targetScore: parsedTargetScore,
        targetText: targetText.trim(),
        dailyHours: parsedDailyHours,
        days: parsedDays,
        reviewCount: parsedReviewCount,
        examFormat: examFormat.trim(),
        remarks: remarks.trim(),
      })
      clearCourseSetupDraft(course.id)
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : '课程初始化失败')
    } finally {
      setIsSavingSetup(false)
    }
  }

  function openMaterials() {
    saveCourseSetupDraft(course.id, {
      courseName,
      examDate,
      targetText,
      targetTextIsCustom,
      targetScore,
      days,
      reviewCount,
      dailyHours,
      examFormat,
      remarks,
    })
    onModuleChange('materials')
  }

  function changeTargetScore(nextTargetScore: string) {
    setTargetScore(nextTargetScore)
    if (!targetTextIsCustom) {
      setTargetText(defaultTargetText(nextTargetScore))
    }
  }

  function changeExamDate(nextExamDate: string) {
    setExamDate(nextExamDate)
    const calculatedDays = calculateReviewDaysFromExamDate(nextExamDate)
    if (calculatedDays !== null) {
      setDays(String(calculatedDays))
      const oldDays = Number(days)
      const currentReviewCount = Number(reviewCount)
      if (Number.isFinite(currentReviewCount) && currentReviewCount === oldDays) {
        // 仍是「每天复习」默认值 → 随跨度同步，保持向后兼容。
        setReviewCount(String(calculatedDays))
      } else if (Number.isFinite(currentReviewCount) && currentReviewCount > calculatedDays) {
        // 跨度变小后超过上限 → 钳制为新跨度。
        setReviewCount(String(calculatedDays))
      }
    }
  }

  async function submitDiagnostic() {
    if (!diagnosticQuestions?.length) return
    if (Object.keys(diagnosticAnswers).length !== diagnosticQuestions.length) {
      setSetupError('请完成所有摸底题后再提交。')
      return
    }
    setIsSubmittingDiagnostic(true)
    setSetupError('')
    try {
      await onSubmitDiagnostic(diagnosticAnswers)
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : '摸底提交失败')
    } finally {
      setIsSubmittingDiagnostic(false)
    }
  }

  return (
    <div className="module-page onboarding-page" aria-busy={isSavingSetup || isSubmittingDiagnostic}>
      {isSavingSetup && (
        <div className="diagnostic-generation-backdrop" role="status" aria-live="polite">
          <section className="diagnostic-generation-loader">
            <div className="diagnostic-generation-visual" aria-hidden="true">
              <span className="diagnostic-generation-core"><Brain size={28} /></span>
              <span className="diagnostic-question-sheet sheet-one"><FileText size={19} /></span>
              <span className="diagnostic-question-sheet sheet-two"><FileText size={19} /></span>
              <span className="diagnostic-question-sheet sheet-three"><FileText size={19} /></span>
              <span className="diagnostic-generation-spark"><Sparkles size={17} /></span>
            </div>
            <strong>AI 正在生成摸底题</strong>
            <p>正在结合课程资料与目标信息设计题目...</p>
            <div className="diagnostic-generation-progress" aria-hidden="true"><span /></div>
          </section>
        </div>
      )}
      {isSubmittingDiagnostic && (
        <section className="initializing-panel" aria-live="polite">
          <div className="initializing-orbit">
            <Sparkles size={28} />
          </div>
          <span className="question-label">正在生成课程策略</span>
          <h1>AI 正在起草复习计划与课程总 Prompt</h1>
          <p>正在结合资料、用户目标和摸底结果形成两份可编辑文档。</p>
          <div className="initializing-progress" aria-label={`初始化进度 ${initializationProgress}%`}>
            <span style={{ width: `${initializationProgress}%` }}></span>
          </div>
          <strong>{initializationProgress}%</strong>
        </section>
      )}
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><Sparkles size={15} /> 资料 → 摸底 → 策略审阅 → 主线计划</p>
          <h1>重新初始化{courseName || course.name}速成 Agent</h1>
          <p>先导入资料并完成摸底，再审阅 AI 起草的总计划和课程 Prompt，确认后生成完整复习主线。</p>
        </div>
        <button className="secondary-button" type="button" onClick={openMaterials}>
          <FolderOpen size={16} /> 去资料库
        </button>
      </section>

      <section className="onboarding-steps">
        <article className={hasMaterials ? 'is-done' : ''}>
          <strong>1</strong>
          <span>导入资料</span>
          <p>{hasMaterials ? `已导入 ${materials.length} 份资料` : '上传课件、练习题、真题或模拟卷'}</p>
        </article>
        <article className={isDiagnosticReady ? 'is-done' : ''}>
          <strong>2</strong>
          <span>生成摸底</span>
          <p>{isDiagnosticReady ? `${diagnosticQuestions?.length ?? 0} 道摸底题待完成` : '填写信息后由 AI 出题'}</p>
        </article>
        <article>
          <strong>3</strong>
          <span>审阅策略</span>
          <p>编辑总计划和课程 Prompt</p>
        </article>
        <article>
          <strong>4</strong>
          <span>初始化主线</span>
          <p>按定稿策略安排每日复习</p>
        </article>
      </section>

      {!isDiagnosticReady ? (
        <form className="setup-form" onSubmit={submitSetup}>
          <label>
            <span>课程名称</span>
            <input value={courseName} onChange={(event) => setCourseName(event.target.value)} />
          </label>
          <label>
            <span>考试日期</span>
            <input placeholder="例如 2026-07-30 或 期末周周三" value={examDate} onChange={(event) => changeExamDate(event.target.value)} />
          </label>
          <label>
            <span>目标描述</span>
            <input
              value={targetText}
              onChange={(event) => {
                setTargetText(event.target.value)
                setTargetTextIsCustom(true)
              }}
              placeholder="例如 我要追求 95+ 满绩 / 60+ 不挂科"
            />
          </label>
          <label>
            <span>目标分数</span>
            <input type="number" min="0" max="100" value={targetScore} onChange={(event) => changeTargetScore(event.target.value)} />
          </label>
          <label>
            <span>距考试天数</span>
            <input type="number" min="1" max="30" value={days} onChange={(event) => setDays(event.target.value)} />
          </label>
          <label>
            <span>复习次数</span>
            <input type="number" min="1" max={Number(days) || 1} value={reviewCount} onChange={(event) => setReviewCount(event.target.value)} />
            {(() => {
              const spanDays = Math.max(1, Math.floor(Number(days) || 1))
              const count = Math.max(1, Math.min(spanDays, Math.floor(Number(reviewCount) || 1)))
              const sessionDays = reviewSessionDays(spanDays, count)
              const interval = count > 1 ? Math.round((spanDays - 1) / (count - 1)) : spanDays
              return (
                <small className="review-days-hint">
                  复习日：{formatReviewDays(sessionDays)}（共 {count} 次{count > 1 ? `，约每 ${interval} 天一次` : ''}）
                </small>
              )
            })()}
          </label>
          <label>
            <span>每天时间</span>
            <input type="number" min="0.5" max="12" step="0.5" value={dailyHours} onChange={(event) => setDailyHours(event.target.value)} />
          </label>
          <label className="is-wide">
            <span>考试形式</span>
            <textarea value={examFormat} onChange={(event) => setExamFormat(event.target.value)} placeholder="例如：闭卷；选择题、计算题、论述题；计算题占大头。" />
          </label>
          <label className="is-wide">
            <span>备注</span>
            <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="例如：第3章不考；老师说第5章重点考；Excel 操作只考函数口径。" />
          </label>
          {setupError && <p className="setup-error">{setupError}</p>}
          <footer>
            <button className="secondary-button" type="button" onClick={openMaterials}>
              <Upload size={16} /> 先导入资料
            </button>
            <button className="primary-button" type="submit" disabled={isSavingSetup || !hasMaterials}>
              <Sparkles size={16} /> {isSavingSetup ? 'AI 正在生成摸底题' : '生成摸底题'}
            </button>
          </footer>
        </form>
      ) : (
        <section className="diagnostic-workbench">
          <header>
            <span className="question-label">10-15 分钟摸底测试</span>
            <h2>先测一下你现在大概能考多少</h2>
            <p>这些题会用于初始化掌握度和复习优先级，不是正式模拟卷。</p>
          </header>
          <div className="diagnostic-question-list">
            {diagnosticQuestions?.map((question, questionIndex) => {
              const choices = [...question.options, UNKNOWN_CHOICE_LABEL]
              return (
                <article className="diagnostic-question" key={question.id}>
                  <strong>{questionIndex + 1}. <FormulaText text={question.prompt} /></strong>
                  <div className="choice-list">
                    {choices.map((option, optionIndex) => (
                      <button
                        className={`choice ${diagnosticAnswers[question.id] === optionIndex ? 'is-selected' : ''}`}
                        type="button"
                        key={`${question.id}-${optionIndex}`}
                        onClick={() => setDiagnosticAnswers((current) => ({ ...current, [question.id]: optionIndex }))}
                      >
                        <b>{String.fromCharCode(65 + optionIndex)}</b>
                        <span><FormulaText text={option} /></span>
                      </button>
                    ))}
                  </div>
                </article>
              )
            })}
          </div>
          {setupError && <p className="setup-error">{setupError}</p>}
          <footer>
            <span>{Object.keys(diagnosticAnswers).length} / {diagnosticQuestions?.length ?? 0} 已作答</span>
            <button className="primary-button" type="button" disabled={isSubmittingDiagnostic} onClick={submitDiagnostic}>
              <Check size={16} /> {isSubmittingDiagnostic ? '正在生成策略文档' : '提交摸底并生成策略'}
            </button>
          </footer>
        </section>
      )}
    </div>
  )
}

type StrategyPaneMode = 'edit' | 'preview'

function StrategyReviewView({
  course,
  strategyDocuments,
  strategyGenerationJob,
  onGenerateStrategyDocuments,
  onApproveStrategyDocuments,
  onRefreshWorkspace,
  onRepairStrategyGeneration,
}: Pick<ModuleViewProps, 'course' | 'strategyDocuments' | 'strategyGenerationJob' | 'onGenerateStrategyDocuments' | 'onApproveStrategyDocuments' | 'onRefreshWorkspace' | 'onRepairStrategyGeneration'>) {
  const [reviewPlan, setReviewPlan] = useState(strategyDocuments?.reviewPlan.content ?? '')
  const [coursePrompt, setCoursePrompt] = useState(strategyDocuments?.coursePrompt.content ?? '')
  const [planMode, setPlanMode] = useState<StrategyPaneMode>('preview')
  const [promptMode, setPromptMode] = useState<StrategyPaneMode>('preview')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRepairing, setIsRepairing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setReviewPlan(strategyDocuments?.reviewPlan.content ?? '')
    setCoursePrompt(strategyDocuments?.coursePrompt.content ?? '')
  }, [strategyDocuments])

  async function approveDocuments() {
    if (!strategyDocuments) return
    if (!reviewPlan.trim() || !coursePrompt.trim()) {
      setError('复习计划和课程总 Prompt 都不能为空。')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      await onApproveStrategyDocuments({
        reviewPlan,
        coursePrompt,
        reviewPlanVersion: strategyDocuments.reviewPlan.version,
        coursePromptVersion: strategyDocuments.coursePrompt.version,
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '复习主线生成失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function retryGeneration() {
    setIsGenerating(true)
    setError('')
    try {
      await onGenerateStrategyDocuments()
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : '策略文档生成失败')
    } finally {
      setIsGenerating(false)
    }
  }

  async function refreshWorkspace() {
    setIsRefreshing(true)
    setError('')
    try {
      await onRefreshWorkspace()
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : '刷新生成状态失败')
    } finally {
      setIsRefreshing(false)
    }
  }

  async function repairGeneration() {
    setIsRepairing(true)
    setError('')
    try {
      await onRepairStrategyGeneration()
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : '重新生成失败')
    } finally {
      setIsRepairing(false)
    }
  }

  const documentsReady = Boolean(reviewPlan.trim() && coursePrompt.trim())
  const activeGenerationJob = strategyGenerationJob?.courseId === course.id ? strategyGenerationJob : null
  const isGeneratingPlan = Boolean(activeGenerationJob && ['queued', 'running'].includes(activeGenerationJob.job.status))
  const hasGenerationFailure = activeGenerationJob?.job.status === 'failed' || Boolean(strategyDocuments?.maintenanceError)

  return (
    <div className="module-page strategy-review-page">
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><Sparkles size={15} /> 摸底完成 · 策略审阅</p>
          <h1>先确认复习策略，再生成主线。</h1>
          <p>左侧是 AI 拟定的速通计划，右侧是这门课程后续所有 AI 行为采用的课程级指令。</p>
        </div>
      </section>

      {!documentsReady && (
        <section className="strategy-generation-error">
          <CircleAlert size={20} />
          <div>
            <strong>策略文档尚未生成</strong>
            <p>{strategyDocuments?.maintenanceError || '可以使用已保存的摸底结果重新生成，不会重复提交摸底。'}</p>
          </div>
          <button className="secondary-button" type="button" disabled={isGenerating} onClick={retryGeneration}>
            <RefreshCw size={16} /> {isGenerating ? '正在重新生成' : '重新生成'}
          </button>
        </section>
      )}

      {documentsReady && hasGenerationFailure && (
        <section className="strategy-generation-error">
          <CircleAlert size={20} />
          <div>
            <strong>复习主线生成没有完整结束</strong>
            <p>{activeGenerationJob?.job.error || strategyDocuments?.maintenanceError || '可以重新入队，系统会复用已生成的检查点继续补齐。'}</p>
          </div>
          <button className="secondary-button" type="button" disabled={isRefreshing} onClick={refreshWorkspace}>
            <RefreshCw className={isRefreshing ? 'is-spinning' : ''} size={16} /> {isRefreshing ? '刷新中' : '刷新状态'}
          </button>
          <button className="primary-button" type="button" disabled={isRepairing || isGeneratingPlan} onClick={repairGeneration}>
            <RotateCcw size={16} /> {isRepairing ? '正在修复' : '修复生成'}
          </button>
        </section>
      )}

      {documentsReady && <div className="strategy-document-grid">
        <section className="strategy-document-panel">
          <header>
            <div><span>复习计划</span><strong>{course.name}速通总计划</strong></div>
            <div className="strategy-mode-switch" role="group" aria-label="复习计划显示模式">
              <button className={planMode === 'edit' ? 'is-active' : ''} type="button" onClick={() => setPlanMode('edit')}>编辑</button>
              <button className={planMode === 'preview' ? 'is-active' : ''} type="button" onClick={() => setPlanMode('preview')}>预览</button>
            </div>
          </header>
          {planMode === 'edit' ? (
            <textarea className="strategy-prompt-editor" value={reviewPlan} onChange={(event) => setReviewPlan(event.target.value)} />
          ) : (
            <article className="strategy-markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{reviewPlan}</ReactMarkdown></article>
          )}
        </section>

        <section className="strategy-document-panel">
          <header>
            <div><span>课程总 Prompt</span><strong>课程级 AI 指令</strong></div>
            <div className="strategy-mode-switch" role="group" aria-label="课程总 Prompt 显示模式">
              <button className={promptMode === 'edit' ? 'is-active' : ''} type="button" onClick={() => setPromptMode('edit')}>编辑</button>
              <button className={promptMode === 'preview' ? 'is-active' : ''} type="button" onClick={() => setPromptMode('preview')}>预览</button>
            </div>
          </header>
          {promptMode === 'edit' ? (
            <textarea className="strategy-prompt-editor" value={coursePrompt} onChange={(event) => setCoursePrompt(event.target.value)} />
          ) : (
            <article className="strategy-markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{coursePrompt}</ReactMarkdown></article>
          )}
        </section>
      </div>}

      {error && <p className="setup-error">{error}</p>}
      {documentsReady && <footer className="strategy-review-actions">
        <span>
          {isGeneratingPlan
            ? `后台生成中，已运行 ${activeGenerationJob?.elapsedSeconds ?? 0} 秒；你可以切换到其他页面。`
            : '提交后，复习计划由 AI 按关键学习事件维护；课程总 Prompt 仍由你维护。'}
        </span>
        <button className="primary-button" type="button" disabled={isSubmitting || isGeneratingPlan} onClick={approveDocuments}>
          <Check size={16} /> {isSubmitting || isGeneratingPlan ? '正在生成复习主线' : '确认文档并生成复习主线'}
        </button>
      </footer>}
    </div>
  )
}

function StrategySection({
  strategyDocuments,
  onSaveCoursePrompt,
}: Pick<ModuleViewProps, 'strategyDocuments' | 'onSaveCoursePrompt'>) {
  const [coursePrompt, setCoursePrompt] = useState(strategyDocuments?.coursePrompt.content ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [promptMode, setPromptMode] = useState<'edit' | 'preview'>('preview')
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    setCoursePrompt(strategyDocuments?.coursePrompt.content ?? '')
  }, [strategyDocuments])

  async function savePrompt() {
    if (!strategyDocuments || !coursePrompt.trim()) return
    setIsSaving(true)
    setMessage('')
    try {
      await onSaveCoursePrompt(coursePrompt, strategyDocuments.coursePrompt.version)
      setMessage('课程总 Prompt 已保存，将用于后续 AI 行为。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '课程总 Prompt 保存失败')
    } finally {
      setIsSaving(false)
    }
  }

  if (!strategyDocuments?.reviewPlan.content) {
    return (
      <section className="strategy-section">
        <header className="strategy-section-head">
          <h2><FileText size={18} /> 复习策略</h2>
        </header>
        <div className="strategy-section-empty">尚未生成复习策略，资料解析完成后可生成。</div>
      </section>
    )
  }

  return (
    <section className={`strategy-section${isExpanded ? ' is-expanded' : ''}`}>
      <header
        className="strategy-section-head"
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onClick={() => setIsExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setIsExpanded((value) => !value)
          }
        }}
      >
        <div className="strategy-section-head-text">
          <h2><FileText size={18} /> 复习策略</h2>
          <p>{strategyDocuments.maintenancePending ? 'AI 正在根据最新学习状态维护复习计划。' : strategyDocuments.reviewPlan.changeSummary || '总计划由 AI 维护，课程指令由你维护。'}</p>
        </div>
        <button
          className="strategy-section-toggle"
          type="button"
          aria-label={isExpanded ? '收起复习策略' : '展开复习策略'}
          onClick={(event) => {
            event.stopPropagation()
            setIsExpanded((value) => !value)
          }}
        >
          {isExpanded ? '收起' : '展开'}
          <ChevronDown size={16} className="strategy-section-chevron" />
        </button>
      </header>
      {isExpanded && (
      <div className="strategy-document-grid">
        <section className="strategy-document-panel">
          <header>
            <div>
              <span>复习计划 · v{strategyDocuments.reviewPlan.version} · AI 维护</span>
              <strong>总复习计划</strong>
            </div>
          </header>
          <article className="strategy-markdown-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{strategyDocuments.reviewPlan.content}</ReactMarkdown>
          </article>
        </section>

        <section className="strategy-document-panel">
          <header>
            <div>
              <span>课程总 Prompt · v{strategyDocuments.coursePrompt.version} · 用户维护</span>
              <strong>课程级 AI 指令</strong>
            </div>
            <div className="strategy-tab-actions">
              {promptMode === 'edit' && (
                <span className="strategy-prompt-message">{message || strategyDocuments.coursePrompt.changeSummary}</span>
              )}
              <div className="strategy-mode-switch" role="group" aria-label="课程总 Prompt 显示模式">
                <button className={promptMode === 'edit' ? 'is-active' : ''} type="button" onClick={() => setPromptMode('edit')}>编辑</button>
                <button className={promptMode === 'preview' ? 'is-active' : ''} type="button" onClick={() => setPromptMode('preview')}>预览</button>
              </div>
              {promptMode === 'edit' && (
                <button className="primary-button" type="button" disabled={isSaving} onClick={savePrompt}>
                  <Check size={16} /> {isSaving ? '正在保存' : '保存'}
                </button>
              )}
            </div>
          </header>
          {promptMode === 'edit' ? (
            <textarea
              className="strategy-prompt-editor"
              value={coursePrompt}
              onChange={(event) => setCoursePrompt(event.target.value)}
              placeholder="在此维护课程级复习指令，保存后将用于后续 AI 行为。"
            />
          ) : (
            <article className="strategy-markdown-preview">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {coursePrompt.trim() ? coursePrompt : '（暂无课程级指令）点击右上角「编辑」可维护课程级复习指令，保存后将用于后续 AI 行为。'}
              </ReactMarkdown>
            </article>
          )}
        </section>
      </div>
      )}
      {isExpanded && strategyDocuments.maintenanceError && <p className="setup-error">计划维护失败：{strategyDocuments.maintenanceError}</p>}
    </section>
  )
}

function getDiagnosticChoiceLabel(question: QuizQuestion, answerIndex: number | undefined) {
  if (answerIndex === undefined || answerIndex < 0) return '未作答'
  if (answerIndex >= question.options.length) return UNKNOWN_CHOICE_LABEL
  return question.options[answerIndex]
}

function DiagnosticResultView({
  course,
  diagnostic,
  diagnosticQuestions,
  diagnosticReviewAnswers,
  onboarding,
  wrongAnswers,
  onModuleChange,
}: Pick<
  ModuleViewProps,
  | 'course'
  | 'diagnostic'
  | 'diagnosticQuestions'
  | 'diagnosticReviewAnswers'
  | 'onboarding'
  | 'wrongAnswers'
  | 'onModuleChange'
>) {
  const answers = diagnosticReviewAnswers ?? {}
  const questions = diagnosticQuestions ?? []
  const wrongQuestions = questions.filter((question) => answers[question.id] !== question.answerIndex)
  const diagnosticScore = onboarding?.diagnosticScore
  const diagnosticTotal = onboarding?.diagnosticTotal
  const diagnosticPercent = onboarding?.diagnosticPercent

  return (
    <div className="module-page diagnostic-result-page">
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><CheckCircle2 size={15} /> 摸底完成 · {course.name}</p>
          <h1>先把这次摸底吃透，再进入复习。</h1>
          <p>{diagnostic.message}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => onModuleChange('plan')}>
          进入复习主线 <ArrowRight size={16} />
        </button>
      </section>

      <section className="diagnostic-result-metrics">
        <article>
          <span>摸底得分</span>
          <strong>
            {diagnosticScore ?? '-'}
            {diagnosticTotal !== undefined && <small> / {diagnosticTotal}</small>}
          </strong>
        </article>
        <article>
          <span>预估分数</span>
          <strong>{diagnostic.estimatedScore.replace(' 分', '')}<small>分</small></strong>
        </article>
        <article>
          <span>错题讲解</span>
          <strong>{wrongQuestions.length}<small> 道</small></strong>
        </article>
        <article>
          <span>掌握率</span>
          <strong>{diagnosticPercent ?? '-'}<small>%</small></strong>
        </article>
      </section>

      <section className="diagnostic-review-panel">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">摸底错题讲解</span>
            <h2>{wrongQuestions.length ? '先处理这些失分点' : '这次摸底没有错题'}</h2>
          </div>
          <button type="button" onClick={() => onModuleChange('errors')}>
            错题本 {wrongAnswers.length} 道 <ChevronRight size={15} />
          </button>
        </header>

        {wrongQuestions.length ? (
          <div className="diagnostic-review-list">
            {wrongQuestions.map((question, index) => {
              const selectedAnswer = answers[question.id]
              return (
                <article className="diagnostic-review-card" key={question.id}>
                  <span className="question-label">错题 {index + 1} · {question.source}</span>
                  <h3><FormulaText text={question.prompt} /></h3>
                  <div className="diagnostic-answer-compare">
                    <p><CircleAlert size={15} /> 你的答案：<FormulaText text={getDiagnosticChoiceLabel(question, selectedAnswer)} /></p>
                    <p><CheckCircle2 size={15} /> 正确答案：{String.fromCharCode(65 + question.answerIndex)}. <FormulaText text={getDiagnosticChoiceLabel(question, question.answerIndex)} /></p>
                  </div>
                  <p className="diagnostic-explanation"><FormulaText text={question.explanation} /></p>
                </article>
              )
            })}
          </div>
        ) : (
          <article className="diagnostic-review-empty">
            <CheckCircle2 size={24} />
            <div>
              <strong>摸底题全部答对。</strong>
              <p>复习主线已经按目标分数和资料重点生成，可以直接进入第一天任务。</p>
            </div>
          </article>
        )}
      </section>

      <footer className="diagnostic-result-actions">
        <button className="secondary-button" type="button" onClick={() => onModuleChange('errors')}>
          查看错题本
        </button>
        <button className="primary-button" type="button" onClick={() => onModuleChange('plan')}>
          开始复习 <Target size={16} />
        </button>
      </footer>
    </div>
  )
}

type StudyTopic = 'timeValue' | 'evaluation' | 'taxCashflow' | 'multiScheme' | 'risk' | 'excel' | 'general'

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword))
}

function getStudyTopicFromText(text: string): StudyTopic {
  const normalizedText = text.toLowerCase()
  if (includesAny(normalizedText, ['excel', 'pv', 'fv', 'pmt', 'nper', '单变量求解', '规划求解器'])) return 'excel'
  if (includesAny(normalizedText, ['税后', '折旧', '所得税', '付现成本', '经营净现金流', 'ncf', 'tax'])) return 'taxCashflow'
  if (includesAny(normalizedText, ['多方案', '互斥', '独立方案', '混合方案', '寿命不同', 'multi'])) return 'multiScheme'
  if (includesAny(normalizedText, ['盈亏平衡', '敏感性', '不确定性', '保本', 'risk'])) return 'risk'
  if (includesAny(normalizedText, ['资金时间', '年金', 'p/f', 'f/p', 'p/a', 'a/p', 'time-value', 'fund-time-value'])) return 'timeValue'
  if (includesAny(normalizedText, ['回收期', 'npv', 'nav', 'npvr', 'irr', 'evaluation'])) return 'evaluation'
  return 'general'
}

function getStudyTopic(task: PlanTask, knowledgePoint?: KnowledgePoint) {
  return getStudyTopicFromText([
    task.knowledgePointId,
    task.title,
    task.description,
    knowledgePoint?.id,
    knowledgePoint?.name,
    knowledgePoint?.summary,
  ].filter(Boolean).join(' '))
}

function findTaskKnowledgePoint(task: PlanTask, knowledgePoints: KnowledgePoint[]) {
  const exactMatch = knowledgePoints.find((point) => point.id === task.knowledgePointId)
  if (exactMatch) return exactMatch
  const taskTopic = getStudyTopic(task)
  return knowledgePoints.find((point) => getStudyTopicFromText(`${point.id} ${point.name} ${point.summary}`) === taskTopic)
}

function getRelatedPracticeQuestions(
  task: PlanTask,
  knowledgePoint: KnowledgePoint | undefined,
  guide: StudyGuide,
  practiceQuestions: QuizQuestion[],
) {
  const explicitIds = guide.selfTestQuestionIds ?? guide.sections?.[3]?.selfTestQuestionIds ?? []
  if (explicitIds.length) {
    const byId = new Map(practiceQuestions.map((question) => [question.id, question]))
    return explicitIds.map((id) => byId.get(id)).filter((question): question is QuizQuestion => Boolean(question))
  }
  const taskTopic = getStudyTopic(task, knowledgePoint)
  const relatedQuestions = practiceQuestions.filter((question) => {
    if (question.taskId === task.id) return true
    if (question.knowledgePointId === task.knowledgePointId || question.knowledgePointId === knowledgePoint?.id) return true
    return getStudyTopicFromText(`${question.knowledgePointId} ${question.prompt} ${question.explanation}`) === taskTopic
  })
  return relatedQuestions
}

function getStudyPageIndexFromProgress(progress: number, pageCount: number) {
  if (pageCount <= 0) return 0
  const normalizedProgress = Number.isFinite(progress) ? Math.max(0, progress) : 0
  if (normalizedProgress <= 0) return 0
  return Math.min(pageCount - 1, Math.max(0, Math.ceil((normalizedProgress / 100) * pageCount) - 1))
}

function getInitialStudyPageIndex(task: PlanTask, pageCount: number) {
  return task.status === 'completed' ? 0 : getStudyPageIndexFromProgress(task.progress, pageCount)
}

function getStudyProgressForPage(pageIndex: number, pageCount: number) {
  if (pageCount <= 0) return 0
  return Math.min(100, Math.round(((pageIndex + 1) / pageCount) * 100))
}

function trimBrackets(text: string) {
  const trimmedText = text.trim()
  if (
    (trimmedText.startsWith('[') && trimmedText.endsWith(']'))
    || (trimmedText.startsWith('(') && trimmedText.endsWith(')'))
  ) {
    return trimmedText.slice(1, -1).trim()
  }
  return trimmedText
}

function isUnitSlash(numerator: string, denominator: string) {
  const unitNumerators = ['m', 'km', 'cm', 'mm', 'kg', 'N', 'J', 'W', 'V', 'A', 'C', 'rad']
  const unitDenominators = ['s', 'h', 'min', 'm', 'kg']
  return unitNumerators.includes(numerator.trim()) && unitDenominators.includes(denominator.trim())
}

const bareLatexCommandPattern = /\\[A-Za-z]+/
const latexScriptPattern = /[_^](?:\{[^{}]+\}|-?[A-Za-z0-9]+)/
const latexCandidateCharacterPattern = /[A-Za-z0-9\\{}_^=+\-*/×÷·.,()\[\]|<>%μωθαλφΩπεβγδσΔΣ∞ 　\t]/

function renderKatexFormula(latex: string, key: string) {
  try {
    const normalizedLatex = latex
      .replace(/^\\\[\s*|\s*\\\]$/g, '')
      .replace(/^\\\(\s*|\s*\\\)$/g, '')
    return (
      <span
        className="formula-katex"
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(normalizedLatex, {
            displayMode: false,
            output: 'html',
            strict: 'ignore',
            throwOnError: true,
            trust: false,
          }),
        }}
        key={key}
      />
    )
  } catch {
    return null
  }
}

function renderLegacyFormulaInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const formulaTokenPattern = /([A-Za-z0-9μωθαλφΩπεβγδσΔΣ∞)）])([_^])(-?[A-Za-z0-9]+)|([A-Za-zμωθλφΩ])([23])(?=$|[^A-Za-z0-9])|([vV])([0-9])|([A-Za-zμωθλφΩ])([0-9])(?=$|[^A-Za-z0-9])|(^|[^A-Za-z])B([Rr])(?=$|[^A-Za-z])/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = formulaTokenPattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const [
      ,
      base,
      marker,
      script,
      powerBase,
      implicitPower,
      compactSubscriptBase,
      compactNumericSubscript,
      subscriptBase,
      implicitNumericSubscript,
      prefix = '',
      implicitSubscript,
    ] = match
    if (implicitSubscript) {
      if (prefix) nodes.push(prefix)
      nodes.push(
        <span className="formula-symbol" key={`${keyPrefix}-${match.index}-${match[0]}`}>
          B<sub>{implicitSubscript}</sub>
        </span>,
      )
    } else if (implicitPower) {
      nodes.push(
        <span className="formula-symbol" key={`${keyPrefix}-${match.index}-${match[0]}`}>
          {powerBase}<sup>{implicitPower}</sup>
        </span>,
      )
    } else if (compactNumericSubscript || implicitNumericSubscript) {
      nodes.push(
        <span className="formula-symbol" key={`${keyPrefix}-${match.index}-${match[0]}`}>
          {compactSubscriptBase ?? subscriptBase}<sub>{compactNumericSubscript ?? implicitNumericSubscript}</sub>
        </span>,
      )
    } else {
      nodes.push(
        <span className="formula-symbol" key={`${keyPrefix}-${match.index}-${match[0]}`}>
          {base}{marker === '_' ? <sub>{script}</sub> : <sup>{script}</sup>}
        </span>,
      )
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

function renderFormulaInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let plainStart = 0
  let candidateStart = -1
  let braceDepth = 0

  const flushCandidate = (end: number) => {
    if (candidateStart < 0) return
    const candidate = text.slice(candidateStart, end)
    if (bareLatexCommandPattern.test(candidate) || latexScriptPattern.test(candidate)) {
      if (candidateStart > plainStart) {
        nodes.push(...renderLegacyFormulaInline(text.slice(plainStart, candidateStart), `${keyPrefix}-plain-${plainStart}`))
      }
      const leadingWhitespace = candidate.match(/^\s*/)?.[0] ?? ''
      const trailingWhitespace = candidate.match(/\s*$/)?.[0] ?? ''
      const latex = candidate.trim()
      if (leadingWhitespace) nodes.push(leadingWhitespace)
      const formula = renderKatexFormula(latex, `${keyPrefix}-latex-${candidateStart}`)
      if (formula) {
        nodes.push(formula)
      } else {
        nodes.push(...renderLegacyFormulaInline(latex, `${keyPrefix}-fallback-${candidateStart}`))
      }
      if (trailingWhitespace) nodes.push(trailingWhitespace)
      plainStart = end
    }
    candidateStart = -1
    braceDepth = 0
  }

  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index]
    const isCandidateCharacter = Boolean(
      character && (latexCandidateCharacterPattern.test(character) || (candidateStart >= 0 && braceDepth > 0)),
    )
    if (isCandidateCharacter && candidateStart < 0) candidateStart = index
    if (candidateStart >= 0 && character === '{') braceDepth += 1
    if (candidateStart >= 0 && character === '}') braceDepth = Math.max(0, braceDepth - 1)
    if (!isCandidateCharacter) flushCandidate(index)
  }

  if (plainStart < text.length) {
    nodes.push(...renderLegacyFormulaInline(text.slice(plainStart), `${keyPrefix}-plain-${plainStart}`))
  }
  return nodes
}

function renderUnwrappedFormulaText(text: string, depth = 0): ReactNode[] {
  const normalizedText = text.replace(/\*\*/g, '')
  const nodes: ReactNode[] = []
  const fractionAtom = String.raw`[A-Za-zμωθαλφΩπεβγδσΔΣ∞\d.'′·×⁰-⁹₀-₉]+(?:\^(?:-?[A-Za-z0-9]+|\{[^{}]+\}))?`
  const fractionOperand = String.raw`(?:\[[^\[\]]+\]|\([^()]+\)(?:\^(?:-?[A-Za-z0-9]+|\{[^{}]+\}))?|${fractionAtom})`
  const fractionPattern = new RegExp(String.raw`\((${fractionAtom})\s*\/\s*(${fractionAtom})\)|(${fractionOperand})\s*\/\s*(${fractionOperand})`, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = fractionPattern.exec(normalizedText))) {
    if (match.index > lastIndex) {
      nodes.push(...renderFormulaInline(normalizedText.slice(lastIndex, match.index), `plain-${lastIndex}`))
    }

    const numerator = match[1] ?? match[3]
    const denominator = match[2] ?? match[4]
    const fractionClassName = `formula-fraction${depth > 0 ? ' is-nested' : ''}${/[\/\[\]()]/.test(`${numerator}${denominator}`) ? ' is-compound' : ''}`
    if (match[3] && match[4] && isUnitSlash(numerator, denominator)) {
      nodes.push(...renderFormulaInline(match[0], `unit-${match.index}`))
      lastIndex = match.index + match[0].length
      continue
    }

    const fraction = (
      <span className={fractionClassName} key={`fraction-${match.index}-${match[0]}`}>
        <span className="formula-fraction-numerator">{renderFormulaText(trimBrackets(numerator), depth + 1)}</span>
        <span className="formula-fraction-denominator">{renderFormulaText(trimBrackets(denominator), depth + 1)}</span>
      </span>
    )
    const fractionEnd = match.index + match[0].length
    const exponentMatch = normalizedText.slice(fractionEnd).match(/^\^(?:\{([^{}]+)\}|(-?[A-Za-z0-9]+))/)
    if (exponentMatch) {
      nodes.push(
        <span className="formula-symbol" key={`fraction-power-${match.index}-${match[0]}`}>
          {fraction}<sup>{exponentMatch[1] ?? exponentMatch[2]}</sup>
        </span>,
      )
      lastIndex = fractionEnd + exponentMatch[0].length
    } else {
      nodes.push(fraction)
      lastIndex = fractionEnd
    }
  }

  if (lastIndex < normalizedText.length) {
    nodes.push(...renderFormulaInline(normalizedText.slice(lastIndex), `plain-${lastIndex}`))
  }

  return nodes
}

function renderFormulaText(text: string, depth = 0): ReactNode[] {
  const nodes: ReactNode[] = []
  const explicitFormulaPattern = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = explicitFormulaPattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(...renderUnwrappedFormulaText(text.slice(lastIndex, match.index), depth))
    }
    const latex = match[1] ?? match[2] ?? ''
    const formula = renderKatexFormula(latex, `explicit-${depth}-${match.index}`)
    if (formula) {
      nodes.push(formula)
    } else {
      nodes.push(...renderUnwrappedFormulaText(match[0], depth))
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(...renderUnwrappedFormulaText(text.slice(lastIndex), depth))
  }
  return nodes
}

function FormulaText({ text }: { text: string }) {
  return <>{renderFormulaText(text)}</>
}

function stripStudySourceMarkers(text: string) {
  return text
    .replace(/\[来源[:：][^\]]+\]/g, '')
    .replace(/[（(]来源[:：][^）)]+[）)]/g, '')
    .replace(/先回到[^，。]+[，,]\s*/g, '先')
    .replace(/优先查看[^，。]+[，,。]\s*/g, '')
    .replace(/关联知识点来源[^，。]+[，,。]\s*/g, '')
    .replace(/目标量和资料出处/g, '目标量')
    .replace(/、?资料出处/g, '')
    .replace(/、?出处来源/g, '')
    .replace(/和。/g, '。')
    .replace(/([，、])。/g, '。')
    .replace(/、、/g, '、')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function StudyFormulaText({ text }: { text: string }) {
  return <FormulaText text={stripStudySourceMarkers(text)} />
}

function studyConceptTitle(title: string) {
  return /资料定位|来源|出处|资料依据|参考/.test(title) ? '学习切入' : stripStudySourceMarkers(title)
}

function isChoiceMarkerAt(text: string, index: number) {
  const label = text[index]
  const marker = text[index + 1]
  if (!label || !/[A-D]/.test(label) || !marker || !'.．、'.includes(marker)) return false
  const previous = text[index - 1]
  return index === 0 || /\s/.test(previous) || '：:；;，,。'.includes(previous)
}

function parseChoiceQuestion(text: string) {
  const markers: Array<{ label: string; labelStart: number; contentStart: number }> = []
  for (let index = 0; index < text.length - 1; index += 1) {
    if (!isChoiceMarkerAt(text, index)) continue
    let contentStart = index + 2
    while (/\s/.test(text[contentStart] ?? '')) contentStart += 1
    markers.push({ label: text[index], labelStart: index, contentStart })
  }
  if (markers.length < 2) return null

  return {
    prompt: text.slice(0, markers[0].labelStart).trim(),
    choices: markers.map((marker, index) => {
      const nextMarker = markers[index + 1]
      const contentEnd = nextMarker?.labelStart ?? text.length
      return {
        label: marker.label,
        text: text.slice(marker.contentStart, contentEnd).replace(/[；;，,。]\s*$/, '').trim(),
      }
    }),
  }
}

function WorkedExampleQuestion({ text }: { text: string }) {
  const choiceQuestion = parseChoiceQuestion(text)
  if (!choiceQuestion) {
    return <p className="worked-example-question-text"><FormulaText text={text} /></p>
  }

  return (
    <section className="worked-example-question">
      {choiceQuestion.prompt && <p><FormulaText text={choiceQuestion.prompt} /></p>}
      <div className="worked-choice-list">
        {choiceQuestion.choices.map((choice) => (
          <div className="worked-choice-option" key={choice.label}>
            <span>{choice.label}</span>
            <p><FormulaText text={choice.text} /></p>
          </div>
        ))}
      </div>
    </section>
  )
}

function buildStudyGuide(task: PlanTask, knowledgePoint: KnowledgePoint | undefined, courseName: string): StudyGuide {
  if (task.studyGuide) return task.studyGuide

  const topic = courseName.trim() === '工程经济学' ? getStudyTopic(task, knowledgePoint) : 'general'
  switch (topic) {
    case 'timeValue':
      return {
        objectives: [
          '先画现金流量图，标清大小、流向、时间点，再决定用现值 P、终值 F 还是年值 A。',
          '能在一次支付、普通年金、即付年金、递延年金、永续年金之间快速分类。',
          '能按“括号左边是要求量，右边是已知量”选择 P/F、F/P、P/A、A/P、F/A、A/F。',
          '能处理名义利率与实际利率换算，知道计息周期变化会影响真实收益率。',
        ],
        sourceHighlights: [
          '第4章与复习课件强调现金流量图三要素：现金流大小、流向、发生时点。',
          '总览中把第4章列为首日重点，覆盖普通年金、即付年金、递延年金、永续年金和名义/实际利率。',
          '真题第一面已出现名义利率与实际利率、永续基金、普通年金终值、一次支付现值/终值等题型。',
        ],
        concepts: [
          {
            title: '同一时点原则',
            body: '不同年份的钱不能直接相加，必须用基准收益率或利率折算到同一时点。题目问“现在值多少”就折到第 0 期，问“几年后有多少”就折到目标期末。',
            formula: 'F = P(F/P, i, n)；P = F(P/F, i, n)',
            source: '第4章资金时间价值',
          },
          {
            title: '年金类型判别',
            body: '每期期末等额发生是普通年金；每期期初等额发生是即付年金；隔若干期后才开始发生是递延年金；无限期等额发生是永续年金。',
            formula: '普通年金 P = A(P/A, i, n)；即付年金可先按普通年金算再乘 (1+i)；永续年金 P = A/i',
            source: '复习总览第4章',
          },
          {
            title: '递延年金处理',
            body: '先把连续年金折到第一笔现金流发生前一期，再用一次支付现值系数继续折回第 0 期。不要把递延期误算进年金期数。',
            formula: 'P0 = A(P/A, i, n)(P/F, i, m)',
            source: '第4章年金时间点专项',
          },
          {
            title: '名义利率与实际利率',
            body: '名义利率 r 固定时，年内计息次数 m 越多，实际年利率越高。当计息周期为一年时，名义利率才等于实际利率。',
            formula: 'i实际 = (1 + r/m)^m - 1',
            source: '真题第一面与第4章课件',
          },
          {
            title: '不等额现金流',
            body: '现金流每年不相等时不要硬套年金系数，要逐年折现后相加。表格题先列年份，再列各年现金流，再折现。',
            formula: 'P = 第1年CF(P/F,i,1) + 第2年CF(P/F,i,2) + ...',
            source: '现金流量图与资金等值计算',
          },
        ],
        example: {
          title: '普通年金与即付年金对照',
          setup: '每年存入 10 万元，连续 5 年，年利率 10%。若题目写“每年年末存”，求第 5 年末本利和；若写“每年年初存”，应如何调整？',
          steps: [
            '年末存款是普通年金终值，直接用 F = A(F/A, 10%, 5)。',
            '查系数或计算：(F/A, 10%, 5) = [(1+10%)^5 - 1] / 10% = 6.1051。',
            '普通年金终值 F = 10 × 6.1051 = 61.051 万元。',
            '年初存款是即付年金，每笔钱比年末存多计息一期，所以在普通年金结果上乘 (1+10%)。',
            '即付年金终值 F = 61.051 × 1.1 = 67.156 万元。',
          ],
          conclusion: '资金时间价值题的分水岭不是公式难，而是“年初/年末/递延/永续”的时间点判断。',
        },
        checklist: [
          '题干有“每年年末”等额发生：优先按普通年金。',
          '题干有“每年年初”等额发生：按即付年金，多一个计息期。',
          '题干有“永久”“永续”“每年固定发放”：用 P=A/i 或 A=P×i。',
          '题干给名义利率且计息次数不是一年一次：先换周期利率或实际利率。',
          '现金流不等额：逐年用 P/F 折现，不套 P/A。',
        ],
      }
    case 'evaluation':
      return {
        objectives: [
          '能区分静态评价指标和动态评价指标，知道第5章中动态指标是最终决策重点。',
          '能计算静态/动态投资回收期，并说明回收期指标的局限。',
          '能用 NPV、NAV、NPVR、IRR 判断单一项目是否可行。',
          '能处理 Excel NPV、PMT、IRR 在第 0 期和现金流符号上的易错点。',
        ],
        sourceHighlights: [
          '第五章课件将评价方法分为不考虑资金时间价值的静态指标和考虑复利折现的动态指标。',
          '第5章 Excel 实践课件给出 NPV 函数曲线、NAV 用 PMT 转换、IRR 插值与函数求解。',
          '复习总览记录了动态投资回收期、NPV 第0期处理、IRR 插值和非常规现金流多 IRR 作为高频陷阱。',
        ],
        concepts: [
          {
            title: '静态回收期',
            body: '不折现，直接累计净现金流到首次转正。优点是直观，缺点是不考虑资金时间价值，也不考虑回收期后的收益。',
            formula: 'Pt = 首次转正前一年 + 上年累计未回收额 / 当年净现金流',
            source: '第五章投资回收期课件',
          },
          {
            title: '动态回收期',
            body: '先把各年净现金流按基准收益率折现，再累计到净现金流量累计现值等于零或首次转正。通常比静态回收期更长。',
            formula: "Pt' = 首次转正前一年 + 上年累计未回收现值 / 当年折现净现金流",
            source: '第五章动态投资回收期',
          },
          {
            title: 'NPV 与 NAV',
            body: 'NPV 把全寿命现金流折到第 0 期，判断是否超过基准收益率；NAV 把 NPV 转换为寿命期内等额年值，寿命不等方案比较时尤其常用。',
            formula: 'NPV = 各期净现金流现值之和；NAV = NPV(A/P, i, n)',
            source: '第五章工程经济评价基本方法',
          },
          {
            title: 'NPVR 与资金受限',
            body: 'NPVR 表示单位投资现值创造的净现值。无资金约束时以 NPV 最大为主，有资金约束时 NPVR 可作为排序线索，但最稳仍是列组合。',
            formula: 'NPVR = NPV / 投资现值',
            source: '复习总览 NPV、NAV、IRR',
          },
          {
            title: 'IRR 判别与插值',
            body: 'IRR 是使 NPV 等于 0 的折现率。常规投资项目中，IRR 大于基准收益率则项目可接受；非常规现金流可能出现多个 IRR。',
            formula: 'IRR = i1 + NPV1 / (NPV1 - NPV2) × (i2 - i1)',
            source: '第5章 IRR 与 Excel 实践',
          },
          {
            title: 'Excel 净现值陷阱',
            body: 'Excel 的 NPV(rate, value1, value2...) 默认 value1 是第 1 期末现金流，不包含第 0 期初始投资。',
            formula: '=第0期现金流 + NPV(rate, 第1期现金流, ..., 第n期现金流)',
            source: '第5章 Excel 实践课件',
          },
        ],
        example: {
          title: '课件案例：用 Excel 思路计算 NPV',
          setup: '某项目初始投资 206000 元，第 1 至 6 年年末现金流分别为 50000、50000、50000、50000、48000、106000 元，贴现率 12%。',
          steps: [
            '先识别第 0 期现金流：初始投资 -206000，不放进 Excel 的 NPV 函数参数序列。',
            '第 1 至 6 年现金流均发生在年末，可放入 NPV(12%, 50000, 50000, 50000, 50000, 48000, 106000)。',
            '完整表达式为 =-206000 + NPV(12%, 50000, 50000, 50000, 50000, 48000, 106000)。',
            '课件计算结果约为 26806.86 元，NPV > 0，说明项目在 12% 基准收益率下仍有超额收益。',
            '若继续求 NAV，再用 PMT 或 A/P 把 NPV 折成年值，不是重新把每年现金流平均。',
          ],
          conclusion: '第5章题目常把“指标含义”和“Excel 函数口径”混在一起考，先处理第 0 期，后判别 NPV 正负。',
        },
        checklist: [
          '问回收速度：回收期；问是否创造超额收益：NPV。',
          '动态回收期必须先折现后累计，静态回收期不折现。',
          'NPV > 0 可行，NPV = 0 刚好达到基准收益率，NPV < 0 不可行。',
          'IRR 插值必须找一正一负两个 NPV，且区间通常不宜过大。',
          'Excel NPV 不含第0期；Excel IRR 序列要包含第0期并保留正负号。',
        ],
      }
    case 'taxCashflow':
      return {
        objectives: [
          '能区分净利润和现金流量，知道工程经济评价更重视现金流量。',
          '能按平均年限法、工作量法、双倍余额递减法、年数总和法计算折旧。',
          '能由收入、付现成本、折旧、所得税推导税后经营净现金流 NCF。',
          '能在最后一年正确加入残值、营运资金回收，并处理残值税影响的口径。',
        ],
        sourceHighlights: [
          '复习课件指出现金流量更客观，现金流量状况决定企业生存能力和价值创造。',
          '总览把折旧、所得税、NCF、最后一年残值列为第5章高频考点。',
          '真题第一面已出现“最后一年税后现金流量”题型，容易漏掉残值或营运资金回收。',
        ],
        concepts: [
          {
            title: '现金流量优先',
            body: '净利润受折旧、摊销等会计处理影响，现金流量更能反映项目能否真实回收投资。工程经济评价通常用现金流而不是利润直接决策。',
            source: '工程经济学复习课件现金流量部分',
          },
          {
            title: '折旧不是付现成本',
            body: '折旧本身不产生现金流出，但会降低税前利润，从而减少所得税，形成折旧抵税。算现金流时要先扣折旧算税，再把折旧加回来。',
            formula: '所得税 = (收入 - 付现成本 - 折旧) × 税率',
            source: '第5章成本费用与折旧',
          },
          {
            title: '经营净现金流',
            body: '如果题目只给经营期收入、付现成本、折旧和税率，最稳写法是先算税前利润、所得税、净利润，再用净利润加折旧得到经营 NCF。',
            formula: 'NCF = 收入 - 付现成本 - 所得税 = 税后利润 + 折旧',
            source: '税后现金流专项',
          },
          {
            title: '折旧方法',
            body: '平均年限法用原值扣净残值后平均摊；工作量法按实际工作量分配；双倍余额递减法前期折旧多；年数总和法按剩余年限占比分配。',
            formula: '平均年限法折旧 = (原值 - 净残值) / 年限',
            source: '复习总览折旧方法',
          },
          {
            title: '最后一年口径',
            body: '最后一年通常等于经营 NCF 加残值回收、营运资金回收。若残值与账面净值不同，还要考虑残值处置带来的所得税影响。',
            formula: '最后一年 NCF = 经营 NCF + 残值收入 + 营运资金回收',
            source: '真题第一面税后现金流题',
          },
        ],
        example: {
          title: '最后一年税后现金流',
          setup: '某设备购置及安装 100 万元，寿命 10 年，残值 10 万元，直线折旧；年营业收入 50 万元，年付现成本 25 万元，所得税率 33%。若另有营运资金 15 万元在期末收回，求最后一年现金流。',
          steps: [
            '年折旧 = (100 - 10) / 10 = 9 万元。',
            '税前利润 = 50 - 25 - 9 = 16 万元。',
            '所得税 = 16 × 33% = 5.28 万元。',
            '经营净现金流 = 50 - 25 - 5.28 = 19.72 万元，也可用税后利润 10.72 + 折旧 9。',
            '最后一年现金流 = 19.72 + 残值 10 + 营运资金回收 15 = 44.72 万元。',
          ],
          conclusion: '这类题最容易漏“最后一年额外回收项”。若题干没有营运资金，就只加题目明确给出的残值等回收项。',
        },
        checklist: [
          '折旧不是现金流出，但影响所得税。',
          '先算税前利润，再算所得税，最后回到经营净现金流。',
          '第0期投资和营运资金投入是现金流出。',
          '最后一年检查残值、营运资金回收、清理税影响。',
          '加速折旧不改变总折旧额，只改变各年税盾发生时间。',
        ],
      }
    case 'multiScheme':
      return {
        objectives: [
          '能先判断方案关系：互斥、独立还是混合，而不是一上来套 NPV 或 IRR。',
          '能根据寿命相同/不同、收益型/费用型选择 NPV、NAV、PC、AC 或差额分析。',
          '能用差额净现值判断追加投资是否值得。',
          '能处理独立方案资金约束和无限寿命方案中的周期性费用。',
        ],
        sourceHighlights: [
          '第6章总览覆盖互斥方案、寿命相同/不同方案、无限寿命方案、独立方案和混合方案。',
          '复习记录中多次强调寿命不同方案优先转年值，费用型方案比较 PC 或 AC。',
          '综合模拟错疑点出现“无限寿命方案中周期性大修费用应按已知 F 求 A，用 A/F”。',
        ],
        concepts: [
          {
            title: '关系优先',
            body: '互斥方案只能选一个；独立方案可以多个都选；混合方案通常组内互斥、组间独立。关系判断错，后面指标再准也会选错。',
            source: '第6章多方案经济评价方法',
          },
          {
            title: '寿命相同的互斥收益型方案',
            body: '可以比较 NPV，也可用差额净现值看追加投资是否值得。不要简单选 IRR 最大，因为 IRR 可能偏向投资额小的方案。',
            formula: 'ΔNPV = NPV投资大方案 - NPV投资小方案；ΔNPV >= 0 选投资大方案',
            source: '第6章差额净现值法',
          },
          {
            title: '寿命不同的互斥方案',
            body: '直接比较 NPV 会受寿命长短影响。常用最小公倍数法、研究期法或年值法；考试速成优先记年值法。',
            formula: '收益型比 NAV，选大；费用型比 AC，选小',
            source: '第6章寿命期不同方案',
          },
          {
            title: '费用型方案',
            body: '如果各方案产出价值相同，或者效益难以估算但满足相同需求，则只比较费用。费用现值 PC 或费用年值 AC 越小越好。',
            formula: 'AC = PC(A/P, i, n)',
            source: '复习课件费用现值、费用年值',
          },
          {
            title: '独立方案资金约束',
            body: '无资金限制时，NPV > 0 的独立方案原则上都可选；有资金限制时，最稳是列出所有不超预算的组合，选总 NPV 最大的组合。',
            source: '第6章独立方案与混合方案',
          },
          {
            title: '无限寿命与周期费用',
            body: '无限寿命方案可把现值转为年值。若每隔 N 年发生一次大修费 F，本质是已知终值求年值，用 A/F。',
            formula: '无限寿命 AC = PC × i；周期大修年值 A = F(A/F, i, N)',
            source: '第6章无限寿命方案',
          },
        ],
        example: {
          title: '差额净现值判断追加投资',
          setup: 'A、B 两个收益型互斥方案寿命相同。A 初始投资 100 万元，NPV 为 28 万元；B 初始投资 150 万元，NPV 为 38 万元。问是否值得选择投资更大的 B。',
          steps: [
            '先确认关系：A、B 互斥，只能选一个。',
            '确认寿命相同且收益型，可以直接比较 NPV，也可以看追加投资是否值得。',
            'ΔNPV = NPV_B - NPV_A = 38 - 28 = 10 万元。',
            'ΔNPV >= 0，说明 B 相对 A 多投的 50 万元能带来正的增量净现值。',
            '结论：选投资较大的 B。',
          ],
          conclusion: '差额分析的本质是判断“多花的钱值不值”。不是只看投资小，也不是只看 IRR 高。',
        },
        checklist: [
          '第一步写方案关系：互斥、独立、混合。',
          '寿命相同收益型互斥：NPV 大或 ΔNPV >= 0 的方案。',
          '寿命不同收益型互斥：转 NAV 比较。',
          '费用型方案：PC 或 AC 越小越好。',
          '独立方案有预算：列合法组合，选总 NPV 最大。',
          '每隔 N 年发生一次费用 F：折成年值用 A/F。',
        ],
      }
    case 'risk':
      return {
        objectives: [
          '能写出盈亏平衡产量、生产能力利用率、保本价格、保本单位变动成本。',
          '能区分不含税与含营业税及附加的盈亏平衡口径。',
          '能用安全余量、盈亏平衡点高低判断项目抗风险能力。',
          '能解释敏感性分析、临界变化率、概率期望值的含义。',
        ],
        sourceHighlights: [
          '第7章总览覆盖盈亏平衡分析、敏感性分析、概率分析与期望值。',
          '复习总览记录了含税口径、生产能力利用率、保本价格和保本单位变动成本。',
          '诊断信息把“盈亏平衡公式口径（含税/不含税）”列为当前提分点。',
        ],
        concepts: [
          {
            title: '盈亏平衡产量',
            body: '在不考虑营业税及附加时，固定成本除以单位边际贡献就是保本产量。单位边际贡献越大，保本产量越低。',
            formula: 'Q* = F / (P - Cv)',
            source: '第7章盈亏平衡分析',
          },
          {
            title: '含税口径',
            body: '如果题目给营业税及附加率 r，销售单价要按 P(1-r) 进入边际贡献。含税与不含税口径是第7章常见陷阱。',
            formula: 'Q* = F / [P(1-r) - Cv]',
            source: '复习总览含税口径',
          },
          {
            title: '生产能力利用率',
            body: '保本产量占设计产能比例越低，说明项目达到不亏损所需产能越少，抗风险能力越强。',
            formula: 'q* = Q* / Qc',
            source: '第7章生产能力利用率',
          },
          {
            title: '保本价格与保本单位变动成本',
            body: '保本价格是刚好不亏时最低售价，保本单位变动成本是刚好不亏时可承受的最高单位变动成本。',
            formula: 'P* = F/Qc + Cv；Cv* = P - F/Qc',
            source: '第7章保本指标',
          },
          {
            title: '敏感性分析',
            body: '每次只改变一个关键变量，看 NPV、利润等评价指标变化幅度。指标变化越大，或者临界变化率绝对值越小，该因素越敏感。',
            formula: '临界变化率越接近 0，风险越大',
            source: '第7章敏感性分析',
          },
          {
            title: '概率分析',
            body: '概率分析把不同情景的结果按概率加权，常用期望值辅助判断，但期望值不能替代对极端风险的关注。',
            formula: 'E = 各情景结果 × 对应概率 后求和',
            source: '第7章概率分析',
          },
        ],
        example: {
          title: '保本产量与风险判断',
          setup: '固定成本 120 万元，产品单价 800 元，单位变动成本 500 元，年设计产能 8000 件。',
          steps: [
            '单位边际贡献 = 800 - 500 = 300 元。',
            '盈亏平衡产量 Q₀ = 1200000 / 300 = 4000 件。',
            '生产能力利用率 = 4000 / 8000 = 50%。',
            '如果同类项目 B 的保本利用率是 70%，则本项目达到保本所需产能更低。',
            '因此在销量下滑时，本项目的安全余量相对更大。',
          ],
          conclusion: '达到 50% 产能即可保本，剩余产能空间越大，安全余量越大。',
        },
        checklist: [
          '题干没给税率：优先用 Q*=F/(P-Cv)。',
          '题干给营业税及附加率：分母改为 P(1-r)-Cv。',
          '盈亏平衡点越低，抗风险能力越强。',
          '临界变化率绝对值越小，因素越敏感。',
          '概率分析用期望值，但敏感性分析不直接给发生概率。',
        ],
      }
    case 'excel':
      return {
        objectives: [
          '能判断 PV、FV、PMT、NPV、IRR、NPER 分别对应现值、终值、年金、项目评价、收益率和期数。',
          '能准确处理 NPV 不含第 0 期、IRR 包含第 0 期现金流序列。',
          '能用 PMT 的 rate、nper、pv、fv、type 参数解释年值换算。',
          '能区分单变量求解和规划求解器的使用场景。',
        ],
        sourceHighlights: [
          'Excel 操作基础课件强调公式以 = 开头、相对/绝对引用、常用函数和数据运算。',
          '第5章 Excel 实践课件给出 NPV 函数曲线、PMT 年值计算、IRR 插值和函数求解。',
          '单变量求解适合“让某公式达到目标值”，规划求解器适合“目标、变量、约束”优化。',
        ],
        concepts: [
          {
            title: '基础输入规则',
            body: 'Excel 公式必须以 = 开头。复制公式时相对引用会变化，绝对引用用 $ 固定行列，做利率表或参数表时尤其重要。',
            formula: '$A$1 固定行列；$A1 固定列；A$1 固定行',
            source: 'Excel 操作基础概述',
          },
          {
            title: '资金等值函数',
            body: 'PV 求现值，FV 求终值，PMT 求等额年金，NPER 求期数。rate 和 nper 的单位必须一致，月利率就配月数。',
            formula: 'PMT(rate, nper, pv, fv, type)',
            source: '第5章 Excel 实践 PMT',
          },
          {
            title: 'PMT 符号与 type',
            body: 'PMT 返回值通常与现值符号相反，因为它把借入本金和偿还现金流看成相反方向。type 为 1 表示期初付款，不填或 0 表示期末付款。',
            source: '第5章 Excel 实践净年值',
          },
          {
            title: 'NPV 第0期',
            body: 'NPV 函数从第 1 期末开始折现，因此第 0 期初始投资要单独加在函数外。',
            formula: '=第0期现金流 + NPV(rate, 第1期现金流, ..., 第n期现金流)',
            source: '第5章 Excel 实践 NPV',
          },
          {
            title: 'IRR 序列',
            body: 'IRR 的现金流序列第一个值就是第 0 期，且通常至少要有一正一负。非常规现金流可能出现多解或不可靠结果。',
            formula: '=IRR(第0期现金流:最后一期现金流)',
            source: '第5章 Excel 实践 IRR',
          },
          {
            title: '求解工具',
            body: '单变量求解用于反推一个变量使公式达到指定值；规划求解器用于在约束条件下最大化、最小化或达到某个目标。',
            source: '单变量求解、规划求解器课件',
          },
        ],
        example: {
          title: 'PMT 与 NPV 的两个高频口径',
          setup: '以 10% 年利率借款 20000 元，用于寿命 10 年的项目，问每年至少收回多少；另有第0期投资 -100，后4年每年现金流 35，折现率 10%，求 NPV 写法。',
          steps: [
            '年金反推用 PMT：=PMT(10%, 10, -20000)，课件示例结果约为 3254.91 元。',
            'PMT 中 pv 写成 -20000，是为了让返回的每年收回金额为正。',
            'NPV 写法为 =-100 + NPV(10%, 35, 35, 35, 35)。',
            '不要写成 =NPV(10%, -100, 35, 35, 35, 35)，否则第0期投资被当作第1期末现金流折现。',
            'IRR 则需要把第0期放入序列：=IRR(-100, 35, 35, 35, 35)。',
          ],
          conclusion: 'Excel 题的关键不是背函数名，而是先确认第 0 期是否已经被正确处理。',
        },
        checklist: [
          'rate 与 nper 单位一致：月利率配月数，年利率配年数。',
          'NPV 不含第0期现金流，第0期单独加。',
          'IRR 现金流序列包含第0期，并保留正负号。',
          'PMT 结果符号与 pv 常相反，必要时在函数前加负号。',
          '单变量求解是一个可变单元格，规划求解器是目标、变量、约束组合。',
        ],
      }
    default:
      return {
        objectives: [
          `能复述「${task.title}」的核心概念和适用条件。`,
          '能把本节公式或结论转成自己的解题步骤。',
          '能完成至少一道对应练习题，检查是否真正掌握。',
        ],
        sourceHighlights: [
          '先抓定义、公式、判别规则和例题结构。',
          '再用一道题验证自己能否独立完成判断、代入和复述。',
        ],
        concepts: [
          { title: '学习切入', body: '先找本节的定义、公式、判别规则和例题结构，再把它们整理成可复述的解题路径。' },
          { title: '核心讲解', body: knowledgePoint?.summary ?? task.description },
          { title: '检验方法', body: '学完后不要只看“懂了”，要用一道题验证自己能否独立判断条件、选公式、写步骤。' },
        ],
        example: {
          title: '通用学习拆解',
          setup: '面对一个新题型，先把题目条件、目标量、可用公式分开列出。',
          steps: [
            '圈出题目问的是现值、终值、年值、收益率还是风险边界。',
            '把已知量统一到同一口径，比如时间点、税前税后、静态动态。',
            '代入公式后，用判别规则解释结果含义。',
          ],
          conclusion: '主线学习的目标是形成稳定解题路径，而不只是看完资料。',
        },
        checklist: [
          '先写题目问什么，再写已知量。',
          '统一时间点、税前税后、静态动态等口径。',
          '代入公式后必须写判别结论。',
        ],
      }
  }
}

function StudyTaskView({
  course,
  task,
  knowledgePoint,
  practiceQuestions,
  practiceAnswers,
  onSubmitPractice,
  onClearPracticeAnswer,
  onBack,
  onPractice,
  onProgressChange,
}: {
  course: Course
  task: PlanTask
  knowledgePoint?: KnowledgePoint
  practiceQuestions: QuizQuestion[]
  practiceAnswers?: Record<string, PracticeAnswerRecord>
  onSubmitPractice: ModuleViewProps['onSubmitPractice']
  onClearPracticeAnswer?: ModuleViewProps['onClearPracticeAnswer']
  onBack: () => void
  onPractice: () => void
  onProgressChange: (pageIndex: number, pageCount: number) => void
}) {
  type StudyPracticeFeedback = {
    correct: boolean
    explanation: string
    mastery: number
    generatedSimilarCount: number
  }
  function restorePracticeState(records?: Record<string, PracticeAnswerRecord>) {
    const answers: Record<string, number> = {}
    const feedback: Record<string, StudyPracticeFeedback> = {}
    if (records) {
      for (const [id, record] of Object.entries(records)) {
        answers[id] = record.answerIndex
        feedback[id] = {
          correct: record.correct,
          explanation: record.explanation,
          mastery: record.mastery,
          generatedSimilarCount: 0,
        }
      }
    }
    return { answers, feedback }
  }
  const [selectedPracticeAnswers, setSelectedPracticeAnswers] = useState<Record<string, number>>(
    () => restorePracticeState(practiceAnswers).answers,
  )
  const [practiceFeedbackById, setPracticeFeedbackById] = useState<Record<string, StudyPracticeFeedback>>(
    () => restorePracticeState(practiceAnswers).feedback,
  )
  const [submittingPracticeId, setSubmittingPracticeId] = useState<string | null>(null)
  const [studyPageIndex, setStudyPageIndex] = useState(0)
  const isCompleted = task.status === 'completed'
  const guide = buildStudyGuide(task, knowledgePoint, course.name)
  const focusSection = guide.sections?.[0]
  const methodSection = guide.sections?.[1]
  const exampleSection = guide.sections?.[2]
  const selfCheckSection = guide.sections?.[3]
  const examPoints = focusSection?.examPoints ?? guide.examPoints ?? []
  const methodExamPoints = methodSection?.examPoints ?? guide.examPoints ?? []
  const legacyExample = exampleSection?.example ?? guide.example
  const workedExamples: StudyWorkedExample[] = exampleSection?.workedExamples?.length
    ? exampleSection.workedExamples
    : guide.workedExamples?.length
      ? guide.workedExamples
      : legacyExample
        ? [legacyExample]
        : []
  const relatedPracticeQuestions = getRelatedPracticeQuestions(task, knowledgePoint, guide, practiceQuestions)

  // 自测题：先选择、后提交——点选项只标记「预选」，必须再点「提交答案」才算正式作答。
  function selectPracticeAnswer(question: QuizQuestion, answerIndex: number) {
    if (submittingPracticeId || practiceFeedbackById[question.id]) return
    setSelectedPracticeAnswers((current) => ({ ...current, [question.id]: answerIndex }))
  }

  async function confirmPracticeAnswer(question: QuizQuestion) {
    if (submittingPracticeId || practiceFeedbackById[question.id]) return
    const answerIndex = selectedPracticeAnswers[question.id]
    if (answerIndex === undefined) return
    setSubmittingPracticeId(question.id)
    try {
      const result = await onSubmitPractice(question.id, answerIndex, '主线学习')
      setPracticeFeedbackById((current) => ({ ...current, [question.id]: result }))
    } finally {
      setSubmittingPracticeId(null)
    }
  }

  const studyPages = [
    {
      label: focusSection?.label ?? '考点',
      title: focusSection?.title ?? '先知道这一节考试会怎么考',
      content: (
        examPoints.length ? (
          <div className="study-exam-points">
            {(focusSection?.planningReason ?? guide.planningReason) && (
              <p className="study-planning-reason">{focusSection?.planningReason ?? guide.planningReason}</p>
            )}
            {examPoints.map((point, index) => (
              <article className="study-exam-point" key={point.id}>
                <header>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong><StudyFormulaText text={point.title} /></strong>
                  <em>{point.importance === 'high' ? '高频重点' : point.importance === 'medium' ? '常规考点' : '快速验证'}</em>
                </header>
                {point.questionTypes?.length ? <p><StudyFormulaText text={`常见考法：${point.questionTypes.join('、')}`} /></p> : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="study-page-grid">
            <section>
              <span className="study-subhead">学习目标</span>
              <ul className="study-points">
                {(focusSection?.objectives ?? guide.objectives ?? []).map((objective) => (
                    <li key={objective}><Target size={16} /> <StudyFormulaText text={objective} /></li>
                ))}
              </ul>
            </section>
          </div>
        )
      ),
    },
    {
      label: methodSection?.label ?? '讲解',
      title: methodSection?.title ?? '速成讲解：把概念、公式和判别规则拆开',
      content: (
        <div className="study-concepts">
          {methodExamPoints.length
            ? methodExamPoints.map((point) => (
                <article className="study-concept" key={point.id}>
                  <strong><StudyFormulaText text={point.title} /></strong>
                  <p><StudyFormulaText text={point.explanation} /></p>
                  {point.formulas?.map((formula) => (
                    <div className="study-formula" key={`${point.id}-${formula.expression}`}>
                      <code><StudyFormulaText text={formula.expression} /></code>
                      <p><StudyFormulaText text={formula.meaning} /></p>
                      <span><StudyFormulaText text={`适用条件：${formula.conditions}`} /></span>
                    </div>
                  ))}
                  {point.procedure?.length ? (
                    <ol className="study-procedure">
                      {point.procedure.map((step) => <li key={step}><StudyFormulaText text={step} /></li>)}
                    </ol>
                  ) : null}
                  {point.pitfalls?.length ? (
                    <ul className="study-pitfalls">
                      {point.pitfalls.map((pitfall) => <li key={pitfall}><StudyFormulaText text={pitfall} /></li>)}
                    </ul>
                  ) : null}
                </article>
              ))
            : (methodSection?.concepts ?? guide.concepts ?? []).map((concept) => (
                <article className="study-concept" key={concept.title}>
                  <strong><FormulaText text={studyConceptTitle(concept.title)} /></strong>
                  <p><StudyFormulaText text={concept.body} /></p>
                  {concept.formula && <code><StudyFormulaText text={concept.formula} /></code>}
                </article>
              ))}
        </div>
      ),
    },
    {
      label: exampleSection?.label ?? '例题',
      title: exampleSection?.title ?? '用具体题目完成方法迁移',
      content: (
        <div className="worked-example-list">
          {workedExamples.map((example, index) => (
            <article className="worked-example" key={example.id ?? `${example.title}-${index}`}>
              <header>
                <div>
                  <span>例题 {index + 1}</span>
                  <h3><StudyFormulaText text={example.title} /></h3>
                </div>
              </header>
              <WorkedExampleQuestion text={stripStudySourceMarkers(example.problem ?? example.setup ?? '')} />
              {example.analysis && (
                <p className="worked-example-analysis">
                  <strong>题型分析：</strong><StudyFormulaText text={example.analysis} />
                </p>
              )}
              <ol>
                {example.steps.map((step) => <li key={step}><StudyFormulaText text={step} /></li>)}
              </ol>
              <strong className="worked-example-answer"><StudyFormulaText text={example.answer ?? example.conclusion ?? ''} /></strong>
              {example.checks?.length ? (
                <ul className="study-checklist">
                  {example.checks.map((check) => <li key={check}><CheckCircle2 size={15} /> <StudyFormulaText text={check} /></li>)}
                </ul>
              ) : null}
            </article>
          ))}
          {!workedExamples.length && <p className="study-empty-practice">本节例题未生成完整，请重新生成复习主线。</p>}
        </div>
      ),
    },
    {
      label: selfCheckSection?.label ?? '自测',
      title: selfCheckSection?.title ?? '用覆盖本节考点的题目检查理解',
      content: (
        <div className="study-self-check">
          {(selfCheckSection?.checklist ?? guide.checklist ?? []).length ? (
            <ul className="study-checklist">
              {(selfCheckSection?.checklist ?? guide.checklist ?? []).map((item) => (
                <li key={item}><CheckCircle2 size={15} /> <StudyFormulaText text={item} /></li>
              ))}
            </ul>
          ) : null}
          <div className="study-practice-list">
            {relatedPracticeQuestions.map((question, questionIndex) => {
              const selectedAnswer = selectedPracticeAnswers[question.id]
              const practiceFeedback = practiceFeedbackById[question.id]
              const isSubmitting = submittingPracticeId === question.id
              return (
                <article className="study-practice-card" key={question.id}>
                  <span className="question-label">自测 {questionIndex + 1}</span>
                  <p><StudyFormulaText text={question.prompt} /></p>
                  <div className="choice-list">
                    {[...question.options, UNKNOWN_CHOICE_LABEL].map((choice, index) => {
                      const choiceId = String.fromCharCode(65 + index)
                      const hasAnswered = Boolean(practiceFeedback)
                      const state =
                        hasAnswered && question.answerIndex === index
                          ? 'is-correct'
                          : hasAnswered && selectedAnswer === index
                            ? 'is-wrong'
                            : selectedAnswer === index
                              ? 'is-selected'
                              : ''
                      return (
                        <button
                          className={`choice ${state}`}
                          key={`${question.id}-${choiceId}`}
                          type="button"
                          disabled={hasAnswered || Boolean(submittingPracticeId)}
                          onClick={() => selectPracticeAnswer(question, index)}
                        >
                          <b>{choiceId}</b>
                          <span><StudyFormulaText text={choice} /></span>
                          {hasAnswered && question.answerIndex === index && <CheckCircle2 size={19} />}
                          {hasAnswered && selectedAnswer === index && question.answerIndex !== index && <CircleAlert size={19} />}
                        </button>
                      )
                    })}
                  </div>
                  {!practiceFeedback && selectedAnswer !== undefined && (
                    <div className="study-practice-confirm">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={Boolean(submittingPracticeId)}
                        onClick={() => void confirmPracticeAnswer(question)}
                      >
                        {isSubmitting ? 'AI 分析中' : '提交答案'} <Check size={16} />
                      </button>
                    </div>
                  )}
                  {isSubmitting && (
                    <section className="answer-feedback">
                      <div><Sparkles size={21} /><strong>AI 正在分析这道题，并准备同类练习。</strong></div>
                    </section>
                  )}
                  {practiceFeedback && selectedAnswer !== undefined && (
                    <section className={`answer-feedback ${practiceFeedback.correct ? 'is-correct' : 'is-wrong'}`}>
                      <div>
                        {practiceFeedback.correct ? <CheckCircle2 size={21} /> : <CircleAlert size={21} />}
                        <strong>
                          {practiceFeedback.correct
                            ? '自测正确，掌握度已更新。'
                            : `已加入错题本${practiceFeedback.generatedSimilarCount ? `，新增 ${practiceFeedback.generatedSimilarCount} 道同类练习` : ''}。`}
                        </strong>
                      </div>
                      <p><StudyFormulaText text={practiceFeedback.explanation} /></p>
                      <button type="button" onClick={() => {
                        if (onClearPracticeAnswer) void onClearPracticeAnswer(question.id)
                        setSelectedPracticeAnswers((current) => {
                          const next = { ...current }
                          delete next[question.id]
                          return next
                        })
                        setPracticeFeedbackById((current) => {
                          const next = { ...current }
                          delete next[question.id]
                          return next
                        })
                      }}>重做本题</button>
                    </section>
                  )}
                </article>
              )
            })}
            {!relatedPracticeQuestions.length && (
              <p className="study-empty-practice">本节自测未生成完整，请重新生成复习主线。</p>
            )}
          </div>
        </div>
      ),
    },
  ]

  useEffect(() => {
    const restored = restorePracticeState(practiceAnswers)
    setSelectedPracticeAnswers(restored.answers)
    setPracticeFeedbackById(restored.feedback)
    setSubmittingPracticeId(null)
    const initialPageIndex = getInitialStudyPageIndex(task, studyPages.length)
    setStudyPageIndex(initialPageIndex)
    onProgressChange(initialPageIndex, studyPages.length)
  }, [task.id])

  const activeStudyPage = studyPages[studyPageIndex] ?? studyPages[0]
  const displayProgress = isCompleted
    ? 100
    : Math.max(task.progress, getStudyProgressForPage(studyPageIndex, studyPages.length))
  const progressHint = displayProgress >= 100 ? '已完成，可继续巩固' : `已记录到 ${displayProgress}%`

  function goToStudyPage(pageIndex: number) {
    const nextPageIndex = Math.min(Math.max(pageIndex, 0), studyPages.length - 1)
    setStudyPageIndex(nextPageIndex)
    onProgressChange(nextPageIndex, studyPages.length)
    window.requestAnimationFrame(() => {
      document.querySelector('.study-workbench')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }

  return (
    <div className="module-page plan-page">
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><BookOpen size={15} /> {course.name} · 主线学习</p>
          <h1>{task.title}</h1>
          <p>{task.description}</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>
          返回主线
        </button>
      </section>

      <section className="question-panel study-workbench">
        <header>
          <div>
            <span className="question-label">复习主线 · 速成讲解 · 预计 {task.duration} 分钟</span>
          </div>
          <span className="question-counter">当前进度 {displayProgress}%</span>
        </header>

        <div className="study-layout">
          <nav className="study-page-tabs" aria-label="学习分页">
            {studyPages.map((page, index) => (
              <button
                className={studyPageIndex === index ? 'is-active' : ''}
                key={page.label}
                type="button"
                onClick={() => goToStudyPage(index)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{page.label}</strong>
              </button>
            ))}
          </nav>

          <div className="study-page-shell">
            <section className="study-section">
              <header className="study-section-heading">
                <span className="study-step">{studyPageIndex + 1}</span>
                <div>
                  <span>{activeStudyPage.label}</span>
                  <h2>{activeStudyPage.title}</h2>
                </div>
              </header>
              <div className="study-page-content">
                {activeStudyPage.content}
              </div>
            </section>

            <div className="study-page-controls">
              <button
                type="button"
                disabled={studyPageIndex === 0}
                onClick={() => goToStudyPage(studyPageIndex - 1)}
              >
                <ChevronLeft size={15} /> 上一页
              </button>
              <span>{studyPageIndex + 1} / {studyPages.length}</span>
              <button
                type="button"
                disabled={studyPageIndex >= studyPages.length - 1}
                onClick={() => goToStudyPage(studyPageIndex + 1)}
              >
                下一页 <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>

        <footer>
          <button className="secondary-button" type="button" onClick={onPractice}>
            <Target size={16} /> 进入练习
          </button>
        </footer>
      </section>

      <section className="practice-bottom-grid">
        <article className="practice-insight">
          <Clock3 size={20} />
          <div>
            <span>学习状态</span>
            <strong>{progressHint}</strong>
          </div>
        </article>
        <article className="practice-insight">
          <Brain size={20} />
          <div>
            <span>关联知识点</span>
            <strong>{knowledgePoint?.name ?? task.title}</strong>
          </div>
        </article>
      </section>
    </div>
  )
}

function buildPracticeFeedback(record: PracticeAnswerRecord | undefined) {
  if (!record) return null
  return {
    correct: record.correct,
    explanation: record.explanation,
    mastery: record.mastery,
    generatedSimilarCount: 0,
  }
}

type PracticeChapterGroup = {
  key: string
  name: string
  questions: QuizQuestion[]
}

// 按知识点（章节）对练习题分组：沿用 knowledgePoints 的顺序，组内保持原顺序（稳定），
// 没有匹配知识点的题目归入「其他知识点」。practiceQuestions 后端无按薄弱度/权重的有意排序，
// 因此按章节重排不会破坏教学顺序，反而让答错后追加的同类题自动归入对应章节。
function buildPracticeChapterGroups(
  questions: QuizQuestion[],
  knowledgePoints: KnowledgePoint[],
): PracticeChapterGroup[] {
  const order = new Map(knowledgePoints.map((point, index) => [point.id, index]))
  const known = new Map<number, PracticeChapterGroup>()
  const others: QuizQuestion[] = []
  for (const question of questions) {
    const groupIndex = order.get(question.knowledgePointId)
    if (groupIndex === undefined) {
      others.push(question)
      continue
    }
    let group = known.get(groupIndex)
    if (!group) {
      const knowledgePoint = knowledgePoints[groupIndex]
      group = { key: knowledgePoint.id, name: knowledgePoint.name, questions: [] }
      known.set(groupIndex, group)
    }
    group.questions.push(question)
  }
  const groups = Array.from(known.entries())
    .sort(([a], [b]) => a - b)
    .map(([, group]) => group)
  if (others.length) {
    groups.push({ key: '__other__', name: '其他知识点', questions: others })
  }
  return groups
}

function practicePositionStorageKey(courseId: string) {
  return `final-congee-practice-position:${courseId}`
}

// 读取上次答到的题目 id（按 questionId 恢复，比存 index 稳健：题目重生成/追加后 index 会漂移）。
// 返回的 id 一定存在于当前 questions 中，否则返回 null 由调用方回退到第一题。
function readPracticePositionId(questions: QuizQuestion[], courseId: string): string | null {
  if (!questions.length) return null
  try {
    const savedId = window.localStorage.getItem(practicePositionStorageKey(courseId))
    if (savedId && questions.some((question) => question.id === savedId)) return savedId
  } catch {
    /* localStorage 不可用时静默回退 */
  }
  return null
}

function PracticeView({
  course,
  knowledgePoints,
  practiceQuestions,
  practiceAnswers,
  onModuleChange,
  onSubmitPractice,
  onClearPracticeAnswer,
}: Pick<
  ModuleViewProps,
  | 'course'
  | 'knowledgePoints'
  | 'practiceQuestions'
  | 'practiceAnswers'
  | 'onModuleChange'
  | 'onSubmitPractice'
  | 'onClearPracticeAnswer'
>) {
  const chapterGroups = useMemo(
    () => buildPracticeChapterGroups(practiceQuestions, knowledgePoints),
    [practiceQuestions, knowledgePoints],
  )
  const orderedQuestions = useMemo(
    () => chapterGroups.flatMap((group) => group.questions),
    [chapterGroups],
  )
  const questionGlobalIndex = useMemo(() => {
    const map = new Map<string, number>()
    orderedQuestions.forEach((question, index) => map.set(question.id, index))
    return map
  }, [orderedQuestions])

  // 以 questionId 作为位置真相：答错后后端会追加同类题使 orderedQuestions 重排，
  // 用 id 派生 index 可保证列表变化时仍稳定指向同一道题，不会突然跳题。
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const savedId = readPracticePositionId(orderedQuestions, course.id)
    return savedId ?? orderedQuestions[0]?.id ?? null
  })
  const questionIndex = useMemo(() => {
    if (!orderedQuestions.length || !currentId) return 0
    const index = orderedQuestions.findIndex((question) => question.id === currentId)
    return index >= 0 ? index : 0
  }, [orderedQuestions, currentId])
  useEffect(() => {
    if (!currentId) return
    try {
      window.localStorage.setItem(practicePositionStorageKey(course.id), currentId)
    } catch {
      /* 忽略写入失败（如隐私模式） */
    }
  }, [currentId, course.id])
  // currentId 缺失（初次进入时题目仍在生成）或当前题已不在列表中（题目被重生成）时，
  // 尝试从 localStorage 恢复上次位置，否则回到第一题。保证位置记忆在题目到达后仍生效。
  useEffect(() => {
    if (!orderedQuestions.length) return
    if (currentId && orderedQuestions.some((question) => question.id === currentId)) return
    const restored = readPracticePositionId(orderedQuestions, course.id)
    setCurrentId(restored ?? orderedQuestions[0].id)
  }, [orderedQuestions, currentId, course.id])

  const initialQuestion = orderedQuestions[questionIndex]
  const firstRecord = practiceAnswers?.[initialQuestion?.id]
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(
    firstRecord ? String(firstRecord.answerIndex) : null,
  )
  const [submitted, setSubmitted] = useState(Boolean(firstRecord))
  const [feedback, setFeedback] = useState<{
    correct: boolean
    explanation: string
    mastery: number
    generatedSimilarCount: number
  } | null>(buildPracticeFeedback(firstRecord))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showNav, setShowNav] = useState(false)
  const question = orderedQuestions[questionIndex]
  const selectedIndex = selectedAnswer ? Number(selectedAnswer) : -1
  const knowledgePoint = knowledgePoints.find((point) => point.id === question?.knowledgePointId)

  function restoreQuestion(id: string) {
    const record = practiceAnswers?.[id]
    setSelectedAnswer(record ? String(record.answerIndex) : null)
    setSubmitted(Boolean(record))
    setFeedback(buildPracticeFeedback(record))
  }

  async function submitAnswer() {
    if (!question || selectedIndex < 0) return
    setIsSubmitting(true)
    try {
      const result = await onSubmitPractice(question.id, selectedIndex, '刷题练习')
      setFeedback(result)
      setSubmitted(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  function goPrev() {
    const prev = orderedQuestions[questionIndex - 1]
    if (!prev) return
    setCurrentId(prev.id)
    restoreQuestion(prev.id)
  }

  function goNext() {
    const next = orderedQuestions[questionIndex + 1]
    if (!next) return
    setCurrentId(next.id)
    restoreQuestion(next.id)
  }

  function jumpTo(index: number) {
    const target = orderedQuestions[index]
    if (!target) return
    setCurrentId(target.id)
    restoreQuestion(target.id)
    setShowNav(false)
  }

  async function redoQuestion() {
    if (!question || !onClearPracticeAnswer) return
    await onClearPracticeAnswer(question.id)
    setSelectedAnswer(null)
    setSubmitted(false)
    setFeedback(null)
  }

  if (!question) {
    return <div className="module-page empty-module"><GraduationCap size={32} /><h1>刷题练习</h1><p>正在生成{course.name}定向题。</p></div>
  }

  return (
    <div className="module-page practice-page">
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><Target size={15} /> {course.name}重点训练 · 高优先级</p>
          <h1>刷题练习</h1>
          <p>这一组题围绕你的薄弱点生成。答题结果会写回掌握度和复习计划。</p>
        </div>
        <div className="practice-heading-actions">
          <button type="button" className="secondary-button practice-nav-trigger" onClick={() => setShowNav(true)}>
            <ListChecks size={16} /> 题目导航
          </button>
          <div className="practice-score">
            <span>本轮进度</span>
            <strong>{questionIndex + 1} <small>/ {orderedQuestions.length}</small></strong>
          </div>
        </div>
      </section>

      <section className="question-panel">
        <header>
          <div>
            <span className="question-label">单选题 · {question.score} 分</span>
            {knowledgePoint && <span className="question-chapter">{knowledgePoint.name}</span>}
            <span className="question-source">参考：{question.source}</span>
          </div>
          <span className="question-counter">{String(questionIndex + 1).padStart(2, '0')} / {String(orderedQuestions.length).padStart(2, '0')}</span>
        </header>
        <h2><FormulaText text={question.prompt} /></h2>
        <div className="choice-list">
          {[...question.options, UNKNOWN_CHOICE_LABEL].map((choice, index) => {
            const choiceId = String.fromCharCode(65 + index)
            const isChoiceCorrect = feedback?.correct ? selectedIndex === index : question.answerIndex === index
            const state =
              submitted && isChoiceCorrect && (feedback?.correct || question.answerIndex === index)
                ? 'is-correct'
                : submitted && selectedIndex === index
                  ? 'is-wrong'
                  : selectedIndex === index
                    ? 'is-selected'
                    : ''
            return (
              <button
                className={`choice ${state}`}
                key={choiceId}
                type="button"
                disabled={submitted}
                onClick={() => setSelectedAnswer(String(index))}
              >
                <b>{choiceId}</b>
                <span><FormulaText text={choice} /></span>
                {submitted && isChoiceCorrect && <CheckCircle2 size={19} />}
                {submitted && !isChoiceCorrect && selectedIndex === index && <CircleAlert size={19} />}
              </button>
            )
          })}
        </div>

        {submitted && feedback && (
          <section className={`answer-feedback ${feedback.correct ? 'is-correct' : 'is-wrong'}`}>
            <div>
              {feedback.correct ? <CheckCircle2 size={21} /> : <CircleAlert size={21} />}
              <strong>
                {feedback.correct
                  ? '回答正确，掌握度已上调。'
                  : `AI 已解析错因并加入错题本${feedback.generatedSimilarCount ? `，新增 ${feedback.generatedSimilarCount} 道同类练习` : ''}。`}
              </strong>
            </div>
            <p><FormulaText text={feedback.explanation} /></p>
            <button type="button" onClick={() => onModuleChange('errors')}>查看相关错题 <ArrowRight size={15} /></button>
          </section>
        )}
        {isSubmitting && (
          <section className="answer-feedback">
            <div>
              <Sparkles size={21} />
              <strong>AI 正在分析本题，并生成同类练习。</strong>
            </div>
          </section>
        )}

        <footer>
          <button className="secondary-button" type="button" onClick={() => onModuleChange('plan')}>
            返回主线
          </button>
          {submitted ? (
            <>
              {onClearPracticeAnswer && (
                <button className="secondary-button" type="button" onClick={() => void redoQuestion()}>
                  重做本题 <RotateCcw size={15} />
                </button>
              )}
              <button className="secondary-button" type="button" disabled={questionIndex <= 0} onClick={goPrev}>
                <ChevronLeft size={16} /> 上一题
              </button>
              <button className="primary-button" type="button" disabled={questionIndex >= orderedQuestions.length - 1} onClick={goNext}>
                下一题 <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <button className="secondary-button" type="button" disabled={questionIndex <= 0} onClick={goPrev}>
                <ChevronLeft size={16} /> 上一题
              </button>
              <button className="primary-button" type="button" disabled={!selectedAnswer || isSubmitting} onClick={submitAnswer}>
                {isSubmitting ? 'AI 分析中' : '提交答案'} <Check size={16} />
              </button>
            </>
          )}
        </footer>
      </section>

      <section className="practice-bottom-grid">
        <article className="practice-insight">
          <Gauge size={20} />
          <div>
            <span>当前知识点掌握度</span>
            <strong>{feedback?.mastery ?? knowledgePoint?.mastery ?? 0}%</strong>
          </div>
          <ProgressRing value={feedback?.mastery ?? knowledgePoint?.mastery ?? 0} size={54} />
        </article>
        <article className="practice-insight">
          <Brain size={20} />
          <div>
            <span>AI 提醒</span>
            <strong>{knowledgePoint?.summary ?? '优先完成当前高权重知识点。'}</strong>
          </div>
          <button type="button" onClick={() => onModuleChange('notes')}>记到笔记</button>
        </article>
      </section>

      {showNav && (
        <div className="practice-nav-backdrop" onClick={() => setShowNav(false)}>
          <div className="practice-nav-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <header className="practice-nav-header">
              <div>
                <h2>题目导航</h2>
                <p>按章节分组，点击题号快速跳转。</p>
              </div>
              <button type="button" className="practice-nav-close" aria-label="关闭" onClick={() => setShowNav(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="practice-nav-legend">
              <span><CheckCircle2 size={15} /> 正确</span>
              <span><XCircle size={15} /> 错误</span>
              <span><Circle size={15} /> 未答</span>
            </div>
            <div className="practice-nav-body">
              {chapterGroups.map((group) => {
                let correct = 0
                let wrong = 0
                let unanswered = 0
                for (const item of group.questions) {
                  const record = practiceAnswers?.[item.id]
                  if (!record) unanswered += 1
                  else if (record.correct) correct += 1
                  else wrong += 1
                }
                return (
                  <section className="practice-nav-group" key={group.key}>
                    <div className="practice-nav-group-title">
                      <span className="practice-nav-group-name">{group.name}</span>
                      <span className="practice-nav-group-meta">
                        {group.questions.length} 题 · {correct} 正确 · {wrong} 错误 · {unanswered} 未答
                      </span>
                    </div>
                    <div className="practice-nav-grid">
                      {group.questions.map((item) => {
                        const record = practiceAnswers?.[item.id]
                        const status = record ? (record.correct ? 'is-correct' : 'is-wrong') : 'is-unanswered'
                        const isCurrent = item.id === question?.id
                        const num = (questionGlobalIndex.get(item.id) ?? 0) + 1
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`practice-nav-cell ${status} ${isCurrent ? 'is-current' : ''}`}
                            onClick={() => jumpTo(questionGlobalIndex.get(item.id) ?? 0)}
                          >
                            <span className="practice-nav-cell-num">{num}</span>
                            {status === 'is-correct' && <CheckCircle2 size={13} />}
                            {status === 'is-wrong' && <XCircle size={13} />}
                            {status === 'is-unanswered' && <Circle size={13} />}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function normalizeMockQuestionType(question: QuizQuestion) {
  return question.questionType?.trim() || '模拟题'
}

function isWrittenMockQuestion(question: QuizQuestion) {
  const questionType = normalizeMockQuestionType(question)
  return question.type === 'calculation' || /计算|综合|填空|简答|论述|证明/.test(questionType)
}

function summarizeMockBlueprint(questions: QuizQuestion[]) {
  const stats = new Map<string, { count: number; score: number }>()
  for (const question of questions) {
    const type = normalizeMockQuestionType(question)
    const current = stats.get(type) ?? { count: 0, score: 0 }
    current.count += 1
    current.score += question.score
    stats.set(type, current)
  }
  return Array.from(stats.entries())
    .map(([type, stat]) => `${type}${stat.score}分/${stat.count}题`)
    .join('，')
}

// === 模拟卷作答草稿：localStorage 自动持久化 ===
// 模拟卷在交卷前不落库，作答只存在于组件 state；这里把未交卷的进度也写进 localStorage，
// 保证刷新 / 关闭浏览器 / 没点"保存并退出"都不丢，重新打开继续作答。约定与练习模块的位置记忆一致。
function mockDraftStorageKey(courseId: string) {
  return `final-congee-mock-draft:${courseId}`
}

type MockDraft = { answers: Record<string, MockAnswer>; currentQuestionId: string | null }

// 读取并清洗草稿：只保留数字选项作答和非空文字作答，丢弃空字符串等无效项。
function readMockDraft(courseId: string): MockDraft | null {
  try {
    const raw = window.localStorage.getItem(mockDraftStorageKey(courseId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MockDraft> | null
    if (!parsed || typeof parsed !== 'object' || !parsed.answers) return null
    const answers: Record<string, MockAnswer> = {}
    for (const [id, value] of Object.entries(parsed.answers)) {
      if (typeof value === 'number') answers[id] = value
      else if (typeof value === 'string' && value.trim().length > 0) answers[id] = value
    }
    const currentQuestionId = typeof parsed.currentQuestionId === 'string' ? parsed.currentQuestionId : null
    return { answers, currentQuestionId }
  } catch {
    return null
  }
}

function writeMockDraft(courseId: string, draft: MockDraft | null) {
  try {
    if (!draft) window.localStorage.removeItem(mockDraftStorageKey(courseId))
    else window.localStorage.setItem(mockDraftStorageKey(courseId), JSON.stringify(draft))
  } catch {
    /* 隐私模式 / 存储满等不可写情况：静默回退，草稿不持久但不影响答题 */
  }
}

function MockView({
  course,
  mockQuestions,
  mockResult,
  onModuleChange,
  onSubmitMock,
  onClearMockResult,
}: Pick<
  ModuleViewProps,
  'course' | 'mockQuestions' | 'mockResult' | 'onModuleChange' | 'onSubmitMock' | 'onClearMockResult'
>) {
  // 仅在没有已交卷成绩时尝试恢复草稿；有成绩时以成绩为准。渲染期一次性读取，避免重复 IO。
  const draftRef = useRef<MockDraft | null>(null)
  if (draftRef.current === null && !mockResult) {
    draftRef.current = readMockDraft(course.id)
  }
  const restoredDraft = draftRef.current
  const hasRestoredDraft = Boolean(restoredDraft && Object.keys(restoredDraft.answers).length > 0)

  const [isExamStarted, setIsExamStarted] = useState(Boolean(mockResult) || hasRestoredDraft)
  const [questionIndex, setQuestionIndex] = useState(() => {
    const id = restoredDraft?.currentQuestionId
    if (id) {
      const idx = mockQuestions.findIndex((question) => question.id === id)
      if (idx >= 0) return idx
    }
    return 0
  })
  const [answers, setAnswers] = useState<Record<string, MockAnswer>>(() =>
    mockResult?.answers ? { ...mockResult.answers } : (restoredDraft?.answers ?? {}),
  )
  const [result, setResult] = useState<{
    score: number
    total: number
    results: Array<{ id: string; correct: boolean; explanation: string; mastery: number; generatedSimilarCount: number }>
  } | null>(() =>
    mockResult
      ? { score: mockResult.score, total: mockResult.total, results: mockResult.results }
      : null,
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const question = mockQuestions[questionIndex]
  const currentAnswer = question ? answers[question.id] : undefined
  const totalScore = mockQuestions.reduce((sum, item) => sum + item.score, 0)
  const mockBlueprintSummary = summarizeMockBlueprint(mockQuestions)
  const currentQuestionType = question ? normalizeMockQuestionType(question) : '模拟题'
  const isCurrentWrittenQuestion = question ? isWrittenMockQuestion(question) : false
  const currentWrittenAnswer = typeof currentAnswer === 'string' ? currentAnswer : ''
  const isCurrentAnswered = question
    ? isCurrentWrittenQuestion
      ? currentWrittenAnswer.trim().length > 0
      : currentAnswer !== undefined
    : false
  const allQuestionsAnswered = mockQuestions.every((item) => {
    const answer = answers[item.id]
    return isWrittenMockQuestion(item)
      ? typeof answer === 'string' && answer.trim().length > 0
      : typeof answer === 'number'
  })
  const suggestedMinutes = Math.max(60, Math.ceil((mockQuestions.length * 7.5) / 5) * 5)

  // 题目晚到（首次挂载时仍在生成）时，按草稿记录的题号回到上次位置。仅执行一次。
  const positionRestoredRef = useRef(false)
  useEffect(() => {
    if (positionRestoredRef.current || !mockQuestions.length) return
    const id = restoredDraft?.currentQuestionId
    if (id) {
      const idx = mockQuestions.findIndex((question) => question.id === id)
      if (idx >= 0) setQuestionIndex(idx)
    }
    positionRestoredRef.current = true
  }, [mockQuestions, restoredDraft])

  // 自动持久化：交卷前的每一次作答 / 翻页都写回 localStorage，刷新即可恢复。
  // 已交卷（有 mockResult）时以成绩为准，不再维护草稿；退回开始页且无作答时清理草稿。
  useEffect(() => {
    if (mockResult) return
    if (!isExamStarted && Object.keys(answers).length === 0) {
      writeMockDraft(course.id, null)
      return
    }
    const currentQuestionId = mockQuestions[questionIndex]?.id ?? null
    writeMockDraft(course.id, { answers, currentQuestionId })
  }, [course.id, mockResult, isExamStarted, answers, questionIndex, mockQuestions])

  async function submitMock() {
    setIsSubmitting(true)
    try {
      const response = await onSubmitMock(answers)
      setResult(response)
      writeMockDraft(course.id, null) // 已交卷，清掉未交卷草稿，避免与成绩混淆
    } finally {
      setIsSubmitting(false)
    }
  }

  async function retakeMock() {
    if (onClearMockResult) await onClearMockResult()
    writeMockDraft(course.id, null) // 重新开考，清掉旧草稿
    setAnswers({})
    setResult(null)
    setQuestionIndex(0)
    setIsExamStarted(true)
  }

  if (!mockQuestions.length) {
    return <div className="module-page empty-module"><GraduationCap size={32} /><h1>模拟卷演练</h1><p>{course.name}模拟卷尚未生成。请回到复习策略页修复或重新生成复习主线。</p></div>
  }

  return (
    <div className="module-page mock-page">
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><FileText size={15} /> 完整模拟卷 · 基于真题与课堂练习</p>
          <h1>模拟卷演练</h1>
          <p>完成 {mockQuestions.length} 道{course.name}真题风格题后，系统会真实计分并更新知识点掌握度。</p>
        </div>
        <div className="mock-chip"><TimerReset size={16} /> 建议用时 {suggestedMinutes} 分钟</div>
      </section>

      {!isExamStarted ? (
        <section className="mock-start-card">
          <div className="mock-paper-icon"><FileText size={30} /></div>
          <span>{course.name}冲刺模拟卷 A</span>
          <h2>按完整考试节奏做一套真题风格模拟卷。</h2>
          <p>包含 {mockQuestions.length} 道题，共 {totalScore} 分；{mockBlueprintSummary}。每题都提供资料依据的讲评。</p>
          <div className="mock-meta-row">
            <span><Clock3 size={16} /> {suggestedMinutes} 分钟</span>
            <span><ListChecks size={16} /> 共 {totalScore} 分</span>
            <span><BookOpen size={16} /> 资料引用 {mockQuestions.length} 处</span>
          </div>
          <button className="primary-button" type="button" onClick={() => setIsExamStarted(true)}>
            <Play size={16} /> 开始模拟
          </button>
        </section>
      ) : (
        <section className="mock-workbench">
          <header>
            <div>
              <span className="question-label">第 {questionIndex + 1} 题 · {currentQuestionType} · {question.score} 分</span>
              <h2><FormulaText text={question.prompt} /></h2>
              <p className="question-source">参考：{question.source}</p>
            </div>
            <div className="exam-timer"><Clock3 size={17} /> {questionIndex + 1} / {mockQuestions.length}</div>
          </header>
          {isCurrentWrittenQuestion ? (
            <textarea
              value={currentWrittenAnswer}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
              placeholder="写出关键计算过程、公式代入和最终答案。"
            />
          ) : (
            <div className="choice-list">
              {question.options.map((option, index) => (
                <button
                  className={`choice ${currentAnswer === index ? 'is-selected' : ''}`}
                  key={option}
                  type="button"
                  onClick={() => setAnswers((current) => ({ ...current, [question.id]: index }))}
                >
                  <b>{String.fromCharCode(65 + index)}</b>
                  <span><FormulaText text={option} /></span>
                </button>
              ))}
            </div>
          )}
          <footer>
            <button className="secondary-button" type="button" onClick={() => setIsExamStarted(false)}>
              保存并退出
            </button>
            {questionIndex < mockQuestions.length - 1 ? (
              <button
                className="primary-button"
                type="button"
                disabled={!isCurrentAnswered}
                onClick={() => setQuestionIndex((current) => current + 1)}
              >
                下一题 <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="primary-button"
                type="button"
                disabled={!allQuestionsAnswered || isSubmitting}
                onClick={submitMock}
              >
                <Check size={16} /> {isSubmitting ? 'AI 正在批改' : '提交并生成报告'}
              </button>
            )}
          </footer>
          {isSubmitting && (
            <div className="mock-result">
              <Sparkles size={22} />
              <div>
                <strong>AI 正在分析错题并补充同类练习。</strong>
                <p>模拟卷批改会把失分题加入错题本，并把同考点题目补进练习题库。</p>
              </div>
            </div>
          )}
          {result && (
            <div className="mock-result">
              <CheckCircle2 size={22} />
              <div>
                <strong>已生成演练报告：{result.score} / {result.total} 分</strong>
                <p>系统已根据每道题的作答更新掌握度，并把失分相关任务提前。</p>
                {result.results.some((item) => !item.correct) && (
                  <div className="mock-wrong-review-list">
                    {result.results.filter((item) => !item.correct).map((item) => {
                      const reviewedQuestion = mockQuestions.find((questionItem) => questionItem.id === item.id)
                      return (
                        <article key={item.id}>
                          <strong><FormulaText text={reviewedQuestion?.prompt ?? '模拟卷错题'} /></strong>
                          <p><FormulaText text={item.explanation} /></p>
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => onModuleChange('errors')}>去错题本 <ArrowRight size={15} /></button>
              {onClearMockResult && (
                <button type="button" onClick={() => void retakeMock()}>再考一次 <RotateCcw size={15} /></button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function NotesView({
  course,
  note,
  onNoteChange,
}: Pick<ModuleViewProps, 'course' | 'note' | 'onNoteChange'>) {
  const [isEditing, setIsEditing] = useState(false)

  return (
    <div className="module-page notes-page">
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><SquarePenIcon /> 已关联：{course.name}复习笔记</p>
          <h1>复习笔记</h1>
          <p>把错题讲评和关键结论写成自己的语言，下一次复练时会自动带上。</p>
        </div>
        <button className="secondary-button" type="button"><LockKeyhole size={16} /> 已保存到本机</button>
      </section>
      <section className="note-editor">
        <header>
          <div className="note-view-switch" role="group" aria-label="笔记显示方式">
            <button
              className={!isEditing ? 'is-active' : ''}
              type="button"
              onClick={() => setIsEditing(false)}
            >
              <Eye size={14} /> 预览
            </button>
            <button
              className={isEditing ? 'is-active' : ''}
              type="button"
              onClick={() => setIsEditing(true)}
            >
              <FileText size={14} /> 编辑
            </button>
          </div>
          <span>自动保存</span>
        </header>
        {isEditing ? (
          <textarea
            aria-label="编辑 Markdown 笔记"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
          />
        ) : (
          <article className="note-markdown-preview">
            {note.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{note}</ReactMarkdown>
            ) : (
              <p className="note-empty">还没有笔记内容</p>
            )}
          </article>
        )}
        <footer>
          <span><BookOpen size={15} /> 关联资料：{course.name}课程资料</span>
          <span><Target size={15} /> 关联错题：{course.name}待复练题</span>
        </footer>
      </section>
    </div>
  )
}

function SquarePenIcon() {
  return <FileText size={15} />
}

function ErrorsView({
  wrongAnswers,
  practiceQuestions,
  mockQuestions,
  diagnosticQuestions,
  onDeleteWrongAnswer,
  onModuleChange,
  onSubmitWrongAnswer,
}: Pick<
  ModuleViewProps,
  | 'wrongAnswers'
  | 'practiceQuestions'
  | 'mockQuestions'
  | 'diagnosticQuestions'
  | 'onDeleteWrongAnswer'
  | 'onModuleChange'
  | 'onSubmitWrongAnswer'
>) {
  const [activeWrongAnswerId, setActiveWrongAnswerId] = useState<string | null>(null)
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null)
  const [retryFeedback, setRetryFeedback] = useState<{
    correct: boolean
    explanation: string
    mastery: number
    generatedSimilarCount: number
  } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const activeWrongAnswer = wrongAnswers.find((item) => item.id === activeWrongAnswerId)

  function resolveQuestion(item: WrongAnswer) {
    const questionId = item.questionId
      ?? (item.id.startsWith('diagnostic-') ? item.id.replace(/^diagnostic-/, '') : item.id)
    return [
      ...practiceQuestions,
      ...mockQuestions,
      ...(diagnosticQuestions ?? []),
    ].find((question) => question.id === questionId)
  }

  function inferQuestionType(item: WrongAnswer) {
    if (item.questionType) return item.questionType
    const questionId = item.questionId ?? item.id
    if (item.id.startsWith('diagnostic-')) return '摸底测试'
    if (mockQuestions.some((question) => question.id === questionId)) return '模拟卷'
    return '刷题练习'
  }

  function formatAddedAt(value?: string) {
    if (!value) return '历史记录'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function openWrongAnswer(item: WrongAnswer) {
    setActiveWrongAnswerId(item.id)
    setSelectedAnswer(null)
    setRetryFeedback(null)
    window.scrollTo({ top: 0, left: 0 })
  }

  function closeWrongAnswer() {
    setActiveWrongAnswerId(null)
    setSelectedAnswer(null)
    setRetryFeedback(null)
  }

  async function submitRetry() {
    if (!activeWrongAnswer || selectedAnswer === null || isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await onSubmitWrongAnswer(activeWrongAnswer.id, selectedAnswer)
      setRetryFeedback(result)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (activeWrongAnswer) {
    const question = resolveQuestion(activeWrongAnswer)
    if (!question) {
      return (
        <div className="module-page errors-page">
          <section className="page-heading-row">
            <div>
              <p className="page-kicker"><CircleAlert size={15} /> {inferQuestionType(activeWrongAnswer)}</p>
              <h1>原题已不在当前题库</h1>
              <p>这条历史错题仍保留，但对应题目已经随题库更新被移除。</p>
            </div>
            <button className="secondary-button" type="button" onClick={closeWrongAnswer}>返回错题本</button>
          </section>
        </div>
      )
    }

    const choices = [...question.options, UNKNOWN_CHOICE_LABEL]
    const hasAnswered = retryFeedback !== null
    return (
      <div className="module-page errors-page wrong-answer-detail-page">
        <section className="page-heading-row">
          <div>
            <p className="page-kicker"><RotateCcw size={15} /> {inferQuestionType(activeWrongAnswer)} · 错题重做</p>
            <h1>重新独立完成这道题</h1>
            <p>{activeWrongAnswer.source ?? question.source}</p>
          </div>
          <button className="secondary-button" type="button" onClick={closeWrongAnswer}>返回错题本</button>
        </section>

        <section className="question-panel wrong-answer-retry-panel">
          <header>
            <div>
              <span className="question-label">{inferQuestionType(activeWrongAnswer)} · 单项选择</span>
              <span className="question-source">加入时间：{formatAddedAt(activeWrongAnswer.addedAt)}</span>
            </div>
            <span className="question-counter">已错 {activeWrongAnswer.count} 次</span>
          </header>
          <h2><FormulaText text={question.prompt} /></h2>
          <div className="choice-list">
            {choices.map((choice, index) => {
              const choiceId = String.fromCharCode(65 + index)
              const state = hasAnswered && question.answerIndex === index
                ? 'is-correct'
                : hasAnswered && selectedAnswer === index
                  ? 'is-wrong'
                  : selectedAnswer === index
                    ? 'is-selected'
                    : ''
              return (
                <button
                  className={`choice ${state}`}
                  key={choiceId}
                  type="button"
                  disabled={hasAnswered || isSubmitting}
                  onClick={() => setSelectedAnswer(index)}
                >
                  <b>{choiceId}</b>
                  <span><FormulaText text={choice} /></span>
                  {hasAnswered && question.answerIndex === index && <CheckCircle2 size={19} />}
                  {hasAnswered && selectedAnswer === index && question.answerIndex !== index && <CircleAlert size={19} />}
                </button>
              )
            })}
          </div>

          {isSubmitting && (
            <section className="answer-feedback">
              <div><Sparkles size={21} /><strong>AI 正在分析本次重做结果。</strong></div>
            </section>
          )}
          {retryFeedback && (
            <section className={`answer-feedback ${retryFeedback.correct ? 'is-correct' : 'is-wrong'}`}>
              <div>
                {retryFeedback.correct ? <CheckCircle2 size={21} /> : <CircleAlert size={21} />}
                <strong>
                  {retryFeedback.correct
                    ? '重做正确，已标记为掌握。'
                    : `仍需复练${retryFeedback.generatedSimilarCount ? `，新增 ${retryFeedback.generatedSimilarCount} 道同类练习` : ''}。`}
                </strong>
              </div>
              <p><FormulaText text={retryFeedback.explanation} /></p>
            </section>
          )}

          <footer>
            <button className="secondary-button" type="button" onClick={closeWrongAnswer}>返回列表</button>
            {retryFeedback ? (
              <button className="primary-button" type="button" onClick={() => {
                setSelectedAnswer(null)
                setRetryFeedback(null)
              }}>再做一次 <RotateCcw size={16} /></button>
            ) : (
              <button className="primary-button" type="button" disabled={selectedAnswer === null || isSubmitting} onClick={() => void submitRetry()}>
                {isSubmitting ? 'AI 分析中' : '提交答案'} <Check size={16} />
              </button>
            )}
          </footer>
        </section>
      </div>
    )
  }

  return (
    <div className="module-page errors-page">
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><CircleAlert size={15} /> AI 已归因 {wrongAnswers.length} 道错题</p>
          <h1>错题回顾</h1>
          <p>优先处理重复出错且考试权重高的题目，减少同类失分。</p>
        </div>
        <button className="primary-button" type="button" onClick={() => onModuleChange('practice')}>
          <RotateCcw size={16} /> 开始定向复练
        </button>
      </section>
      <section className="error-summary">
        <div><span>待复练</span><strong>{wrongAnswers.filter((item) => !item.isReviewed).length}</strong></div>
        <div><span>已掌握</span><strong>{wrongAnswers.filter((item) => item.isReviewed).length}</strong></div>
        <div><span>重复失分</span><strong>{wrongAnswers.reduce((total, item) => total + item.count, 0)} 次</strong></div>
      </section>
      <section className="error-list">
        {wrongAnswers.map((item) => {
          const question = resolveQuestion(item)
          return (
            <article className={`error-row ${item.isReviewed ? 'is-reviewed' : ''}`} key={item.id}>
              <button className="error-row-main" type="button" onClick={() => openWrongAnswer(item)}>
                <span className="error-symbol">{item.isReviewed ? <Check size={18} /> : <CircleAlert size={18} />}</span>
                <span className="error-row-content">
                  <span className="error-title-line">
                    <span>{inferQuestionType(item)}</span>
                    <span>{item.isReviewed ? '已掌握' : '待复练'}</span>
                  </span>
                  <strong><FormulaText text={question?.prompt ?? item.title} /></strong>
                  <span className="error-meta-row">
                    <span><FileText size={13} /> {item.source ?? question?.source ?? item.tag}</span>
                    <span><Clock3 size={13} /> {formatAddedAt(item.addedAt)}</span>
                    <span>错 {item.count} 次</span>
                  </span>
                </span>
                <ArrowRight className="error-open-icon" size={18} />
              </button>
              <button
                className="danger-icon-button"
                type="button"
                title="删除错题"
                aria-label={`删除错题：${item.title}`}
                onClick={() => onDeleteWrongAnswer(item)}
              >
                <Trash2 size={15} />
              </button>
            </article>
          )
        })}
      </section>
    </div>
  )
}

function formatArchiveDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function getRemainingDays(purgeAfter: string) {
  const purgeAt = new Date(purgeAfter).getTime()
  if (Number.isNaN(purgeAt)) return 0
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)))
}

function ArchiveView({
  archiveItems,
  onRestoreArchiveItem,
}: Pick<ModuleViewProps, 'archiveItems' | 'onRestoreArchiveItem'>) {
  const courseCount = archiveItems.filter((item) => item.itemType === 'course').length
  const wrongAnswerCount = archiveItems.filter((item) => item.itemType === 'wrong-answer').length

  return (
    <div className="module-page archive-page">
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><ArchiveRestore size={15} /> 删除内容暂存 7 天</p>
          <h1>归档</h1>
          <p>课程和错题删除后会先放在这里，超过 7 天未恢复会自动彻底删除。</p>
        </div>
      </section>
      <section className="error-summary archive-summary">
        <div><span>归档内容</span><strong>{archiveItems.length}</strong></div>
        <div><span>课程</span><strong>{courseCount}</strong></div>
        <div><span>错题</span><strong>{wrongAnswerCount}</strong></div>
      </section>
      <section className="archive-list">
        {archiveItems.length ? (
          archiveItems.map((item) => (
            <article className="archive-row" key={item.id}>
              <span className="archive-symbol"><ArchiveRestore size={18} /></span>
              <div>
                <div className="error-title-line">
                  <h3>{item.title}</h3>
                  <span>{item.itemType === 'course' ? '课程' : '错题'}</span>
                </div>
                <p>
                  {item.courseName ? `${item.courseName} · ` : ''}
                  删除于 {formatArchiveDate(item.deletedAt)}，剩余 {getRemainingDays(item.purgeAfter)} 天
                </p>
              </div>
              <button type="button" onClick={() => onRestoreArchiveItem(item.id)}>
                <RotateCcw size={15} /> 恢复
              </button>
            </article>
          ))
        ) : (
          <section className="material-preview-empty">
            <ArchiveRestore size={26} />
            <strong>归档里还没有内容</strong>
            <p>删除课程或错题后，会在这里暂存 7 天。</p>
          </section>
        )}
      </section>
    </div>
  )
}

function MaterialPreviewEmpty({ title, message }: { title: string; message: string }) {
  return (
    <section className="material-preview-empty" role="status">
      <CircleAlert size={26} />
      <strong>{title}</strong>
      <p>{message}</p>
    </section>
  )
}

function MaterialSheetPreview({ preview }: { preview: MaterialPreview }) {
  const sheet = preview.sheets?.[0]
  if (!sheet?.rows.length) {
    return <MaterialPreviewEmpty title="没有可显示内容" message={preview.message} />
  }

  return (
    <section className="material-sheet-preview">
      <header>
        <strong>{sheet.name}</strong>
        <span>{preview.message}</span>
      </header>
      <div className="material-table-wrap">
        <table>
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={`${sheet.name}-${rowIndex}`}>
                {row.map((cell, columnIndex) => (
                  <td key={`${rowIndex}-${columnIndex}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function isMarkdownMaterial(preview: MaterialPreview) {
  const name = preview.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown')
}

function MaterialPreviewContent({
  preview,
  fileUrl,
}: {
  preview: MaterialPreview
  fileUrl: string
}) {
  if (preview.kind === 'image') {
    return (
      <div className="material-image-preview">
        <img src={fileUrl} alt={preview.name} />
      </div>
    )
  }

  if (preview.kind === 'pdf') {
    return <iframe className="material-frame-preview" src={fileUrl} title={preview.name} />
  }

  if (preview.kind === 'sheet') {
    return <MaterialSheetPreview preview={preview} />
  }

  if (preview.kind === 'text') {
    if (isMarkdownMaterial(preview)) {
      return (
        <article className="material-markdown-preview note-markdown-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {preview.text || preview.message}
          </ReactMarkdown>
        </article>
      )
    }
    return <pre className="material-text-preview">{preview.text || preview.message}</pre>
  }

  return <MaterialPreviewEmpty title="暂不支持站内预览" message={preview.message} />
}

function materialAiStatusClass(material: Material) {
  return material.aiStatus ?? 'unreadable'
}

function materialPreviewStatusClass(material: Material) {
  return material.previewStatus ?? 'unsupported'
}

function materialAiLabel(material: Material) {
  return material.aiLabel ?? 'AI未解析'
}

function materialPreviewLabel(material: Material) {
  return material.previewLabel ?? '需预览'
}

function MaterialsView({
  course,
  materials,
  materialMemory,
  assessmentProfile,
  strategyDocuments,
  onSaveCoursePrompt,
  onRescanMaterials,
  onUploadMaterials,
  onDeleteMaterial,
  onMaterialPreviewOpenChange,
  materialPreviewPath,
  onMaterialPreviewRequestHandled,
}: Pick<
  ModuleViewProps,
  | 'course'
  | 'materials'
  | 'materialMemory'
  | 'assessmentProfile'
  | 'strategyDocuments'
  | 'onSaveCoursePrompt'
  | 'onRescanMaterials'
  | 'onUploadMaterials'
  | 'onDeleteMaterial'
  | 'onMaterialPreviewOpenChange'
  | 'materialPreviewPath'
  | 'onMaterialPreviewRequestHandled'
>) {
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null)
  const [materialPreview, setMaterialPreview] = useState<MaterialPreview | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [isRescanning, setIsRescanning] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadingFileCount, setUploadingFileCount] = useState(0)
  const [deletingMaterialPath, setDeletingMaterialPath] = useState<string | null>(null)
  const [rescanError, setRescanError] = useState('')
  const [materialActionMessage, setMaterialActionMessage] = useState('')
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [sourceDraft, setSourceDraft] = useState<{
    url: string
    serverId: string
    toolName: string
    sourceType: ExternalSource['sourceType']
  }>({ url: '', serverId: '', toolName: '', sourceType: 'web' })
  const [externalSource, setExternalSource] = useState<ExternalSource | null>(null)
  const [isExternalSourceBusy, setIsExternalSourceBusy] = useState(false)
  const selectedMaterialUrl = selectedMaterial ? getCourseMaterialFileUrl(course.id, selectedMaterial.relativePath) : ''
  const selectedPreviewUrl = selectedMaterial && materialPreview?.isConvertedPreview
    ? getCourseMaterialConvertedFileUrl(course.id, selectedMaterial.relativePath)
    : selectedMaterialUrl
  const aiReadyCount = materials.filter((file) => file.aiStatus === 'ready').length
  const aiPartialCount = materials.filter((file) => file.aiStatus === 'partial').length
  const aiSkippedCount = materials.filter((file) => file.aiStatus === 'skipped').length
  const aiUnreadableCount = materials.filter((file) => file.aiStatus === 'unreadable').length
  const materialStatusItems = [
    `${aiReadyCount} 份 AI 已解析`,
    aiPartialCount ? `${aiPartialCount} 份部分解析` : '',
    aiSkippedCount ? `${aiSkippedCount} 份无需解析` : '',
    aiUnreadableCount ? `${aiUnreadableCount} 份未解析` : '',
  ].filter(Boolean)
  const selectedMcpServer = mcpServers.find((server) => server.id === sourceDraft.serverId)

  function getSourceDraftForUrl(
    url: string,
    servers: McpServer[],
    current: typeof sourceDraft,
  ): typeof sourceDraft {
    const normalized = url.toLowerCase()
    const isBilibili = normalized.includes('bilibili.com') || normalized.includes('b23.tv')
    const isXiaohongshu = normalized.includes('xiaohongshu.com') || normalized.includes('xhslink.com')
    const isGithub = normalized.includes('github.com')
    const isArxiv = normalized.includes('arxiv.org')
    const isWeb = normalized.startsWith('http://') || normalized.startsWith('https://')
    const matchedServer = isBilibili
      ? servers.find((server) => server.id === 'mcp-bilibili')
      : isXiaohongshu
        ? servers.find((server) => server.id === 'mcp-xiaohongshu')
        : isArxiv
          ? servers.find((server) => server.id === 'mcp-arxiv')
          : isGithub
            ? servers.find((server) => server.id === 'mcp-gitmcp')
            : isWeb
              ? servers.find((server) => server.id === 'mcp-firecrawl')
              : undefined
    return {
      ...current,
      url,
      serverId: matchedServer?.id ?? current.serverId,
      toolName: isBilibili
        ? matchedServer?.allowedTools.includes('get_video_info') ? 'get_video_info' : matchedServer?.allowedTools[0] ?? current.toolName
        : isXiaohongshu
          ? matchedServer?.allowedTools.includes('xhs_get_note') ? 'xhs_get_note' : matchedServer?.allowedTools[0] ?? current.toolName
          : isArxiv
            ? matchedServer?.allowedTools.includes('read_paper') ? 'read_paper' : matchedServer?.allowedTools[0] ?? current.toolName
            : isGithub
              ? matchedServer?.allowedTools.includes('fetch_repository_documentation') ? 'fetch_repository_documentation' : matchedServer?.allowedTools[0] ?? current.toolName
              : isWeb
                ? matchedServer?.allowedTools.includes('firecrawl_scrape') ? 'firecrawl_scrape' : matchedServer?.allowedTools[0] ?? current.toolName
                : current.toolName,
      sourceType: isBilibili ? 'video' : isXiaohongshu ? 'note' : isWeb ? 'web' : current.sourceType,
    }
  }

  async function refreshMcpServers() {
    const servers = await listMcpServers()
    setMcpServers(servers)
    setSourceDraft((current) => {
      const currentServer = servers.find((server) => server.id === current.serverId)
      if (current.url) {
        return getSourceDraftForUrl(current.url, servers, current)
      }
      if (currentServer) {
        return {
          ...current,
          toolName: currentServer.allowedTools.includes(current.toolName)
            ? current.toolName
            : currentServer.allowedTools[0] ?? '',
        }
      }
      const first = servers[0]
      return first
        ? { ...current, serverId: first.id, toolName: first.allowedTools[0] || '' }
        : current
    })
  }

  useEffect(() => {
    let isActive = true
    void refreshMcpServers().catch((error) => {
      if (isActive) setRescanError(error instanceof Error ? error.message : '无法读取 MCP 服务配置')
    })
    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    if (!externalSource || !['queued', 'fetching'].includes(externalSource.status)) return
    let isActive = true
    const timer = window.setInterval(() => {
      void getCourseExternalSource(course.id, externalSource.id)
        .then((source) => {
          if (isActive) setExternalSource(source)
        })
        .catch((error) => {
          if (isActive) setRescanError(error instanceof Error ? error.message : '外部资料状态读取失败')
        })
    }, 1200)
    return () => {
      isActive = false
      window.clearInterval(timer)
    }
  }, [course.id, externalSource])

  useEffect(() => {
    onMaterialPreviewOpenChange(Boolean(selectedMaterial))
    return () => onMaterialPreviewOpenChange(false)
  }, [onMaterialPreviewOpenChange, selectedMaterial])

  useEffect(() => {
    if (!materialPreviewPath) return
    const requestedMaterial = materials.find((material) => material.relativePath === materialPreviewPath)
    if (requestedMaterial) {
      setSelectedMaterial(requestedMaterial)
    }
    onMaterialPreviewRequestHandled()
  }, [materialPreviewPath, materials, onMaterialPreviewRequestHandled])

  useEffect(() => {
    if (!selectedMaterial) return

    let isActive = true
    setMaterialPreview(null)
    setPreviewError('')
    setIsPreviewLoading(true)
    getCourseMaterialPreview(course.id, selectedMaterial.relativePath)
      .then((preview) => {
        if (isActive) setMaterialPreview(preview)
      })
      .catch((error) => {
        if (isActive) setPreviewError(error instanceof Error ? error.message : '资料预览失败')
      })
      .finally(() => {
        if (isActive) setIsPreviewLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [course.id, selectedMaterial])

  useEffect(() => {
    if (!selectedMaterial) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedMaterial(null)
        setMaterialPreview(null)
        setPreviewError('')
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedMaterial])

  function closeMaterialPreview() {
    setSelectedMaterial(null)
    setMaterialPreview(null)
    setPreviewError('')
  }

  async function rescanMaterials() {
    setIsRescanning(true)
    setRescanError('')
    setMaterialActionMessage('')
    try {
      await onRescanMaterials()
      setMaterialActionMessage('资料记忆已重新同步。')
    } catch (error) {
      setRescanError(error instanceof Error ? error.message : '资料重新解析失败')
    } finally {
      setIsRescanning(false)
    }
  }

  async function uploadMaterials(event: ChangeEvent<HTMLInputElement>) {
    const { files } = event.target
    if (!files?.length) return
    setUploadingFileCount(files.length)
    setIsUploading(true)
    setRescanError('')
    setMaterialActionMessage('')
    try {
      await onUploadMaterials(files)
      setMaterialActionMessage(`已批量导入 ${files.length} 份资料，并刷新 AI 资料记忆。`)
    } catch (error) {
      setRescanError(error instanceof Error ? error.message : '资料导入失败')
    } finally {
      event.target.value = ''
      setIsUploading(false)
      setUploadingFileCount(0)
    }
  }

  async function deleteMaterial(file: Material) {
    const firstConfirmed = window.confirm(
      `确认删除「${file.name}」吗？删除后该文件会从本机资料库移除，并刷新 AI 资料记忆。`,
    )
    if (!firstConfirmed) return
    const secondConfirmed = window.confirm(`再次确认：真的要删除「${file.relativePath}」吗？`)
    if (!secondConfirmed) return

    setDeletingMaterialPath(file.relativePath)
    setRescanError('')
    setMaterialActionMessage('')
    try {
      await onDeleteMaterial(file)
      if (selectedMaterial?.relativePath === file.relativePath) {
        closeMaterialPreview()
      }
      setMaterialActionMessage('资料已删除，并刷新 AI 资料记忆。')
    } catch (error) {
      setRescanError(error instanceof Error ? error.message : '资料删除失败')
    } finally {
      setDeletingMaterialPath(null)
    }
  }

  function selectMcpServer(serverId: string) {
    const server = mcpServers.find((item) => item.id === serverId)
    setSourceDraft((current) => ({
      ...current,
      serverId,
      toolName: server?.allowedTools[0] ?? '',
    }))
  }

  function updateExternalSourceUrl(url: string) {
    setSourceDraft((current) => getSourceDraftForUrl(url, mcpServers, current))
  }

  function refreshMcpServersQuietly() {
    void refreshMcpServers().catch((error) => {
      setRescanError(error instanceof Error ? error.message : '无法读取 MCP 服务配置')
    })
  }

  async function submitExternalSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sourceDraft.url.trim() || !sourceDraft.serverId || !sourceDraft.toolName) {
      setRescanError('请填写网址并选择 MCP 服务和工具。')
      return
    }
    setIsExternalSourceBusy(true)
    setRescanError('')
    setMaterialActionMessage('')
    try {
      const source = await submitCourseExternalSource(course.id, {
        url: sourceDraft.url,
        mcpServerId: sourceDraft.serverId,
        toolName: sourceDraft.toolName,
        sourceType: sourceDraft.sourceType,
      })
      setExternalSource(source)
      setMaterialActionMessage('外部资料已进入解析队列。')
    } catch (error) {
      setRescanError(error instanceof Error ? error.message : '外部资料提交失败')
    } finally {
      setIsExternalSourceBusy(false)
    }
  }

  async function approveExternalSource() {
    if (!externalSource) return
    setIsExternalSourceBusy(true)
    setRescanError('')
    try {
      const result = await approveCourseExternalSource(course.id, externalSource.id)
      setExternalSource(result.source)
      setSourceDraft((current) => ({ ...current, url: '' }))
      await onRescanMaterials()
      setMaterialActionMessage('外部资料已确认并写入当前课程知识库。')
    } catch (error) {
      setRescanError(error instanceof Error ? error.message : '外部资料导入失败')
    } finally {
      setIsExternalSourceBusy(false)
    }
  }

  async function dismissExternalSource() {
    if (!externalSource) return
    setIsExternalSourceBusy(true)
    setRescanError('')
    try {
      setExternalSource(await dismissCourseExternalSource(course.id, externalSource.id))
      setMaterialActionMessage('外部资料草稿已忽略。')
    } catch (error) {
      setRescanError(error instanceof Error ? error.message : '外部资料忽略失败')
    } finally {
      setIsExternalSourceBusy(false)
    }
  }

  return (
    <div className="module-page materials-page" aria-busy={isUploading}>
      {isUploading && (
        <div className="material-upload-backdrop" role="status" aria-live="polite">
          <section className="material-upload-loader">
            <div className="material-upload-animation" aria-hidden="true">
              <span className="material-upload-file file-one"><FileText size={21} /></span>
              <span className="material-upload-file file-two"><FileText size={21} /></span>
              <span className="material-upload-file file-three"><FileText size={21} /></span>
              <span className="material-upload-target"><Upload size={24} /></span>
            </div>
            <strong>正在导入 {uploadingFileCount} 份资料</strong>
            <p>写入本机资料库，并刷新 AI 资料记忆...</p>
            <div className="material-upload-progress" aria-hidden="true"><span /></div>
          </section>
        </div>
      )}
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><FolderOpen size={15} /> 所有资料默认保存在本机</p>
          <h1>资料库</h1>
          <p>{materials.length ? `已检查${course.name}资料；Agent 只使用标记为可读或部分可读的资料生成计划和题目。` : `${course.name}资料库已建立。`}</p>
        </div>
        <div className="material-toolbar">
          <label className={`secondary-button upload-trigger ${isUploading ? 'is-busy' : ''}`}>
            <Upload size={16} />
            {isUploading ? '批量导入中' : '批量导入资料'}
            <input type="file" multiple disabled={isUploading || isRescanning} onChange={uploadMaterials} />
          </label>
          <button className="secondary-button" type="button" disabled={isRescanning || isUploading} onClick={rescanMaterials}>
            <RefreshCw className={isRescanning ? 'is-spinning' : ''} size={16} />
            {isRescanning ? '解析中' : '重新解析'}
          </button>
        </div>
      </section>
      <form className="external-source-import" onSubmit={submitExternalSource}>
        <div className="external-source-heading">
          <span><Link2 size={17} /></span>
          <div>
            <strong>网页资料</strong>
            <small>解析结果需确认后才会进入课程知识库。</small>
          </div>
        </div>
        <input
          type="url"
          value={sourceDraft.url}
          placeholder="粘贴网页、GitHub、arXiv、B站或小红书笔记地址"
          disabled={!mcpServers.length || isExternalSourceBusy}
          onFocus={refreshMcpServersQuietly}
          onChange={(event) => updateExternalSourceUrl(event.target.value)}
        />
        <select
          value={sourceDraft.sourceType}
          disabled={!mcpServers.length || isExternalSourceBusy}
          aria-label="资料类型"
          onChange={(event) => setSourceDraft((current) => ({ ...current, sourceType: event.target.value as ExternalSource['sourceType'] }))}
        >
          <option value="video">教学视频</option>
          <option value="note">网页笔记</option>
          <option value="web">普通网页</option>
        </select>
        <select
          value={sourceDraft.serverId}
          disabled={!mcpServers.length || isExternalSourceBusy}
          aria-label="MCP 服务"
          onFocus={refreshMcpServersQuietly}
          onChange={(event) => selectMcpServer(event.target.value)}
        >
          {mcpServers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
        </select>
        <select
          value={sourceDraft.toolName}
          disabled={!selectedMcpServer || isExternalSourceBusy}
          aria-label="MCP 工具"
          onChange={(event) => setSourceDraft((current) => ({ ...current, toolName: event.target.value }))}
        >
          {selectedMcpServer?.allowedTools.map((tool) => <option key={tool} value={tool}>{tool}</option>)}
        </select>
        <button className="primary-button" type="submit" disabled={!mcpServers.length || isExternalSourceBusy}>
          <Sparkles size={16} /> {isExternalSourceBusy ? '处理中' : '解析'}
        </button>
      </form>
      {externalSource && !['approved', 'dismissed'].includes(externalSource.status) && (
        <section className="external-source-review">
          <header>
            <div>
              <strong>{externalSource.title || '外部资料解析中'}</strong>
              <small>{externalSource.url}</small>
            </div>
            <span className={`external-source-status is-${externalSource.status}`}>
              {externalSource.status === 'pending_review' ? '待确认' : externalSource.status === 'failed' ? '解析失败' : '解析中'}
            </span>
          </header>
          {externalSource.error && <p role="alert">{externalSource.error}</p>}
          {externalSource.status === 'pending_review' && <pre>{externalSource.content.slice(0, 4000)}</pre>}
          {['pending_review', 'failed'].includes(externalSource.status) && (
            <footer>
              {externalSource.status === 'pending_review' && (
                <button className="primary-button" type="button" disabled={isExternalSourceBusy} onClick={approveExternalSource}>
                  <Check size={16} /> 确认导入
                </button>
              )}
              <button className="secondary-button" type="button" disabled={isExternalSourceBusy} onClick={dismissExternalSource}>
                <X size={16} /> 忽略
              </button>
            </footer>
          )}
        </section>
      )}
      <section className="material-insight">
        <div className="material-insight-icon"><Sparkles size={20} /></div>
        <div>
          <strong>{materialMemory?.contentRefreshRecommended ? '资料记忆已更新，建议审阅主线' : '资料解析状态已透明化'}</strong>
          <p>{materialMemory?.summary ?? assessmentProfile.summary}</p>
          {materialMemory?.lastChange && <small>最近同步：{materialMemory.lastChange}</small>}
        </div>
        <div className="material-insight-status" aria-label="资料解析统计">
          {materialStatusItems.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>
      {rescanError && <p className="material-rescan-error" role="alert">{rescanError}</p>}
      {materialActionMessage && <p className="material-action-message">{materialActionMessage}</p>}
      <section className="material-list">
        {materials.map((file) => (
          <article className="material-row" key={file.relativePath}>
            <span className="file-type">{file.type}</span>
            <div>
              <h3>{file.name}</h3>
              <p>{file.relativePath} · {file.detail}</p>
              <small>{file.aiMessage || file.previewMessage || '该资料已被记录。'}</small>
            </div>
            <div className="material-actions">
              <span className={`material-status ai-${materialAiStatusClass(file)}`}>{materialAiLabel(file)}</span>
              <span className={`material-status preview-${materialPreviewStatusClass(file)}`}>{materialPreviewLabel(file)}</span>
              <button type="button" aria-label={`预览 ${file.name}`} onClick={() => setSelectedMaterial(file)}>
                <Eye size={15} /> 预览
              </button>
              <button
                className="material-delete-button"
                type="button"
                disabled={deletingMaterialPath === file.relativePath}
                aria-label={`删除 ${file.name}`}
                onClick={() => void deleteMaterial(file)}
              >
                <Trash2 size={15} /> {deletingMaterialPath === file.relativePath ? '删除中' : '删除'}
              </button>
            </div>
          </article>
        ))}
      </section>
      <StrategySection strategyDocuments={strategyDocuments} onSaveCoursePrompt={onSaveCoursePrompt} />
      {selectedMaterial && (
        <div className="modal-backdrop material-preview-backdrop" role="presentation" onMouseDown={closeMaterialPreview}>
          <section
            className="material-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="material-preview-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="material-preview-header">
              <span className="file-type">{selectedMaterial.type}</span>
              <div>
                <h2 id="material-preview-title">{selectedMaterial.name}</h2>
                <p>{selectedMaterial.relativePath}</p>
                <div className="material-preview-state-row">
                  <span className={`material-status ai-${materialAiStatusClass(selectedMaterial)}`}>
                    {materialAiLabel(selectedMaterial)}
                  </span>
                  <span className={`material-status preview-${materialPreviewStatusClass(selectedMaterial)}`}>
                    {materialPreviewLabel(selectedMaterial)}
                  </span>
                </div>
              </div>
              <a className="secondary-button" href={selectedMaterialUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={15} /> 打开原文件
              </a>
              <button className="icon-button" type="button" aria-label="关闭预览" onClick={closeMaterialPreview}>
                <X size={18} />
              </button>
            </header>
            <div className="material-preview-content">
              {isPreviewLoading && <MaterialPreviewEmpty title="正在打开资料" message="请稍等，正在准备站内预览。" />}
              {!isPreviewLoading && previewError && <MaterialPreviewEmpty title="预览失败" message={previewError} />}
              {!isPreviewLoading && !previewError && materialPreview && (
                <MaterialPreviewContent preview={materialPreview} fileUrl={selectedPreviewUrl} />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export function ModuleView(props: ModuleViewProps) {
  const title = moduleTitles[props.activeModule]
  const { onActiveStudyTaskChange } = props
  const [activeStudyTaskId, setActiveStudyTaskId] = useState<string | null>(null)
  const activeStudyTask = props.tasks.find((task) => task.id === activeStudyTaskId)
  const activeKnowledgePoint = activeStudyTask
    ? findTaskKnowledgePoint(activeStudyTask, props.knowledgePoints)
    : undefined

  useEffect(() => {
    setActiveStudyTaskId(null)
  }, [props.activeModule])

  useEffect(() => {
    if (activeStudyTaskId) {
      window.scrollTo({ top: 0, left: 0 })
    }
  }, [activeStudyTaskId])

  useEffect(() => {
    onActiveStudyTaskChange?.(activeStudyTask?.id ?? null)
  }, [activeStudyTask?.id, onActiveStudyTaskChange])

  function updateStudyTaskProgress(taskId: string, pageIndex: number, pageCount: number) {
    props.onTasksChange(
      props.tasks.map((task) => {
        if (task.id !== taskId) return task
        const pageProgress = getStudyProgressForPage(pageIndex, pageCount)
        const nextProgress = task.status === 'completed' ? task.progress : Math.max(task.progress, pageProgress)
        return {
          ...task,
          progress: nextProgress,
          status: nextProgress >= 100 ? 'completed' : 'in-progress',
        }
      }),
    )
  }

  if (activeStudyTask && (props.activeModule === 'overview' || props.activeModule === 'plan')) {
    return (
      <StudyTaskView
        course={props.course}
        task={activeStudyTask}
        knowledgePoint={activeKnowledgePoint}
        practiceQuestions={props.practiceQuestions}
        practiceAnswers={props.practiceAnswers}
        onSubmitPractice={props.onSubmitPractice}
        onClearPracticeAnswer={props.onClearPracticeAnswer}
        onBack={() => setActiveStudyTaskId(null)}
        onPractice={() => {
          setActiveStudyTaskId(null)
          props.onModuleChange('practice')
        }}
        onProgressChange={(pageIndex, pageCount) => updateStudyTaskProgress(activeStudyTask.id, pageIndex, pageCount)}
      />
    )
  }

  if (props.activeModule === 'overview' && props.onboarding?.status === 'strategy-review') {
    return <StrategyReviewView {...props} />
  }

  if (props.activeModule === 'overview' && props.onboarding?.status !== 'planned') {
    return <CourseOnboardingView key={props.course.id} {...props} />
  }

  if (props.activeModule === 'overview' && props.diagnosticReviewAnswers && props.diagnosticQuestions?.length) {
    return <DiagnosticResultView {...props} />
  }

  if (props.activeModule === 'overview') {
    return <OverviewView {...props} onStudyTask={setActiveStudyTaskId} />
  }
  if (props.activeModule === 'plan') {
    return <PlanView {...props} onStudyTask={setActiveStudyTaskId} />
  }
  if (props.activeModule === 'practice') {
    return <PracticeView {...props} />
  }
  if (props.activeModule === 'mock') {
    return <MockView {...props} />
  }
  if (props.activeModule === 'notes') {
    return <NotesView {...props} />
  }
  if (props.activeModule === 'errors') {
    return <ErrorsView {...props} />
  }
  if (props.activeModule === 'archive') {
    return <ArchiveView {...props} />
  }
  if (props.activeModule === 'materials') {
    return <MaterialsView {...props} />
  }
  if (props.activeModule === 'planning') {
    return <PlanningView courses={props.courses ?? [props.course]} courseWorkspaces={props.courseWorkspaces ?? {}} />
  }
  if (props.activeModule === 'mindmap') {
    return (
      <Suspense
        fallback={(
          <div className="module-page empty-module">
            <LoaderCircle className="is-spinning" size={32} />
            <h1>正在打开知识地图</h1>
            <p>正在加载无限画布。</p>
          </div>
        )}
      >
        <CourseMindMapView
          course={props.course}
          onModuleChange={props.onModuleChange}
          tasks={props.tasks}
          knowledgePoints={props.knowledgePoints}
          practiceQuestions={props.practiceQuestions}
          mockQuestions={props.mockQuestions}
          wrongAnswers={props.wrongAnswers}
        />
      </Suspense>
    )
  }
  if (props.activeModule === 'settings') {
    return (
      <SettingsView
        courseId={props.course.id}
        modelProfile={props.modelProfile}
        theme={props.theme}
        uiFont={props.uiFont}
        uiFontSize={props.uiFontSize}
        onModelProfileChange={props.onModelProfileChange}
        onThemeChange={props.onThemeChange}
        onUiFontChange={props.onUiFontChange}
        onUiFontSizeChange={props.onUiFontSizeChange}
      />
    )
  }

  return (
    <div className="module-page empty-module">
      <GraduationCap size={32} />
      <h1>{title.title}</h1>
      <p>{title.subtitle}</p>
    </div>
  )
}
