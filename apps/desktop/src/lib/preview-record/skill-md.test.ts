import { describe, expect, it } from 'vitest'

import { buildRecordedSkillMarkdown, describeRecordedStep, slugifySkillName } from './skill-md'

describe('slugifySkillName', () => {
  it('slugifies a title into a valid skill name', () => {
    expect(slugifySkillName('Order Groceries!')).toBe('order-groceries')
    expect(slugifySkillName('  Deploy — staging  ')).toBe('deploy-staging')
  })

  it('falls back when nothing survives slugging', () => {
    expect(slugifySkillName('订单')).toBe('recorded-task')
    expect(slugifySkillName('')).toBe('recorded-task')
  })
})

describe('buildRecordedSkillMarkdown', () => {
  const steps = [
    { kind: 'navigate' as const, url: 'https://shop.example/cart' },
    { kind: 'click' as const, label: 'Checkout', selector: '#checkout' },
    { kind: 'type' as const, label: 'Card number', selector: 'input[name="cc"]', value: '4111' },
    { kind: 'type' as const, label: 'Password', redacted: true, selector: 'input[name="pw"]' },
    { kind: 'press' as const, key: 'Enter', label: 'Card number', selector: 'input[name="cc"]' }
  ]

  const md = buildRecordedSkillMarkdown({
    name: 'order-groceries',
    steps,
    title: 'Order groceries',
    url: 'https://shop.example/start'
  })

  it('emits frontmatter the create path accepts', () => {
    expect(md).toMatch(/^---\nname: order-groceries\ndescription: ".+"\n/)
    const description = /description: "(.+)"/.exec(md)![1]
    expect(description.length).toBeLessThanOrEqual(60)
    expect(description).toMatch(/\.$/)
  })

  it('numbers every step, seeding from the recorded page', () => {
    expect(md).toContain('1. Open `https://shop.example/start`')
    expect(md).toContain('2. Open `https://shop.example/cart`')
    expect(md).toContain('3. Click **Checkout** (`#checkout`)')
    expect(md).toContain('4. Type `4111` into **Card number** (`input[name="cc"]`)')
    expect(md).toContain('5. Enter the credential into **Password** (`input[name="pw"]`)')
  })

  it('generates the description from the host when none is given', () => {
    expect(md).toContain('description: "Recorded UI workflow on shop.example."')
  })

  it('clamps a custom description to the 60-char index budget', () => {
    const out = buildRecordedSkillMarkdown({
      description: 'a'.repeat(90),
      name: 'x',
      steps
    })

    const description = /description: "(.+)"/.exec(out)![1]
    expect(description.length).toBeLessThanOrEqual(60)
    expect(description.endsWith('.')).toBe(true)
  })

  it('escapes quotes inside the description', () => {
    const out = buildRecordedSkillMarkdown({
      description: 'Replay the "checkout" flow.',
      name: 'x',
      steps
    })

    expect(out).toContain('description: "Replay the \\"checkout\\" flow."')
  })
})

describe('describeRecordedStep', () => {
  it('describes each kind', () => {
    expect(describeRecordedStep({ kind: 'navigate', url: 'https://x.dev' })).toBe('Open `https://x.dev`')
    expect(describeRecordedStep({ kind: 'click', label: 'Go', selector: 'button' })).toBe(
      'Click **Go** (`button`)'
    )
    expect(describeRecordedStep({ kind: 'press', key: 'Tab' })).toBe('Press **Tab**')
  })
})
