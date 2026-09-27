import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = (props: IconProps) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props
})

export const NewNoteIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M12 12v6M9 15h6" />
  </svg>
)

export const NewFolderIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 10v6M9 13h6" />
  </svg>
)

export const TemplateIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
)

export const CollapseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 14l5-5 5 5M7 19l5-5 5 5" />
  </svg>
)

export const GraphIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <circle cx="10" cy="18" r="2.5" />
    <path d="M8.3 7l7.4.8M7 8.2l2.3 7.5M16.6 10l-5 6.3" />
  </svg>
)

export const EditIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
)

export const VaultIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

export const BulletListIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" fill="currentColor" />
    <circle cx="4.5" cy="12" r="1" fill="currentColor" />
    <circle cx="4.5" cy="18" r="1" fill="currentColor" />
  </svg>
)

export const NumberListIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="M4 5l1.5-1v5M3.5 9h3M3.5 14.5a1.5 1.5 0 1 1 2.6 1L3.5 19h3" strokeWidth={1.4} />
  </svg>
)

export const TaskListIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="6" height="6" rx="1" />
    <path d="M4.5 7l1.2 1.2L8 5.8" />
    <rect x="3" y="14" width="6" height="6" rx="1" />
    <path d="M13 7h8M13 17h8" />
  </svg>
)

export const QuoteIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5v14M9 8h11M9 12h11M9 16h7" />
  </svg>
)

export const LinkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
)

export const NoteLinkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 4H5v16h3M16 4h3v16h-3" />
    <path d="M10 12h4" />
  </svg>
)

export const TableIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18M10 4v16" />
  </svg>
)

export const CodeBlockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 10l-2 2 2 2M15 10l2 2-2 2" />
  </svg>
)

export const DividerIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12h18" />
    <path d="M7 6h10M7 18h10" strokeOpacity={0.4} />
  </svg>
)

export const ChevronIcon =(p: IconProps) => (
  <svg {...base({ width: 12, height: 12, ...p })}>
    <path d="M9 6l6 6-6 6" />
  </svg>
)
