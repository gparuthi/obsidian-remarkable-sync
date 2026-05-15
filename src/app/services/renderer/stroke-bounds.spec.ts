import { test, expect, describe } from 'bun:test'
import { computeStrokesBounds } from './stroke-bounds'
import { PenType, StrokeColor } from '../../domain/notebook'
import type { Stroke, StrokePoint } from '../../domain/notebook'

function makePoint(x: number, y: number, width = 0): StrokePoint {
    return { x, y, speed: 0, width, direction: 0, pressure: 0 }
}

function makeStroke(
    penType: PenType,
    points: StrokePoint[],
    thickness = 1,
    color = StrokeColor.Black
): Stroke {
    return { penType, color, thickness, points }
}

describe('computeStrokesBounds', () => {
    test('returns null for empty stroke array', () => {
        expect(computeStrokesBounds([])).toBeNull()
    })

    test('returns null when only eraser strokes are present', () => {
        const strokes: Stroke[] = [
            makeStroke(PenType.Eraser, [makePoint(0, 0)]),
            makeStroke(PenType.EraseArea, [makePoint(100, 100)])
        ]
        expect(computeStrokesBounds(strokes)).toBeNull()
    })

    test('returns null when strokes have no points', () => {
        const strokes: Stroke[] = [makeStroke(PenType.Fineliner, [])]
        expect(computeStrokesBounds(strokes)).toBeNull()
    })

    test('single zero-width point produces a half-pixel halo', () => {
        const strokes: Stroke[] = [makeStroke(PenType.Fineliner, [makePoint(10, 20, 0)])]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        // Minimum radius is clamped to 0.5 so bounds become a 1px box around the point.
        expect(bounds!.minX).toBe(9.5)
        expect(bounds!.maxX).toBe(10.5)
        expect(bounds!.minY).toBe(19.5)
        expect(bounds!.maxY).toBe(20.5)
    })

    test('expands bounds by per-point rendered radius', () => {
        // BallPoint multiplier is 0.5, thickness 2, point.width 4 → radius 2.0
        const strokes: Stroke[] = [makeStroke(PenType.BallPoint, [makePoint(0, 0, 4)], 2)]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        expect(bounds!.minX).toBe(-2)
        expect(bounds!.maxX).toBe(2)
        expect(bounds!.minY).toBe(-2)
        expect(bounds!.maxY).toBe(2)
    })

    test('aggregates across multiple strokes and points', () => {
        const strokes: Stroke[] = [
            makeStroke(PenType.Fineliner, [makePoint(-100, 50), makePoint(100, 50)]),
            makeStroke(PenType.Fineliner, [makePoint(0, 2000), makePoint(0, 3000)])
        ]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        // Fineliner: multiplier 0.25, thickness 1, width 0 → radius clamped to 0.5
        expect(bounds!.minX).toBe(-100.5)
        expect(bounds!.maxX).toBe(100.5)
        expect(bounds!.minY).toBe(49.5)
        expect(bounds!.maxY).toBe(3000.5)
    })

    test('handles content extending below the standard page height (issue #3)', () => {
        // A user who scrolled while writing produces strokes well past PAGE_HEIGHT (1872).
        const strokes: Stroke[] = [
            makeStroke(PenType.Fineliner, [makePoint(0, 0), makePoint(0, 5000)])
        ]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        expect(bounds!.maxY).toBeGreaterThan(1872)
    })

    test('handles negative Y values', () => {
        const strokes: Stroke[] = [
            makeStroke(PenType.Fineliner, [makePoint(0, -50), makePoint(0, 50)])
        ]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        expect(bounds!.minY).toBe(-50.5)
        expect(bounds!.maxY).toBe(50.5)
    })

    test('ignores eraser strokes when other strokes are present', () => {
        const strokes: Stroke[] = [
            makeStroke(PenType.Eraser, [makePoint(-9999, -9999)]),
            makeStroke(PenType.Fineliner, [makePoint(0, 0)])
        ]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        // Eraser bounds at -9999 must NOT extend the box.
        expect(bounds!.minX).toBeGreaterThan(-1)
        expect(bounds!.minY).toBeGreaterThan(-1)
    })
})
