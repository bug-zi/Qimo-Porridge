/**
 * 术语匹配器：模块级单例注册表 + 文本包裹。
 *
 * FormulaText 的渲染函数是 ModuleView.tsx 的模块级纯函数，拿不到 React Context，
 * 因此术语表通过 setActiveGlossaryTerms 直接注册到本模块，Provider 在课程加载时调用。
 */
import type { ReactNode } from 'react'
import { cloneElement, createElement, isValidElement, type ReactElement } from 'react'
import type { GlossaryTerm } from '../types'
import GlossaryTermSpan from '../components/GlossaryTermSpan'

/** 单个正则分支上限：超过则只保留 core 词条，防止正则爆炸。 */
const MAX_PATTERN_BRANCHES = 2500

type GlossaryMatcher = {
  pattern: RegExp | null
  matchToTerm: Map<string, GlossaryTerm>
}

let matcher: GlossaryMatcher = { pattern: null, matchToTerm: new Map() }

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 含拉丁字母/数字的别名需要边界守卫，避免 "NPV" 命中 "NPVs"、误伤普通变量名。 */
function buildAliasBranch(alias: string) {
  return /[A-Za-z0-9]/.test(alias)
    ? `(?<![A-Za-z0-9])${escapeRegExp(alias)}(?![A-Za-z0-9])`
    : escapeRegExp(alias)
}

export function setActiveGlossaryTerms(terms: GlossaryTerm[]) {
  const active = terms.filter((term) => term.status === 'active')
  const aliasEntries: Array<{ alias: string; term: GlossaryTerm }> = []
  for (const term of active) {
    const aliases = new Set<string>([term.term, ...term.aliases])
    for (const alias of aliases) {
      const text = alias.trim()
      // 剔除过短的纯拉丁别名（单字母变量名误伤防护）
      if (!text) continue
      if (text.length < 2 && /^[A-Za-z]$/.test(text)) continue
      aliasEntries.push({ alias: text, term })
    }
  }
  // 分支超限时只保留 core 词条
  if (aliasEntries.length > MAX_PATTERN_BRANCHES) {
    const coreIds = new Set(active.filter((t) => t.importance === 'core').map((t) => t.id))
    const trimmed = aliasEntries.filter((entry) => coreIds.has(entry.term.id))
    if (trimmed.length) aliasEntries.splice(0, aliasEntries.length, ...trimmed)
  }
  if (!aliasEntries.length) {
    matcher = { pattern: null, matchToTerm: new Map() }
    return
  }
  // 最长匹配优先：长别名排前面
  aliasEntries.sort((a, b) => b.alias.length - a.alias.length)
  const branches: string[] = []
  const matchToTerm = new Map<string, GlossaryTerm>()
  const seenAliases = new Set<string>()
  for (const { alias, term } of aliasEntries) {
    const key = alias.toLowerCase()
    if (seenAliases.has(key)) continue
    seenAliases.add(key)
    branches.push(buildAliasBranch(alias))
    matchToTerm.set(alias, term)
  }
  matcher = {
    pattern: new RegExp(branches.join('|'), 'gu'),
    matchToTerm,
  }
}

export function clearGlossaryTerms() {
  matcher = { pattern: null, matchToTerm: new Map() }
}

/** 把纯文本切成 [普通文本, TermSpan, 普通文本, ...]；无注册或无命中返回 null（调用方零开销兜底）。 */
export function wrapTextWithTerms(text: string, keyPrefix: string): ReactNode[] | null {
  const { pattern, matchToTerm } = matcher
  if (!pattern || !text) return null
  pattern.lastIndex = 0
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let matched = false
  while ((match = pattern.exec(text))) {
    const matchedText = match[0]
    const term = matchToTerm.get(matchedText)
    if (!term) {
      // 零宽保护：极端情况下避免死循环
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1
      continue
    }
    matched = true
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    nodes.push(createElement(GlossaryTermSpan, { key: `${keyPrefix}-term-${match.index}`, term, matchedText }))
    lastIndex = match.index + matchedText.length
  }
  if (!matched) return null
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

const SKIP_ELEMENTS = new Set(['CODE', 'PRE', 'A', 'KBD', 'SCRIPT', 'STYLE'])

function isKatexNode(node: ReactNode): boolean {
  if (!node || typeof node !== 'object' || !('props' in node)) return false
  const props = (node as { props?: { className?: unknown } }).props
  const className = typeof props?.className === 'string' ? props.className : ''
  return /katex|formula/i.test(className)
}

/** 递归替换 ReactMarkdown 子树中的字符串节点为 TermSpan；跳过 code/a/katex。 */
export function wrapMarkdownChildren(children: ReactNode, keyPrefix = 'md'): ReactNode {
  if (typeof children === 'string') {
    return wrapTextWithTerms(children, keyPrefix) ?? children
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => wrapMarkdownChildren(child, `${keyPrefix}-${index}`))
  }
  if (children && typeof children === 'object' && 'type' in children) {
    if (!isValidElement(children)) return children
    if (typeof children.type === 'string' && SKIP_ELEMENTS.has(children.type)) return children
    if (isKatexNode(children)) return children
    const element = children as ReactElement<{ children?: unknown }>
    const childChildren = element.props.children
    if (childChildren === undefined || childChildren === null) return children
    const wrapped = wrapMarkdownChildren(childChildren as ReactNode, `${keyPrefix}-child`)
    if (wrapped === childChildren) return children
    return cloneElement(element, undefined, wrapped)
  }
  return children
}

function wrapContainerTag(tag: string) {
  function GlossaryContainer(props: { children?: ReactNode }) {
    return createElement(tag, props, wrapMarkdownChildren(props.children ?? null, `glossary-${tag}`))
  }
  return GlossaryContainer
}

/** ReactMarkdown components 覆写：p/li/td 三类正文容器接入术语包裹。
 *  缓存为模块级单例：组件身份稳定，下游 ReactMarkdown 重渲染时不会因 components 变化整树重挂载。
 *  术语匹配在渲染时动态读取模块级 matcher，缓存不影响词条更新后的重新包裹。 */
const cachedGlossaryComponents = {
  p: wrapContainerTag('p'),
  li: wrapContainerTag('li'),
  td: wrapContainerTag('td'),
}

export function glossaryMarkdownComponents() {
  return cachedGlossaryComponents
}
