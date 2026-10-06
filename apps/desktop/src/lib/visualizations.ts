/**
 * Extract a visualization payload from a `create_visualization` tool result.
 * Mirrors the shape of `generatedImageFromResult` in generated-images.ts:
 * the backend returns JSON `{success, visualization: {title, html}}`
 * (or the raw JSON string of it).
 */

export interface VisualizationPayload {
  title: string
  html: string
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** `null` when the result carries no renderable visualization. */
export function visualizationFromResult(result: unknown): VisualizationPayload | null {
  const record = recordFromUnknown(result)
  if (!record) {
    return null
  }
  const viz = recordFromUnknown(record.visualization)
  if (!viz) {
    return null
  }
  const html = viz.html
  if (typeof html !== 'string' || !html.trim()) {
    return null
  }
  const title = typeof viz.title === 'string' && viz.title.trim() ? viz.title.trim() : 'Visualization'
  return { title, html }
}
