import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphNode } from '@shared/types'
import { useLinkIndex } from '../../state/LinkIndexContext'
import { useWorkspace } from '../../state/WorkspaceContext'

type Node = GraphNode & { x?: number; y?: number }
type Link = { source: string | Node; target: string | Node }

function readColors() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string): string => css.getPropertyValue(name).trim()
  return {
    node: v('--graph-node'),
    unresolved: v('--graph-unresolved'),
    active: v('--accent'),
    link: v('--graph-link'),
    linkActive: v('--accent'),
    label: v('--text-muted')
  }
}

const idOf = (end: string | Node): string => (typeof end === 'string' ? end : end.id)

export function GraphView() {
  const snapshot = useLinkIndex()
  const { active, openNote, openLink } = useWorkspace()
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [colors, setColors] = useState(readColors)
  const [hovered, setHovered] = useState<string | null>(null)
  const positions = useRef(new Map<string, Node>())
  const graphRef = useRef<ForceGraphMethods<Node, Link> | undefined>(undefined)
  const fitted = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setColors(readColors())
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  // Reuse node objects between snapshots so the layout doesn't jump when a note changes.
  const data = useMemo(() => {
    if (!snapshot) return { nodes: [] as Node[], links: [] as Link[] }
    const previous = positions.current
    const nodes = snapshot.graph.nodes.map((n) => {
      const old = previous.get(n.id)
      return old ? Object.assign(old, n) : ({ ...n } as Node)
    })
    positions.current = new Map(nodes.map((n) => [n.id, n]))
    return { nodes, links: snapshot.graph.links.map((l) => ({ ...l })) as Link[] }
  }, [snapshot])

  const focus = hovered ?? active?.path ?? null
  const neighbors = useMemo(() => {
    const set = new Set<string>()
    if (!focus) return set
    for (const l of data.links) {
      const s = idOf(l.source)
      const t = idOf(l.target)
      if (s === focus) set.add(t)
      if (t === focus) set.add(s)
    }
    return set
  }, [data, focus])

  const isEmpty = data.nodes.length === 0

  return (
    <div className="graph-view" ref={containerRef}>
      {isEmpty && <p className="empty centered">No notes to show yet. Link notes with [[Note name]].</p>}
      {!isEmpty && size.width > 0 && (
        <ForceGraph2D<Node, Link>
          ref={graphRef}
          onEngineStop={() => {
            if (fitted.current) return
            fitted.current = true
            graphRef.current?.zoomToFit(400, 80)
          }}
          width={size.width}
          height={size.height}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={4}
          nodeLabel={(n) => n.name}
          linkColor={(l) =>
            focus && (idOf(l.source) === focus || idOf(l.target) === focus) ? colors.linkActive : colors.link
          }
          linkWidth={(l) => (focus && (idOf(l.source) === focus || idOf(l.target) === focus) ? 1.5 : 0.6)}
          cooldownTicks={120}
          onNodeHover={(n) => setHovered(n ? n.id : null)}
          onNodeClick={(n) => (n.resolved ? openNote(n.id) : void openLink(n.name))}
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={(n, ctx, scale) => {
            if (n.x === undefined || n.y === undefined) return
            const radius = 3 + Math.sqrt(n.degree) * 1.4
            const isFocus = n.id === focus
            const dimmed = hovered !== null && !isFocus && !neighbors.has(n.id)
            ctx.globalAlpha = dimmed ? 0.35 : 1
            ctx.beginPath()
            ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI)
            ctx.fillStyle = isFocus || n.id === active?.path ? colors.active : n.resolved ? colors.node : colors.unresolved
            ctx.fill()
            if (scale > 1.2 || isFocus || neighbors.has(n.id)) {
              ctx.font = `${Math.max(11 / scale, 2)}px system-ui, sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'top'
              ctx.fillStyle = colors.label
              ctx.fillText(n.name, n.x, n.y + radius + 2 / scale)
            }
            ctx.globalAlpha = 1
          }}
          nodePointerAreaPaint={(n, color, ctx) => {
            if (n.x === undefined || n.y === undefined) return
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(n.x, n.y, 4 + Math.sqrt(n.degree) * 1.4, 0, 2 * Math.PI)
            ctx.fill()
          }}
        />
      )}
    </div>
  )
}
