export type LearningModule =
  | 'overview'
  | 'materials'
  | 'planning'
  | 'mindmap'
  | 'plan'
  | 'practice'
  | 'mock'
  | 'notes'
  | 'errors'
  | 'archive'
  | 'settings'

export type SearchResult = {
  id: string
  type: 'material' | 'knowledge' | 'note' | 'wrong-answer' | 'question'
  module: LearningModule
  title: string
  excerpt: string
  source: string
}

export type ModelProvider = 'openai' | 'deepseek' | 'glm' | 'custom'

export type UiFont =
  | 'system'
  | 'lakeus-night-writing'
  | 'maple-mono-nf-cn'
  | 'honglei-banshu'
  | 'liyu-xingkai'
  | 'nanxi-ink-song'
  | 'lxgw-wenkai'
  | 'xuanzongti'
  | 'slidexiaxing'
  | 'slideyouran'

export type UiFontSize = 90 | 95 | 100 | 105 | 110 | 115

export type ModelProfile = {
  provider: ModelProvider
  baseUrl: string
  model: string
  apiKey: string
  hasApiKey?: boolean
  availableModels?: string[]
  supportsVision: boolean
  status: 'unconfigured' | 'saved' | 'testing' | 'connected' | 'error'
  statusMessage: string
  lastTestedAt?: string
}

export type UserProfilePrompt = {
  content: string
  updatedAt: string
}

export type Course = {
  id: string
  name: string
  examDate: string
  targetScore: number
  progress: number
  dailyHours: number
  color: string
  icon: 'code' | 'physics' | 'math' | 'english' | 'system' | 'database'
}

export type StudyConcept = {
  title: string
  body: string
  formula?: string
  source?: string
}

export type StudyFormula = {
  expression: string
  meaning: string
  conditions: string
}

export type StudyExamPoint = {
  id: string
  title: string
  importance: 'high' | 'medium' | 'low'
  teachingMode: 'concept' | 'calculation' | 'proof' | 'application'
  explanation: string
  formulas?: StudyFormula[]
  procedure?: string[]
  questionTypes?: string[]
  pitfalls?: string[]
  sourceRefs: string[]
}

export type StudyWorkedExample = {
  id?: string
  title: string
  origin?: 'material' | 'ai-adapted'
  source?: string
  problem?: string
  analysis?: string
  setup?: string
  steps: string[]
  answer?: string
  conclusion?: string
  checks?: string[]
  examPointIds?: string[]
}

export type StudyGuideSection = {
  id: 'exam-focus' | 'method' | 'worked-example' | 'self-check' | string
  label: string
  title: string
  objectives?: string[]
  sourceHighlights?: string[]
  concepts?: StudyConcept[]
  example?: StudyGuide['example']
  planningReason?: string
  examPoints?: StudyExamPoint[]
  workedExamples?: StudyWorkedExample[]
  selfTestQuestionIds?: string[]
  checklist?: string[]
}

export type OrientationPhase = {
  title: string
  dayRange: string
  goal: string
  focus?: string[]
}

export type OrientationDependencyLayer = {
  level: number
  title: string
  knowledgePoints: string[]
  rationale?: string
}

export type OrientationMilestone = {
  day: number
  title: string
  criteria?: string
}

export type OrientationGuide = {
  overview: string
  phases: OrientationPhase[]
  dependencyLayers: OrientationDependencyLayer[]
  method: string[]
  milestones: OrientationMilestone[]
  checklist: string[]
}

export type StudyGuide = {
  planningReason?: string
  examPoints?: StudyExamPoint[]
  workedExamples?: StudyWorkedExample[]
  selfTestQuestionIds?: string[]
  objectives?: string[]
  sourceHighlights?: string[]
  concepts?: StudyConcept[]
  example?: {
    title: string
    setup: string
    steps: string[]
    conclusion: string
  }
  checklist?: string[]
  sections?: StudyGuideSection[]
  orientation?: OrientationGuide
}

export type EmbeddingProfile = {
  enabled: boolean
  provider: 'ollama'
  baseUrl: string
  model: string
  status: 'disabled' | 'ready' | 'unavailable' | 'indexing'
  message: string
  indexedChunks: number
  totalChunks: number
  dimension: number
}

export type KnowledgeBaseStatus = {
  courseId: string
  materials: number
  chunks: number
  chatTurns: number
  learningEvents: number
  memories: number
  embedding: EmbeddingProfile
}

export type McpServer = {
  id: string
  name: string
  endpoint: string
  transport: 'http' | 'stdio'
  command: string
  args: string[]
  tools: Array<{
    name: string
    description?: string
    inputSchema?: Record<string, unknown>
  }>
  allowedTools: string[]
}

export type BilibiliCredentialStatus = {
  configured: boolean
  source: 'app' | 'global_config' | 'none'
}

export type BilibiliCredentialVerifyResult = {
  loggedIn: boolean | null
  message: string
  nextSteps: string[]
}

export type ExternalSource = {
  id: string
  courseId: string
  url: string
  sourceType: 'web' | 'video' | 'note'
  title: string
  status: 'queued' | 'fetching' | 'pending_review' | 'approved' | 'dismissed' | 'failed'
  content: string
  metadata: Record<string, unknown>
  error: string
  createdAt: string
  updatedAt: string
}

export type PlanTask = {
  id: string
  courseId: string
  kind?: 'orientation'
  day?: number
  order: number
  title: string
  description: string
  source: string
  duration: number
  progress: number
  weight: number
  knowledgePointId?: string
  status: 'pending' | 'in-progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
  studyGuide?: StudyGuide
  contentQualityWarning?: string
  schedulingReason?: string
}

export type WrongAnswer = {
  id: string
  questionId?: string
  questionType?: '摸底测试' | '主线学习' | '刷题练习' | '模拟卷' | '错题重做'
  source?: string
  addedAt?: string
  reviewedAt?: string
  title: string
  tag: string
  mistakeType: string
  count: number
  isReviewed: boolean
}

export type ArchiveItem = {
  id: string
  itemType: 'course' | 'wrong-answer'
  entityId: string
  title: string
  courseId?: string
  courseName?: string
  deletedAt: string
  purgeAfter: string
}

export type StudyMessage = {
  id: string
  role: 'assistant' | 'user'
  mode?: 'chat' | 'agent'
  content: string
  createdAt: string
  toolEvents?: StreamingToolEvent[]
  sources?: Array<Record<string, unknown>>
}

export type StreamingToolEvent = {
  step: number
  name: string
  label: string
  status: 'running' | 'done'
  summary?: string
}

export type StreamingMessage = {
  content: string
  toolEvents: StreamingToolEvent[]
}

export type AdjustmentProposal = {
  id: string
  courseId?: string
  baseRevision?: number
  title: string
  reason: string
  impact: string
  status: 'pending' | 'applied' | 'dismissed'
  operations?: Array<Record<string, unknown>>
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  params?: { examDate?: string; days?: number; dailyHours?: number }
}

export type PlanParamsAdjustRequest = {
  examDate?: string
  days?: number
  dailyHours?: number
}

export type PlanParamsAdjustResponse =
  | { workspace: StudyWorkspace; proposal: null }
  | { workspace: null; proposal: AdjustmentProposal }

export type Material = {
  name: string
  relativePath: string
  type: string
  size: number
  detail: string
  analysisVersion?: number
  parser?: string
  parsedCharacters?: number
  aiStatus?: 'ready' | 'partial' | 'skipped' | 'unreadable'
  aiLabel?: string
  aiMessage?: string
  aiReadable?: boolean
  previewStatus?: 'ready' | 'converted' | 'limited' | 'unsupported'
  previewLabel?: string
  previewMessage?: string
}

export type MaterialPreview = {
  name: string
  relativePath: string
  type: string
  kind: 'image' | 'pdf' | 'text' | 'sheet' | 'unsupported'
  message: string
  isConvertedPreview?: boolean
  aiStatus?: Material['aiStatus']
  aiLabel?: string
  aiMessage?: string
  previewStatus?: Material['previewStatus']
  previewLabel?: string
  previewMessage?: string
  text?: string
  sheets?: Array<{
    name: string
    rows: string[][]
  }>
}

export type MaterialMemory = {
  digest: string
  sourceCount: number
  aiReadableCount: number
  aiPartialCount: number
  aiSkippedCount: number
  aiUnreadableCount: number
  lastChange: string
  lastSyncedAt: string
  contentRefreshRecommended: boolean
  summary: string
}

export type CourseOnboarding = {
  status: 'draft' | 'diagnostic' | 'strategy-review' | 'planned'
  courseName: string
  examDate: string
  targetScore: number
  targetText: string
  dailyHours: number
  days: number
  reviewCount?: number
  examFormat: string
  remarks: string
  diagnosticScore?: number
  diagnosticTotal?: number
  diagnosticPercent?: number
}

export type StrategyDocument = {
  content: string
  version: number
  updatedAt: string
  updatedBy: 'ai' | 'user'
  changeSummary?: string
}

export type StrategyDocuments = {
  status: 'generating' | 'review' | 'approved' | 'maintenance-error'
  reviewPlan: StrategyDocument
  coursePrompt: StrategyDocument
  maintenancePending: boolean
  maintenanceError?: string
}

export type AgentJob = {
  id: string
  courseId: string
  jobType: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  attempts: number
  maxAttempts: number
  error: string
  result: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type KnowledgePoint = {
  id: string
  name: string
  mastery: number
  weight: number
  difficulty?: number
  prerequisites?: string[]
  summary: string
  source: string
  moduleId?: string
}

export type QuizQuestion = {
  id: string
  type: 'single' | 'calculation'
  questionType?: string
  score: number
  prompt: string
  options: string[]
  answerIndex: number
  referenceAnswer?: string
  gradingRubric?: string[]
  explanation: string
  knowledgePointId: string
  source: string
  taskId?: string
  examPointIds?: string[]
}

export type MindMapNodeType =
  | 'course'
  | 'chapter'
  | 'knowledge'
  | 'task'
  | 'material'
  | 'question'
  | 'wrongAnswer'

export type MindMapNode = {
  id: string
  type: MindMapNodeType
  title: string
  summary?: string
  knowledgePointId?: string
  taskId?: string
  materialPath?: string
  questionId?: string
  wrongAnswerId?: string
  source?: string
  mastery?: number
  weight?: number
  status?: string
  moduleId?: string
  order?: number
  kind?: 'module' | 'bucket'
  position?: {
    x: number
    y: number
  }
  collapsed?: boolean
}

export type MindMapEdge = {
  id: string
  source: string
  target: string
  label?: string
}

export type CourseMindMap = {
  version: number
  courseId: string
  generatedAt: string
  sourceRevision?: number
  modules?: Array<{ id: string; title: string; order: number }>
  layout: 'tree-right'
  layouted?: boolean
  layoutVersion?: number
  viewport?: {
    x: number
    y: number
    zoom: number
  }
  nodes: MindMapNode[]
  edges: MindMapEdge[]
}

export type StudyWorkspace = {
  revision?: number
  planRevision?: number
  course: Course
  assessmentProfile: {
    summary: string
    questionTypes: string[]
  }
  diagnostic: {
    estimatedScore: string
    message: string
  }
  knowledgePoints: KnowledgePoint[]
  tasks: PlanTask[]
  practiceQuestions: QuizQuestion[]
  mockQuestions: QuizQuestion[]
  materials: Material[]
  materialMemory?: MaterialMemory
  knowledgeBase?: KnowledgeBaseStatus
  diagnosticQuestions?: QuizQuestion[]
  onboarding?: CourseOnboarding
  strategyDocuments?: StrategyDocuments
  wrongAnswers: WrongAnswer[]
  practiceAnswers?: Record<string, PracticeAnswerRecord>
  mockResult?: MockResultRecord | null
  note: string
  messages: StudyMessage[]
  generatedAt: string
  generationMode: 'ai' | 'fallback'
  planStartDate?: string
  timeLog?: TimeLogEntry[]
  dailyProgress?: DailyProgress
  pendingProposals?: AdjustmentProposal[]
  schedulingWarnings?: string[]
}

export type PracticeAnswerResult = {
  correct: boolean
  explanation: string
  mastery: number
  generatedSimilarCount: number
  workspace: StudyWorkspace
}

export type MockSubmitResult = {
  score: number
  total: number
  results: Array<{
    id: string
    correct: boolean
    earnedScore?: number
    explanation: string
    mastery: number
    generatedSimilarCount: number
  }>
  workspace: StudyWorkspace
}

export type MockAnswer = number | string

export type PracticeAnswerRecord = {
  answerIndex: number
  correct: boolean
  explanation: string
  mastery: number
  answeredAt: string
  mode: string
}

export type MockResultRecord = {
  submittedAt: string
  score: number
  total: number
  answers: Record<string, MockAnswer>
  results: Array<{
    id: string
    correct: boolean
    earnedScore?: number
    explanation: string
    mastery: number
    generatedSimilarCount: number
  }>
}

export type TimeLogEntry = {
  id: string
  taskId: string
  date: string
  minutes: number
  note: string
  createdAt: string
}

export type OverdueTaskRef = {
  id: string
  title: string
  day: number
  duration: number
  priority: 'high' | 'medium' | 'low'
  status: string
}

export type DailyProgress = {
  date: string
  todayDay: number
  maxDay: number
  plannedToday: number
  spentToday: number
  remaining: number
  overBudget: boolean
  overdue: OverdueTaskRef[]
}

export type GlossaryTerm = {
  id: string
  term: string
  aliases: string[]
  oneLiner: string
  article: string
  examTips: string[]
  pitfalls: string[]
  knowledgePointId?: string
  relatedKnowledgePointIds: string[]
  moduleId?: string
  importance: 'core' | 'extended'
  status: 'draft' | 'active' | 'inactive'
  origin: 'curator' | 'manual'
  updatedAt: string
}

export type GlossaryStatus = {
  courseId: string
  status: 'idle' | 'generating' | 'ready' | 'failed'
  termsTotal: number
  termsActive: number
  lastError: string
  lastRefreshedAt: string
}

export type GlossaryResponse = {
  courseId: string
  terms: GlossaryTerm[]
  status: GlossaryStatus
}
