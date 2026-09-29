import { useMemo } from 'react'

import { useI18n } from '@/i18n'
import { delimiterFor, parseDelimited } from '@/lib/delimited'

/** Rows parsed for display; the source view still has the whole file. */
const TABLE_ROW_LIMIT = 2000

/** CSV/TSV as a table: sticky header row, row numbers, cells that wrap
 *  nowhere (hover shows the full value). The first line is the header. */
export function TableViewer({ filePath, text }: { filePath: string; text: string }) {
  const { t } = useI18n()
  const rows = useMemo(() => parseDelimited(text, delimiterFor(filePath), TABLE_ROW_LIMIT + 1), [filePath, text])
  const [header = [], ...body] = rows
  const shown = body.slice(0, TABLE_ROW_LIMIT)
  const width = Math.max(header.length, ...shown.map(row => row.length))

  return (
    <div className="h-full overflow-auto" data-slot="table-viewer">
      <table className="min-w-full border-separate border-spacing-0 text-[0.75rem] tabular-nums">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 border-b border-(--ui-stroke-tertiary) bg-(--ui-editor-surface-background) px-2 py-1.5 text-right font-normal text-(--ui-text-quaternary)">
              #
            </th>
            {Array.from({ length: width }, (_, i) => (
              <th
                className="sticky top-0 z-10 max-w-64 truncate border-b border-(--ui-stroke-tertiary) bg-(--ui-editor-surface-background) px-3 py-1.5 text-left font-semibold text-foreground"
                key={i}
                title={header[i]}
              >
                {header[i] ?? ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr className="hover:bg-(--ui-control-hover-background)" key={r}>
              <td className="sticky left-0 border-b border-(--ui-stroke-quaternary) bg-(--ui-editor-surface-background) px-2 py-1 text-right text-(--ui-text-quaternary)">
                {r + 1}
              </td>
              {Array.from({ length: width }, (_, i) => (
                <td
                  className="max-w-64 truncate border-b border-(--ui-stroke-quaternary) px-3 py-1 text-(--ui-text-secondary)"
                  key={i}
                  title={row[i]}
                >
                  {row[i] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > TABLE_ROW_LIMIT && (
        <p className="px-3 py-2 text-[0.6875rem] text-(--ui-text-tertiary)">{t.preview.tableTruncated(TABLE_ROW_LIMIT)}</p>
      )}
    </div>
  )
}
