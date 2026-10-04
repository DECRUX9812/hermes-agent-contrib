/**
 * An agent's "when should it ask you" rules are its profile's approvals
 * settings. Saving them must send only the approvals keys (the config route
 * deep-merges, so a partial body can never clobber the rest of the profile).
 */

import { describe, expect, it } from 'vitest'

import { askRulesFromConfig, askRulesPatch } from './ask-rules-card'

describe('ask rules', () => {
  it('round-trips through a config record and writes only the approvals keys', () => {
    const config = {
      approvals: { mode: false, smart_policy: 'Ask before email', timeout: 300 },
      model: { default: 'x' }
    }
    const rules = askRulesFromConfig(config)

    expect(rules).toEqual({ mode: 'off', policy: 'Ask before email' })
    expect(askRulesPatch({ ...rules, mode: 'smart', policy: '  Ask before spending  ' })).toEqual({
      approvals: { mode: 'smart', smart_policy: 'Ask before spending' }
    })
    expect(askRulesFromConfig(askRulesPatch(rules))).toEqual(rules)
  })
})
