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

            // Per-page OCR state from the previous sync, so an unchanged page is
            // neither re-OCR'd nor re-sent to the OCR endpoint.
            const ocrEnabled = settings.ocrEnabled
            const prevPages = plugin.syncStoreService.getState(notebook.id)?.pages ?? {}
            const ocrUpdates: OcrPageInput[] = []
            const nextPages: Record<string, PageOcrState> = {}

            // Step 3: Render each page
            for (let i = 0; i < contentPages.length; i++) {
                const page = contentPages[i]!
                const pageIndex = page.pageIndex

                // Render page to image
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

                if (ocrEnabled) {
                    const prev = prevPages[page.pageId]
                    if (!imageData) {
                        // Render produced no image → keep any prior OCR state and
                        // its block intact (don't drop it as if the page were gone).
                        if (prev) {
                            nextPages[page.pageId] = prev
                        }
                    } else {
                        const srcHash = hashBytes(imageData)
                        if (prev && prev.srcHash === srcHash) {
                            // Source unchanged → keep prior OCR; no endpoint call, no
                            // block rewrite.
                            nextPages[page.pageId] = prev
                        } else {
                            try {
                                const markdown = await ocrPageImage(
                                    settings.mdserverOcrUrl,
                                    imageData,
                                    settings.imageFormat
                                )
                                const ocrHash = computeOcrHash(markdown)
                                ocrUpdates.push({
                                    pageId: page.pageId,
                                    pageIndex,
                                    label: `Page ${pageIndex + 1}`,
                                    markdown,
                                    srcHash,
                                    ocrHash
                                })
                                nextPages[page.pageId] = {
                                    pageId: page.pageId,
                                    srcHash,
                                    ocrHash
                                }
                            } catch (error) {
                                // Fail-soft: one page's OCR failure must not abort
                                // the sync or wipe the note. Leave the prior block
                                // intact; carry forward old state (still ≠ srcHash)
                                // so the next sync retries this page.
                                log(
                                    `OCR failed for ${notebook.visibleName} page ${pageIndex + 1}`,
                                    'warn',
                                    error
                                )
                                if (prev) {
                                    nextPages[page.pageId] = prev
                                }
                            }
                        }
                    }
                }
            }

            // Assemble one markdown note per notebook (newest page on top). On a
            // write failure, roll the updated pages' state back so they retry.
            if (ocrEnabled && ocrUpdates.length > 0) {
                try {
                    const mdPath = buildNotebookMarkdownPath(
                        settings.targetFolder,
                        notebook.visibleName
                    )
                    const existing = await readNotebookMarkdown(plugin.app.vault, mdPath)
                    const assembled = assembleNotebookMarkdown(existing, ocrUpdates)
                    await writeNotebookMarkdown(plugin.app.vault, mdPath, assembled)
                } catch (error) {
                    log(`Failed to write OCR markdown for ${notebook.visibleName}`, 'error', error)
                    for (const update of ocrUpdates) {
                        const prev = prevPages[update.pageId]
                        if (prev) {
                            nextPages[update.pageId] = prev
                        } else {
                            delete nextPages[update.pageId]
                        }
                    }
                }
            }

            onProgress({ status: 'done', currentPage: totalPages, totalPages })
            new Notice(`${notebook.visibleName}: Processed ${totalPages} pages`)

            // Update sync state. Persist per-page OCR state only when OCR ran and
            // produced at least one entry; an empty map would otherwise wipe prior
            // OCR progress (e.g. a transient run where every page failed to render).
            // When omitted, updateState leaves existing OCR state untouched.
            const lastModifiedCloud = parseInt(notebook.lastModified, 10) || Date.now()
            const persistPages =
                ocrEnabled && Object.keys(nextPages).length > 0 ? nextPages : undefined
            await plugin.syncStoreService.updateState(
                notebook.id,
                lastModifiedCloud,
                totalPages,
                persistPages
            )

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
