const officialOrigins = ['https://web.hycdn.cn', 'https://bbs.hycdn.cn', 'https://assets.skland.com']

export function shareAssetUrl(value, assetBase) {
    const url = new URL(value)
    if (url.username || url.password || url.port || url.hash || url.protocol !== 'https:') throw new Error('Invalid asset URL')
    const allowed = officialOrigins.includes(url.origin)
        || (assetBase.startsWith('https://') && url.href.startsWith(assetBase))
    if (!allowed) throw new Error('Unsupported asset origin')
    return url
}

export async function fetchShareAsset(url) {
    const response = await fetch(url, {
        redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'image/*' }
    })
    const type = response.headers.get('content-type')?.split(';')[0]
    if (!response.ok || !/^image\/(?:png|jpeg|webp|gif|svg\+xml|avif)$/.test(type)) throw new Error('Invalid asset response')
    const limit = 8 * 1024 * 1024
    if (Number(response.headers.get('content-length')) > limit) throw new Error('Asset too large')
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > limit) throw new Error('Asset too large')
            chunks.push(value)
        }
    } finally {
        await reader.cancel().catch(() => {})
    }
    return { type, data: Buffer.concat(chunks) }
}
