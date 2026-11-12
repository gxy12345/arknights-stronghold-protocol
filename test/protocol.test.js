import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import md5 from 'js-md5'
import { createQrAuth } from '../lib/qr-auth.js'
import { AccountError, Skland, signRequest } from '../public/skland.js'
import { mergeStatistics } from '../public/local-data.js'

test('browser signatures match the plugin for refresh and a signed history query', async () => {
    globalThis.md5 = md5
    for (const token of ['', 'example-api-token']) {
        const path = '/api/v1/game/garrison/guide/history-log'
        const query = 'seasonId=season%2Bexample'
        const timestamp = '1704067200'
        const profile = { platform: '1', timestamp, dId: '', vName: '1.21.0' }
        const hmac = createHmac('sha256', token).update(path + query + timestamp + JSON.stringify(profile)).digest('hex')
        const sign = createHash('md5').update(hmac).digest('hex')
        assert.deepEqual(await signRequest(token, path, query, timestamp), { ...profile, sign, language: 'zh-hans-CN' })
    }
})

test('query refreshes an expired API token once and rejects an invalid Cred', async () => {
    const client = new Skland('example-cred')
    let refreshes = 0
    const tokens = []
    client.send = async (path, options) => {
        if (path.endsWith('/refresh')) {
            return { response: { ok: true }, result: { code: 0, data: { token: 'token-' + ++refreshes } } }
        }
        tokens.push(options.token)
        return { response: { ok: false, status: 401 }, result: { code: 10002 } }
    }
    await assert.rejects(client.roles(), AccountError)
    assert.equal(refreshes, 2)
    assert.deepEqual(tokens, ['token-1', 'token-2'])
})

test('version-specific history enrichment rejects a current-version fallback', async () => {
    const client = new Skland('example-cred')
    const current = {
        versionInfo: { seasonId: 's', versionId: 'v2' },
        chars: [{ charId: 'c', name: 'current' }]
    }
    client.resource = async () => current
    const records = [
        { id: 'old', activityId: 's', versionId: 'v1', gameEndTs: '1704067201', chessSquad: [{ charId: 'c' }] },
        { id: 'new', activityId: 's', versionId: 'v2', gameEndTs: '1704067200000', chessSquad: [{ charId: 'c' }] }
    ]
    const [old, fresh] = await client.normalizeHistory('1', 's', records, current)
    assert.equal(old.operators[0].name, 'c')
    assert.equal(old.resourceUnavailable, true)
    assert.equal(fresh.operators[0].name, 'current')
})

test('statistics survive a rolling history window and keep zero values', () => {
    const first = { id: 'a', gameEndTs: '1704067200', modeType: 'SINGLE', modeDifficulty: 'HARD', completeState: 1, killCnt: 4, trophyAfter: 2 }
    const next = { ...first, id: 'b', gameEndTs: '1704067201000', modeType: 'MULTI', completeState: 0, killCnt: 0, trophyAfter: 0, chessSquad: [{ charId: 'test-only' }] }
    const old = mergeStatistics('act3autochess', undefined, [first, first])
    const updated = mergeStatistics('act3autochess', old.snapshot, [next])
    assert.deepEqual([updated.summary.total, updated.summary.wins, updated.summary.kills, updated.summary.trophies], [2, 1, 4, 0])
    assert.deepEqual(updated.summary.difficulties.map(row => row.label), ['规程等级 9–14', '绝境模拟'])
    assert.doesNotMatch(JSON.stringify(updated.snapshot), /chessSquad|test-only/)
    assert.deepEqual(mergeStatistics('act3autochess', updated.snapshot, []).summary, updated.summary)
})

test('QR tickets are signed, expire, and complete the expected official exchange', async () => {
    let now = 1704067200000
    let pending = true
    const seen = []
    const fetcher = async (value, options) => {
        const url = new URL(value)
        const body = options.body && JSON.parse(options.body)
        seen.push(url.pathname)
        const result = {
            '/general/v1/gen_scan/login': { status: 0, data: { scanId: 'test/scan+id' } },
            '/general/v1/scan_status': pending ? { status: 1 } : { status: 0, data: { scanCode: 'test-scan-code' } },
            '/user/auth/v1/token_by_scan_code': { status: 0, data: { token: 'test-passport-token' } },
            '/user/oauth2/v2/grant': { msg: 'OK', data: { code: 'test-grant' } },
            '/web/v1/user/auth/generate_cred_by_code': { code: 0, data: { cred: 'test-issued-cred' } }
        }[url.pathname]
        if (url.pathname === '/general/v1/scan_status') assert.equal(url.searchParams.get('scanId'), 'test/scan+id')
        if (url.pathname.endsWith('/generate_cred_by_code')) {
            assert.deepEqual(body, { kind: 1, code: 'test-grant' })
            assert.equal(options.headers.dId, 'test-device')
        }
        return new Response(JSON.stringify(result))
    }
    const auth = createQrAuth({ fetcher, now: () => now, getDeviceId: async () => 'test-device' })
    const { ticket, image, expiresIn } = await auth.start()
    assert.match(image, /^data:image\/png;base64,/)
    const [payload, signature] = ticket.split('.')
    await assert.rejects(auth.check((payload.startsWith('a') ? 'b' : 'a') + payload.slice(1) + '.' + signature), { status: 400 })
    assert.deepEqual(await auth.check(ticket), { status: 'pending' })
    pending = false
    assert.deepEqual(await auth.check(ticket), { status: 'confirmed', cred: 'test-issued-cred' })
    now += expiresIn
    assert.deepEqual(await auth.check(ticket), { status: 'expired' })
    assert.deepEqual(seen, [
        '/general/v1/gen_scan/login', '/general/v1/scan_status', '/general/v1/scan_status', '/user/auth/v1/token_by_scan_code',
        '/user/oauth2/v2/grant', '/web/v1/user/auth/generate_cred_by_code'
    ])
})
