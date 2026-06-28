import { Notice } from 'obsidian'
import { log } from '../../../utils/log'
import type { RemarkableSyncPlugin } from '../../plugin'
import type { NotebookSummary } from '../../domain/notebook'
import { pageHasContent } from '../parser/rm-file-parser'
import { parseDocument } from '../parser/document-parser.service'
import { renderPage } from '../renderer/page-renderer.service'
import {
    buildNotebookMarkdownPath,
    readNotebookMarkdown,
    writeNotebookMarkdown,
    writePageImage
} from '../output/markdown-writer.service'
import { ocrPageImage } from '../ocr/ocr.service'
import { assembleNotebookMarkdown, computeOcrHash } from '../../domain/ocr-markdown'
import type { OcrPageInput } from '../../domain/ocr-markdown'
import { hashBytes } from '../../../utils/hash'
import { sleep } from '../../../utils/sleep'
import type { PageOcrState } from '../../domain/sync-state'

export type PipelineStatus = 'idle' | 'downloading' | 'parsing' | 'rendering' | 'done' | 'error'

export interface PipelineProgress {
    status: PipelineStatus
    currentPage: number
    totalPages: number
    error?: string
}

export type ProgressCallback = (progress: PipelineProgress) => void

export interface NotebookPipelineService {
    processNotebook(notebook: NotebookSummary, onProgress: ProgressCallback): Promise<boolean>
}

export function createNotebookPipelineService(
    plugin: RemarkableSyncPlugin
): NotebookPipelineService {
    async function processNotebook(
        notebook: NotebookSummary,
        onProgress: ProgressCallback
    ): Promise<boolean> {
        const { settings } = plugin

        try {
            // Step 1: Download
            onProgress({ status: 'downloading', currentPage: 0, totalPages: 0 })
            const files = await plugin.cloudService.downloadDocument(notebook.id)
            if (!files) {
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: 'Download failed'
                })
                return false
            }

            // Step 2: Parse
            onProgress({ status: 'parsing', currentPage: 0, totalPages: 0 })
            const parsed = parseDocument(files, notebook.id)
            if (!parsed) {
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: 'Parse failed'
                })
                return false
            }

            // Filter out blank pages
            const contentPages = parsed.pages.filter(pageHasContent)

            if (contentPages.length === 0) {
                new Notice(`${notebook.visibleName}: No pages with content found`)
                onProgress({ status: 'done', currentPage: 0, totalPages: 0 })
                // Record sync state for blank notebooks too, so an unattended
                // all-notebooks sync skips this (unchanged) notebook on the next
                // tick instead of re-downloading it every interval.
                const lastModifiedCloud = parseInt(notebook.lastModified, 10) || Date.now()
                await plugin.syncStoreService.updateState(notebook.id, lastModifiedCloud, 0)
                return true
            }

            const totalPages = contentPages.length

            // Per-page OCR state from the previous sync. A page whose rendered image
            // hash is unchanged is skipped, so a re-sync RESUMES only the pages still
            // missing OCR — the syncStore IS the implicit worklist (no queue).
            const ocrEnabled = settings.ocrEnabled
            const prevState = plugin.syncStoreService.getState(notebook.id)
            const prevPages = prevState?.pages ?? {}
            // Keep the notebook's mtime at its prior value until every page is OCR'd,
            // so a partial run stays "needs sync" and the next sync resumes it.
            const prevMtime = prevState?.lastModifiedCloud ?? 0
            const lastModifiedCloud = parseInt(notebook.lastModified, 10) || Date.now()
            const nextPages: Record<string, PageOcrState> = {}
            const mdPath = buildNotebookMarkdownPath(settings.targetFolder, notebook.visibleName)
            const interDelayMs = Math.max(0, settings.ocrRequestDelayMs)
            let allPagesOcrd = true
            let madeOcrRequest = false

            // Step 3: Render (and, when enabled, OCR) each page — serially, one at a
            // time, never a parallel burst.
            for (let i = 0; i < contentPages.length; i++) {
                const page = contentPages[i]!
                const pageIndex = page.pageIndex

                onProgress({ status: 'rendering', currentPage: i + 1, totalPages })
                const imageData = await renderPage(
                    page,
                    settings.imageFormat,
                    settings.imageQuality
                )

                if (imageData && settings.saveImages) {
                    await writePageImage(
                        plugin.app.vault,
                        settings.targetFolder,
                        notebook.folderPath,
                        notebook.visibleName,
                        pageIndex,
                        imageData,
                        settings.imageFormat
                    )
                }

                if (!ocrEnabled) {
                    continue
                }

                const prev = prevPages[page.pageId]
                if (!imageData) {
                    // Couldn't render → keep prior OCR state/block; retry next sync.
                    if (prev) {
                        nextPages[page.pageId] = prev
                    }
                    allPagesOcrd = false
                    continue
                }

                const srcHash = hashBytes(imageData)
                if (prev && prev.srcHash === srcHash) {
                    // Already OCR'd and unchanged → skip (no request, no rewrite).
                    nextPages[page.pageId] = prev
                    continue
                }

                // Pace requests to stay under the OCR provider's rate limit.
                if (madeOcrRequest && interDelayMs > 0) {
                    await sleep(interDelayMs)
                }
                madeOcrRequest = true

                try {
                    const markdown = await ocrPageImage(
                        settings.mdserverOcrUrl,
                        imageData,
                        settings.imageFormat,
                        {
                            onRateLimit: ({ attempt, status }) => {
                                new Notice(
                                    `${notebook.visibleName}: rate limited (HTTP ${status}) — backing off, retrying page ${pageIndex + 1} (attempt ${attempt})`
                                )
                            }
                        }
                    )
                    const ocrHash = computeOcrHash(markdown)
                    nextPages[page.pageId] = { pageId: page.pageId, srcHash, ocrHash }

                    // Persist incrementally: write this page's block into the note and
                    // record its ocrHash NOW. A crash/restart then loses nothing and
                    // the next sync resumes from the still-missing pages. Pass a copy
                    // of nextPages so immer's frozen snapshot doesn't freeze our live
                    // working map.
                    try {
                        const existing = await readNotebookMarkdown(plugin.app.vault, mdPath)
                        const update: OcrPageInput = {
                            pageId: page.pageId,
                            pageIndex,
                            label: `Page ${pageIndex + 1}`,
                            markdown,
                            srcHash,
                            ocrHash
                        }
                        const assembled = assembleNotebookMarkdown(existing, [update])
                        await writeNotebookMarkdown(plugin.app.vault, mdPath, assembled)
                        await plugin.syncStoreService.updateState(
                            notebook.id,
                            prevMtime,
                            totalPages,
                            { ...nextPages }
                        )
                    } catch (writeError) {
                        // Persist failed → roll this page back so it retries next sync.
                        log(
                            `Failed to persist OCR page ${pageIndex + 1} for ${notebook.visibleName}`,
                            'error',
                            writeError
                        )
                        if (prev) {
                            nextPages[page.pageId] = prev
                        } else {
                            delete nextPages[page.pageId]
                        }
                        allPagesOcrd = false
                    }
                } catch (error) {
                    // Fail-soft after retries: surface a clear per-page error and keep
                    // going (don't abort the notebook). Leave the prior block/state
                    // intact so the next sync retries just this page.
                    log(
                        `OCR failed for ${notebook.visibleName} page ${pageIndex + 1}`,
                        'warn',
                        error
                    )
                    new Notice(
                        `${notebook.visibleName}: OCR failed for page ${pageIndex + 1} — will retry on next sync`
                    )
                    if (prev) {
                        nextPages[page.pageId] = prev
                    }
                    allPagesOcrd = false
                }
            }

            onProgress({ status: 'done', currentPage: totalPages, totalPages })
            new Notice(`${notebook.visibleName}: Processed ${totalPages} pages`)

            // Final sync-state write. Advance the cloud mtime only when OCR is off or
            // every page is OCR'd, so the notebook is considered "done"; otherwise keep
            // the prior mtime so the next sync re-enters and resumes the missing pages.
            if (ocrEnabled) {
                const persistPages =
                    Object.keys(nextPages).length > 0 ? { ...nextPages } : undefined
                const finalMtime = allPagesOcrd ? lastModifiedCloud : prevMtime
                await plugin.syncStoreService.updateState(
                    notebook.id,
                    finalMtime,
                    totalPages,
                    persistPages
                )
            } else {
                await plugin.syncStoreService.updateState(
                    notebook.id,
                    lastModifiedCloud,
                    totalPages
                )
            }

            return true
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            log(`Pipeline failed for ${notebook.visibleName}`, 'error', error)
            onProgress({ status: 'error', currentPage: 0, totalPages: 0, error: message })
            new Notice(`Error processing ${notebook.visibleName}: ${message}`)
            return false
        }
    }

    return { processNotebook }
}
