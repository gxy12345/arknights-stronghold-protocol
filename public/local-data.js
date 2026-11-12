import { garrisonRecordLabels, garrisonRecordStatistics } from './garrison-view.js'

export const accountKey = 'stronghold.account.v1'
export const statsPrefix = 'stronghold.statistics.v1:'
const order = ['training', 'standard', 'risk', 'extreme', 'ultimate', 'neutral']
const groupKey = ({ modeCode, difficultyCode }) => JSON.stringify([modeCode, difficultyCode])
const empty = () => ({ recordIds: [], difficulties: [], kills: 0, killsReported: 0, latestTrophy: null })

// Same count and difficulty rules as the plugin. No detailed lineup is persisted.
export function mergeStatistics(seasonId, snapshot = empty(), records = []) {
    const data = structuredClone(snapshot)
    const ids = new Set(data.recordIds)
    const groups = new Map(data.difficulties.map(row => [groupKey(row), row]))
    for (const raw of records) {
        const { id, modeCode, difficultyCode, success, timestamp, killCnt, trophyAfter } = garrisonRecordStatistics(raw)
        if (!id || ids.has(id)) continue
        ids.add(id)
        const group = { modeCode, difficultyCode: modeCode === 'LOCAL' ? 'TRAINING' : difficultyCode }
        const key = groupKey(group)
        if (!groups.has(key)) groups.set(key, { ...group, total: 0, wins: 0 })
        const row = groups.get(key)
        row.total++
        if (success) row.wins++
        if (Number.isFinite(killCnt) && killCnt >= 0) {
            data.kills += killCnt
            data.killsReported++
        }
        const time = Number(timestamp)
        const timeMs = time < 1e12 ? time * 1000 : time
        if (Number.isFinite(timeMs) && timeMs > (data.latestTrophy?.timeMs ?? 0) && Number.isFinite(trophyAfter) && trophyAfter >= 0) {
            data.latestTrophy = { timeMs, value: trophyAfter }
        }
    }
    data.recordIds = [...ids]
    data.difficulties = [...groups.values()]
    const difficulties = data.difficulties.map(({ modeCode, difficultyCode, total, wins }) => {
        const { mode, modeTone, difficulty, difficultyTone } = garrisonRecordLabels({ modeCode, difficultyCode, seasonId })
        return { mode, modeTone, label: difficulty, tone: difficultyTone, total, wins }
    }).sort((a, b) => a.modeTone.localeCompare(b.modeTone) || order.indexOf(a.tone) - order.indexOf(b.tone))
    return {
        snapshot: data, summary: {
            total: ids.size, wins: difficulties.reduce((sum, row) => sum + row.wins, 0),
            trophies: data.latestTrophy?.value ?? null, kills: data.killsReported ? data.kills : null,
            killsReported: data.killsReported, difficulties
        }
    }
}

export function syncStatistics(uid, seasonId, records) {
    const key = statsPrefix + JSON.stringify([uid, seasonId])
    try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null')
        const { snapshot, summary } = mergeStatistics(seasonId, saved || undefined, records)
        if (records.length && snapshot.recordIds.length !== (saved?.recordIds?.length ?? 0)) {
            localStorage.setItem(key, JSON.stringify(snapshot))
        }
        return { summary, persisted: true }
    } catch {
        return { summary: mergeStatistics(seasonId, undefined, records).summary, persisted: false }
    }
}

export function forgetStatistics(uids) {
    const keys = Object.keys(localStorage).filter(key => key.startsWith(statsPrefix))
    for (const key of keys) {
        try {
            const [uid] = JSON.parse(key.slice(statsPrefix.length))
            if (uids.includes(uid)) localStorage.removeItem(key)
        } catch { /* Other accounts and malformed entries are left alone. */ }
    }
}
