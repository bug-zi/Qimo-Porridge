import type {
  AdjustmentProposal,
  AgentJob,
  ArchiveItem,
  Course,
  EmbeddingProfile,
  ExternalSource,
  KnowledgeBaseStatus,
  MaterialPreview,
  McpServer,
  MockSubmitResult,
  ModelProfile,
  PlanTask,
  PracticeAnswerResult,
  SearchResult,
  StrategyDocuments,
  StudyWorkspace,
  WrongAnswer,
} from './types'

const apiBaseUrl = 'http://127.0.0.1:8000/api'

function encodeMaterialPath(relativePath: string) {
  return relativePath.split('/').map(encodeURIComponent).join('/')
}

type RuntimeModel = {
  baseUrl: string
  model: string
  connected: boolean
  hasApiKey?: boolean
  availableModels?: string[]
}

type CourseApiResponse = {
  id: string
  name: string
  exam_date: string
  target_score: number
  daily_hours: number
  progress: number
}

type CourseCreatePayload = {
  name: string
  examDate: string
  targetScore: number
  dailyHours: number
}

type ArchiveItemApiResponse = {
  id: string
  item_type: ArchiveItem['itemType']
  entity_id: string
  title: string
  course_id?: string | null
  course_name?: string | null
  deleted_at: string
  purge_after: string
}

type WrongAnswerArchiveApiResponse = {
  workspace: StudyWorkspace
  archive_item: ArchiveItemApiResponse
}

type RestoreArchiveApiResponse = {
  item_type: ArchiveItem['itemType']
  course?: CourseApiResponse
  workspace?: StudyWorkspace
  archive_items: ArchiveItemApiResponse[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
    ...init,
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof body.detail === 'string' ? body.detail : '本地服务请求失败')
  }
  return body as T
}

function inferCourseIcon(name: string): Course['icon'] {
  const normalizedName = name.toLowerCase()
  if (name.includes('英语') || normalizedName.includes('english')) return 'english'
  if (name.includes('物理') || normalizedName.includes('physics')) return 'physics'
  if (name.includes('数据库') || normalizedName.includes('database')) return 'database'
  if (name.includes('数据结构') || name.includes('程序') || normalizedName.includes('code')) return 'code'
  if (name.includes('数学') || name.includes('概率') || name.includes('经济') || normalizedName.includes('math')) return 'math'
  return 'system'
}

function resolveCourseColor(courseId: string) {
  const palette = ['#ff537f', '#3973e8', '#16a7a5', '#ff8a3d', '#a94cc6', '#2f65d8']
  const hash = Array.from(courseId).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return palette[hash % palette.length]
}

function toCourse(course: CourseApiResponse): Course {
  return {
    id: course.id,
    name: course.name,
    examDate: course.exam_date,
    targetScore: course.target_score,
    dailyHours: course.daily_hours,
    progress: course.progress,
    color: resolveCourseColor(course.id),
    icon: inferCourseIcon(course.name),
  }
}

function toArchiveItem(item: ArchiveItemApiResponse): ArchiveItem {
  return {
    id: item.id,
    itemType: item.item_type,
    entityId: item.entity_id,
    title: item.title,
    courseId: item.course_id ?? undefined,
    courseName: item.course_name ?? undefined,
    deletedAt: item.deleted_at,
    purgeAfter: item.purge_after,
  }
}

export async function listCourses() {
  const courses = await request<CourseApiResponse[]>('/courses')
  return courses.map(toCourse)
}

export async function createCourse(payload: CourseCreatePayload) {
  const course = await request<CourseApiResponse>('/courses', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name,
      exam_date: payload.examDate,
      target_score: payload.targetScore,
      daily_hours: payload.dailyHours,
    }),
  })
  return toCourse(course)
}

export async function deleteCourse(courseId: string) {
  const archiveItem = await request<ArchiveItemApiResponse>(`/courses/${encodeURIComponent(courseId)}`, {
    method: 'DELETE',
  })
  return toArchiveItem(archiveItem)
}

export function getCourseWorkspace(courseId: string) {
  return request<StudyWorkspace>(`/courses/${encodeURIComponent(courseId)}/workspace`)
}

export async function searchCourse(courseId: string, query: string) {
  const response = await request<{ query: string; results: SearchResult[] }>(
    `/courses/${encodeURIComponent(courseId)}/search?q=${encodeURIComponent(query)}`,
  )
  return response.results
}

export function saveCourseSetup(courseId: string, payload: {
  courseName: string
  examDate: string
  targetScore: number
  targetText: string
  dailyHours: number
  days: number
  examFormat: string
  remarks: string
}) {
  return request<StudyWorkspace>(`/courses/${encodeURIComponent(courseId)}/setup`, {
    method: 'POST',
    body: JSON.stringify({
      course_name: payload.courseName,
      exam_date: payload.examDate,
      target_score: payload.targetScore,
      target_text: payload.targetText,
      daily_hours: payload.dailyHours,
      days: payload.days,
      exam_format: payload.examFormat,
      remarks: payload.remarks,
    }),
  })
}

export function submitCourseDiagnostic(courseId: string, answers: Record<string, number>) {
  return request<StudyWorkspace>(`/courses/${encodeURIComponent(courseId)}/diagnostic/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  })
}

export function getStrategyDocuments(courseId: string) {
  return request<StrategyDocuments>(`/courses/${encodeURIComponent(courseId)}/strategy-documents`)
}

export function generateStrategyDocuments(courseId: string) {
  return request<StrategyDocuments>(`/courses/${encodeURIComponent(courseId)}/strategy-documents/generate`, {
    method: 'POST',
  })
}

export function saveStrategyDocuments(
  courseId: string,
  payload: { reviewPlan: string; coursePrompt: string; reviewPlanVersion: number; coursePromptVersion: number },
) {
  return request<StrategyDocuments>(`/courses/${encodeURIComponent(courseId)}/strategy-documents`, {
    method: 'PUT',
    body: JSON.stringify({
      review_plan: payload.reviewPlan,
      course_prompt: payload.coursePrompt,
      review_plan_version: payload.reviewPlanVersion,
      course_prompt_version: payload.coursePromptVersion,
    }),
  })
}

export function approveStrategyDocuments(
  courseId: string,
  payload: { reviewPlan: string; coursePrompt: string; reviewPlanVersion: number; coursePromptVersion: number },
) {
  return request<StudyWorkspace>(`/courses/${encodeURIComponent(courseId)}/strategy-documents/approve`, {
    method: 'POST',
    body: JSON.stringify({
      review_plan: payload.reviewPlan,
      course_prompt: payload.coursePrompt,
      review_plan_version: payload.reviewPlanVersion,
      course_prompt_version: payload.coursePromptVersion,
    }),
  })
}

export function approveStrategyDocumentsInBackground(
  courseId: string,
  payload: { reviewPlan: string; coursePrompt: string; reviewPlanVersion: number; coursePromptVersion: number },
) {
  return request<{ jobId: string; courseId: string }>(`/courses/${encodeURIComponent(courseId)}/strategy-documents/approve-job`, {
    method: 'POST',
    body: JSON.stringify({
      review_plan: payload.reviewPlan,
      course_prompt: payload.coursePrompt,
      review_plan_version: payload.reviewPlanVersion,
      course_prompt_version: payload.coursePromptVersion,
    }),
  })
}

export function getAgentJob(jobId: string) {
  return request<AgentJob>(`/agent-jobs/${encodeURIComponent(jobId)}`)
}

export function saveCoursePrompt(courseId: string, coursePrompt: string, version: number) {
  return request<StrategyDocuments>(`/courses/${encodeURIComponent(courseId)}/course-prompt`, {
    method: 'PUT',
    body: JSON.stringify({ course_prompt: coursePrompt, version }),
  })
}

export function getCourseMaterialPreview(courseId: string, relativePath: string) {
  return request<MaterialPreview>(
    `/courses/${encodeURIComponent(courseId)}/materials/preview/${encodeMaterialPath(relativePath)}`,
  )
}

export function getCourseMaterialFileUrl(courseId: string, relativePath: string) {
  return `${apiBaseUrl}/courses/${encodeURIComponent(courseId)}/materials/file/${encodeMaterialPath(relativePath)}`
}

export function getCourseMaterialConvertedFileUrl(courseId: string, relativePath: string) {
  return `${apiBaseUrl}/courses/${encodeURIComponent(courseId)}/materials/converted-file/${encodeMaterialPath(relativePath)}`
}

export function rescanCourseMaterials(courseId: string) {
  return request<StudyWorkspace>(`/courses/${encodeURIComponent(courseId)}/materials/rescan`, { method: 'POST' })
}

export async function uploadCourseMaterials(courseId: string, files: FileList | File[]) {
  const fileArray = Array.from(files)
  const manifest = fileArray.map((file) => ({ name: file.name, size: file.size, type: file.type }))
  const encoder = new TextEncoder()
  const manifestBytes = encoder.encode(JSON.stringify(manifest))
  const headerBytes = encoder.encode(`${manifestBytes.byteLength}\n`)
  const response = await fetch(`${apiBaseUrl}/courses/${encodeURIComponent(courseId)}/materials/upload-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([headerBytes, manifestBytes, ...fileArray]),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : '资料批量导入失败')
  return body as StudyWorkspace
}

export function deleteCourseMaterial(courseId: string, relativePath: string) {
  return request<StudyWorkspace>(
    `/courses/${encodeURIComponent(courseId)}/materials/${encodeMaterialPath(relativePath)}`,
    { method: 'DELETE' },
  )
}

export function getRuntimeModel() {
  return request<RuntimeModel>('/runtime-model')
}

export function saveRuntimeModel(payload: { baseUrl: string; apiKey: string; model: string }) {
  return request<RuntimeModel>('/runtime-model', {
    method: 'PUT',
    body: JSON.stringify({
      base_url: payload.baseUrl,
      api_key: payload.apiKey,
      model: payload.model,
    }),
  })
}

export function getEmbeddingProfile() {
  return request<EmbeddingProfile>('/knowledge/embedding')
}

export function saveEmbeddingProfile(payload: Pick<EmbeddingProfile, 'enabled' | 'baseUrl' | 'model'>) {
  return request<EmbeddingProfile>('/knowledge/embedding', {
    method: 'PUT',
    body: JSON.stringify({
      enabled: payload.enabled,
      base_url: payload.baseUrl,
      model: payload.model,
    }),
  })
}

export function testEmbeddingProfile() {
  return request<EmbeddingProfile & { success: boolean }>('/knowledge/embedding/test', {
    method: 'POST',
  })
}

export function rebuildKnowledgeEmbeddings(courseId: string) {
  return request<EmbeddingProfile>(`/courses/${encodeURIComponent(courseId)}/knowledge/reindex`, {
    method: 'POST',
  })
}

export function getKnowledgeBaseStatus(courseId: string) {
  return request<KnowledgeBaseStatus>(`/courses/${encodeURIComponent(courseId)}/knowledge/status`)
}

export function submitCoursePracticeAnswer(
  courseId: string,
  questionId: string,
  answerIndex: number,
  mode: '主线学习' | '刷题练习' = '刷题练习',
) {
  return request<PracticeAnswerResult>(`/courses/${encodeURIComponent(courseId)}/practice/answer`, {
    method: 'POST',
    body: JSON.stringify({ question_id: questionId, answer_index: answerIndex, mode }),
  })
}

export function submitCourseWrongAnswerRetry(courseId: string, wrongAnswerId: string, answerIndex: number) {
  return request<PracticeAnswerResult>(
    `/courses/${encodeURIComponent(courseId)}/wrong-answers/${encodeURIComponent(wrongAnswerId)}/retry`,
    { method: 'POST', body: JSON.stringify({ answer_index: answerIndex }) },
  )
}

export function submitCourseMockAnswers(courseId: string, answers: Record<string, number>) {
  return request<MockSubmitResult>(`/courses/${encodeURIComponent(courseId)}/mock/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  })
}

export function updateCourseWorkspace(courseId: string, payload: {
  tasks?: PlanTask[]
  wrongAnswers?: WrongAnswer[]
  note?: string
}) {
  return request<StudyWorkspace>(`/courses/${encodeURIComponent(courseId)}/workspace`, {
    method: 'PUT',
    body: JSON.stringify({
      tasks: payload.tasks,
      wrong_answers: payload.wrongAnswers,
      note: payload.note,
    }),
  })
}

export function askCourseAgent(courseId: string, message: string) {
  return request<{
    reply: string
    workspace: StudyWorkspace
    proposal?: AdjustmentProposal | null
    runId?: string
    sources?: Array<Record<string, unknown>>
  }>(
    `/courses/${encodeURIComponent(courseId)}/agent/chat`,
    { method: 'POST', body: JSON.stringify({ message }) },
  )
}

export function applyCourseAdjustmentProposal(courseId: string, proposalId: string) {
  return request<{ workspace: StudyWorkspace; proposal: AdjustmentProposal }>(
    `/courses/${encodeURIComponent(courseId)}/adjustment-proposals/${encodeURIComponent(proposalId)}/apply`,
    { method: 'POST' },
  )
}

export function dismissCourseAdjustmentProposal(courseId: string, proposalId: string) {
  return request<AdjustmentProposal>(
    `/courses/${encodeURIComponent(courseId)}/adjustment-proposals/${encodeURIComponent(proposalId)}/dismiss`,
    { method: 'POST' },
  )
}

export function listMcpServers() {
  return request<McpServer[]>('/mcp/servers')
}

export function saveMcpServer(payload: {
  id?: string
  name: string
  endpoint: string
  transport: McpServer['transport']
  command: string
  args: string[]
  allowedTools: string[]
}) {
  return request<McpServer>('/mcp/servers', {
    method: 'PUT',
    body: JSON.stringify({
      id: payload.id ?? '',
      name: payload.name,
      endpoint: payload.endpoint,
      transport: payload.transport,
      command: payload.command,
      args: payload.args,
      allowed_tools: payload.allowedTools,
    }),
  })
}

export function discoverMcpServer(serverId: string) {
  return request<McpServer>(`/mcp/servers/${encodeURIComponent(serverId)}/discover`, { method: 'POST' })
}

export function submitCourseExternalSource(courseId: string, payload: {
  url: string
  mcpServerId: string
  toolName: string
  sourceType: ExternalSource['sourceType']
}) {
  return request<ExternalSource>(`/courses/${encodeURIComponent(courseId)}/external-sources`, {
    method: 'POST',
    body: JSON.stringify({
      url: payload.url,
      mcp_server_id: payload.mcpServerId,
      tool_name: payload.toolName,
      source_type: payload.sourceType,
    }),
  })
}

export function getCourseExternalSource(courseId: string, sourceId: string) {
  return request<ExternalSource>(
    `/courses/${encodeURIComponent(courseId)}/external-sources/${encodeURIComponent(sourceId)}`,
  )
}

export function approveCourseExternalSource(courseId: string, sourceId: string) {
  return request<{ source: ExternalSource; workspace: StudyWorkspace }>(
    `/courses/${encodeURIComponent(courseId)}/external-sources/${encodeURIComponent(sourceId)}/approve`,
    { method: 'POST' },
  )
}

export function dismissCourseExternalSource(courseId: string, sourceId: string) {
  return request<ExternalSource>(
    `/courses/${encodeURIComponent(courseId)}/external-sources/${encodeURIComponent(sourceId)}/dismiss`,
    { method: 'POST' },
  )
}

export async function deleteCourseWrongAnswer(courseId: string, wrongAnswerId: string) {
  const response = await request<WrongAnswerArchiveApiResponse>(
    `/courses/${encodeURIComponent(courseId)}/wrong-answers/${encodeURIComponent(wrongAnswerId)}`,
    {
      method: 'DELETE',
    },
  )
  return {
    workspace: response.workspace,
    archiveItem: toArchiveItem(response.archive_item),
  }
}

export async function listArchiveItems() {
  const archiveItems = await request<ArchiveItemApiResponse[]>('/archive')
  return archiveItems.map(toArchiveItem)
}

export async function restoreArchiveItem(archiveId: string) {
  const response = await request<RestoreArchiveApiResponse>(`/archive/${encodeURIComponent(archiveId)}/restore`, {
    method: 'POST',
  })
  return {
    itemType: response.item_type,
    course: response.course ? toCourse(response.course) : undefined,
    workspace: response.workspace,
    archiveItems: response.archive_items.map(toArchiveItem),
  }
}

export function toRuntimeModelProfile(
  runtimeModel: RuntimeModel,
): ModelProfile {
  return {
    provider: 'custom',
    baseUrl: runtimeModel.baseUrl,
    model: runtimeModel.model,
    apiKey: '',
    hasApiKey: runtimeModel.hasApiKey,
    availableModels: runtimeModel.availableModels,
    supportsVision: true,
    status: runtimeModel.connected ? 'connected' : 'unconfigured',
    statusMessage: runtimeModel.connected ? '已由本机服务配置并连接' : '本机模型尚未配置',
  }
}
