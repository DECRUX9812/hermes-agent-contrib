import { computed } from 'nanostores'

import { $messages } from '@/store/session'

import { $petActivity, derivePetState, type PetActivity, type PetState } from './pet'

// Emotion engine — maps message sentiment + task state → avatar expression.
// Hermes is a work tool: emotions are professional (happy/thinking/working/
// waiting/proud/concerned), never romantic or dependency-baiting. No model
// call: sentiment is cheap keyword heuristics over the last assistant message,
// task state comes from the real $petActivity store. When in doubt, neutral.

export type PetEmotion =
  | 'happy'
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'proud'
  | 'concerned'
  | 'neutral'

interface ScoredPattern {
  re: RegExp
  score: number
}

const POSITIVE: ScoredPattern[] = [
  { re: /\b(done|completed|finished|success|successful|fixed|resolved|shipped|merged|passed|passing|working now)\b/i, score: 2 },
  { re: /\b(great|excellent|perfect|awesome|nice)\b/i, score: 1 },
  { re: /🎉|✅|✓|👍/u, score: 1 },
]

const PROUD: ScoredPattern[] = [
  { re: /\b(all (tests|checks) (pass|green)|shipped|deployed|merged|released)\b/i, score: 2 },
  { re: /\b(landed|wrapped up|nailed it)\b/i, score: 1 },
]

const CONCERNED: ScoredPattern[] = [
  { re: /\b(error|failed|failure|broken|crash|exception|warning|problem|issue|blocked|stuck)\b/i, score: 2 },
  { re: /\b(sorry|apologize|unable|couldn't|can't)\b/i, score: 1 },
  { re: /⚠️|❌|🚨/u, score: 1 },
]

const THINKING: ScoredPattern[] = [
  { re: /\b(let me (think|check|look|see)|hmm|considering|analyzing|investigating|one moment)\b/i, score: 2 },
  { re: /\b(interesting|curious)\b/i, score: 1 },
]

function scoreText(text: string, patterns: ScoredPattern[]): number {
  return patterns.reduce((sum, p) => sum + (p.re.test(text) ? p.score : 0), 0)
}

export type MessageSentiment = 'positive' | 'proud' | 'concerned' | 'thinking' | 'neutral'

/** Cheap sentiment over a message body — no model call. */
export function analyzeSentiment(text: string): MessageSentiment {
  const body = text.slice(-2000) // last 2k chars is enough signal

  const scores = {
    positive: scoreText(body, POSITIVE),
    proud: scoreText(body, PROUD),
    concerned: scoreText(body, CONCERNED),
    thinking: scoreText(body, THINKING),
  }

  const best = (Object.entries(scores) as [MessageSentiment, number][]).sort((a, b) => b[1] - a[1])[0]

  return best[1] > 0 ? best[0] : 'neutral'
}

/**
 * Derive the avatar's emotion. Task state wins (it's ground truth); sentiment
 * only refines the quiet states (idle/review). Priority:
 *   failed -> concerned | awaitingInput -> waiting | celebrate -> happy |
 *   justCompleted -> proud/happy | busy/toolRunning -> working |
 *   reasoning -> thinking | idle + sentiment -> sentiment | idle -> neutral
 */
export function deriveEmotion(activity: PetActivity, sentiment: MessageSentiment): PetEmotion {
  const state = derivePetState(activity)

  switch (state) {
    case 'failed':
      return 'concerned'

    case 'waiting':
      return 'waiting'

    case 'jump':
      return 'happy'

    case 'wave':
      return sentiment === 'proud' ? 'proud' : 'happy'

    case 'run':
      return 'working'

    case 'review':
      return sentiment === 'concerned' ? 'concerned' : 'thinking'

    case 'idle':

    default:
      if (sentiment === 'positive') {return 'happy'}

      if (sentiment === 'proud') {return 'proud'}

      if (sentiment === 'concerned') {return 'concerned'}

      if (sentiment === 'thinking') {return 'thinking'}

      return 'neutral'
  }
}

/** Map an emotion back onto a pet sprite state for the avatar. */
export function emotionToPetState(emotion: PetEmotion): PetState {
  switch (emotion) {
    case 'happy':
      return 'wave'

    case 'proud':
      return 'jump'

    case 'working':
      return 'run'

    case 'thinking':
      return 'review'

    case 'waiting':
      return 'waiting'

    case 'concerned':
      return 'failed'

    case 'neutral':

    default:
      return 'idle'
  }
}

/** Plain-language caption for an emotion (status line use). */
export function emotionCaption(emotion: PetEmotion): string {
  switch (emotion) {
    case 'happy':
      return 'Happy to help'

    case 'proud':
      return 'Done — nicely'

    case 'working':
      return 'Working…'

    case 'thinking':
      return 'Thinking…'

    case 'waiting':
      return 'Waiting for you'

    case 'concerned':
      return 'Hit a snag'

    case 'neutral':

    default:
      return 'Ready'
  }
}

function lastAssistantText(): string {
  const messages = $messages.get()

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    // ChatMessage shape: role + content/text variants — read defensively.
    const role = (m as { role?: string }).role ?? ''

    if (role !== 'assistant') {continue}
    const content = (m as { content?: unknown }).content ?? (m as { text?: unknown }).text ?? ''

    if (typeof content === 'string' && content.trim()) {return content}

    if (Array.isArray(content)) {
      const text = content
        .map(part => (typeof part === 'string' ? part : (part as { text?: string }).text ?? ''))
        .join('')

      if (text.trim()) {return text}
    }
  }

  return ''
}

/** Live emotion: task state first, message sentiment second. Never invented. */
export const $petEmotion = computed([$petActivity, $messages], (activity, messages): PetEmotion => {
  void messages // recompute when messages change; text read inside for freshness

  return deriveEmotion(activity, analyzeSentiment(lastAssistantText()))
})
