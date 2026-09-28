import type { ReactNode } from 'react'
import type { EditorView } from '@codemirror/view'
import {
  blockKind,
  headingLevel,
  insertCodeBlock,
  insertDivider,
  insertLink,
  insertMath,
  insertNoteLink,
  insertTable,
  isInlineActive,
  run,
  setHeading,
  toggleBlock,
  toggleInline,
  type Format
} from './extensions/formatting'
import {
  BulletListIcon,
  CodeBlockIcon,
  DividerIcon,
  LinkIcon,
  NoteLinkIcon,
  NumberListIcon,
  QuoteIcon,
  TableIcon,
  TaskListIcon
} from '../icons'

const isMac = navigator.platform.toLowerCase().includes('mac')
const mod = isMac ? '⌘' : 'Ctrl+'
const shift = isMac ? '⇧' : 'Shift+'
const alt = isMac ? '⌥' : 'Alt+'

const TEXT_STYLES = [
  { level: 0, label: 'Normal text' },
  { level: 1, label: 'Heading 1' },
  { level: 2, label: 'Heading 2' },
  { level: 3, label: 'Heading 3' },
  { level: 4, label: 'Heading 4' },
  { level: 5, label: 'Heading 5' },
  { level: 6, label: 'Heading 6' }
]

function ToolButton(props: {
  view: EditorView
  format: Format
  label: string
  shortcut?: string
  active?: boolean
  children: ReactNode
}) {
  const { view, format, label, shortcut, active, children } = props
  return (
    <button
      type="button"
      className={active ? 'tool on' : 'tool'}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      // mousedown + preventDefault keeps the editor's selection and focus.
      onMouseDown={(e) => {
        e.preventDefault()
        run(format)(view)
        view.focus()
      }}
    >
      {children}
    </button>
  )
}

/** Word-processor style controls that write standard markdown, so notes stay portable. */
export function FormattingToolbar({ view }: { view: EditorView }) {
  const state = view.state
  const heading = headingLevel(state)
  const block = blockKind(state)
  const common = { view }

  return (
    <div className="format-toolbar" role="toolbar" aria-label="Formatting">
      <select
        className="style-select"
        value={heading}
        title={`Text style (${mod}${alt}0–3)`}
        aria-label="Text style"
        onChange={(e) => {
          run(setHeading(Number(e.target.value)))(view)
          view.focus()
        }}
      >
        {TEXT_STYLES.map((s) => (
          <option key={s.level} value={s.level}>
            {s.label}
          </option>
        ))}
      </select>
      <span className="tool-sep" />
      <ToolButton {...common} format={toggleInline('bold')} label="Bold" shortcut={`${mod}B`} active={isInlineActive(state, 'bold')}>
        <b>B</b>
      </ToolButton>
      <ToolButton {...common} format={toggleInline('italic')} label="Italic" shortcut={`${mod}I`} active={isInlineActive(state, 'italic')}>
        <i className="serif">I</i>
      </ToolButton>
      <ToolButton {...common} format={toggleInline('strike')} label="Strikethrough" shortcut={`${mod}${shift}X`} active={isInlineActive(state, 'strike')}>
        <s>S</s>
      </ToolButton>
      <ToolButton {...common} format={toggleInline('code')} label="Inline code" shortcut={`${mod}E`} active={isInlineActive(state, 'code')}>
        <span className="mono">{'</>'}</span>
      </ToolButton>
      <span className="tool-sep" />
      <ToolButton {...common} format={toggleBlock('bullet')} label="Bulleted list" shortcut={`${mod}${shift}8`} active={block === 'bullet'}>
        <BulletListIcon />
      </ToolButton>
      <ToolButton {...common} format={toggleBlock('number')} label="Numbered list" shortcut={`${mod}${shift}7`} active={block === 'number'}>
        <NumberListIcon />
      </ToolButton>
      <ToolButton {...common} format={toggleBlock('task')} label="Checklist" shortcut={`${mod}${shift}9`} active={block === 'task'}>
        <TaskListIcon />
      </ToolButton>
      <ToolButton {...common} format={toggleBlock('quote')} label="Quote" active={block === 'quote'}>
        <QuoteIcon />
      </ToolButton>
      <span className="tool-sep" />
      <ToolButton {...common} format={insertNoteLink} label="Link to a note">
        <NoteLinkIcon />
      </ToolButton>
      <ToolButton {...common} format={insertLink} label="Web link" shortcut={`${mod}K`}>
        <LinkIcon />
      </ToolButton>
      <ToolButton {...common} format={insertTable} label="Table">
        <TableIcon />
      </ToolButton>
      <ToolButton {...common} format={insertCodeBlock} label="Code block">
        <CodeBlockIcon />
      </ToolButton>
      <ToolButton {...common} format={insertMath} label="Equation" active={isInlineActive(state, 'math')}>
        <span className="serif math-glyph">∑</span>
      </ToolButton>
      <ToolButton {...common} format={insertDivider} label="Divider">
        <DividerIcon />
      </ToolButton>
    </div>
  )
}
