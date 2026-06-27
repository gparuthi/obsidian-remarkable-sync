import { test, expect, describe } from 'bun:test'
import { hashBytes, hashString } from './hash'

describe('hash', () => {
    test('is deterministic for the same input', () => {
        expect(hashString('hello world')).toBe(hashString('hello world'))
    })

    test('differs for different input', () => {
        expect(hashString('hello world')).not.toBe(hashString('hello worle'))
    })

    test('is sensitive to small byte changes', () => {
        const a = new Uint8Array([1, 2, 3, 4]).buffer
        const b = new Uint8Array([1, 2, 3, 5]).buffer
        expect(hashBytes(a)).not.toBe(hashBytes(b))
    })

    test('hashString equals hashBytes of its UTF-8 encoding', () => {
        const s = 'transcribed page ✓'
        expect(hashString(s)).toBe(hashBytes(new TextEncoder().encode(s).buffer))
    })

    test('empty input hashes stably', () => {
        expect(hashString('')).toBe(hashBytes(new ArrayBuffer(0)))
    })

    test('returns a hex string', () => {
        expect(hashString('abc')).toMatch(/^[0-9a-f]+$/)
    })
})
