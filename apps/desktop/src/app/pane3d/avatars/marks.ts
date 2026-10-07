/**
 * Brand marks as real 3D geometry (architecture §8.3).
 *
 * The SVG path data is salvaged verbatim from PR #146
 * (`apps/desktop/src/app/botroom/engine/marks.ts`, `BRAND_MARKS`), so the marks
 * are the vectors the products actually ship rather than a redrawn
 * approximation. Each path is parsed with three's `SVGLoader`, extruded into a
 * thin beveled slab, flipped out of SVG's y-down space, normalized so its
 * longest side is `size` world units and centered on the origin.
 *
 * Geometry is memoized per (mark, size, depth, bevel): the pane mounts the same
 * mark on the live body and on the off-screen pre-warm body, and a second
 * ExtrudeGeometry per mount would be pure waste. Nothing is disposed — the pane
 * keeps its bodies mounted for the lifetime of the window (scene/prewarm.ts).
 */

import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type MarkId = 'claude' | 'opencode' | 'x'

export interface BrandMark {
  /** Square viewBox the path is authored in. */
  viewBox: number
  /** SVG path data. */
  d: string
  /** The mark's own brand color (the material tints it). */
  color: string
}

export const BRAND_MARKS: Record<MarkId, BrandMark> = {
  // Claude's spark — the canonical simple-icons vector (viewBox 24).
  claude: {
    color: '#d97757',
    d: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
    viewBox: 24
  },
  // The opencode frame — outer square with a square hole (viewBox 24).
  opencode: { color: '#e8e8f2', d: 'M22 24H2V0h20zM17 4.8H7v14.4h10z', viewBox: 24 },
  // The X mark worn by Grok (viewBox 24).
  x: {
    color: '#e8e8f2',
    d: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
    viewBox: 24
  }
}

export interface MarkGeometryOptions {
  /** Longest side of the finished mark, world units. */
  size: number
  /** Slab thickness, world units. Defaults to 16% of `size`. */
  depth?: number
  /** Bevel size, world units. Defaults to 1.5% of `size`. */
  bevel?: number
  bevelSegments?: number
  curveSegments?: number
}

const cache = new Map<string, THREE.BufferGeometry>()

function parseShapes(mark: BrandMark): THREE.Shape[] {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${mark.d}"/></svg>`
  const { paths } = new SVGLoader().parse(svg)
  const shapes: THREE.Shape[] = []

  paths.forEach(path => {
    SVGLoader.createShapes(path).forEach(shape => shapes.push(shape))
  })

  return shapes
}

/** Bounding box of the authored paths, in viewBox units. */
function shapesBounds(shapes: THREE.Shape[]): THREE.Box2 {
  const box = new THREE.Box2()

  shapes.forEach(shape => {
    shape.getPoints(12).forEach(point => box.expandByPoint(point))
    shape.holes.forEach(hole => hole.getPoints(12).forEach(point => box.expandByPoint(point)))
  })

  return box
}

/**
 * A centered, size-normalized, beveled ExtrudeGeometry — memoized, so the live
 * body and the pre-warm body share one geometry.
 */
export function getMarkGeometry(id: MarkId, options: MarkGeometryOptions): THREE.BufferGeometry {
  const { size } = options
  const depth = options.depth ?? size * 0.16
  const bevel = options.bevel ?? size * 0.015
  const bevelSegments = options.bevelSegments ?? 2
  const curveSegments = options.curveSegments ?? 12
  const key = `${id}|${size}|${depth}|${bevel}|${bevelSegments}|${curveSegments}`

  const cached = cache.get(key)

  if (cached) {
    return cached
  }

  const mark = BRAND_MARKS[id]
  const shapes = parseShapes(mark)
  const bounds = shapesBounds(shapes)
  const nominalSpan = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, Number.EPSILON)
  // Extrude in viewBox units against a nominal scale, then rescale to the
  // measured bounds: the bevel grows the silhouette, so the shape bounds alone
  // would leave the finished mark a couple of percent oversized.
  const nominalScale = size / nominalSpan

  const geometry = mergeGeometries(
    shapes.map(
      shape =>
        new THREE.ExtrudeGeometry(shape, {
          bevelEnabled: true,
          bevelSegments,
          bevelSize: (bevel * 0.6) / nominalScale,
          bevelThickness: bevel / nominalScale,
          curveSegments,
          depth: depth / nominalScale
        })
    )
  )

  // SVG y grows down; rotate (not a negative scale) so normals stay outward.
  geometry.rotateX(Math.PI)
  geometry.computeBoundingBox()
  const measured = geometry.boundingBox

  const span = Math.max(
    measured ? measured.max.x - measured.min.x : nominalSpan,
    measured ? measured.max.y - measured.min.y : nominalSpan,
    Number.EPSILON
  )

  const scale = size / span

  geometry.scale(scale, scale, scale)
  geometry.center()
  cache.set(key, geometry)

  return geometry
}
