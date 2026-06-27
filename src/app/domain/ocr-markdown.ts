import { hashString } from '../../utils/hash'

/**
 * One page's OCR result to merge into a notebook's markdown note.
 */
export interface OcrPageInput {
    readonly pageId: string
    /** 0-based page index; used only to order newly-inserted pages (newest on top). */
    readonly pageIndex: number
    /** Heading shown for the page, e.g. "Page 3". */
    readonly label: string
    /** Raw markdown returned by the OCR endpoint. */
    readonly markdown: string
    /** Hash of the source page image that was OCR'd. */
    readonly srcHash: string
    /** Hash of the OCR markdown — must equal {@link computeOcrHash}(markdown). */
    readonly ocrHash: string
}

interface ParsedBlock {
    readonly pageId: string
    readonly srcHash: string
    readonly ocrHash: string
    readonly label: string
    readonly body: string
    readonly openStart: number
    readonly closeEnd: number
}

/**
 * Canonicalize a block body before hashing/writing: normalize newlines, neutralize
 * any literal HTML-comment opener so OCR text can never forge or prematurely close a
 * managed-block marker (`<!--` → `&lt;!--`, which renders as visible text in
 * Obsidian), and drop trailing whitespace. Applied symmetrically on write and read,
 * so a round-trip hashes identically.
 */
export function normalizeBody(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/<!--/g, '&lt;!--').replace(/\s+$/, '')
}

/**
 * Hash of a page's OCR markdown, as stored in the block's `ocr=` marker. Both
 * the writer and the anti-clobber reader use this so they agree bit-for-bit.
 */
export function computeOcrHash(markdown: string): string {
    return hashString(normalizeBody(markdown))
}

function closeMarker(pageId: string): string {
    return `<!-- /rm:page=${pageId} -->`
}

/**
 * Render one managed block. The `ocrHash` is taken from the input (computed once
 * by the caller via {@link computeOcrHash}); the body written is the normalized
 * markdown so it round-trips to the same hash.
 */
export function renderBlock(input: OcrPageInput): string {
    const body = normalizeBody(input.markdown)
    return (
        `<!-- rm:page=${input.pageId} src=${input.srcHash} ocr=${input.ocrHash} -->\n` +
        `## ${input.label}\n` +
        `${body}\n` +
        closeMarker(input.pageId)
    )
}

/**
 * Demote a hand-edited block to a collapsed "superseded" callout that preserves
 * exactly what the user had written, with the rm markers stripped (so it is no
 * longer a managed block and will never be rewritten).
 */
function renderSuperseded(block: ParsedBlock): string {
    const quoted = block.body
        .split('\n')
        .map((line) => (line.length > 0 ? `> ${line}` : '>'))
        .join('\n')
    return `> [!note]- superseded (you edited this)\n${quoted}`
}

/**
 * Parse all managed blocks out of a notebook markdown file. Everything else is
 * treated as untouchable user content. Malformed blocks (no matching close
 * marker) are ignored and left as raw text.
 */
export function parseManagedBlocks(content: string): ParsedBlock[] {
    const blocks: ParsedBlock[] = []
    // Local regex: a fresh `lastIndex` per call, no shared mutable state.
    const openMarkerRe = /<!-- rm:page=(\S+) src=(\S+) ocr=(\S+) -->/g
    let match: RegExpExecArray | null
    while ((match = openMarkerRe.exec(content)) !== null) {
        const pageId = match[1]!
        const srcHash = match[2]!
        const ocrHash = match[3]!
        const openStart = match.index
        const afterOpen = openMarkerRe.lastIndex

        const close = closeMarker(pageId)
        const closeIdx = content.indexOf(close, afterOpen)
        if (closeIdx === -1) {
            continue // malformed/unterminated — leave as raw text
        }
        const closeEnd = closeIdx + close.length

        // inner = "\n## label\nbody\n" between the two markers
        const inner = content.slice(afterOpen, closeIdx).replace(/^\r?\n/, '')
        let label = ''
        let bodyRaw = inner
        if (inner.startsWith('## ')) {
            const nl = inner.indexOf('\n')
            const headingLine = nl === -1 ? inner : inner.slice(0, nl)
            label = headingLine.slice(3).trim()
            bodyRaw = nl === -1 ? '' : inner.slice(nl + 1)
        }

        blocks.push({
            pageId,
            srcHash,
            ocrHash,
            label,
            body: normalizeBody(bodyRaw),
            openStart,
            closeEnd
        })

        // Skip past this block so a marker inside the body can't be re-matched.
        openMarkerRe.lastIndex = closeEnd
    }
    return blocks
}

/**
 * Assemble a notebook's markdown note from its existing content plus the OCR
 * results for the pages that are new or changed this sync.
 *
 * Rules (see goal):
 * - New page → its block is inserted at the TOP of the managed region (newest
 *   page on top; when several arrive at once the highest page index ends up
 *   topmost).
 * - Changed page (its block exists) → re-OCR'd block replaces the old one in
 *   place.
 * - Anti-clobber: if the on-disk block body no longer matches its `ocr=` marker
 *   (the user hand-edited inside it), the fresh block is inserted just above and
 *   the user's edited block is demoted to a collapsed "superseded" callout
 *   rather than being overwritten.
 * - Content outside any managed block is never touched.
 *
 * Unchanged pages must NOT be passed in `updates` (the caller skips them); their
 * blocks are left exactly as they are on disk.
 */
export function assembleNotebookMarkdown(existingContent: string, updates: OcrPageInput[]): string {
    if (updates.length === 0) {
        return existingContent
    }

    const blocks = parseManagedBlocks(existingContent)
    const blockByPageId = new Map<string, ParsedBlock>()
    for (const b of blocks) {
        blockByPageId.set(b.pageId, b)
    }

    const newUpdates: OcrPageInput[] = []
    const replacementByStart = new Map<number, string>()

    for (const update of updates) {
        const existing = blockByPageId.get(update.pageId)
        if (!existing) {
            newUpdates.push(update)
            continue
        }
        const handEdited = computeOcrHash(existing.body) !== existing.ocrHash
        const replacement = handEdited
            ? `${renderBlock(update)}\n\n${renderSuperseded(existing)}`
            : renderBlock(update)
        replacementByStart.set(existing.openStart, replacement)
    }

    // Newly-inserted pages: newest (highest index) first so it lands at the top.
    const newRegion =
        newUpdates.length > 0
            ? [...newUpdates]
                  .sort((a, b) => b.pageIndex - a.pageIndex)
                  .map(renderBlock)
                  .join('\n\n')
            : ''

    let result: string
    if (blocks.length === 0) {
        // No managed region yet: create it at the top, keeping any user content
        // verbatim below it (never strip/alter content outside a block).
        result =
            existingContent.trim().length > 0 ? `${newRegion}\n\n${existingContent}` : newRegion
    } else {
        const blocksAsc = [...blocks].sort((a, b) => a.openStart - b.openStart)
        const firstBlockStart = blocksAsc[0]!.openStart
        const parts: string[] = []
        let cursor = 0
        for (const b of blocksAsc) {
            parts.push(existingContent.slice(cursor, b.openStart))
            if (b.openStart === firstBlockStart && newRegion.length > 0) {
                parts.push(`${newRegion}\n\n`)
            }
            parts.push(
                replacementByStart.get(b.openStart) ??
                    existingContent.slice(b.openStart, b.closeEnd)
            )
            cursor = b.closeEnd
        }
        parts.push(existingContent.slice(cursor))
        result = parts.join('')
    }

    return result.replace(/\n*$/, '\n')
}
