export const palette = {
  bg: '#000000',
  bgRaised: '#0d0d0f',
  card: '#141416',
  border: '#26262a',
  text: '#f5f5f4',
  textDim: '#a1a1aa',
  accent: '#e8622c',
  accentSoft: 'rgba(232, 98, 44, 0.14)',
  green: '#34d399',
  red: '#f87171',
  bubbleMe: '#1f1f23',
  bubbleThem: '#141416',
} as const;

export type Theme = typeof palette;
