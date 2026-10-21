/**
 * RFC 4180-ish CSV/TSV parsing for the table viewer: quoted fields, doubled
 * quotes, delimiters and newlines inside quotes, CRLF. Stops after `maxRows`
 * so a huge file costs a bounded amount of work.
 */
export function parseDelimited(text: string, delimiter: string, maxRows = Number.POSITIVE_INFINITY): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }

      continue
    }

    if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++
      }

      row.push(field)
      rows.push(row)
      row = []
      field = ''

      if (rows.length >= maxRows) {
        return rows
      }
    } else {
      field += ch
    }
  }

  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

export const delimiterFor = (filePath: string) => (/\.tsv$/i.test(filePath) ? '\t' : ',')
