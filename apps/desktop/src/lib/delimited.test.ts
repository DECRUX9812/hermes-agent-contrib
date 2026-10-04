/**
 * The table viewer shows what a spreadsheet would: quoted cells keep their
 * commas, quotes and line breaks, and CRLF files read the same as LF ones.
 */

import { describe, expect, it } from 'vitest'

import { parseDelimited } from './delimited'

describe('parseDelimited', () => {
  it('keeps quoted delimiters, escaped quotes and embedded newlines inside one cell', () => {
    const csv = 'name,note\r\n"Acme, Inc.","said ""hi""\nthen left"\r\nBolt,plain\n'

    expect(parseDelimited(csv, ',')).toEqual([
      ['name', 'note'],
      ['Acme, Inc.', 'said "hi"\nthen left'],
      ['Bolt', 'plain']
    ])
    expect(parseDelimited('a\tb\n1\t2', '\t', 1)).toEqual([['a', 'b']])
  })
})
