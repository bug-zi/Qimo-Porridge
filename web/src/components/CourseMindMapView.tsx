import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileText,
  GitBranch,
  Layers3,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  LocateFixed,
  Maximize2,
  Minimize2,
  Network,
  RefreshCw,
  Route,
  Save,
  Sparkles,
  X,
} from 'lucide-react'
import type {
  Course,
  CourseMindMap,
  KnowledgePoint,
  MindMapEdge,
  MindMapNode,
  PlanTask,
  QuizQuestion,
  StudyExamPoint,
  StudyWorkedExample,
  WrongAnswer,
} from '../types'
import { generateCourseMindMap, getCourseMindMap, regroupCourseMindMapModules, saveCourseMindMap } from '../apiClient'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

// 知识地图浮卡里"错题"Tab 最多列出的错题条数，超出折叠避免浮卡过长。
const wrongAnswerPreviewLimit = 8
// 每个知识点节点在主画布上最多直接挂出的题目节点数：超出部分留在讲解卡片/刷题模块入口，
// 避免题目把金字塔树形撑散。其余题目仍可经讲解卡片"去刷本知识点 N 道题"到达（用全量计数）。
const questionPreviewPerNode = 5

type CourseMindMapViewProps = {
  course: Course
  onModuleChange: (module: 'materials' | 'plan' | 'practice' | 'mock' | 'errors' | 'overview') => void
  // 工作区数据用于在知识点节点浮卡里展开"讲解分析 / 典型例题 / 错题"。
  // 这些数据 ModuleView 已经加载，直接透传即可，避免知识地图另起请求。
  tasks: PlanTask[]
  knowledgePoints: KnowledgePoint[]
  practiceQuestions: QuizQuestion[]
  mockQuestions: QuizQuestion[]
  wrongAnswers: WrongAnswer[]
}

type MapFilter = 'structure' | 'weak' | 'important'

type MindMapFlowNodeData = {
  item: MindMapNode
  childCount: number
  relation: 'selected' | 'upstream' | 'downstream' | 'none'
  onToggleCollapse: (nodeId: string) => void
}

type MindMapFlowNode = Node<MindMapFlowNodeData, 'mindMapNode'>
type MindMapFlowEdge = Edge

const panSpeed = 480
const panAcceleration = 0.18
const panDamping = 0.85
const zoomSensitivity = 0.0018
const minZoom = 0.25
const maxZoom = 2.2
const zoomLerp = 0.22
// 自动保存指示器"已保存"的闪烁冷却时间：两次闪烁之间至少间隔 1 分钟，
// 避免每次拖动/缩放都把状态从"自动保存"切到"已保存"再切回来，造成频繁闪烁。
const savedFlashCooldownMs = 60_000
// 思维导图布局算法版本：升级布局逻辑后，旧版本号的已保存地图会被重新排版，
// 让所有用户（含历史地图）都享受到新布局，而不只是新生成的地图。
const mindMapLayoutVersion = 3

const structureNodeTypes = new Set<MindMapNode['type']>(['course', 'chapter', 'knowledge'])

function isStructureNode(node?: MindMapNode) {
  return Boolean(node && structureNodeTypes.has(node.type) && node.kind !== 'bucket')
}

// 画布节点 = 结构节点 + 题目节点。题目作为「课程-模块-知识点-题目」第 4 层在主画布显现；
// 任务/错题/资料仍只在浮卡与对应模块中可达，不进画布。
function isCanvasNode(node?: MindMapNode) {
  return node != null && (isStructureNode(node) || node.type === 'question')
}

// 画布边 = 两端均为画布节点的边。借助 isStructureNode 已排除收纳筐(bucket)章节，
// 挂在「复习任务」收纳筐下的无归属孤儿题目会因父节点非画布节点而被自动排除。
function isCanvasEdge(edge: CourseMindMap['edges'][number], nodeById: Map<string, MindMapNode>) {
  return isCanvasNode(nodeById.get(edge.source)) && isCanvasNode(nodeById.get(edge.target))
}

function getCanvasEdges(mindMap: CourseMindMap) {
  const nodeById = new Map(mindMap.nodes.map((node) => [node.id, node]))
  return mindMap.edges.filter((edge) => isCanvasEdge(edge, nodeById))
}

function moduleForNode(node: MindMapNode): CourseMindMapViewProps['onModuleChange'] extends (module: infer Module) => void ? Module : never {
  if (node.type === 'material') return 'materials'
  if (node.type === 'task') return 'plan'
  if (node.type === 'wrongAnswer') return 'errors'
  if (node.type === 'question') return node.status === '模拟卷' ? 'mock' : 'practice'
  return 'overview'
}

// 找到知识点节点归属的复习主线任务（按 knowledgePointId 精确匹配）。
// 与 ModuleView 的 findTaskKnowledgePoint 保持同一约定，确保两边定位到同一份 studyGuide。
function findOwningTask(node: MindMapNode, tasks: PlanTask[]): PlanTask | undefined {
  if (!node.knowledgePointId) return undefined
  return tasks.find((task) => task.knowledgePointId === node.knowledgePointId)
}

// 某知识点下的全部题目（练习 + 模拟），用于错题反查与"去刷题"入口。
function getKnowledgeQuestions(knowledgePointId: string | undefined, questions: QuizQuestion[]): QuizQuestion[] {
  if (!knowledgePointId) return []
  return questions.filter((question) => question.knowledgePointId === knowledgePointId)
}

// 错题通过 questionId 关联到题目、再由题目归属到知识点。
// 兼容 diagnostic- 前缀（与 ErrorsView.resolveQuestion 同一约定）。
function resolveWrongAnswerQuestionId(item: WrongAnswer): string | undefined {
  if (item.questionId) return item.questionId
  if (item.id.startsWith('diagnostic-')) return item.id.replace(/^diagnostic-/, '')
  return item.id
}

function getKnowledgeWrongAnswers(
  knowledgePointId: string | undefined,
  questions: QuizQuestion[],
  wrongAnswers: WrongAnswer[],
): WrongAnswer[] {
  const related = getKnowledgeQuestions(knowledgePointId, questions)
  if (!related.length) return []
  const ids = new Set(related.map((question) => question.id))
  return wrongAnswers.filter((item) => {
    const qid = resolveWrongAnswerQuestionId(item)
    return qid ? ids.has(qid) : false
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function movementKey(event: KeyboardEvent) {
  const code = event.code.toLowerCase()
  if (code === 'keyw') return 'w'
  if (code === 'keya') return 'a'
  if (code === 'keys') return 's'
  if (code === 'keyd') return 'd'
  const key = event.key.toLowerCase().trim()
  return ['w', 'a', 's', 'd'].includes(key) ? key : ''
}

function nodeSize(node: MindMapNode) {
  if (node.type === 'course') return { width: 232, height: 70 }
  if (node.type === 'chapter') return { width: 212, height: 68 }
  if (node.type === 'knowledge') return { width: 202, height: 78 }
  if (node.type === 'question') return { width: 196, height: 60 }
  return { width: 198, height: 66 }
}

function buildEdgeIndexes(edges: CourseMindMap['edges']) {
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const edge of edges) {
    const sourceTargets = outgoing.get(edge.source) ?? []
    sourceTargets.push(edge.target)
    outgoing.set(edge.source, sourceTargets)
    const targetSources = incoming.get(edge.target) ?? []
    targetSources.push(edge.source)
    incoming.set(edge.target, targetSources)
  }
  return { outgoing, incoming }
}

function collectReachable(startId: string, index: Map<string, string[]>) {
  const visited = new Set<string>()
  const pending = [...(index.get(startId) ?? [])]
  while (pending.length) {
    const nextId = pending.pop()
    if (!nextId || visited.has(nextId)) continue
    visited.add(nextId)
    pending.push(...(index.get(nextId) ?? []))
  }
  return visited
}

function childCountByNode(edges: CourseMindMap['edges']) {
  const counts = new Map<string, number>()
  for (const edge of edges) {
    // 前置依赖边不算子节点数，避免知识点徽标把"被依赖"误计为展开子项。
    if (isPrerequisiteEdge(edge)) continue
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1)
  }
  return counts
}

function relationStateForNode(nodeId: string, selectedNodeId: string | null, upstream: Set<string>, downstream: Set<string>) {
  if (!selectedNodeId) return 'none'
  if (nodeId === selectedNodeId) return 'selected'
  if (upstream.has(nodeId)) return 'upstream'
  if (downstream.has(nodeId)) return 'downstream'
  return 'none'
}

function toFlowNodes(
  mindMap: CourseMindMap,
  options: {
    selectedNodeId?: string | null
    upstream?: Set<string>
    downstream?: Set<string>
    childEdges?: CourseMindMap['edges']
    onToggleCollapse?: (nodeId: string) => void
  } = {},
): MindMapFlowNode[] {
  const counts = childCountByNode(options.childEdges ?? mindMap.edges)
  const upstream = options.upstream ?? new Set<string>()
  const downstream = options.downstream ?? new Set<string>()
  return mindMap.nodes.map((node, index) => {
    const size = nodeSize(node)
    return {
      id: node.id,
      type: 'mindMapNode',
      position: node.position ?? { x: Math.floor(index / 8) * 280, y: (index % 8) * 122 },
      data: {
        item: node,
        childCount: counts.get(node.id) ?? 0,
        relation: relationStateForNode(node.id, options.selectedNodeId ?? null, upstream, downstream),
        onToggleCollapse: options.onToggleCollapse ?? (() => undefined),
      },
      width: size.width,
      height: size.height,
    }
  })
}

function isPrerequisiteEdge(edge: MindMapEdge): boolean {
  return edge.label === '前置'
}

function relationClassName(label = '') {
  return `is-${label === '错题' ? 'wrong' : label === '资料' ? 'material' : label === '任务' ? 'task' : label === '题目' ? 'question' : label === '知识点' ? 'knowledge' : label === '前置' ? 'prerequisite' : 'structure'}`
}

function relationColor(label = '') {
  if (label === '知识点') return 'var(--primary)'
  if (label === '任务') return 'var(--violet)'
  if (label === '题目') return 'var(--peach)'
  if (label === '资料') return 'var(--mint)'
  if (label === '错题') return 'var(--primary-strong)'
  if (label === '前置') return 'var(--accent-strong, var(--peach))'
  return 'var(--text-soft)'
}

function toFlowEdges(mindMap: CourseMindMap, selectedNodeId: string | null = null): MindMapFlowEdge[] {
  return mindMap.edges.map((edge) => {
    // 连线上的"模块/知识点/任务…"文字标识去掉，仅保留按关系类型上色。
    const color = relationColor(edge.label)
    // 前置依赖边用虚线叠加绘制，与结构包含边（实线）区分。
    const isPrereq = isPrerequisiteEdge(edge)
    return {
      ...edge,
      label: undefined,
      type: 'smoothstep',
      animated: Boolean(selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId)),
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, ...(isPrereq ? { strokeDasharray: '6 4' } : {}) },
      className: `mind-map-edge ${relationClassName(edge.label)} ${selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId) ? 'is-active' : ''}`,
    }
  })
}

function updateMapPositions(mindMap: CourseMindMap, nodes: MindMapFlowNode[], viewport?: Viewport): CourseMindMap {
  const positionById = new Map(nodes.map((node) => [node.id, node.position]))
  return {
    ...mindMap,
    viewport: viewport ?? mindMap.viewport,
    nodes: mindMap.nodes.map((node) => ({
      ...node,
      position: positionById.get(node.id) ?? node.position,
    })),
  }
}

async function layoutMap(mindMap: CourseMindMap): Promise<CourseMindMap> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()
  // 对画布节点（课程/模块/知识点 + 题目）做布局；收纳筐章节与 任务/错题/资料 仍排除在外。
  // 题目作为知识点的第 4 层参与排版，由 questionPreviewPerNode 在 filterMap 侧限量，
  // 避免单个知识点题目过多把金字塔树形撑散。
  const layoutNodes = mindMap.nodes.filter(isCanvasNode)
  // 前置依赖边（知识点→知识点）不参与 elk 布局：跨模块前置会让 layered 布局成环、
  // 把知识点推到错误层级；保持树形稳定，前置边在布局完成后叠加绘制。
  const layoutEdges = getCanvasEdges(mindMap).filter((edge) => !isPrerequisiteEdge(edge))
  const graph = {
    id: 'mind-map-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      // 紧凑：同一列节点（兄弟/堂兄弟）的纵向间距，列与列之间的横向间距。
      'elk.spacing.nodeNode': '30',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      // NETWORK_SIMPLEX 让子树围绕父节点居中排布，呈现清晰的金字塔树形。
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.thoroughness': '8',
      'elk.padding': '[left=26, top=26, right=26, bottom=26]',
    },
    children: layoutNodes.map((node) => ({
      id: node.id,
      ...nodeSize(node),
    })),
    edges: layoutEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }
  const layout = await elk.layout(graph)
  const positionById = new Map((layout.children ?? []).map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
  return {
    ...mindMap,
    layouted: true,
    layoutVersion: mindMapLayoutVersion,
    // 重排后节点包围盒已变，清掉旧的保存视口，让画布 mount 时重新 fitView 框住新布局。
    viewport: undefined,
    nodes: mindMap.nodes.map((node) => ({
      ...node,
      position: positionById.get(node.id) ?? node.position,
    })),
  }
}

// 仅在地图未经 ELK 布局（后端给的网格坐标会让模块与子知识点垂直错位）时跑一次，
// 布局结果带 layouted 标记并随自动保存持久化，避免下次覆盖用户已拖拽的位置。
async function ensureLayouted(mindMap: CourseMindMap): Promise<CourseMindMap> {
  // 已用当前版本布局过才跳过；升级布局逻辑（如改为只排结构节点）后，旧版本号的地图会自动重新排版。
  if (mindMap.layouted && mindMap.layoutVersion === mindMapLayoutVersion) return mindMap
  try {
    return await layoutMap(mindMap)
  } catch {
    return mindMap
  }
}

function isStructureEdge(edge: CourseMindMap['edges'][number], nodeById: Map<string, MindMapNode>) {
  return isStructureNode(nodeById.get(edge.source)) && isStructureNode(nodeById.get(edge.target))
}

function getStructureEdges(mindMap: CourseMindMap) {
  const nodeById = new Map(mindMap.nodes.map((node) => [node.id, node]))
  return mindMap.edges.filter((edge) => isStructureEdge(edge, nodeById))
}

function shouldShowNode(node: MindMapNode, filter: MapFilter) {
  if (!isStructureNode(node)) return false
  if (filter === 'structure') return true
  if (node.type === 'course' || node.type === 'chapter') return false
  if (filter === 'weak') return (node.mastery ?? 100) < 70
  return (node.weight ?? 0) >= 30
}

function filterMap(mindMap: CourseMindMap, filter: MapFilter) {
  const canvasEdges = getCanvasEdges(mindMap)
  const { incoming, outgoing } = buildEdgeIndexes(canvasEdges)
  const nodeById = new Map(mindMap.nodes.map((node) => [node.id, node]))
  const collapsedIds = new Set(mindMap.nodes.filter((node) => node.collapsed).map((node) => node.id))
  const matchedIds = new Set(
    mindMap.nodes
      .filter((node) => (filter === 'structure' ? isStructureNode(node) : shouldShowNode(node, filter)))
      .map((node) => node.id),
  )
  const visibleIds = new Set<string>()
  if (filter === 'structure') {
    for (const node of mindMap.nodes) {
      if (isStructureNode(node)) visibleIds.add(node.id)
    }
  } else {
    for (const id of matchedIds) {
      visibleIds.add(id)
      for (const ancestorId of collectReachable(id, incoming)) {
        visibleIds.add(ancestorId)
      }
    }
  }
  // 第 4 层题目：每个可见知识点最多挂出 questionPreviewPerNode 道题（按画布边顺序取前 N）。
  // 对所有筛选模式统一生效——结构视图呈现完整四级层级，薄弱/核心视图只给可见知识点挂题。
  for (const node of mindMap.nodes) {
    if (!visibleIds.has(node.id) || node.type !== 'knowledge') continue
    const questionChildren = (outgoing.get(node.id) ?? [])
      .map((childId) => nodeById.get(childId))
      .filter((child): child is MindMapNode => child != null && child.type === 'question')
      .slice(0, questionPreviewPerNode)
    for (const question of questionChildren) visibleIds.add(question.id)
  }
  const hiddenIds = new Set<string>()
  for (const id of collapsedIds) {
    if (!visibleIds.has(id)) continue
    for (const descendantId of collectReachable(id, outgoing)) {
      hiddenIds.add(descendantId)
    }
  }
  for (const id of hiddenIds) visibleIds.delete(id)
  return {
    ...mindMap,
    nodes: mindMap.nodes.filter((node) => visibleIds.has(node.id)),
    edges: canvasEdges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  }
}

// 按画布边计算每个节点相对课程根的层级深度（BFS 最短路径）。
// 课程=0、模块=1、知识点=2、题目=3。
function computeNodeDepths(mindMap: CourseMindMap): Map<string, number> {
  const canvasEdges = getCanvasEdges(mindMap)
  const { incoming, outgoing } = buildEdgeIndexes(canvasEdges)
  const depths = new Map<string, number>()
  const queue: Array<{ id: string; depth: number }> = []
  for (const node of mindMap.nodes) {
    if ((incoming.get(node.id)?.length ?? 0) === 0) queue.push({ id: node.id, depth: 0 })
  }
  while (queue.length) {
    const { id, depth } = queue.shift()!
    if (depths.has(id)) continue
    depths.set(id, depth)
    for (const childId of outgoing.get(id) ?? []) {
      if (!depths.has(childId)) queue.push({ id: childId, depth: depth + 1 })
    }
  }
  return depths
}

// 按目标层级批量设置收起：深度 >= level 的节点收起（其子树隐藏），其余展开。
// 0=只看课程, 1=到模块, 2=到知识点, 99=全部展开。
function applyExpansionLevel(mindMap: CourseMindMap, level: number): CourseMindMap {
  const depths = computeNodeDepths(mindMap)
  return {
    ...mindMap,
    nodes: mindMap.nodes.map((node) => ({
      ...node,
      collapsed: (depths.get(node.id) ?? 0) >= level,
    })),
  }
}

// 反推当前展开到第几层，用于高亮层级控件。
function detectExpansionLevel(mindMap: CourseMindMap): number {
  const depths = computeNodeDepths(mindMap)
  let collapsedAt0 = false
  let collapsedAt1 = false
  let collapsedAt2 = false
  for (const node of mindMap.nodes) {
    if (!node.collapsed) continue
    const depth = depths.get(node.id) ?? 0
    if (depth === 0) collapsedAt0 = true
    else if (depth === 1) collapsedAt1 = true
    else if (depth === 2) collapsedAt2 = true
  }
  if (collapsedAt0) return 0
  if (collapsedAt1) return 1
  if (collapsedAt2) return 2
  return 99
}

function MindMapNodeCard({ data }: NodeProps<MindMapFlowNode>) {
  const node = data.item
  const hasChildren = data.childCount > 0
  return (
    <div className={`mind-map-node is-${node.type} is-relation-${data.relation} is-kind-${node.kind || 'plain'} ${node.collapsed ? 'is-collapsed-node' : ''}`}>
      <Handle className="mind-map-handle" type="target" position={Position.Left} />
      {hasChildren && (
        <div className="mind-map-node-topline">
          <button
            className="mind-map-node-collapse"
            type="button"
            aria-label={node.collapsed ? `展开${node.title}` : `收起${node.title}`}
            title={node.collapsed ? '展开子节点' : '收起子节点'}
            onClick={(event) => {
              event.stopPropagation()
              data.onToggleCollapse(node.id)
            }}
          >
            {node.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      )}
      {node.type === 'question' && node.status && (
        <em className="mind-map-node-tag">{node.status}</em>
      )}
      <strong>{node.title}</strong>
      <Handle className="mind-map-handle" type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { mindMapNode: MindMapNodeCard }

function MindMapCanvas({
  course,
  mindMap,
  selectedNodeId,
  filter,
  isFullscreen,
  onMindMapChange,
  onSelectedNodeChange,
  onModuleChange,
  onSaveStateChange,
  tasks,
  knowledgePoints,
  practiceQuestions,
  mockQuestions,
  wrongAnswers,
}: {
  course: Course
  mindMap: CourseMindMap
  selectedNodeId: string | null
  filter: MapFilter
  isFullscreen: boolean
  onMindMapChange: (mindMap: CourseMindMap) => void
  onSelectedNodeChange: (nodeId: string | null) => void
  onModuleChange: CourseMindMapViewProps['onModuleChange']
  onSaveStateChange: (state: 'idle' | 'saving' | 'saved' | 'error') => void
  tasks: PlanTask[]
  knowledgePoints: KnowledgePoint[]
  practiceQuestions: QuizQuestion[]
  mockQuestions: QuizQuestion[]
  wrongAnswers: WrongAnswer[]
}) {
  const visibleMap = useMemo(() => filterMap(mindMap, filter), [filter, mindMap])
  const selectedNode = useMemo(
    () => (selectedNodeId ? visibleMap.nodes.find((node) => node.id === selectedNodeId) ?? null : null),
    [selectedNodeId, visibleMap.nodes],
  )
  const canvasEdges = useMemo(() => getCanvasEdges(mindMap), [mindMap])
  const [nodes, setNodes, onNodesChange] = useNodesState<MindMapFlowNode>(
    toFlowNodes(visibleMap, { childEdges: canvasEdges }),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<MindMapFlowEdge>(toFlowEdges(visibleMap))
  const { fitView, getViewport, setViewport } = useReactFlow<MindMapFlowNode, MindMapFlowEdge>()
  const viewportRef = useRef<Viewport>(mindMap.viewport ?? { x: 72, y: 120, zoom: 0.88 })
  const zoomTargetRef = useRef<Viewport | null>(null)
  const velocityRef = useRef({ x: 0, y: 0 })
  const keysRef = useRef(new Set<string>())
  const frameRef = useRef<number | null>(null)
  const previousTimeRef = useRef<number | null>(null)
  // 平移/缩放动画与按键监听只读 ref 里的回调，组件每次重渲染时同步更新。
  // 这样选中节点、自动保存、视口变化触发的 re-render 既不会取消正在运行的动画，
  // 也不会因 useCallback 闭包过期而出现 WASD 按键无响应的卡死。
  const setViewportRef = useRef(setViewport)
  const getViewportRef = useRef(getViewport)
  const scheduleSaveRef = useRef<(nextMap: CourseMindMap, delay?: number) => void>(() => undefined)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const mindMapRef = useRef(mindMap)
  const nodesRef = useRef(nodes)
  const saveTimerRef = useRef<number | null>(null)
  const pendingSaveRef = useRef<CourseMindMap | null>(null)
  const isSavingRef = useRef(false)
  const saveStateTimerRef = useRef<number | null>(null)
  const selectedRelation = useMemo(() => {
    if (!selectedNodeId) return { upstream: new Set<string>(), downstream: new Set<string>() }
    const { incoming, outgoing } = buildEdgeIndexes(canvasEdges)
    return {
      upstream: collectReachable(selectedNodeId, incoming),
      downstream: collectReachable(selectedNodeId, outgoing),
    }
  }, [selectedNodeId, canvasEdges])

  const activeLevel = useMemo(() => detectExpansionLevel(mindMap), [mindMap])

  useEffect(() => {
    mindMapRef.current = mindMap
  }, [mindMap])

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const flushPendingSave = useCallback(async () => {
    if (isSavingRef.current) return
    const nextMap = pendingSaveRef.current
    if (!nextMap) return
    pendingSaveRef.current = null
    isSavingRef.current = true
    onSaveStateChange('saving')
    try {
      await saveCourseMindMap(course.id, nextMap)
      onSaveStateChange('saved')
      if (saveStateTimerRef.current !== null) window.clearTimeout(saveStateTimerRef.current)
      saveStateTimerRef.current = window.setTimeout(() => onSaveStateChange('idle'), 1200)
    } catch {
      onSaveStateChange('error')
    } finally {
      isSavingRef.current = false
      if (pendingSaveRef.current) {
        void flushPendingSave()
      }
    }
  }, [course.id, onSaveStateChange])

  const scheduleSave = useCallback((nextMap: CourseMindMap, delay = 650) => {
    pendingSaveRef.current = nextMap
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushPendingSave()
    }, delay)
  }, [flushPendingSave])

  // 把随渲染变化的回调同步进 ref，供 rAF 循环与按键监听读取
  useEffect(() => {
    setViewportRef.current = setViewport
    getViewportRef.current = getViewport
  }, [setViewport, getViewport])

  useEffect(() => {
    scheduleSaveRef.current = scheduleSave
  }, [scheduleSave])

  const handleToggleCollapse = useCallback((nodeId: string) => {
    const nextMap = {
      ...mindMapRef.current,
      nodes: mindMapRef.current.nodes.map((node) => (
        node.id === nodeId ? { ...node, collapsed: !node.collapsed } : node
      )),
    }
    mindMapRef.current = nextMap
    onMindMapChange(nextMap)
    scheduleSave(nextMap, 250)
  }, [onMindMapChange, scheduleSave])

  useEffect(() => {
    const visibleMindMap = { ...mindMap, nodes: visibleMap.nodes, edges: visibleMap.edges }
    const nextNodes = toFlowNodes(visibleMindMap, {
      selectedNodeId,
      upstream: selectedRelation.upstream,
      downstream: selectedRelation.downstream,
      childEdges: canvasEdges,
      onToggleCollapse: handleToggleCollapse,
    })
    const nextEdges = toFlowEdges(visibleMindMap, selectedNodeId)
    setNodes(nextNodes)
    setEdges(nextEdges)
    if (mindMap.viewport) {
      viewportRef.current = mindMap.viewport
      void setViewport(mindMap.viewport)
    }
  }, [handleToggleCollapse, mindMap, selectedNodeId, selectedRelation.downstream, selectedRelation.upstream, setEdges, setNodes, setViewport, canvasEdges, visibleMap])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (saveStateTimerRef.current !== null) window.clearTimeout(saveStateTimerRef.current)
  }, [])

  // 进入/退出全屏时画布尺寸变化，等布局稳定后重新 fitView 框住整张图。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.18, duration: 260 })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [fitView, isFullscreen])

  const tick = useCallback((timestamp: number) => {
    const previousTime = previousTimeRef.current ?? timestamp
    const dt = Math.min(0.032, (timestamp - previousTime) / 1000)
    previousTimeRef.current = timestamp

    const keys = keysRef.current
    let dirX = 0
    let dirY = 0
    // 视口 x/y 增大 = 内容向右/下平移 = 视角向左/上移动，因此 W↑/S↓/A←/D→ 对应 +y/-y/+x/-x
    if (keys.has('w')) dirY += 1
    if (keys.has('s')) dirY -= 1
    if (keys.has('a')) dirX += 1
    if (keys.has('d')) dirX -= 1
    if (dirX && dirY) {
      dirX *= Math.SQRT1_2
      dirY *= Math.SQRT1_2
    }

    const velocity = velocityRef.current
    if (dirX && velocity.x && Math.sign(dirX) !== Math.sign(velocity.x)) velocity.x *= 0.25
    if (dirY && velocity.y && Math.sign(dirY) !== Math.sign(velocity.y)) velocity.y *= 0.25
    velocity.x = velocity.x * panDamping + dirX * panSpeed * panAcceleration
    velocity.y = velocity.y * panDamping + dirY * panSpeed * panAcceleration

    // 每帧从 ReactFlow 读取真实视口作为基准：fitView、程序化 setViewport、用户拖拽
    // 改变的都是 ReactFlow 内部视口。若仍用手维护的 viewportRef 做基准，方向键平移会基于
    // 旧坐标，导致缩放或切换视图后画面“跳回”、按了不动等卡顿。
    const base = getViewportRef.current()
    let nextX = base.x
    let nextY = base.y
    let nextZoom = base.zoom

    const zoomTarget = zoomTargetRef.current
    if (zoomTarget) {
      nextX += (zoomTarget.x - nextX) * zoomLerp
      nextY += (zoomTarget.y - nextY) * zoomLerp
      nextZoom += (zoomTarget.zoom - nextZoom) * zoomLerp
      if (Math.abs(nextZoom - zoomTarget.zoom) < 0.003) {
        nextX = zoomTarget.x
        nextY = zoomTarget.y
        nextZoom = zoomTarget.zoom
        zoomTargetRef.current = null
      }
    }

    // 方向键平移叠加在缩放之后，并同步平移缩放锚点，保证缩放进行中也能平移，
    // 而不是被缩放 lerp 抵消掉（放大后立刻按 WASD 不动的来源）。
    const moving = Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1
    if (moving) {
      nextX += velocity.x * dt
      nextY += velocity.y * dt
      const activeZoomTarget = zoomTargetRef.current
      if (activeZoomTarget) {
        activeZoomTarget.x += velocity.x * dt
        activeZoomTarget.y += velocity.y * dt
      }
    }

    setViewportRef.current({ x: nextX, y: nextY, zoom: nextZoom })

    const shouldContinue = keys.size > 0 || moving || zoomTargetRef.current !== null
    if (shouldContinue) {
      frameRef.current = window.requestAnimationFrame(tick)
    } else {
      frameRef.current = null
      previousTimeRef.current = null
    }
    // tick 仅读写 ref、无外部依赖，因此永不重建 —— rAF 循环自驱动运行，
    // 不会被组件 re-render 打断，也不会持有过期的 setViewport 闭包。
  }, [])

  const ensureAnimation = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(tick)
    }
  }, [tick])

  const handleMovementKeyDown = useCallback((event: KeyboardEvent) => {
    if (isEditableTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return
    const key = movementKey(event)
    if (!key) return
    event.preventDefault()
    event.stopPropagation()
    if (key === 'a') keysRef.current.delete('d')
    if (key === 'd') keysRef.current.delete('a')
    if (key === 'w') keysRef.current.delete('s')
    if (key === 's') keysRef.current.delete('w')
    keysRef.current.add(key)
    if (key === 'a') velocityRef.current.x = Math.max(velocityRef.current.x, panSpeed * 0.14)
    if (key === 'd') velocityRef.current.x = Math.min(velocityRef.current.x, -panSpeed * 0.14)
    if (key === 'w') velocityRef.current.y = Math.max(velocityRef.current.y, panSpeed * 0.14)
    if (key === 's') velocityRef.current.y = Math.min(velocityRef.current.y, -panSpeed * 0.14)
    ensureAnimation()
  }, [ensureAnimation])

  const handleMovementKeyUp = useCallback((event: KeyboardEvent) => {
    const key = movementKey(event)
    if (!key) return
    event.preventDefault()
    event.stopPropagation()
    keysRef.current.delete(key)
    if (keysRef.current.size === 0) {
      scheduleSaveRef.current({ ...mindMapRef.current, viewport: getViewportRef.current() }, 900)
    }
    ensureAnimation()
  }, [ensureAnimation])

  useEffect(() => {
    function clearKeys() {
      keysRef.current.clear()
    }

    // 在 window 捕获阶段监听，确保 WASD 早于 ReactFlow 及任何子节点的按键处理，
    // 避免 D 等按键被画布内部拦截而失灵。
    window.addEventListener('keydown', handleMovementKeyDown, true)
    window.addEventListener('keyup', handleMovementKeyUp, true)
    window.addEventListener('blur', clearKeys)
    // 关键：这里绝不能 cancelAnimationFrame。监听器会因回调引用变化而重绑定，
    // 若在重绑定时取消正在运行的 rAF，用户按住 WASD 平移会突然卡死。动画循环
    // 由 tick 自驱动（无键且速度衰减完后自行停止），仅在组件真正卸载时才收尾。
    return () => {
      window.removeEventListener('keydown', handleMovementKeyDown, true)
      window.removeEventListener('keyup', handleMovementKeyUp, true)
      window.removeEventListener('blur', clearKeys)
    }
  }, [handleMovementKeyDown, handleMovementKeyUp])

  // 仅在组件卸载时停止动画循环，避免 re-render 期间的误取消
  useEffect(() => () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target)) return
    event.preventDefault()
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const current = zoomTargetRef.current ?? getViewportRef.current()
    const nextZoom = clamp(current.zoom * Math.exp(-event.deltaY * zoomSensitivity), minZoom, maxZoom)
    const ratio = nextZoom / current.zoom
    zoomTargetRef.current = {
      x: anchor.x - (anchor.x - current.x) * ratio,
      y: anchor.y - (anchor.y - current.y) * ratio,
      zoom: nextZoom,
    }
    ensureAnimation()
  }

  // 直接用已知的节点坐标 + 尺寸算包围盒并居中设置视口，不依赖 ReactFlow 的 DOM 尺寸测量。
  // 层级切换会让可见节点数量骤变（几十个 → 1 个），节点测量滞后于渲染帧时 fitView 会拿到
  // 错乱/缺失的包围盒，把视口定位到空白处，用户看到一片空、得手动拖回内容。
  function fitToVisibleNodes(sourceNodes: CourseMindMap['nodes']) {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    const placed = sourceNodes.filter(
      (node): node is MindMapNode & { position: { x: number; y: number } } => Boolean(node.position),
    )
    if (placed.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of placed) {
      const { width, height } = nodeSize(node)
      const nodeX = node.position.x
      const nodeY = node.position.y
      if (nodeX < minX) minX = nodeX
      if (nodeY < minY) minY = nodeY
      if (nodeX + width > maxX) maxX = nodeX + width
      if (nodeY + height > maxY) maxY = nodeY + height
    }
    const bboxW = maxX - minX
    const bboxH = maxY - minY
    if (bboxW <= 0 || bboxH <= 0) return
    const padding = 0.2
    const zoom = clamp(
      Math.min((rect.width * (1 - padding)) / bboxW, (rect.height * (1 - padding)) / bboxH),
      minZoom,
      maxZoom,
    )
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    // ReactFlow 视口变换：screenX = flowX * zoom + viewport.x
    // 让包围盒中心落到容器中心：viewport.x = rect.width / 2 - centerX * zoom
    setViewportRef.current({
      x: rect.width / 2 - centerX * zoom,
      y: rect.height / 2 - centerY * zoom,
      zoom,
    })
  }

  async function applyAutoLayout(transform?: (source: CourseMindMap) => CourseMindMap) {
    onSaveStateChange('saving')
    try {
      const baseMap = transform ? transform(mindMapRef.current) : mindMapRef.current
      const visibleForLayout = filterMap(baseMap, filter)
      const nextVisibleMap = await layoutMap(visibleForLayout)
      const positionById = new Map(nextVisibleMap.nodes.map((node) => [node.id, node.position]))
      const nextMap = {
        ...baseMap,
        // 重排后节点包围盒已变，旧的保存视口不再对应任何内容，清掉它，
        // 改由 fitToVisibleNodes 按新布局把视口对准内容，避免被旧视口带偏。
        viewport: undefined,
        nodes: baseMap.nodes.map((node) => ({
          ...node,
          position: positionById.get(node.id) ?? node.position,
        })),
      }
      mindMapRef.current = nextMap
      onMindMapChange(nextMap)
      setNodes(toFlowNodes(nextVisibleMap, { selectedNodeId, childEdges: canvasEdges, onToggleCollapse: handleToggleCollapse }))
      setEdges(toFlowEdges(nextVisibleMap, selectedNodeId))
      scheduleSave(nextMap, 0)
      window.requestAnimationFrame(() => fitToVisibleNodes(nextVisibleMap.nodes))
    } catch {
      onSaveStateChange('error')
    }
  }

  function handleSetExpansionLevel(level: number) {
    void applyAutoLayout((source) => applyExpansionLevel(source, level))
  }

  function handleMoveEnd(_: MouseEvent | TouchEvent | null, viewport: Viewport) {
    viewportRef.current = viewport
    scheduleSave({ ...mindMapRef.current, viewport }, 900)
  }

  function handleNodeDragStop() {
    const viewport = getViewport()
    const nextMap = updateMapPositions(mindMapRef.current, nodesRef.current, viewport)
    mindMapRef.current = nextMap
    onMindMapChange(nextMap)
    scheduleSave(nextMap, 300)
  }

  return (
    <div
      className="mind-map-canvas-wrap"
      ref={wrapperRef}
      tabIndex={0}
      onPointerDown={(event) => {
        if (!isEditableTarget(event.target)) event.currentTarget.focus({ preventScroll: true })
      }}
      onWheel={handleWheel}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        onlyRenderVisibleElements
        selectNodesOnDrag={false}
        minZoom={minZoom}
        maxZoom={maxZoom}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch
        fitView
        fitViewOptions={{ padding: 0.18 }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelectedNodeChange(node.id)}
        onNodeDragStop={handleNodeDragStop}
        onMove={(_, viewport) => { viewportRef.current = viewport }}
        onMoveEnd={handleMoveEnd}
        proOptions={{ hideAttribution: true }}
        className="mind-map-flow"
      >
        <Background color="rgba(168, 129, 143, 0.22)" gap={24} />
        <MiniMap pannable zoomable nodeBorderRadius={6} className="mind-map-minimap" />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>
      <div className="mind-map-floating-toolbar">
        <button className="secondary-button" type="button" onClick={() => fitView({ padding: 0.18, duration: 320 })}>
          <LocateFixed size={15} /> 适应视图
        </button>
        <button className="secondary-button" type="button" onClick={() => void applyAutoLayout()}>
          <GitBranch size={15} /> 自动整理
        </button>
      </div>
      <div className="mind-map-level-control" role="group" aria-label="展开层级">
        <span className="mind-map-level-control-label">层级</span>
        {([
          [0, '课程'],
          [1, '模块'],
          [2, '知识点'],
          [99, '全部'],
        ] as const).map(([level, label]) => (
          <button
            key={level}
            type="button"
            className={activeLevel === level ? 'is-active' : ''}
            onClick={() => handleSetExpansionLevel(level)}
            title={`展开到${label}层级`}
          >
            {label}
          </button>
        ))}
      </div>
      {selectedNode && (
        <MindMapInspector
          node={selectedNode}
          mindMap={mindMap}
          onModuleChange={onModuleChange}
          onSelectedNodeChange={onSelectedNodeChange}
          onClose={() => onSelectedNodeChange(null)}
          tasks={tasks}
          knowledgePoints={knowledgePoints}
          practiceQuestions={practiceQuestions}
          mockQuestions={mockQuestions}
          wrongAnswers={wrongAnswers}
        />
      )}
      {selectedNodeId && <span className="mind-map-selection-pulse" />}
    </div>
  )
}

function MindMapInspector({
  node,
  mindMap,
  onModuleChange,
  onSelectedNodeChange,
  onClose,
  tasks,
  knowledgePoints,
  practiceQuestions,
  mockQuestions,
  wrongAnswers,
}: {
  node: MindMapNode
  mindMap: CourseMindMap
  onModuleChange: CourseMindMapViewProps['onModuleChange']
  onSelectedNodeChange: (nodeId: string) => void
  onClose: () => void
  tasks: PlanTask[]
  knowledgePoints: KnowledgePoint[]
  practiceQuestions: QuizQuestion[]
  mockQuestions: QuizQuestion[]
  wrongAnswers: WrongAnswer[]
}) {
  function openLinkedModule() {
    onModuleChange(moduleForNode(node))
  }

  const structureEdges = getStructureEdges(mindMap)
  // 上级/下级只统计结构包含边；前置依赖边（知识点→知识点）拆成独立"前置知识点"区。
  const structureTreeEdges = structureEdges.filter((edge) => !isPrerequisiteEdge(edge))
  const upstreamNodes = structureTreeEdges
    .filter((edge) => edge.target === node.id)
    .map((edge) => mindMap.nodes.find((item) => item.id === edge.source))
    .filter((item): item is MindMapNode => Boolean(item))
  const downstreamNodes = structureTreeEdges
    .filter((edge) => edge.source === node.id)
    .map((edge) => mindMap.nodes.find((item) => item.id === edge.target))
    .filter((item): item is MindMapNode => Boolean(item))
  const prerequisiteNodes = structureEdges
    .filter((edge) => isPrerequisiteEdge(edge) && edge.target === node.id)
    .map((edge) => mindMap.nodes.find((item) => item.id === edge.source))
    .filter((item): item is MindMapNode => Boolean(item))
  const dependentNodes = structureEdges
    .filter((edge) => isPrerequisiteEdge(edge) && edge.source === node.id)
    .map((edge) => mindMap.nodes.find((item) => item.id === edge.target))
    .filter((item): item is MindMapNode => Boolean(item))
  const mastery = typeof node.mastery === 'number' ? clamp(node.mastery, 0, 100) : null
  const isKnowledge = node.type === 'knowledge'

  const knowledgePoint = isKnowledge
    ? knowledgePoints.find((point) => point.id === node.knowledgePointId)
    : undefined
  const owningTask = isKnowledge ? findOwningTask(node, tasks) : undefined
  const allQuestions = useMemo(() => [...practiceQuestions, ...mockQuestions], [practiceQuestions, mockQuestions])
  const relatedQuestions = isKnowledge ? getKnowledgeQuestions(node.knowledgePointId, allQuestions) : []
  const relatedWrong = isKnowledge ? getKnowledgeWrongAnswers(node.knowledgePointId, allQuestions, wrongAnswers) : []

  return (
    // 浮卡是独立滚动容器（.mind-map-popover 有 overflow:auto）。这里拦截滚轮冒泡，
    // 阻止事件传到外层 .mind-map-canvas-wrap 的 handleWheel——否则滚轮会被劫持成画布缩放，
    // 既无法滚动浮卡内容、又误改画布。stopPropagation 后浏览器走默认行为滚动浮卡。
    <aside
      className={`mind-map-popover${isKnowledge ? ' is-detail' : ''}`}
      onWheel={(event) => event.stopPropagation()}
    >
      <button className="mind-map-popover-close" type="button" aria-label="关闭详情" onClick={onClose}>
        <X size={14} />
      </button>
      {/* 滚动正文区：只有这一段随滚轮滚动；底栏(footer)在它之外，故按钮永远钉底可见。 */}
      <div className="mind-map-popover-body">
      <header className="mind-map-popover-header">
        <h2>{node.title}</h2>
        {isKnowledge && (
          <div className="mind-map-popover-badges">
            {mastery !== null && (
              <span className={`mind-map-badge is-mastery${mastery < 70 ? ' is-weak' : ''}`}>掌握 {mastery}%</span>
            )}
            {typeof node.weight === 'number' && <span className="mind-map-badge">权重 {node.weight}</span>}
            {node.status && <span className="mind-map-badge">{node.status}</span>}
          </div>
        )}
      </header>

      {isKnowledge ? (
        <KnowledgeDetailPanel
          node={node}
          knowledgePoint={knowledgePoint}
          owningTask={owningTask}
          questions={relatedQuestions}
          wrongAnswers={relatedWrong}
          onModuleChange={onModuleChange}
        />
      ) : (
        <>
          {node.summary && <p>{node.summary}</p>}
          <dl>
            {mastery !== null && (
              <div>
                <dt>掌握度</dt>
                <dd>{mastery}%</dd>
              </div>
            )}
            {typeof node.weight === 'number' && (
              <div>
                <dt>权重</dt>
                <dd>{node.weight}</dd>
              </div>
            )}
            {node.status && (
              <div>
                <dt>状态</dt>
                <dd>{node.status}</dd>
              </div>
            )}
          </dl>
        </>
      )}

      </div>
      {/* 关系区(上级/下级)与底栏按钮一样，置于滚动正文之外，作为钉底的 flex 项(flex:0 0 auto)。
          这样无论讲解内容如何滚动，上下级导航始终可见可达——与「打开对应模块」按钮同源同修。 */}
      {(upstreamNodes.length > 0 || downstreamNodes.length > 0 || prerequisiteNodes.length > 0 || dependentNodes.length > 0) && (
        <div className="mind-map-popover-relations">
          {upstreamNodes.length > 0 && (
            <section className="mind-map-relation-list" aria-label="上级知识点">
              <strong><Network size={14} /> 上级</strong>
              {upstreamNodes.slice(0, 6).map((item) => (
                <button type="button" key={`up-${item.id}`} onClick={() => onSelectedNodeChange(item.id)}>
                  <b>{item.title}</b>
                </button>
              ))}
            </section>
          )}
          {downstreamNodes.length > 0 && (
            <section className="mind-map-relation-list" aria-label="下级知识点">
              <strong><Layers3 size={14} /> 下级</strong>
              {downstreamNodes.slice(0, 6).map((item) => (
                <button type="button" key={`down-${item.id}`} onClick={() => onSelectedNodeChange(item.id)}>
                  <b>{item.title}</b>
                </button>
              ))}
            </section>
          )}
          {prerequisiteNodes.length > 0 && (
            <section className="mind-map-relation-list is-prerequisite" aria-label="前置知识点">
              <strong><ArrowRight size={14} /> 前置知识点</strong>
              {prerequisiteNodes.slice(0, 6).map((item) => (
                <button type="button" key={`pre-${item.id}`} onClick={() => onSelectedNodeChange(item.id)}>
                  <b>{item.title}</b>
                </button>
              ))}
            </section>
          )}
          {dependentNodes.length > 0 && (
            <section className="mind-map-relation-list is-prerequisite" aria-label="被依赖知识点">
              <strong><ArrowLeft size={14} /> 后续依赖本节</strong>
              {dependentNodes.slice(0, 6).map((item) => (
                <button type="button" key={`dep-${item.id}`} onClick={() => onSelectedNodeChange(item.id)}>
                  <b>{item.title}</b>
                </button>
              ))}
            </section>
          )}
        </div>
      )}
      <div className="mind-map-popover-footer">
        <button className="primary-button" type="button" onClick={openLinkedModule}>
          <FileText size={15} /> {node.type === 'question' ? (node.status === '模拟卷' ? '去模拟卷' : '去刷题') : '打开对应模块'}
        </button>
      </div>
    </aside>
  )
}

// 合并 studyGuide 各 section 与顶层的考点，按 id 去重，供"讲解分析"Tab 展示。
function dedupeExamPoints(guide: PlanTask['studyGuide']): StudyExamPoint[] {
  if (!guide) return []
  const merged: StudyExamPoint[] = [
    ...(guide.sections?.flatMap((section) => section.examPoints ?? []) ?? []),
    ...(guide.examPoints ?? []),
  ]
  const seen = new Set<string>()
  const result: StudyExamPoint[] = []
  for (const point of merged) {
    if (!point || seen.has(point.id)) continue
    seen.add(point.id)
    result.push(point)
  }
  return result
}

// 合并各 section 与顶层的例题，按 id（无则按标题+题干）去重。
function collectWorkedExamples(guide: PlanTask['studyGuide']): StudyWorkedExample[] {
  if (!guide) return []
  const merged: StudyWorkedExample[] = [
    ...(guide.sections?.flatMap((section) => section.workedExamples ?? []) ?? []),
    ...(guide.workedExamples ?? []),
  ]
  const seen = new Set<string>()
  const result: StudyWorkedExample[] = []
  for (const example of merged) {
    if (!example) continue
    const key = example.id ?? `${example.title}-${example.problem ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(example)
  }
  return result
}

type KnowledgeDetailTab = 'analysis' | 'examples' | 'wrong'

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="mind-map-detail-empty">
      <CircleAlert size={18} />
      <p>{text}</p>
    </div>
  )
}

// 知识点节点专属详情：讲解分析 / 典型例题 / 错题 三 Tab。
// 讲解与例题文本可能含公式，统一走 ReactMarkdown + remark-math + rehype-katex 渲染。
function KnowledgeDetailPanel({
  node,
  knowledgePoint,
  owningTask,
  questions,
  wrongAnswers,
  onModuleChange,
}: {
  node: MindMapNode
  knowledgePoint: KnowledgePoint | undefined
  owningTask: PlanTask | undefined
  questions: QuizQuestion[]
  wrongAnswers: WrongAnswer[]
  onModuleChange: CourseMindMapViewProps['onModuleChange']
}) {
  const [tab, setTab] = useState<KnowledgeDetailTab>('analysis')
  // 切换到另一个知识点节点时回到默认 Tab，避免上一个节点的 Tab 选择串到内容不同的新节点。
  useEffect(() => {
    setTab('analysis')
  }, [node.id])

  const guide = owningTask?.studyGuide
  const examPoints = useMemo(() => dedupeExamPoints(guide), [guide])
  const workedExamples = useMemo(() => collectWorkedExamples(guide), [guide])
  const concepts = guide?.concepts ?? []
  const planningReason = guide?.planningReason
  const hasAnalysis = Boolean(knowledgePoint?.summary || planningReason || examPoints.length || concepts.length)

  const tabs: Array<{ id: KnowledgeDetailTab; label: string; icon: typeof BookOpen; count?: number }> = [
    { id: 'analysis', label: '讲解分析', icon: BookOpen },
    { id: 'examples', label: '典型例题', icon: Lightbulb, count: workedExamples.length },
    { id: 'wrong', label: '错题', icon: CircleAlert, count: wrongAnswers.length },
  ]

  return (
    <div className="mind-map-detail">
      <div className="mind-map-popover-tabs" role="tablist">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`mind-map-popover-tab${tab === entry.id ? ' is-active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            <entry.icon size={13} /> {entry.label}
            {typeof entry.count === 'number' && entry.count > 0 && <em>{entry.count}</em>}
          </button>
        ))}
      </div>

      <div className="mind-map-popover-tab-content">
        {tab === 'analysis' && (
          hasAnalysis ? (
            <div className="mind-map-detail-section">
              {knowledgePoint?.summary && <p className="mind-map-detail-lead">{knowledgePoint.summary}</p>}
              {planningReason && (
                <p className="mind-map-detail-reason"><Lightbulb size={13} /> {planningReason}</p>
              )}
              {examPoints.map((point, index) => (
                <article className="mind-map-detail-point" key={point.id}>
                  <header>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{point.title}</strong>
                    <em>{point.importance === 'high' ? '高频' : point.importance === 'medium' ? '常规' : '了解'}</em>
                  </header>
                  {point.explanation && (
                    <div className="mind-map-detail-md">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {point.explanation}
                      </ReactMarkdown>
                    </div>
                  )}
                  {point.questionTypes?.length ? (
                    <p className="mind-map-detail-meta">常见考法：{point.questionTypes.join('、')}</p>
                  ) : null}
                  {point.formulas?.map((formula) => (
                    <div className="mind-map-detail-formula" key={formula.expression}>
                      <code>{formula.expression}</code>
                      <span>{formula.meaning}</span>
                    </div>
                  ))}
                  {point.procedure?.length ? (
                    <ol className="mind-map-detail-steps">
                      {point.procedure.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  ) : null}
                  {point.pitfalls?.length ? (
                    <ul className="mind-map-detail-pitfalls">
                      {point.pitfalls.map((pitfall) => <li key={pitfall}><CircleAlert size={12} /> {pitfall}</li>)}
                    </ul>
                  ) : null}
                </article>
              ))}
              {concepts.map((concept) => (
                <article className="mind-map-detail-concept" key={concept.title}>
                  <strong>{concept.title}</strong>
                  {concept.body && (
                    <div className="mind-map-detail-md">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {concept.body}
                      </ReactMarkdown>
                    </div>
                  )}
                  {concept.formula && <code className="mind-map-detail-inline-formula">{concept.formula}</code>}
                </article>
              ))}
            </div>
          ) : (
            <EmptyHint text="本知识点暂无讲解，可在复习主线重新生成。" />
          )
        )}

        {tab === 'examples' && (
          workedExamples.length ? (
            <div className="mind-map-detail-section">
              {workedExamples.map((example, index) => (
                <article className="mind-map-detail-example" key={example.id ?? `${example.title}-${index}`}>
                  <header>
                    <span>例 {index + 1}</span>
                    <strong>{example.title}</strong>
                  </header>
                  {example.problem && (
                    <div className="mind-map-detail-md mind-map-detail-example-problem">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {example.problem}
                      </ReactMarkdown>
                    </div>
                  )}
                  {example.analysis && (
                    <p className="mind-map-detail-example-analysis"><strong>分析：</strong>{example.analysis}</p>
                  )}
                  {example.steps?.length ? (
                    <ol className="mind-map-detail-steps">
                      {example.steps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  ) : null}
                  {example.answer && (
                    <p className="mind-map-detail-example-answer"><CheckCircle2 size={13} /> {example.answer}</p>
                  )}
                  {example.checks?.length ? (
                    <ul className="mind-map-detail-checks">
                      {example.checks.map((check) => <li key={check}><CheckCircle2 size={12} /> {check}</li>)}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <EmptyHint text="本知识点暂无例题，可在复习主线重新生成。" />
          )
        )}

        {tab === 'wrong' && (
          <div className="mind-map-detail-section">
            {wrongAnswers.length ? (
              <>
                <ul className="mind-map-detail-wrong">
                  {wrongAnswers.slice(0, wrongAnswerPreviewLimit).map((item) => (
                    <li key={item.id} className={item.isReviewed ? 'is-reviewed' : ''}>
                      <div className="mind-map-detail-wrong-head">
                        <strong>{item.title}</strong>
                        {item.isReviewed && <em>已复练</em>}
                      </div>
                      <div className="mind-map-detail-wrong-meta">
                        {item.mistakeType && <span>{item.mistakeType}</span>}
                        {item.count > 1 && <span>失分 {item.count} 次</span>}
                        {item.tag && <span>{item.tag}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                {wrongAnswers.length > wrongAnswerPreviewLimit && (
                  <p className="mind-map-detail-more">还有 {wrongAnswers.length - wrongAnswerPreviewLimit} 道错题未展示</p>
                )}
                <button className="secondary-button mind-map-detail-link" type="button" onClick={() => onModuleChange('errors')}>
                  <CircleAlert size={14} /> 去错题本全部复习
                </button>
              </>
            ) : (
              <EmptyHint text="本知识点暂无错题，继续保持。" />
            )}
            {questions.length > 0 && (
              <button className="secondary-button mind-map-detail-link" type="button" onClick={() => onModuleChange('practice')}>
                <ListChecks size={14} /> 去刷本知识点 {questions.length} 道题
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CourseMindMapViewInner({
  course,
  onModuleChange,
  tasks,
  knowledgePoints,
  practiceQuestions,
  mockQuestions,
  wrongAnswers,
}: CourseMindMapViewProps) {
  const [mindMap, setMindMap] = useState<CourseMindMap | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [filter, setFilter] = useState<MapFilter>('structure')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // 记录上一次向用户闪现"已保存"的时刻，用于节流：冷却期内完成的自动保存不再闪烁。
  const lastSavedFlashRef = useRef(0)
  // 自动保存（拖动/缩放/折叠节点等）触发的状态流转都走这里。
  // 冷却期内不显示"保存中"与"已保存"，指示器安静地停留在"自动保存"，约每分钟才闪一次"已保存"。
  const applySaveState = useCallback((next: 'idle' | 'saving' | 'saved' | 'error') => {
    const withinCooldown = Date.now() - lastSavedFlashRef.current < savedFlashCooldownMs
    if (next === 'saving') {
      if (withinCooldown) return
      setSaveState('saving')
      return
    }
    if (next === 'saved') {
      if (withinCooldown) {
        // 正在闪现的"已保存"不要被打断；仅当处于"保存中"时才静默回到"自动保存"。
        setSaveState((prev) => (prev === 'saving' ? 'idle' : prev))
        return
      }
      lastSavedFlashRef.current = Date.now()
      setSaveState('saved')
      return
    }
    setSaveState(next)
  }, [])
  const [errorMessage, setErrorMessage] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const visibleMindMap = useMemo(() => (mindMap ? filterMap(mindMap, filter) : null), [filter, mindMap])

  useEffect(() => {
    if (!visibleMindMap) return
    if (!selectedNodeId) return
    if (visibleMindMap.nodes.some((node) => node.id === selectedNodeId)) return
    setSelectedNodeId(null)
  }, [selectedNodeId, visibleMindMap])

  // 用浏览器原生全屏 API 把整张知识地图铺满整个屏幕（连浏览器地址栏/标签栏都隐藏）。
  // 环境不支持或被拦截时（如 iframe 未授权 fullscreen），自动回退到 CSS 覆盖式全屏。
  const toggleFullscreen = useCallback(() => {
    const el = pageRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }
    if (isFullscreen) {
      // 当前处于 CSS 回退全屏（非原生全屏），直接关闭
      setIsFullscreen(false)
      return
    }
    const requestFullscreen = el.requestFullscreen
      ?? (el as HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen
    if (!requestFullscreen) {
      setIsFullscreen(true)
      return
    }
    const result = requestFullscreen.call(el)
    if (result instanceof Promise) {
      result.catch(() => setIsFullscreen(true))
    }
  }, [isFullscreen])

  // 与浏览器全屏状态保持同步：用户按 Esc / F11 退出、切换标签页等都会触发
  useEffect(() => {
    function syncFullscreen() {
      const el = pageRef.current
      setIsFullscreen(el ? document.fullscreenElement === el : false)
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    document.addEventListener('webkitfullscreenchange', syncFullscreen)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      document.removeEventListener('webkitfullscreenchange', syncFullscreen)
    }
  }, [])

  // 原生全屏下浏览器自带 Esc 退出；此处仅为 CSS 回退全屏兜底 Esc 关闭
  useEffect(() => {
    if (!isFullscreen || document.fullscreenElement) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullscreen])

  // 离开本课程时若仍处于原生全屏，主动退出，避免全屏残留
  useEffect(() => () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
  }, [])

  useEffect(() => {
    let isActive = true
    async function loadMap() {
      setLoadState('loading')
      setErrorMessage('')
      try {
        const response = await getCourseMindMap(course.id)
        const nextMap = response.mindMap ?? (await generateCourseMindMap(course.id)).mindMap
        if (!nextMap) throw new Error('知识地图生成失败')
        const laidMap = await ensureLayouted(nextMap)
        if (!isActive) return
        setMindMap(laidMap)
        setSelectedNodeId(null)
        setLoadState('ready')
      } catch (error) {
        if (!isActive) return
        setErrorMessage(error instanceof Error ? error.message : '知识地图加载失败')
        setLoadState('error')
      }
    }
    void loadMap()
    return () => {
      isActive = false
    }
  }, [course.id])

  async function regenerateMap() {
    setSaveState('saving')
    setErrorMessage('')
    try {
      const response = await generateCourseMindMap(course.id)
      if (!response.mindMap) throw new Error('知识地图生成失败')
      setMindMap(await ensureLayouted(response.mindMap))
      setSelectedNodeId(null)
      lastSavedFlashRef.current = Date.now()
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 1200)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '知识地图生成失败')
      setSaveState('error')
    }
  }

  async function regroupModules() {
    setSaveState('saving')
    setErrorMessage('')
    try {
      const response = await regroupCourseMindMapModules(course.id)
      if (!response.mindMap) throw new Error('模块归并失败')
      setMindMap(await ensureLayouted(response.mindMap))
      setSelectedNodeId(null)
      lastSavedFlashRef.current = Date.now()
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 1200)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '模块归并失败')
      setSaveState('error')
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="module-page mind-map-page">
        <section className="empty-module">
          <LoaderCircle className="is-spinning" size={32} />
          <h1>正在展开知识地图</h1>
          <p>正在整理当前课程的章节、知识点和结构关系。</p>
        </section>
      </div>
    )
  }

  if (loadState === 'error' || !mindMap) {
    return (
      <div className="module-page mind-map-page">
        <section className="empty-module">
          <CircleAlert size={32} />
          <h1>知识地图暂不可用</h1>
          <p>{errorMessage}</p>
          <button className="primary-button" type="button" onClick={() => void regenerateMap()}>
            <RefreshCw size={15} /> 重新生成
          </button>
        </section>
      </div>
    )
  }

  return (
    <div ref={pageRef} className={`module-page mind-map-page${isFullscreen ? ' is-fullscreen' : ''}`}>
      <section className="page-heading-row mind-map-heading">
        <div>
          <p className="page-kicker"><Route size={15} /> 课程大纲 · 知识结构图</p>
          <h1>{course.name} · 知识地图</h1>
          <p>主画布呈现课程、模块与知识点层级；点击任意节点，可在浮卡中查看详情、掌握度与上下级关系。</p>
        </div>
      </section>

      <div className="mind-map-control-row">
        <div className="mind-map-filterbar" role="group" aria-label="知识地图筛选">
          {([
            ['structure', '知识结构'],
            ['weak', '薄弱结构'],
            ['important', '核心结构'],
          ] as const).map(([id, label]) => (
            <button
              className={filter === id ? 'is-active' : ''}
              key={id}
              type="button"
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mind-map-actions">
          <span className={`mind-map-save-state is-${saveState}`}>
            {saveState === 'saving' ? <LoaderCircle className="is-spinning" size={14} /> : <Save size={14} />}
            {saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : saveState === 'error' ? '保存失败' : '自动保存'}
          </span>
          <button className="secondary-button" type="button" onClick={() => void regroupModules()}>
            <Sparkles size={15} /> 智能归并模块
          </button>
          <button className="secondary-button" type="button" onClick={() => void regenerateMap()}>
            <RefreshCw size={15} /> 重新生成
          </button>
          <button
            className="secondary-button mind-map-fullscreen-toggle"
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? '退出全屏 (Esc)' : '全屏查看'}
            aria-label={isFullscreen ? '退出全屏' : '全屏查看'}
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {isFullscreen ? '退出全屏' : '全屏'}
          </button>
        </div>
      </div>

      {errorMessage && <p className="mind-map-error" role="alert">{errorMessage}</p>}

      <section className="mind-map-shell">
        <MindMapCanvas
          course={course}
          filter={filter}
          isFullscreen={isFullscreen}
          mindMap={mindMap}
          selectedNodeId={selectedNodeId}
          onMindMapChange={setMindMap}
          onSelectedNodeChange={setSelectedNodeId}
          onModuleChange={onModuleChange}
          onSaveStateChange={applySaveState}
          tasks={tasks}
          knowledgePoints={knowledgePoints}
          practiceQuestions={practiceQuestions}
          mockQuestions={mockQuestions}
          wrongAnswers={wrongAnswers}
        />
      </section>
    </div>
  )
}

export function CourseMindMapView(props: CourseMindMapViewProps) {
  return (
    <ReactFlowProvider>
      <CourseMindMapViewInner {...props} />
    </ReactFlowProvider>
  )
}
