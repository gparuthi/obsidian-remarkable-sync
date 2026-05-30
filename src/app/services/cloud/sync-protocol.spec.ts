import { test, expect, describe, mock, beforeEach } from 'bun:test'
import { docIndexFilename, fetchBlob, parseIndex, ROOT_INDEX_FILENAME } from './sync-protocol'

interface RecordedRequest {
    url: string
    headers?: Record<string, string>
}

const recordedRequests: RecordedRequest[] = []

void mock.module('obsidian', () => ({
    requestUrl: async (options: { url: string; headers?: Record<string, string> }) => {
        recordedRequests.push({ url: options.url, headers: options.headers })
        return { status: 200, text: '', json: {}, arrayBuffer: new ArrayBuffer(8) }
    }
}))

describe('sync-protocol', () => {
    describe('fetchBlob rm-filename header', () => {
        beforeEach(() => {
            recordedRequests.length = 0
        })

        test('sends rm-filename and Authorization headers on /sync/v3/files/{hash}', async () => {
            await fetchBlob('token-abc', 'hash123', 'doc.metadata', 'https://sync.example')

            expect(recordedRequests.length).toBe(1)
            const req = recordedRequests[0]!
            expect(req.url).toBe('https://sync.example/sync/v3/files/hash123')
            expect(req.headers?.['rm-filename']).toBe('doc.metadata')
            expect(req.headers?.['Authorization']).toBe('Bearer token-abc')
        })

        test('ROOT_INDEX_FILENAME is "root.docSchema"', () => {
            expect(ROOT_INDEX_FILENAME).toBe('root.docSchema')
        })

        test('docIndexFilename appends ".docSchema" to the document id', () => {
            expect(docIndexFilename('uuid-1')).toBe('uuid-1.docSchema')
        })
    })

    describe('parseIndex', () => {
        test('parses entries with header lines', () => {
            const index = '3\n2\nabc123:80000000:folder-id-1:0:0\ndef456:0:doc-id-1:0:512\n'
            const entries = parseIndex(index)

            expect(entries.length).toBe(2)
            expect(entries[0]!.hash).toBe('abc123')
            expect(entries[0]!.type).toBe('80000000')
            expect(entries[0]!.id).toBe('folder-id-1')
            expect(entries[0]!.subfiles).toBe(0)
            expect(entries[0]!.size).toBe(0)
            expect(entries[1]!.hash).toBe('def456')
            expect(entries[1]!.type).toBe('0')
            expect(entries[1]!.id).toBe('doc-id-1')
            expect(entries[1]!.size).toBe(512)
        })

        test('parses legacy format without header lines', () => {
            const index = 'abc123:80000000:folder-id-1\ndef456:0:doc-id-1\n'
            const entries = parseIndex(index)

            expect(entries.length).toBe(2)
            expect(entries[0]!.hash).toBe('abc123')
            expect(entries[0]!.type).toBe('80000000')
            expect(entries[0]!.id).toBe('folder-id-1')
            expect(entries[1]!.type).toBe('0')
            expect(entries[1]!.id).toBe('doc-id-1')
        })

        test('handles empty input', () => {
            const entries = parseIndex('')
            expect(entries.length).toBe(0)
        })

        test('skips malformed lines', () => {
            const index = '3\n3\nabc123:80000000:folder-id:0:0\nbadline\nghi789:0:doc-id:0:0\n'
            const entries = parseIndex(index)
            expect(entries.length).toBe(2)
        })

        test('parses document index entries with file paths', () => {
            const index =
                '3\n3\nabc:0:docid.metadata:0:100\ndef:0:docid.content:0:200\nghi:0:docid/page1.rm:0:500\n'
            const entries = parseIndex(index)

            expect(entries.length).toBe(3)
            expect(entries[0]!.id).toBe('docid.metadata')
            expect(entries[1]!.id).toBe('docid.content')
            expect(entries[2]!.id).toBe('docid/page1.rm')
        })
    })
})
