import { normalizeGarrisonRecord } from './garrison-view.js'
import { withRequestTimeout } from './request-timeout.js'

const origin = 'https://zonai.skland.com'
const signatureVersion = '1.21.0'
const timeout = 15_000
const authCodes = new Set([10002, 10003, 10004, 10005])
const encoder = new TextEncoder()

export class AccountError extends Error {}
export const validCred = value => typeof value === 'string' && /^[!-~]{1,4096}$/.test(value)
const list = value => Array.isArray(value) ? value : []

export async function signRequest(token, path, query, timestamp) {
    const profile = { platform: '1', timestamp, dId: '', vName: signatureVersion }
    if (!globalThis.crypto?.subtle) throw new Error('请通过 HTTPS 或本机 localhost 打开网页。')
    // HMAC pads its key with zeros. A single zero byte is equivalent to an empty key.
    const key = await crypto.subtle.importKey('raw', token ? encoder.encode(token) : new Uint8Array(1),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(path + query + timestamp + JSON.stringify(profile)))
    const sign = globalThis.md5(Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, '0')).join(''))
    return { ...profile, sign, language: 'zh-hans-CN' }
}

export class Skland {
    constructor(cred) {
        this.cred = cred
        this.token = null
        this.refreshing = null
    }

    async send(path, { token = '', uid, params } = {}) {
        const query = new URLSearchParams(params).toString()
        const timestamp = String(Math.floor(Date.now() / 1000))
        const headers = await signRequest(token, path, query, timestamp)
        return withRequestTimeout(timeout, async signal => {
            const response = await fetch(origin + path + (query ? '?' + query : ''), {
                headers: {
                    ...headers, cred: this.cred, ...(token ? { token } : {}),
                    ...(uid ? { 'sk-game-role': `1_${uid}_0` } : {})
                },
                signal, credentials: 'omit', cache: 'no-store', redirect: 'error'
            }).catch(() => { throw new Error('无法连接森空岛，请检查网络后重试。') })
            const result = await response.json().catch(() => null)
            return { response, result }
        })
    }

    getToken() {
        if (this.token && this.token.until > Date.now()) return Promise.resolve(this.token.value)
        this.refreshing ??= this.send('/api/v1/auth/refresh').then(({ response, result }) => {
            const value = result?.data?.token
            if (response.status === 401 || authCodes.has(Number(result?.code))) throw new AccountError('Cred 已失效，请重新绑定。')
            if (!response.ok || Number(result?.code) !== 0 || !value) throw new Error('森空岛暂时无法验证 Cred，请稍后重试。')
            const seconds = Number(result.data.expiresIn || result.data.expireIn || result.expiresIn)
            const ttl = seconds > 0 ? Math.max(1, Math.min(seconds - 15, 300)) : 300
            this.token = { value, until: Date.now() + ttl * 1000 }
            return value
        }).finally(() => { this.refreshing = null })
        return this.refreshing
    }

    async get(path, options = {}, retry = true) {
        const token = await this.getToken()
        const { response, result } = await this.send(path, { ...options, token })
        const code = Number(result?.code)
        if (response.status === 401 || authCodes.has(code)) {
            if (retry) {
                if (this.token?.value === token) this.token = null
                return this.get(path, options, false)
            }
            throw new AccountError('森空岛未接受当前 Cred，请重新绑定后重试。')
        }
        if (!response.ok || code !== 0 || !result?.data) throw new Error('森空岛未能返回数据，请稍后重试。')
        return result.data
    }

    async roles() {
        const result = await this.get('/api/v1/game/player/binding')
        if (!Array.isArray(result.list)) throw new Error('森空岛返回的角色列表无效，请稍后重试。')
        const roles = result.list.filter(game => game?.appCode === 'arknights').flatMap(game => list(game.bindingList))
            .filter(role => /^\d{1,24}$/.test(String(role?.uid)))
            .map(role => ({
                uid: String(role.uid), name: String(role.nickName || role.nickname || '博士'),
                channel: String(role.channelName || ''), primary: Boolean(role.isDefault)
            }))
        return [...new Map(roles.sort((a, b) => Number(b.primary) - Number(a.primary)).map(role => [role.uid, role])).values()]
    }

    player(uid) {
        return this.get('/api/v1/game/player/info', { uid, params: { uid } })
    }

    resource(uid, seasonId, versionId) {
        const params = {}
        if (seasonId) params.seasonId = seasonId
        if (versionId) params.versionId = versionId
        return this.get('/api/v1/game/garrison/guide/resource', { uid, params })
    }

    async history(uid, seasonId) {
        const data = await this.get('/api/v1/game/garrison/guide/history-log', { uid, params: { seasonId } })
        if (!Array.isArray(data.records)) throw new Error('森空岛返回的战绩格式无效，请稍后重试。')
        return data.records.filter(record => record && String(record.activityId) === seasonId)
    }

    async historyResources(uid, seasonId, records, resource) {
        const versions = [...new Set(records.map(record => String(record.versionId ?? '').trim()).filter(Boolean))]
            .filter(versionId => versionId !== String(resource.versionInfo?.versionId))
        const versionResources = Object.create(null)
        for (let offset = 0; offset < versions.length; offset += 4) {
            await Promise.all(versions.slice(offset, offset + 4).map(async versionId => {
                const previous = await this.resource(uid, seasonId, versionId).catch(() => null)
                if (String(previous?.versionInfo?.seasonId) === seasonId && String(previous.versionInfo?.versionId) === versionId) {
                    versionResources[versionId] = previous
                }
            }))
        }
        return { [seasonId]: { versionResourceMap: versionResources } }
    }

    async normalizeHistory(uid, seasonId, records, resource, versionResources) {
        versionResources ??= await this.historyResources(uid, seasonId, records, resource)
        const seen = new Set()
        const timestamp = value => Number(value) < 1e12 ? Number(value) * 1000 : Number(value)
        return records.map(raw => normalizeGarrisonRecord(raw, resource, versionResources))
            .filter(record => {
                if (!record.id) return true
                if (seen.has(record.id)) return false
                seen.add(record.id)
                return true
            })
            .sort((a, b) => (timestamp(b.timestamp) || 0) - (timestamp(a.timestamp) || 0))
    }
}
