import { requestUrl } from 'obsidian'
import type { ImageFormat } from '../../domain/image-format'
import { imageFormatToMime } from '../../domain/image-format'
import { sleep as defaultSleep } from '../../../utils/sleep'

export const DEFAULT_OCR_MAX_RETRIES = 5
export const DEFAULT_OCR_BASE_DELAY_MS = 500
export const DEFAULT_OCR_MAX_DELAY_MS = 30_000

export interface OcrRequestOptions {
    /** Max retries on a retryable status (429 / 5xx) before giving up. */
    maxRetries?: number
    /** Base delay for exponential backoff (doubled each attempt). */
    baseDelayMs?: number
    /** Ceiling for any single backoff wait. */
    maxDelayMs?: number
    /** Injectable sleep (tests); defaults to a real timer. */
    sleep?: (ms: number) => Promise<void>
    /** Injectable clock for Retry-After date math (tests); defaults to Date.now. */
    now?: () => number
    /** Called before each backoff wait so the UI can surface a status. */
    onRateLimit?: (info: { attempt: number; delayMs: number; status: number }) => void
}

/** A 429 or any 5xx is worth retrying; everything else is fatal for the page. */
export function isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 599)
}

/**
 * Parse a `Retry-After` header into milliseconds. Supports both forms: an integer
 * count of delta-seconds, and an HTTP-date. Returns undefined if absent/unparseable.
 */
export function parseRetryAfterMs(header: string | undefined, nowMs: number): number | undefined {
    if (header === undefined) {
        return undefined
    }
    const trimmed = header.trim()
    if (trimmed === '') {
        return undefined
    }
    if (/^\d+$/.test(trimmed)) {
        return parseInt(trimmed, 10) * 1000
    }
    const dateMs = Date.parse(trimmed)
    if (!Number.isNaN(dateMs)) {
        return Math.max(0, dateMs - nowMs)
    }
    return undefined
}

/**
 * Backoff (ms) for a retry attempt (0-based). Honors `Retry-After` when the server
 * supplied one; otherwise exponential `base * 2^attempt`. Always capped at maxDelay.
 */
export function computeBackoffMs(
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number,
    retryAfterMs: number | undefined
): number {
    if (retryAfterMs !== undefined) {
        return Math.min(maxDelayMs, retryAfterMs)
    }
    return Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt))
}

/** Case-insensitive header lookup (header casing varies across platforms). */
function headerValue(
    headers: Record<string, string> | undefined,
    name: string
): string | undefined {
    if (!headers) {
        return undefined
    }
    const lower = name.toLowerCase()
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) {
            return headers[key]
        }
    }
    return undefined
}

/**
 * Build a `multipart/form-data` request body holding a single file field.
 *
 * Obsidian's `requestUrl` does not accept a `FormData` instance, so we assemble
 * the multipart body by hand as an ArrayBuffer. Pure (no I/O) so it is unit
 * testable. The caller must send `Content-Type: multipart/form-data;
 * boundary=<boundary>`.
 */
export function buildMultipartBody(
    boundary: string,
    fieldName: string,
    filename: string,
    contentType: string,
    data: ArrayBuffer
): ArrayBuffer {
    const encoder = new TextEncoder()
    const head = encoder.encode(
        `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
            `Content-Type: ${contentType}\r\n\r\n`
    )
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
    const dataBytes = new Uint8Array(data)

    const body = new Uint8Array(head.length + dataBytes.length + tail.length)
    body.set(head, 0)
    body.set(dataBytes, head.length)
    body.set(tail, head.length + dataBytes.length)
    return body.buffer
}

/**
 * Extract a human-readable error message from a non-200 `/ocr` response,
 * preferring the `{"error": ...}` field the server documents.
 */
function describeOcrError(status: number, json: unknown, text: string): string {
    if (json && typeof json === 'object' && 'error' in json) {
        const err = (json as { error?: unknown }).error
        if (typeof err === 'string' && err.length > 0) {
            return `OCR server returned HTTP ${status}: ${err}`
        }
    }
    const snippet = text.trim().slice(0, 200)
    return snippet
        ? `OCR server returned HTTP ${status}: ${snippet}`
        : `OCR server returned HTTP ${status}`
}

/**
 * Send a single page image to the local OCR endpoint and return its markdown.
 *
 * Contract (md_capture_server `/ocr`): POST multipart/form-data with field
 * `image` = the page image → `200 application/json {"markdown": "<text>"}`;
 * non-200 → `{"error": "<msg>"}`. The Mistral key never leaves the server; this
 * plugin only talks to the configured localhost URL.
 *
 * Retries a 429 / 5xx with exponential backoff, honoring `Retry-After` when the
 * server sends it, up to `maxRetries`. After the cap (or on any non-retryable
 * status / malformed body) it throws, so the caller can fail-soft for that one
 * page without aborting the whole notebook.
 */
export async function ocrPageImage(
    url: string,
    imageData: ArrayBuffer,
    format: ImageFormat,
    options: OcrRequestOptions = {}
): Promise<string> {
    const maxRetries = options.maxRetries ?? DEFAULT_OCR_MAX_RETRIES
    const baseDelayMs = options.baseDelayMs ?? DEFAULT_OCR_BASE_DELAY_MS
    const maxDelayMs = options.maxDelayMs ?? DEFAULT_OCR_MAX_DELAY_MS
    const sleep = options.sleep ?? defaultSleep
    const now = options.now ?? ((): number => Date.now())

    const mime = imageFormatToMime(format)
    const ext = format === 'jpeg' ? 'jpg' : format
    const boundary = `----rmobsidianocr${now().toString(16)}`
    const body = buildMultipartBody(boundary, 'image', `page.${ext}`, mime, imageData)

    for (let attempt = 0; ; attempt++) {
        const response = await requestUrl({
            url,
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
            body,
            throw: false
        })

        if (response.status === 200) {
            const data = response.json as { markdown?: unknown } | null
            if (!data || typeof data.markdown !== 'string') {
                throw new Error('OCR server response did not contain a markdown string')
            }
            return data.markdown
        }

        if (!isRetryableStatus(response.status) || attempt >= maxRetries) {
            throw new Error(describeOcrError(response.status, response.json, response.text))
        }

        const retryAfterMs = parseRetryAfterMs(headerValue(response.headers, 'Retry-After'), now())
        const delayMs = computeBackoffMs(attempt, baseDelayMs, maxDelayMs, retryAfterMs)
        options.onRateLimit?.({ attempt: attempt + 1, delayMs, status: response.status })
        await sleep(delayMs)
    }
}
