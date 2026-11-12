import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Script } from 'node:vm'
import { JSDOM, VirtualConsole } from 'jsdom'
import QRCode from 'qrcode'

const passport = 'https://as.hypergryph.com'
const skland = 'https://zonai.skland.com'
const appCode = '4ca99fa6b56cc2ba'
const scanLifetime = 100_000
const appAgent = 'Skland/2.2.0 (com.hypergryph.skland; build:200200057; Android; )'
const webAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

export class ScanError extends Error {
    constructor(message, status = 502) {
        super(message)
        this.status = status
    }
}

// The QR exchange uses the same server-side device profile as the plugin.
async function generateDeviceId() {
    if (process.env.SKLAND_DEVICE_ID) return process.env.SKLAND_DEVICE_ID
    const source = await readFile(new URL('./sm.sdk.cjs', import.meta.url), 'utf8')
    let timeout
    let dom
    try {
        return await new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Device profile timed out')), 5000)
            dom = new JSDOM('', {
                runScripts: 'outside-only',
                virtualConsole: new VirtualConsole(),
                beforeParse(window) {
                    window._smReadyFuncs = [() => resolve(window.SMSdk.getDeviceId())]
                    window._smConf = {
                        organization: 'UWXspnCCJN4sfYlNfqps', appId: 'default',
                        publicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCmxMNr7n8ZeT0tE1R9j/mPixoinPkeM+k4VGIn/s0k7N5rJAfnZ0eMER+QhwFvshzo0LNmeUkpR8uIlU/GEVr8mN28sKmwd2gpygqj0ePnBmOW4v0ZVwbSYK+izkhVFk2V/doLoMbWy6b+UnA8mkjvg0iYWRByfRsK2gdl7llqCwIDAQAB',
                        protocol: 'https', apiHost: 'fp-it.portal101.cn', apiPath: '/deviceprofile/v4'
                    }
                }
            })
            new Script(source).runInContext(dom.getInternalVMContext())
        })
    } finally {
        clearTimeout(timeout)
        dom?.window.close()
    }
}

export function createQrAuth({
    fetcher = globalThis.fetch, now = Date.now, secret = randomBytes(32), getDeviceId = generateDeviceId
} = {}) {
    function signature(value) {
        return createHmac('sha256', secret).update(value).digest()
    }

    async function upstream(url, body, headers = {}) {
        const options = {
            headers, redirect: 'error', signal: AbortSignal.timeout(10_000)
        }
        if (body) {
            options.method = 'POST'
            options.headers = { 'Content-Type': 'application/json;charset=utf-8', ...headers }
            options.body = JSON.stringify(body)
        }
        const response = await fetcher(url, options)
        if (!response.ok) throw new ScanError('森空岛扫码服务暂时不可用，请稍后重试或使用 Cred 绑定。')
        return response.json()
    }

    async function start() {
        const result = await upstream(passport + '/general/v1/gen_scan/login', { appCode })
        const scanId = result?.data?.scanId
        if (result?.status !== 0 || typeof scanId !== 'string' || !scanId) {
            throw new ScanError('无法生成二维码，请稍后重试。')
        }
        const payload = Buffer.from(JSON.stringify({ scanId, expiresAt: now() + scanLifetime })).toString('base64url')
        const url = 'hypergryph://scan_login?' + new URLSearchParams({ scanId })
        const image = await QRCode.toDataURL(url, { width: 240, margin: 3 })
        return { ticket: payload + '.' + signature(payload).toString('base64url'), image, expiresIn: scanLifetime }
    }

    async function check(ticket) {
        if (typeof ticket !== 'string' || !/^[\w-]{1,1500}\.[\w-]{43}$/.test(ticket)) {
            throw new ScanError('二维码无效，请重新获取。', 400)
        }
        const [payload, mac] = ticket.split('.')
        const provided = Buffer.from(mac, 'base64url')
        const expected = signature(payload)
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
            throw new ScanError('二维码无效，请重新获取。', 400)
        }
        const { scanId, expiresAt } = JSON.parse(Buffer.from(payload, 'base64url').toString())
        if (now() >= expiresAt) return { status: 'expired' }

        const status = await upstream(passport + '/general/v1/scan_status?' + new URLSearchParams({ scanId }))
        const scanCode = status?.data?.scanCode
        if (status?.status !== 0 || !scanCode) return { status: 'pending' }

        const login = await upstream(passport + '/user/auth/v1/token_by_scan_code', { scanCode })
        if (login?.status !== 0 || !login.data?.token) {
            throw new ScanError('扫码已结束，请重新生成二维码。')
        }
        const grant = await upstream(passport + '/user/oauth2/v2/grant',
            { appCode, type: 0, token: login.data.token }, { 'User-Agent': appAgent })
        if (grant?.msg !== 'OK' || !grant.data?.code) throw new ScanError('森空岛授权失败，请重新扫码。')

        const credResult = await upstream(skland + '/web/v1/user/auth/generate_cred_by_code',
            { kind: 1, code: grant.data.code }, {
                'User-Agent': webAgent, Referer: 'https://www.skland.com/', Origin: 'https://www.skland.com',
                dId: await getDeviceId(), platform: '3', timestamp: String(Math.floor(now() / 1000)), vName: '1.0.0'
            })
        if (credResult?.code !== 0 || typeof credResult.data?.cred !== 'string' || !credResult.data.cred) {
            throw new ScanError('森空岛凭证换取失败，请重新扫码或使用 Cred 绑定。')
        }
        return { status: 'confirmed', cred: credResult.data.cred }
    }

    return { start, check }
}
