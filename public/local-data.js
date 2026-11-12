import { garrisonMetricRecord } from './garrison-view.js'
import { mergeMetricRecords, migrateSnapshot, validateBaseline } from './statistics-core.js'

export const accountKey = 'stronghold.account.v1'
export const statsPrefix = 'stronghold.statistics.v2:'
export const legacyStatsPrefix = 'stronghold.statistics.v1:'
export const statisticsKey = (uid, seasonId, prefix = statsPrefix) => prefix + JSON.stringify([uid, seasonId])

export function mergeStatistics(seasonId, snapshot, records = []) {
    return mergeMetricRecords(seasonId, snapshot, records.map(garrisonMetricRecord))
}

function readBaseline(key) {
    const value = localStorage.getItem(key)
    if (value === null) return null
    const data = JSON.parse(value)
    if (data?.version !== undefined && data.version !== 1) throw new Error('Invalid legacy statistics version')
    return validateBaseline(data)
}

function readSnapshot(uid, seasonId, key) {
    const raw = localStorage.getItem(key)
    const saved = raw === null ? undefined : JSON.parse(raw)
    if (raw !== null && saved?.version !== 2) throw new Error('Invalid statistics version')
    const snapshot = migrateSnapshot(saved)
    let legacy, legacyConflict = false
    try {
        legacy = readBaseline(statisticsKey(uid, seasonId, legacyStatsPrefix))
    } catch (error) {
        if (raw === null) throw error
        legacyConflict = true
    }

    let migrated = false
    if (legacy) {
        const previousIds = snapshot.legacyV1?.recordIds ?? []
        const ids = new Set(legacy.recordIds)
        if (previousIds.every(id => ids.has(id))) {
            if (!snapshot.legacyV1 || ids.size > previousIds.length) {
                snapshot.legacyV1 = legacy
                migrated = true
            }
        } else {
            legacyConflict = true
        }
    }
    return { snapshot, migrated, legacyConflict }
}

// The caller holds the statistics lock for writes. A read can use the last
// complete localStorage snapshot even when the browser has no Web Locks.
export function syncStatistics(uid, seasonId, facts = [], { assets = [], write = false, readOnly = false } = {}) {
    const key = statisticsKey(uid, seasonId)
    let result
    try {
        const { snapshot, migrated, legacyConflict } = readSnapshot(uid, seasonId, key)
        const { snapshot: merged, summary, changed } = mergeMetricRecords(seasonId, snapshot, facts, assets)
        result = { summary, persisted: !migrated, notice: legacyConflict ? '旧版统计缓存无法合并，请刷新仍打开的旧版页面。' : '' }
        if (readOnly) return result
        if (!write) {
            return { ...result, persisted: false, notice: [result.notice, '此浏览器缺少 Web Locks，新增统计仅本次有效。'].filter(Boolean).join(' ') }
        }
        if (migrated || changed) localStorage.setItem(key, JSON.stringify(merged))
        return { ...result, persisted: true }
    } catch {
        return {
            summary: result?.summary ?? mergeMetricRecords(seasonId, undefined, facts, assets).summary,
            persisted: false,
            notice: [result?.notice, '本次统计未能保存，请检查浏览器的站点数据设置或刷新后重试。'].filter(Boolean).join(' ')
        }
    }
}

export function forgetStatistics(uids) {
    const selected = new Set(uids.map(String))
    for (const key of Object.keys(localStorage)) {
        const prefix = [statsPrefix, legacyStatsPrefix].find(prefix => key.startsWith(prefix))
        if (!prefix) continue
        let scope
        try { scope = JSON.parse(key.slice(prefix.length)) } catch { continue }
        if (Array.isArray(scope) && scope.length === 2 && scope.every(value => typeof value === 'string' && value) &&
            selected.has(scope[0])) localStorage.removeItem(key)
    }
}
