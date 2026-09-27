const pad = (n: number): string => String(n).padStart(2, '0')

export function formatDate(date: Date, format: string): string {
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes())
  }
  return format.replace(/YYYY|MM|DD|HH|mm/g, (t) => tokens[t])
}

/**
 * Fills {{title}}, {{date}}, {{time}}, {{date:FORMAT}} and {{cursor}} placeholders.
 * Unknown placeholders are left as they are. No code is ever evaluated.
 */
export function renderTemplate(
  source: string,
  vars: { title: string; now?: Date }
): { content: string; cursor: number | null } {
  const now = vars.now ?? new Date()
  const filled = source.replace(/\{\{\s*([a-zA-Z]+)(?::([^}]*))?\s*\}\}/g, (match, name: string, arg?: string) => {
    switch (name.toLowerCase()) {
      case 'title':
        return vars.title
      case 'date':
        return formatDate(now, arg?.trim() || 'YYYY-MM-DD')
      case 'time':
        return formatDate(now, arg?.trim() || 'HH:mm')
      default:
        return match
    }
  })
  const marker = /\{\{\s*cursor\s*\}\}/
  const m = marker.exec(filled)
  if (!m) return { content: filled, cursor: null }
  return {
    content: filled.slice(0, m.index) + filled.slice(m.index + m[0].length).replace(new RegExp(marker, 'g'), ''),
    cursor: m.index
  }
}
