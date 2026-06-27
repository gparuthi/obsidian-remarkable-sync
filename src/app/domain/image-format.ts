/**
 * Image encodings the renderer can produce. Mirrors the `imageFormat` setting.
 */
export type ImageFormat = 'png' | 'jpeg' | 'webp'

/**
 * Map an image format to its MIME type (for multipart upload headers etc.).
 */
export function imageFormatToMime(format: ImageFormat): string {
    switch (format) {
        case 'png':
            return 'image/png'
        case 'webp':
            return 'image/webp'
        case 'jpeg':
            return 'image/jpeg'
    }
}
