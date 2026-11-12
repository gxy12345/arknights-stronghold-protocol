import { AccountError, Skland, validCred } from './skland.js'
import { accountKey, forgetStatistics, syncStatistics } from './local-data.js'
import { $, detailView, emptyState, historyView, loading, node, playerView, setMessage, statisticsView } from './views.js'
import { bindDetailTooltips } from './detail-tooltips.js'
import { playerIdentity } from './player.js'
import { downloadShareImage } from './share-image.js'

const bindingMessage = $('binding-message')
const queryStatus = $('query-status')
const results = $('results')
const seasonSelect = $('season')
const roleSelect = $('role')
const detail = $('detail')
const viewExport = $('export-view')
const detailExport = $('export-detail')
bindDetailTooltips(detail)
const qrStart = $('qr-start')
const qrImage = $('qr-image')
const unbindDialog = $('unbind-dialog')
let config = { assetBase: '/assets/' }
const asset = name => config.assetBase + name
let account
let pendingAccount
let query = 0
let history = null
let activeRecord
let seasonId = ''
let page = 1
let querying = false
let scanController
let bindSequence = 0

function selectOptions(select, items, selected) {
    select.replaceChildren(...items.map(({ id, label }) => new Option(label, id)))
    select.value = selected
}

function accountUI() {
    const signedIn = Boolean(account)
    $('binding-title').textContent = signedIn ? '森空岛账号' : '绑定森空岛'
    $('binding-methods').hidden = signedIn
    $('bound-account').hidden = !signedIn
    const state = $('account-state')
    state.textContent = signedIn ? (account.persisted ? '已绑定' : '仅本次使用') : '未绑定'
    state.toggleAttribute('data-bound', signedIn)
    $('query-actions').hidden = !signedIn
    if (signedIn) {
        const role = account.roles.find(role => role.uid === account.uid)
        $('role-meta').textContent = [role.channel, `UID ${role.uid}`].filter(Boolean).join(' / ')
        selectOptions(roleSelect, account.roles.map(role => ({ id: role.uid, label: role.name })), account.uid)
    } else {
        roleSelect.replaceChildren()
        $('role-meta').textContent = ''
    }
}

function currentPlayer() {
    if (!account) return null
    if (account.player?.uid === account.uid) return account.player
    return playerIdentity({}, account.roles.find(role => role.uid === account.uid))
}

function renderPlayer() {
    const container = $('player-info')
    const player = currentPlayer()
    container.hidden = !player
    container.replaceChildren(...(player ? [playerView(player)] : []))
}

function saveAccount() {
    try {
        localStorage.setItem(accountKey, JSON.stringify({ cred: account.client.cred, uid: account.uid, seasonId }))
        account.persisted = true
    } catch { account.persisted = false }
}

function setTab() {
    if (!viewExport.hasAttribute('aria-busy')) setMessage($('export-status'))
    const stats = location.hash === '#statistics'
    for (const [id, active] of [['history-tab', !stats], ['statistics-tab', stats]]) {
        if (active) $(id).setAttribute('aria-current', 'page')
        else $(id).removeAttribute('aria-current')
    }
    renderResults()
}

function openRecord(record) {
    activeRecord = record
    setMessage($('detail-export-status'))
    $('detail-role').replaceChildren(playerView(currentPlayer()))
    $('detail-body').replaceChildren(...detailView(record, asset))
    detail.showModal()
    detail.scrollTop = 0
}

function changePage(value) {
    page = value
    if (!viewExport.hasAttribute('aria-busy')) setMessage($('export-status'))
    renderResults()
    results.querySelector('.record')?.focus({ preventScroll: true })
    $('history-tab').scrollIntoView({ block: 'nearest' })
}

function renderResults() {
    const stats = location.hash === '#statistics'
    renderPlayer()
    results.setAttribute('aria-busy', String(querying))
    viewExport.hidden = !account || querying || (stats ? !history?.statistics?.summary.total : !history?.records?.length)
    viewExport.setAttribute('aria-label', stats ? '导出赛季统计图片' : '导出本页战绩图片')
    if (!account && !pendingAccount) {
        const link = node('a', 'text-link', '前往绑定')
        link.href = '#binding'
        results.replaceChildren(emptyState(stats ? '绑定后查看统计' : '绑定后查看战绩',
            stats ? '按模式与难度累计模拟成功次数、击败数与最近奖杯。'
                : '绑定森空岛账号，查询卫戍协议的对局记录与阵容。', link))
    } else if (querying || pendingAccount) {
        results.replaceChildren(loading())
    } else if (stats && history?.statistics) {
        results.replaceChildren(statisticsView(history.statistics.summary, history.statistics.persisted))
    } else if (history?.records) {
        results.replaceChildren(historyView(history.records, page, changePage, openRecord))
    } else {
        const retry = node('button', 'button small', '重新查询')
        retry.type = 'button'
        retry.addEventListener('click', () => loadHistory())
        results.replaceChildren(emptyState('暂时无法读取战绩', '刷新可重新向森空岛查询。', retry))
    }
}

async function exportImage(button, message, data) {
    if (button.hasAttribute('aria-busy')) return
    button.setAttribute('aria-busy', 'true')
    button.setAttribute('aria-disabled', 'true')
    const label = button.textContent
    button.textContent = '生成中…'
    setMessage(message, '正在生成图片…')
    try {
        await downloadShareImage(data)
        setMessage(message, 'PNG 图片已开始下载。')
    } catch {
        setMessage(message, '图片生成失败，请重试。', true)
    } finally {
        button.removeAttribute('aria-busy')
        button.removeAttribute('aria-disabled')
        button.textContent = label
    }
}

viewExport.addEventListener('click', () => {
    if (viewExport.hidden) return
    const stats = location.hash === '#statistics'
    void exportImage(viewExport, $('export-status'), {
        kind: stats ? 'statistics' : 'history', source: document.querySelector('.ledger'), page
    })
})
detailExport.addEventListener('click', () => {
    if (activeRecord) {
        void exportImage(detailExport, $('detail-export-status'), { kind: 'detail', source: detail })
    }
})
detail.addEventListener('close', () => { activeRecord = null })

function updateSeasonOptions(resource) {
    const seasons = Array.isArray(resource.seasons) ? resource.seasons : []
    const names = new Map(seasons.filter(item => item?.seasonId).map(item => [String(item.seasonId), String(item.name || item.seasonId)]))
    if (!names.has(seasonId)) names.set(seasonId, seasonId)
    selectOptions(seasonSelect, [...names].map(([id, label]) => ({ id, label })), seasonId)
}

async function loadHistory({ reset = false } = {}) {
    if (!account) return
    const current = ++query
    const { client, uid } = account
    const requestedSeason = seasonId
    const previous = reset ? null : history
    if (reset) history = null
    querying = true
    if (!viewExport.hasAttribute('aria-busy')) setMessage($('export-status'))
    $('refresh').disabled = true
    seasonSelect.disabled = true
    setMessage(queryStatus, '正在同步森空岛战绩…')
    renderResults()
    let resolvedSeason = requestedSeason
    try {
        const role = account.roles.find(role => role.uid === uid)
        const [resource, player] = await Promise.all([
            client.resource(uid, requestedSeason),
            client.player(uid).then(data => playerIdentity(data, role)).catch(() =>
                account?.player?.uid === uid ? account.player : playerIdentity({}, role))
        ])
        if (current !== query) return
        account.player = player
        renderPlayer()
        resolvedSeason = String(resource.versionInfo?.seasonId || '')
        if (!resolvedSeason) throw new Error('森空岛暂无可查询的卫戍协议赛季。')
        if (requestedSeason && resolvedSeason !== requestedSeason) {
            seasonId = ''
            seasonSelect.replaceChildren()
            throw new Error('所选赛季暂不可查。刷新可重新加载当前赛季。')
        }
        seasonId = resolvedSeason
        updateSeasonOptions(resource)
        saveAccount()
        accountUI()
        const raw = await client.history(uid, resolvedSeason)
        if (current !== query) return
        const writeStatistics = () => current === query && syncStatistics(uid, resolvedSeason, raw)
        const statistics = navigator.locks
            ? await navigator.locks.request('stronghold.statistics', writeStatistics)
            : writeStatistics()
        if (current !== query) return
        const records = await client.normalizeHistory(uid, resolvedSeason, raw, resource)
        if (current !== query) return
        history = { records, statistics }
        page = 1
        setMessage(queryStatus, statistics.persisted ? '' : '本次统计未能保存，请检查浏览器的站点数据设置。', !statistics.persisted)
    } catch (error) {
        if (current !== query) return
        history = previous
        if (!history && resolvedSeason) {
            const statistics = syncStatistics(uid, resolvedSeason, [])
            if (statistics.summary.total) history = { statistics }
        }
        setMessage(queryStatus, error.message, true)
    } finally {
        if (current === query) {
            querying = false
            $('refresh').disabled = false
            seasonSelect.disabled = seasonSelect.options.length === 0
            renderResults()
        }
    }
}

function stopScan() {
    scanController?.abort()
    scanController = null
    qrImage.replaceChildren()
    qrImage.hidden = true
    qrStart.disabled = false
    qrStart.textContent = '生成二维码'
}

function changeMethod(qr) {
    bindSequence++
    stopScan()
    $('qr-method').setAttribute('aria-pressed', String(qr))
    $('cred-method').setAttribute('aria-pressed', String(!qr))
    $('qr-panel').hidden = !qr
    $('cred-panel').hidden = qr
    $('cred-submit').disabled = false
    $('cred').value = ''
    setMessage(bindingMessage)
}

async function acceptCred(cred, { sequence, saved = {} }) {
    const client = new Skland(cred)
    const roles = await client.roles()
    if (sequence !== bindSequence) return
    if (!roles.length) throw new AccountError('此森空岛账号未绑定明日方舟角色。')
    const uid = roles.find(role => role.uid === saved.uid)?.uid ?? roles[0].uid
    account = { client, uid, roles, persisted: false }
    seasonId = uid === saved.uid && typeof saved.seasonId === 'string' ? saved.seasonId : ''
    saveAccount()
    accountUI()
    stopScan()
    setMessage(bindingMessage)
    void loadHistory({ reset: true })
}

async function post(path, data, signal) {
    const response = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data), cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(50_000)])
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || '扫码请求失败，请稍后重试。')
    return result
}

function wait(ms, signal) {
    return new Promise(resolve => {
        if (signal.aborted) return resolve()
        const finish = () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', finish)
            resolve()
        }
        const timer = setTimeout(finish, ms)
        signal.addEventListener('abort', finish, { once: true })
    })
}

async function scan() {
    stopScan()
    const sequence = ++bindSequence
    const controller = new AbortController()
    scanController = controller
    const { signal } = controller
    qrStart.disabled = true
    setMessage(bindingMessage, '正在生成二维码…')
    try {
        const { ticket, image, expiresIn } = await post('/api/qr/start', {}, signal)
        if (signal.aborted) return
        const code = node('img')
        code.alt = '森空岛登录二维码'
        code.width = code.height = 176
        code.src = image
        qrImage.replaceChildren(code)
        qrImage.hidden = false
        qrStart.textContent = '刷新二维码'
        qrStart.disabled = false
        setMessage(bindingMessage, '等待扫码与确认。二维码约 100 秒内有效。')
        const expiresAt = Date.now() + expiresIn
        while (!signal.aborted && Date.now() < expiresAt) {
            await wait(2100, signal)
            if (signal.aborted || Date.now() >= expiresAt) break
            const result = await post('/api/qr/check', { ticket }, signal)
            if (signal.aborted || result.status === 'expired') break
            if (result.status === 'confirmed') {
                setMessage(bindingMessage, '扫码成功，正在验证角色…')
                await acceptCred(result.cred, { sequence })
                return
            }
        }
        if (!signal.aborted) setMessage(bindingMessage, '二维码已过期，请重新生成。', true)
    } catch (error) {
        if (!signal.aborted) setMessage(bindingMessage, error.message || '扫码失败，请重新生成二维码。', true)
    } finally {
        if (scanController === controller) stopScan()
    }
}

function clearAccount() {
    try {
        localStorage.removeItem(accountKey)
        if ($('clear-stats').checked) forgetStatistics(account.roles.map(role => role.uid))
    } catch {
        if (account.persisted) {
            setMessage(queryStatus, '未能清除此浏览器的全部站点数据。', true)
            return
        }
    }
    query++
    bindSequence++
    account = null
    history = null
    seasonId = ''
    querying = false
    seasonSelect.replaceChildren()
    $('refresh').disabled = false
    setMessage(queryStatus)
    setMessage(bindingMessage, '已解除绑定。')
    setMessage($('export-status'))
    accountUI()
    renderResults()
    $('qr-method').focus()
}

async function restoreAccount() {
    let saved
    try { saved = JSON.parse(localStorage.getItem(accountKey) || 'null') } catch { return }
    if (!validCred(saved?.cred)) return
    const sequence = ++bindSequence
    pendingAccount = true
    setMessage(queryStatus, '正在验证本地绑定…')
    renderResults()
    try { await acceptCred(saved.cred, { sequence, saved }) } catch (error) {
        if (sequence === bindSequence) {
            if (error instanceof AccountError) {
                try { localStorage.removeItem(accountKey) } catch { /* Storage can be disabled. */ }
            }
            setMessage(bindingMessage, error.message, true)
            setMessage(queryStatus)
        }
    } finally {
        pendingAccount = false
        if (!account) setMessage(queryStatus)
        renderResults()
    }
}

async function loadConfig() {
    try {
        const response = await fetch('/config.json', { cache: 'no-store' })
        if (!response.ok) return
        config = await response.json()
        const logo = document.querySelector('.brand img')
        logo.addEventListener('error', () => { logo.src = '/assets/stronghold.png' }, { once: true })
        logo.src = asset('stronghold.png')
    } catch { /* Bundled artwork and repository links remain available. */ }
}

$('qr-method').addEventListener('click', () => changeMethod(true))
$('cred-method').addEventListener('click', () => changeMethod(false))
qrStart.addEventListener('click', scan)
$('cred-panel').addEventListener('submit', async event => {
    event.preventDefault()
    const cred = $('cred').value.trim()
    if (!validCred(cred)) {
        setMessage(bindingMessage, '请粘贴有效的 Cred 字符串。', true)
        return
    }
    const sequence = ++bindSequence
    const button = $('cred-submit')
    button.disabled = true
    setMessage(bindingMessage, '正在向森空岛验证…')
    try {
        await acceptCred(cred, { sequence })
        if (sequence === bindSequence) $('cred').value = ''
    } catch (error) {
        if (sequence === bindSequence) setMessage(bindingMessage, error.message, true)
    } finally {
        if (sequence === bindSequence) button.disabled = false
    }
})
seasonSelect.addEventListener('change', () => {
    seasonId = seasonSelect.value
    void loadHistory({ reset: true })
})
roleSelect.addEventListener('change', () => {
    account.uid = roleSelect.value
    seasonId = ''
    seasonSelect.replaceChildren()
    saveAccount()
    accountUI()
    void loadHistory({ reset: true })
})
$('refresh').addEventListener('click', () => loadHistory())
$('unbind').addEventListener('click', () => {
    unbindDialog.returnValue = ''
    $('clear-stats').checked = false
    unbindDialog.showModal()
})
unbindDialog.addEventListener('close', () => {
    if (unbindDialog.returnValue !== 'confirm' || !account) return
    if (navigator.locks) void navigator.locks.request('stronghold.statistics', clearAccount)
    else clearAccount()
})
window.addEventListener('hashchange', setTab)
window.addEventListener('storage', event => {
    if (event.storageArea !== localStorage || (event.key !== accountKey && event.key !== null)) return
    let cred
    try { cred = JSON.parse(event.newValue)?.cred } catch { /* Invalid account data is cleared on reload. */ }
    if (cred !== account?.client.cred) location.reload()
})

setTab()
void loadConfig()
void restoreAccount()
