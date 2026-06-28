---
title: Configuration
nav_order: 3
---

# Configuration

All settings are accessible via **Settings → Community plugins → Remarkable Synchronizer**.

## Settings

| Setting                      | Type     | Default                     | Description                                                                                     |
| ---------------------------- | -------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| Target folder                | text     | `""`                        | Vault-relative path where output files are saved. Leave empty for vault root.                   |
| Save images                  | toggle   | `true`                      | Save rendered page images                                                                       |
| Image format                 | dropdown | `jpeg`                      | Format for rendered images: JPEG, WebP, or PNG                                                  |
| Image quality                | slider   | `0.85`                      | Quality for JPEG/WebP (0.1 = smallest, 1.0 = best). Hidden when PNG is selected.                |
| Use rmfakecloud              | toggle   | `false`                     | Connect to a self-hosted rmfakecloud server instead of the official cloud                       |
| Server URL                   | text     | `""`                        | Base URL of your rmfakecloud server (only shown when rmfakecloud is enabled)                    |
| Transcribe pages to markdown | toggle   | `false`                     | OCR each new/changed synced page via a local server and assemble one markdown note per notebook |
| OCR server URL               | text     | `http://localhost:1250/ocr` | Local endpoint each page image is posted to (only used when transcription is enabled)           |
| OCR request delay (ms)       | text     | `400`                       | Pause between per-page OCR requests, to stay under the OCR provider rate limit (0 disables)     |

## OCR transcription

Enable **Transcribe pages to markdown** to turn synced page images into text. After a
sync, each new or changed page image is posted to the configured local OCR server,
which returns markdown. The plugin writes one note per notebook
(`{targetFolder}/{NotebookName}.md`) with the **newest page at the top**.

- Each page is wrapped in a managed `<!-- rm:page=… -->` block. Text you write
  **outside** those blocks is never modified.
- If you hand-edit inside a managed block, your edit is preserved: the next sync
  inserts the fresh transcription above it and moves your version into a collapsed
  `> [!note]- superseded` callout instead of overwriting it.
- Unchanged pages are skipped, so the OCR server is not called again for them.
- Only the page image is sent, and only to the URL you configure. The plugin holds
  no OCR/API keys — those stay on the local server.

### Rate limiting and resume

Pages are OCR'd **one at a time**, with the configurable **OCR request delay** between
requests to stay under the OCR provider's rate limit. If a request is rate-limited or
the server returns a transient error (HTTP 429 / 5xx), it is retried with exponential
backoff that honors the server's `Retry-After` header; after a few attempts the page is
skipped (non-fatal, surfaced as a Notice) and retried on the next sync.

Each page's transcription is persisted as soon as it succeeds. If a sync is interrupted
— Obsidian closed mid-run, or a persistent rate limit — the next sync **resumes from the
pages still missing OCR** rather than restarting the whole notebook, and never duplicates
pages. (Tip: lower **OCR request delay** to go faster, or raise it if you keep hitting
rate limits.)

## Image Formats

- **JPEG** (default) — lossy compression, small file size, good for handwritten notes
- **WebP** — lossy compression, smaller than JPEG at equivalent quality
- **PNG** — lossless, larger files, no quality slider

The quality slider controls the compression level for JPEG and WebP. Lower values produce smaller files; higher values preserve more detail. The slider is hidden when PNG is selected since PNG is always lossless.

## Authentication

The authentication section shows your connection status and provides connect/disconnect buttons.

Tokens are stored at `~/.remarkable-sync/token.json` (outside the vault for security). The user token auto-refreshes every 23 hours.

## rmfakecloud

To use a self-hosted [rmfakecloud](https://github.com/ddvk/rmfakecloud) server:

1. Enable **"Use rmfakecloud"** in the Cloud settings section
2. Enter your server URL (e.g., `https://cloud.example.com` or `http://localhost:3000`)
3. Disconnect and reconnect if you were previously connected to a different cloud

The server URL must be a valid HTTP or HTTPS URL. When enabled, all authentication and sync requests go to your rmfakecloud server instead of the official reMarkable cloud.

**Note:** Tokens are not transferable between clouds. Switching between official cloud and rmfakecloud requires disconnecting and reconnecting.

## About

The about section includes links to follow the developer and support the project.
