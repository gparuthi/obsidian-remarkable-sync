import type { Stroke } from '../../domain/notebook'
import { ERASER_PEN_TYPES, PEN_WIDTH_MULTIPLIER } from '../../domain/rm-constants'

export interface StrokesBounds {
    readonly minX: number
    readonly maxX: number
    readonly minY: number
    readonly maxY: number
}

/**
 * Compute the axis-aligned bounding box of all visible strokes in stroke
 * coordinate space.
 *
 * - X is centered around 0 in the .rm file format (range roughly
 *   -PAGE_WIDTH/2 .. +PAGE_WIDTH/2 for a non-scrolling page).
 * - Y is top-anchored at 0 and can extend well beyond PAGE_HEIGHT for pages
 *   that the user scrolled while writing on the device. Issue #3.
 *
 * Each point is expanded by its rendered radius (point.width *
 * widthMultiplier * stroke.thickness / 2) so that stroke edges aren't clipped
 * when the canvas is sized from these bounds.
 *
 * Returns null when the page has no renderable content (no strokes or only
 * eraser strokes).
 */
export function computeStrokesBounds(strokes: readonly Stroke[]): StrokesBounds | null {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let hasAnyPoint = false

    for (const stroke of strokes) {
        if (ERASER_PEN_TYPES.has(stroke.penType)) continue
        const widthMultiplier = PEN_WIDTH_MULTIPLIER[stroke.penType] ?? 1.0
        for (const p of stroke.points) {
            const radius = Math.max((p.width * widthMultiplier * stroke.thickness) / 2, 0.5)
            const xMin = p.x - radius
            const xMax = p.x + radius
            const yMin = p.y - radius
            const yMax = p.y + radius
            if (xMin < minX) minX = xMin
            if (xMax > maxX) maxX = xMax
            if (yMin < minY) minY = yMin
            if (yMax > maxY) maxY = yMax
            hasAnyPoint = true
        }
    }

    return hasAnyPoint ? { minX, maxX, minY, maxY } : null
}
