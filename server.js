import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { fetchShareAsset, shareAssetUrl } from './lib/share-assets.js'
import { createQrAuth, ScanError } from './lib/qr-auth.js'

const staticRoot = new URL('./public/', import.meta.url)
const mime = {
    html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml'
}
const headers = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' https://zonai.skland.com; frame-src 'self' about:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
}

function httpsUrl(value) {
    if (!value) return ''
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('资源或仓库地址必须是 HTTPS URL')
    }
    return url.href
}

function json(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(value))
}

async function readBody(request) {
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
        throw new ScanError('请求格式无效。', 415)
    }
    if (Number(request.headers['content-length']) > 2048) throw new ScanError('请求过大。', 413)
    const chunks = []
    let size = 0
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length
        if (size > 2048) throw new ScanError('请求过大。', 413)
        chunks.push(chunk)
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
        throw new ScanError('请求格式无效。', 400)
    }
}

function sameOrigin(request, publicOrigin) {
    const origin = request.headers.origin
    if (!origin) return false
    if (publicOrigin) return origin === publicOrigin
    try {
        const url = new URL(origin)
        return ['http:', 'https:'].includes(url.protocol) && url.host === request.headers.host
            && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin')
    } catch { return false }
}

export function createApp({
    qrAuth = createQrAuth(), publicOrigin = process.env.PUBLIC_ORIGIN,
    assetBaseUrl = process.env.ASSET_BASE_URL
} = {}) {
    const config = {
        assetBase: assetBaseUrl ? httpsUrl(assetBaseUrl).replace(/\/*$/, '/') : '/assets/'
    }
    const origin = publicOrigin ? new URL(publicOrigin).origin : ''
    return createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, async (request, response) => {
        for (const [name, value] of Object.entries(headers)) response.setHeader(name, value)
        let pathname
        try { pathname = new URL(request.url, 'http://localhost').pathname } catch {
            return json(response, 400, { error: '无效地址。' })
        }
        try {
            if (pathname === '/api/qr/start' || pathname === '/api/qr/check') {
                if (request.method !== 'POST') return json(response, 405, { error: '请求方式无效。' })
                if (!sameOrigin(request, origin)) return json(response, 403, { error: '请从本站页面发起扫码。' })
                const body = await readBody(request)
                return json(response, 200, pathname.endsWith('/start') ? await qrAuth.start() : await qrAuth.check(body?.ticket))
            }
            if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: '请求方式无效。' })
            if (pathname === '/api/share-asset') {
                let imageUrl
                try {
                    imageUrl = shareAssetUrl(new URL(request.url, 'http://localhost').searchParams.get('url'), config.assetBase)
                } catch {
                    return json(response, 400, { error: '图片地址无效。' })
                }
                const { type, data } = await fetchShareAsset(imageUrl)
                response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'Content-Length': data.length })
                return response.end(request.method === 'HEAD' ? undefined : data)
            }
            if (pathname === '/config.json') return json(response, 200, config)
            const file = pathname === '/' ? '/index.html' : pathname
            const ext = file.split('.').at(-1)
            if (!/^(?:\/[a-zA-Z0-9_-]+)*\/[a-zA-Z0-9_-]+\.[a-z]+$/.test(file) || !Object.hasOwn(mime, ext)) {
                return json(response, 404, { error: '页面不存在。' })
            }
            const url = file === '/vendor/md5.js'
                ? new URL('./node_modules/js-md5/build/md5.min.js', import.meta.url)
                : file === '/vendor/modern-screenshot.mjs'
                    ? new URL('./node_modules/modern-screenshot/dist/index.mjs', import.meta.url)
                : new URL('.' + file, staticRoot)
            const data = await readFile(url)
            response.writeHead(200, {
                'Content-Type': mime[ext], 'Content-Length': data.length,
                'Cache-Control': file.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache'
            })
            response.end(request.method === 'HEAD' ? undefined : data)
        } catch (error) {
            if (error?.code === 'ENOENT') return json(response, 404, { error: '页面不存在。' })
            const known = error instanceof ScanError
            json(response, known ? error.status : 502, {
                error: known ? error.message : '请求暂时无法完成，请稍后重试。'
            })
        }
    })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.PORT ?? 3000)
    createApp().listen(port, process.env.HOST ?? '127.0.0.1', function () {
        console.log(`卫戍协议已启动 http://localhost:${this.address().port}`)
    })
}
