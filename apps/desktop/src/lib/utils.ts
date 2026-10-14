import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge only knows Tailwind's stock scales. Without these, it reads
// `text-ui-sm` as a text colour and drops it next to `text-fg` (design/tokens.css).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['control', 'row', 'card', 'panel', 'dialog', 'pill'],
      shadow: ['e1', 'e2', 'e3'],
      text: ['ui-2xs', 'ui-xs', 'ui-sm', 'ui-base', 'ui-md', 'ui-lg', 'ui-xl', 'ui-2xl', 'ui-display']
    }
  }
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
