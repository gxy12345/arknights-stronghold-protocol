import { domToBlob } from '/vendor/modern-screenshot.mjs'
import { withRequestTimeout } from './request-timeout.js'

const titles = { history: '战绩列表', detail: '对局详情', statistics: '赛季统计' }
const excluded = '.export-button, .detail-actions, .detail-tip, #query-status, #export-status, #detail-export-status, .pager button, #refresh'

async function embedImage(value) {
    const url = new URL(value, location.href)
    if (url.protocol === 'data:') return value
    const endpoint = url.origin === location.origin ? url.href : '/api/share-asset?' + new URLSearchParams({ url: url.href })
    const blob = await withRequestTimeout(20_000, async signal => {
        const response = await fetch(endpoint, {
            credentials: 'omit', cache: 'force-cache', signal
        })
        if (!response.ok) throw new Error('图片加载失败')
        return response.blob()
    })
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

export async function downloadShareImage({ kind, source, page }) {
    await document.fonts.ready
    await Promise.all([...source.querySelectorAll('img')].map(image => {
        image.loading = 'eager'
        return Promise.race([image.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))])
    }))
    const bounds = source.getBoundingClientRect()
    const width = Math.ceil(bounds.width)
    const height = Math.max(Math.ceil(bounds.height), source.scrollHeight + 2)
    const scale = Math.min(2, 8192 / height, Math.sqrt(12_000_000 / (width * height)))
    const resources = new Map()
    const png = await domToBlob(source, {
        type: 'image/png', width, height, scale, timeout: 20_000,
        maximumCanvasSize: 8192,
        backgroundColor: getComputedStyle(source).backgroundColor,
        filter: element => !(element instanceof Element && element.matches(excluded)),
        style: {
            position: 'static', inset: 'auto', margin: '0', maxWidth: 'none', maxHeight: 'none',
            boxSizing: 'border-box', overflow: 'visible', height: height + 'px'
        },
        fetchFn: url => {
            if (!resources.has(url)) resources.set(url, embedImage(url))
            return resources.get(url)
        },
        onCloneEachNode: cloned => {
            if (!(cloned instanceof HTMLElement)) return
            if (cloned.classList.contains('dialog-head')) cloned.style.position = 'static'
            // Serialized fractional widths can round down and move the last flex item to another row.
            if (cloned.matches('.record-meta, .detail-grid')) {
                const rounded = Math.ceil(parseFloat(cloned.style.width))
                if (Number.isFinite(rounded)) {
                    cloned.style.width = rounded + 'px'
                    cloned.style.inlineSize = rounded + 'px'
                }
            }
        }
    })
    await Promise.all(resources.values())
    if (!png) throw new Error('图片生成失败')
    const url = URL.createObjectURL(png)
    const link = document.createElement('a')
    link.href = url
    link.download = `卫戍协议-${titles[kind]}${kind === 'history' ? `-第${page}页` : ''}.png`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
