import { test, expect, describe, spyOn, afterEach } from 'bun:test'
import * as obsidian from 'obsidian'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import {
    buildMultipartBody,
    computeBackoffMs,
    isRetryableStatus,
    ocrPageImage,
    parseRetryAfterMs
} from './ocr.service'

function decode(buffer: ArrayBuffer): string {
    return new TextDecoder().decode(buffer)
}

function response(partial: Partial<RequestUrlResponse>): RequestUrlResponse {
    return {
        status: 200,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
        json: {},
        text: '',
        ...partial
    }
}

describe('buildMultipartBody', () => {
    test('wraps the data with multipart headers and boundary', () => {
        const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer
        const body = buildMultipartBody('BOUND', 'image', 'page.jpg', 'image/jpeg', data)
        const text = decode(body)

        expect(text).toContain('--BOUND\r\n')
        expect(text).toContain(
            'Content-Disposition: form-data; name="image"; filename="page.jpg"\r\n'
        )
        expect(text).toContain('Content-Type: image/jpeg\r\n\r\n')
        expect(text).toMatch(/\r\n--BOUND--\r\n$/)
    })

    test('embeds the raw data bytes intact', () => {
        const data = new Uint8Array([1, 2, 3, 250, 251, 252]).buffer
        const body = new Uint8Array(buildMultipartBody('B', 'image', 'p.png', 'image/png', data))
        const needle = [1, 2, 3, 250, 251, 252]
        let found = false
        for (let i = 0; i + needle.length <= body.length; i++) {
            if (needle.every((b, j) => body[i + j] === b)) {
                found = true
                break
            }
        }
        expect(found).toBe(true)
    })
})

describe('isRetryableStatus', () => {
    test('429 and 5xx are retryable', () => {
        expect(isRetryableStatus(429)).toBe(true)
        expect(isRetryableStatus(500)).toBe(true)
        expect(isRetryableStatus(503)).toBe(true)
    })
    test('200 and non-429 4xx are not retryable', () => {
        expect(isRetryableStatus(200)).toBe(false)
        expect(isRetryableStatus(400)).toBe(false)
        expect(isRetryableStatus(401)).toBe(false)
    })
})

describe('parseRetryAfterMs', () => {
    test('parses delta-seconds', () => {
        expect(parseRetryAfterMs('3', 0)).toBe(3000)
    })
    test('parses an HTTP-date relative to now', () => {
        expect(parseRetryAfterMs(new Date(10_000).toUTCString(), 0)).toBe(10_000)
    })
    test('clamps a past date to 0', () => {
        expect(parseRetryAfterMs(new Date(1000).toUTCString(), 5000)).toBe(0)
    })
    test('returns undefined for absent/blank/garbage', () => {
        expect(parseRetryAfterMs(undefined, 0)).toBeUndefined()
        expect(parseRetryAfterMs('   ', 0)).toBeUndefined()
        expect(parseRetryAfterMs('soon', 0)).toBeUndefined()
    })
})

describe('computeBackoffMs', () => {
    test('exponential on the attempt index', () => {
        expect(computeBackoffMs(0, 500, 30_000, undefined)).toBe(500)
        expect(computeBackoffMs(3, 500, 30_000, undefined)).toBe(4000)
    })
    test('caps at maxDelay', () => {
        expect(computeBackoffMs(20, 500, 30_000, undefined)).toBe(30_000)
    })
    test('Retry-After wins, still capped at maxDelay', () => {
        expect(computeBackoffMs(0, 500, 30_000, 2000)).toBe(2000)
        expect(computeBackoffMs(0, 500, 1000, 5000)).toBe(1000)
    })
})

describe('ocrPageImage', () => {
    let spy: { mockRestore: () => void } | undefined
    let lastRequest: RequestUrlParam | undefined
    let requestCount = 0

    function stubSequence(responses: RequestUrlResponse[]): void {
        let i = 0
        const impl = (param: RequestUrlParam | string): Promise<RequestUrlResponse> => {
            lastRequest = typeof param === 'string' ? undefined : param
            requestCount++
            const resp = responses[Math.min(i, responses.length - 1)]!
            i++
            return Promise.resolve(resp)
        }
        spy = spyOn(obsidian, 'requestUrl').mockImplementation(impl as typeof obsidian.requestUrl)
    }

    const noSleep = (): Promise<void> => Promise.resolve()
    const fixedNow = (): number => 0

    async function expectRejects(promise: Promise<unknown>): Promise<Error> {
        try {
            await promise
        } catch (error) {
            return error instanceof Error ? error : new Error(String(error))
        }
        throw new Error('expected the call to reject')
    }

    afterEach(() => {
        spy?.mockRestore()
        spy = undefined
        lastRequest = undefined
        requestCount = 0
    })

    test('posts multipart and returns markdown on 200', async () => {
        stubSequence([response({ status: 200, json: { markdown: '# Page text\n- [ ] todo' } })])

        const markdown = await ocrPageImage('http://localhost:1250/ocr', new ArrayBuffer(8), 'jpeg')

        expect(markdown).toBe('# Page text\n- [ ] todo')
        expect(lastRequest?.method).toBe('POST')
        expect(lastRequest?.headers?.['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
    })

    test('retries a 429 then succeeds on the next 200', async () => {
        stubSequence([
            response({ status: 429, json: { error: 'rate_limited' } }),
            response({ status: 200, json: { markdown: 'ok' } })
        ])
        const slept: number[] = []

        const markdown = await ocrPageImage(
            'http://localhost:1250/ocr',
            new ArrayBuffer(4),
            'jpeg',
            {
                baseDelayMs: 500,
                sleep: (ms) => {
                    slept.push(ms)
                    return Promise.resolve()
                },
                now: fixedNow
            }
        )

        expect(markdown).toBe('ok')
        expect(requestCount).toBe(2)
        expect(slept).toEqual([500]) // base * 2^0
    })

    test('honors Retry-After (seconds) over exponential backoff', async () => {
        stubSequence([
            response({ status: 429, headers: { 'Retry-After': '2' }, json: {} }),
            response({ status: 200, json: { markdown: 'ok' } })
        ])
        const slept: number[] = []

        const markdown = await ocrPageImage(
            'http://localhost:1250/ocr',
            new ArrayBuffer(4),
            'jpeg',
            {
                baseDelayMs: 500,
                sleep: (ms) => {
                    slept.push(ms)
                    return Promise.resolve()
                },
                now: fixedNow
            }
        )

        expect(markdown).toBe('ok')
        expect(slept).toEqual([2000])
    })

    test('calls onRateLimit before each backoff', async () => {
        stubSequence([
            response({ status: 503, json: {} }),
            response({ status: 200, json: { markdown: 'ok' } })
        ])
        const events: Array<{ attempt: number; status: number }> = []

        await ocrPageImage('http://localhost:1250/ocr', new ArrayBuffer(4), 'jpeg', {
            baseDelayMs: 1,
            sleep: noSleep,
            now: fixedNow,
            onRateLimit: (info) => events.push({ attempt: info.attempt, status: info.status })
        })

        expect(events).toEqual([{ attempt: 1, status: 503 }])
    })

    test('gives up after maxRetries on a persistent 429 and reports it', async () => {
        stubSequence([response({ status: 429, json: { error: 'rate_limited' } })])
        let sleeps = 0

        const error = await expectRejects(
            ocrPageImage('http://localhost:1250/ocr', new ArrayBuffer(4), 'jpeg', {
                maxRetries: 2,
                baseDelayMs: 10,
                sleep: () => {
                    sleeps++
                    return Promise.resolve()
                },
                now: fixedNow
            })
        )

        expect(error.message).toMatch(/429.*rate_limited/)
        expect(sleeps).toBe(2) // attempts 0 and 1 sleep; attempt 2 hits the cap and throws
        expect(requestCount).toBe(3)
    })

    test('throws immediately on a non-retryable status (no retries)', async () => {
        stubSequence([response({ status: 400, json: { error: 'bad image' } })])
        let sleeps = 0

        const error = await expectRejects(
            ocrPageImage('http://localhost:1250/ocr', new ArrayBuffer(4), 'png', {
                sleep: () => {
                    sleeps++
                    return Promise.resolve()
                }
            })
        )

        expect(error.message).toMatch(/400.*bad image/)
        expect(sleeps).toBe(0)
        expect(requestCount).toBe(1)
    })

    test('throws when the 200 body has no markdown string', async () => {
        stubSequence([response({ status: 200, json: {} })])

        const error = await expectRejects(
            ocrPageImage('http://localhost:1250/ocr', new ArrayBuffer(4), 'jpeg')
        )
        expect(error.message).toMatch(/markdown/)
    })
})
