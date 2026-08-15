import type { Course } from '../types'

/** 课程在「查看课程」中的时间线分类。 */
export type CourseTimelineCategory = 'active' | 'history'

export type CourseTimelineEntry = {
  course: Course
  category: CourseTimelineCategory
  /** 解析后的考试日期；无法解析（如「待填写」「期末周周三」）时为 null。 */
  examDate: Date | null
}

/** 分类展示文案（聚焦卡上的状态胶囊用）。 */
export const COURSE_CATEGORY_LABELS: Record<CourseTimelineCategory, string> = {
  active: '备考中',
  history: '已结束',
}

/** 滚轮里更简短的小标签。 */
export const COURSE_CATEGORY_SHORT_LABELS: Record<CourseTimelineCategory, string> = {
  active: '备考',
  history: '已结束',
}

/**
 * 「查看课程」顶部分类切换的标签与顺序（备考在前，作为默认分类）。
 * 两个课程浏览界面（顶栏切换器 / 侧边课程面板）共用，保证文案与顺序一致。
 */
export const COURSE_CATEGORY_TABS: { key: CourseTimelineCategory; label: string }[] = [
  { key: 'active', label: '备考' },
  { key: 'history', label: '历史' },
]

const EXAM_DATE_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/

/**
 * 解析 YYYY-MM-DD 考试日期；非法值返回 null。
 * 与后端 study_service._review_days_from_exam_date 的正则一致，避免前后端判定漂移。
 */
export function parseExamDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(EXAM_DATE_PATTERN)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }
  return parsed
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * 判定课程分类：
 * - 考试日 < 今天 → history（已考完，归入历史记录）；
 * - 其余（今天考试、未来考试、未填写/无法解析的日期）→ active（仍处备考状态）。
 *
 * 「今天考试」按备考处理：考试当天仍需冲刺，过了这一天才转入历史。
 */
export function classifyCourse(course: Course, now: Date = new Date()): CourseTimelineCategory {
  const examDate = parseExamDate(course.examDate)
  if (!examDate) return 'active'
  return startOfDay(examDate) < startOfDay(now) ? 'history' : 'active'
}

/**
 * 构建「查看课程」的展示顺序：
 * 1) 备考课程在前，历史课程在后；
 * 2) 备考课程按考试时间升序（越早考试越靠前，如 8.2 排在 8.5 前），未填日期的沉到该组末尾；
 * 3) 历史课程按考试时间降序（越近考完越靠前，如 7.30 排在 7.20 前）。
 */
export function buildCourseTimeline(courses: Course[], now: Date = new Date()): CourseTimelineEntry[] {
  const entries: CourseTimelineEntry[] = courses.map((course) => ({
    course,
    category: classifyCourse(course, now),
    examDate: parseExamDate(course.examDate),
  }))

  const active = entries.filter((entry) => entry.category === 'active')
  const history = entries.filter((entry) => entry.category === 'history')

  active.sort((a, b) => compareByDate(a.examDate, b.examDate, 'asc'))
  history.sort((a, b) => compareByDate(a.examDate, b.examDate, 'desc'))

  return [...active, ...history]
}

/** 日期比较：有日期的按方向排序，无日期的统一沉到末尾（无论升降序）。 */
function compareByDate(a: Date | null, b: Date | null, direction: 'asc' | 'desc'): number {
  if (a && b) return direction === 'asc' ? a.getTime() - b.getTime() : b.getTime() - a.getTime()
  if (a) return -1
  if (b) return 1
  return 0
}

/** 统计两类课程数量，供 UI 展示「备考 N · 历史 M」。 */
export function summarizeTimeline(entries: CourseTimelineEntry[]): { active: number; history: number } {
  let active = 0
  let history = 0
  for (const entry of entries) {
    if (entry.category === 'active') active += 1
    else history += 1
  }
  return { active, history }
}
