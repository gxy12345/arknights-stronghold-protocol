import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { garrisonMetricRecord } from '../public/garrison-view.js'
import { forgetStatistics, legacyStatsPrefix, statisticsKey, syncStatistics } from '../public/local-data.js'

const { records, legacy } = JSON.parse(readFileSync(new URL('./fixtures/garrison-statistics-v2.json', import.meta.url), 'utf8'))
const facts = records.map(garrisonMetricRecord)
const key = statisticsKey('1', 's')
const v1 = statisticsKey('1', 's', legacyStatsPrefix)

function fakeStorage(t, initial = {}, { quota = false } = {}) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const storage = Object.assign(Object.create({
        getItem(key) { return this[key] ?? null },
        setItem(key, value) {
            if (quota) throw new DOMException('Full', 'QuotaExceededError')
            this[key] = value
        },
        removeItem(key) { delete this[key] }
    }), initial)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    t.after(() => {
        if (prior) Object.defineProperty(globalThis, 'localStorage', prior)
        else delete globalThis.localStorage
    })
    return storage
}

test('v1 remains intact and a strict superset replaces the baseline without double counting overlap', t => {
    const { version, ...unversioned } = legacy
    const initial = JSON.stringify(unversioned)
    const storage = fakeStorage(t, { [v1]: initial })
    const migrated = syncStatistics('1', 's', facts.slice(0, 2), { write: true })
    assert.deepEqual([migrated.summary.total, migrated.summary.kills, migrated.summary.boss.reported], [3, 17, 2])
    assert.equal(storage[v1], initial)
    assert.equal(JSON.parse(storage[key]).version, 2)

    storage[v1] = JSON.stringify({
        ...unversioned, recordIds: [...legacy.recordIds, 'r2'],
        difficulties: [...legacy.difficulties, { modeCode: 'MULTI', difficultyCode: 'FAST', total: 1, wins: 0 }],
        killsReported: 3, latestTrophy: { timeMs: 1704067800000, value: 0 }
    })
    const absorbed = syncStatistics('1', 's', facts, { write: true })
    assert.deepEqual([absorbed.summary.total, absorbed.summary.kills, absorbed.summary.killsReported, absorbed.summary.trophies], [4, 17, 3, 0])
    assert.equal(absorbed.summary.boss.reported, 3)
    const saved = storage[key]
    storage[v1] = initial
    const conflict = syncStatistics('1', 's', [], { write: true })
    assert.match(conflict.notice, /旧版/)
    assert.equal(conflict.summary.total, 4)
    assert.equal(storage[key], saved)
})

test('read-only sync and missing Web Locks preserve cached data and avoid writes', t => {
    const storage = fakeStorage(t, { [v1]: JSON.stringify(legacy) })
    const memory = syncStatistics('1', 's', facts)
    assert.equal(memory.persisted, false)
    assert.match(memory.notice, /仅本次有效/)
    assert.equal(memory.summary.total, 4)
    assert.equal(storage[key], undefined)
    assert.equal(syncStatistics('1', 's', [], { readOnly: true }).summary.total, 2)
    assert.equal(storage[key], undefined)
})

test('a quota failure shows the candidate and malformed or unknown snapshots are left untouched', t => {
    const storage = fakeStorage(t, { [v1]: JSON.stringify(legacy) }, { quota: true })
    const candidate = syncStatistics('1', 's', facts, { write: true })
    assert.deepEqual([candidate.persisted, candidate.summary.total, candidate.summary.boss.total], [false, 4, 3])
    assert.equal(storage[key], undefined)
    for (const invalid of ['{', '{"version":999}']) {
        storage[key] = invalid
        const failed = syncStatistics('1', 's', facts, { write: true })
        assert.equal(failed.persisted, false)
        assert.equal(failed.summary.boss.total, 3)
        assert.equal(storage[key], invalid)
    }
    delete storage[key]
    storage[v1] = '{}'
    assert.equal(syncStatistics('1', 's', facts, { write: true }).persisted, false)
    assert.equal(storage[key], undefined)
})

test('forgetting statistics deletes only confirmed keys for selected UIDs across both versions', t => {
    const other = statisticsKey('2', 's')
    const malformed = statisticsKey('1', null)
    const storage = fakeStorage(t, { [key]: 'v2', [v1]: 'v1', [other]: 'other', [malformed]: 'malformed' })
    forgetStatistics(['1'])
    assert.deepEqual(Object.keys(storage), [other, malformed])
})
