// Keep timeout and user cancellation compatible with browsers lacking AbortSignal static methods.
export async function withRequestTimeout(milliseconds, request, parentSignal) {
    const controller = new AbortController()
    const cancel = () => controller.abort(parentSignal.reason)
    if (parentSignal?.aborted) cancel()
    else parentSignal?.addEventListener('abort', cancel, { once: true })

    const timer = setTimeout(() => {
        controller.abort(new DOMException('请求超时，请稍后重试。', 'TimeoutError'))
    }, milliseconds)
    try {
        return await request(controller.signal)
    } finally {
        clearTimeout(timer)
        parentSignal?.removeEventListener('abort', cancel)
    }
}
