import { useEffect, useMemo, useRef } from 'react'
import type { JobSummary } from '@shared/vault/types'
import { useLinkIndex } from '../../state/LinkIndexContext'
import { useVault } from '../../state/VaultContext'
import { useWorkspace } from '../../state/WorkspaceContext'

/** Jobs that aren't done and are assigned to you, by workflow and then oldest first. */
export function useMyTasks(): JobSummary[] {
  const index = useLinkIndex()
  const me = (useVault().info?.author ?? '').trim().toLowerCase()
  return useMemo(
    () =>
      me
        ? (index?.jobs ?? [])
            .filter((j) => j.status !== 'done' && j.assignee.trim().toLowerCase() === me)
            .sort((a, b) => (a.workflow ?? '').localeCompare(b.workflow ?? '') || a.created.localeCompare(b.created))
        : [],
    [index, me]
  )
}

/** What's waiting on you: a list under the My tasks button. */
export function MyTasks({ onClose }: { onClose(): void }) {
  const tasks = useMyTasks()
  const ws = useWorkspace()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    const away = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.my-tasks-button')) onClose()
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="my-tasks"
      role="dialog"
      aria-label="My tasks"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <h3>My tasks</h3>
      {tasks.length === 0 ? (
        <p className="hint">Nothing is waiting on you.</p>
      ) : (
        <ul>
          {tasks.map((job) => (
            <li key={job.path}>
              <button
                onClick={() => {
                  onClose()
                  ws.openNote(job.path)
                }}
              >
                <span className="my-task-title">
                  {job.workflow ?? 'Job'} · {job.stage}
                </span>
                <span className="my-task-detail">
                  {job.title.replace(/^.* job /, 'job ')}
                  {job.runOpen ? ' · run open' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="text-button"
        onClick={() => {
          onClose()
          ws.setView('board')
        }}
      >
        Open the board
      </button>
    </div>
  )
}
