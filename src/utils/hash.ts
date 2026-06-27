/**
 * Small, dependency-free, non-cryptographic hash used purely for change
 * detection (per-page source image + OCR markdown). Not used for any security
 * purpose. Based on cyrb53 — fast, good distribution, returns a stable hex
 * string so it can live inside a managed-block marker and the sync store.
 */
export function hashBytes(data: ArrayBuffer): string {
    const bytes = new Uint8Array(data)
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let i = 0; i < bytes.length; i++) {
        const ch = bytes[i]!
        h1 = Math.imul(h1 ^ ch, 2654435761)
        h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    const result = 4294967296 * (2097151 & h2) + (h1 >>> 0)
    return result.toString(16)
}

/**
 * Hash a string (UTF-8). Used for the OCR markdown hash (`ocrHash`).
 */
export function hashString(value: string): string {
    return hashBytes(new TextEncoder().encode(value).buffer)
}
