import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { withRequestTimeout } from '../public/request-timeout.js'

// Reproduce the older browser environment from the reported QR failure.
Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true })
Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true })

function waitForCancellation(signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason)
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
}

test('requests complete without AbortSignal.timeout or AbortSignal.any', async () => {
    let requestSignal
    assert.equal(await withRequestTimeout(10, async signal => {
        requestSignal = signal
        return 'QR response'
    }), 'QR response')
    await delay(20)
    assert.equal(requestSignal.aborted, false)
})

test('timeout also cancels a request still reading its response body', async () => {
    await assert.rejects(withRequestTimeout(10, async signal => {
        await Promise.resolve('headers received')
        return waitForCancellation(signal)
    }), { name: 'TimeoutError' })
})

test('parent cancellation stops pending QR requests and preserves the reason', async () => {
    const parent = new AbortController()
    const reason = new DOMException('扫码已取消', 'AbortError')
    const request = withRequestTimeout(1000, waitForCancellation, parent.signal)
    parent.abort(reason)
    await assert.rejects(request, error => error === reason)
})

test('an already-cancelled QR request stays cancelled', async () => {
    const parent = new AbortController()
    parent.abort()
    await assert.rejects(withRequestTimeout(1000, waitForCancellation, parent.signal), { name: 'AbortError' })
})

test('a completed request is detached from later QR cancellation', async () => {
    const parent = new AbortController()
    let requestSignal
    await withRequestTimeout(1000, async signal => { requestSignal = signal }, parent.signal)
    parent.abort()
    assert.equal(requestSignal.aborted, false)
})
