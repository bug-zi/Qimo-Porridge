/**
 * 复习日分布工具——把「共复习 K 次」均匀落到「距考试 D 天」的日程上。
 *
 * 公式与后端 study_service._review_session_days 严格一致，前端用于表单实时预览，
 * 后端用于任务 day 重映射。改这里必须同步改后端。
 *
 * - K == 1 → [1]（只复习一次，放在第 1 天）
 * - K >= 2 → 第 j 次（j=0..K-1）落在 clamp(round(1 + j*(D-1)/(K-1)), 1, D)，去重保序
 * - K = D → [1..D]（每天复习，向后兼容旧行为）
 * - K > D 钳制为 D（一天最多一次复习）
 */
export function reviewSessionDays(days: number, reviewCount: number): number[] {
  const span = Math.max(1, Math.floor(days))
  const count = Math.min(Math.max(1, Math.floor(reviewCount)), span)
  if (count === 1) return [1]
  const seen = new Set<number>()
  const result: number[] = []
  for (let j = 0; j < count; j++) {
    const raw = 1 + (j * (span - 1)) / (count - 1)
    const day = Math.max(1, Math.min(span, Math.round(raw)))
    if (!seen.has(day)) {
      seen.add(day)
      result.push(day)
    }
  }
  return result
}

/** 形如「第 1·3·6·8·10 天」。 */
export function formatReviewDays(sessionDays: number[]): string {
  return `第 ${sessionDays.join('·')} 天`
}
