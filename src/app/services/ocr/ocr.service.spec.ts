import { test, expect, describe, spyOn, afterEach } from 'bun:test'
import * as obsidian from 'obsidian'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { buildMultipartBody, ocrPageImage } from './ocr.service'

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
        // The data bytes must appear verbatim somewhere in the body.
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

describe('ocrPageImage', () => {
    let spy: { mockRestore: () => void } | undefined
    let lastRequest: RequestUrlParam | undefined

    function stub(resp: RequestUrlResponse): void {
        const impl = (param: RequestUrlParam | string): Promise<RequestUrlResponse> => {
            lastRequest = typeof param === 'string' ? undefined : param
            return Promise.resolve(resp)
        }
        spy = spyOn(obsidian, 'requestUrl').mockImplementation(impl as typeof obsidian.requestUrl)
    }

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
    })

    test('posts multipart and returns markdown on 200', async () => {
        stub(response({ status: 200, json: { markdown: '# Page text\n- [ ] todo' } }))

        const markdown = await ocrPageImage('http://localhost:1250/ocr', new ArrayBuffer(8), 'jpeg')

        expect(markdown).toBe('# Page text\n- [ ] todo')
        expect(lastRequest?.method).toBe('POST')
        expect(lastRequest?.headers?.['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
    })

    test('throws with the server error message on non-200', async () => {
        stub(response({ status: 502, json: { error: 'upstream OCR failed' }, text: '' }))

        const error = await expectRejects(
            ocrPageImage('http://localhost:1250/ocr', new ArrayBuffer(4), 'png')
        )
        expect(error.message).toMatch(/502.*upstream OCR failed/)
    })

    test('throws when the 200 body has no markdown string', async () => {
        stub(response({ status: 200, json: {} }))

        const error = await expectRejects(
            ocrPageImage('http://localhost:1250/ocr', new ArrayBuffer(4), 'jpeg')
        )
        expect(error.message).toMatch(/markdown/)
    })
})
