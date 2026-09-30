export type DiffLine = { type: 'same' | 'added' | 'removed'; text: string }

/** Beyond this many changed lines, show the change as a full replacement rather than spend time on an exact diff. */
const MAX_CELLS = 4_000_000

/** A line-by-line diff (longest common subsequence), trimming identical lines at both ends first. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ type: 'same', text }))
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ type: 'same', text }))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)

  if (midA.length * midB.length > MAX_CELLS) {
    return [
      ...head,
      ...midA.map((text): DiffLine => ({ type: 'removed', text })),
      ...midB.map((text): DiffLine => ({ type: 'added', text })),
      ...tail
    ]
  }

  // lcs[i][j] = length of the longest common subsequence of midA[i..] and midB[j..]
  const rows = midA.length + 1
  const cols = midB.length + 1
  const lcs = new Uint32Array(rows * cols)
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lcs[i * cols + j] = midA[i] === midB[j] ? lcs[(i + 1) * cols + j + 1] + 1 : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1])
    }
  }
  const middle: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      middle.push({ type: 'same', text: midA[i++] })
      j++
    } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) middle.push({ type: 'removed', text: midA[i++] })
    else middle.push({ type: 'added', text: midB[j++] })
  }
  while (i < midA.length) middle.push({ type: 'removed', text: midA[i++] })
  while (j < midB.length) middle.push({ type: 'added', text: midB[j++] })
  return [...head, ...middle, ...tail]
}
