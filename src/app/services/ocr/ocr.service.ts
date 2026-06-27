import { requestUrl } from 'obsidian'
import type { ImageFormat } from '../../domain/image-format'
import { imageFormatToMime } from '../../domain/image-format'

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
 * Throws on any failure (non-200, malformed body, network error) so the caller
 * can fail-soft for that one page without corrupting the rest of the sync.
 */
export async function ocrPageImage(
    url: string,
    imageData: ArrayBuffer,
    format: ImageFormat
): Promise<string> {
    const mime = imageFormatToMime(format)
    const ext = format === 'jpeg' ? 'jpg' : format
    const boundary = `----rmobsidianocr${Date.now().toString(16)}`
    const body = buildMultipartBody(boundary, 'image', `page.${ext}`, mime, imageData)

    const response = await requestUrl({
        url,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
        throw: false
    })

    if (response.status !== 200) {
        throw new Error(describeOcrError(response.status, response.json, response.text))
    }

    const data = response.json as { markdown?: unknown } | null
    if (!data || typeof data.markdown !== 'string') {
        throw new Error('OCR server response did not contain a markdown string')
    }
    return data.markdown
}
