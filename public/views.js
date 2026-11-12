import { formatGarrisonDuration, garrisonImageUrl } from './garrison-view.js'

export const $ = id => document.getElementById(id)
export const node = (tag, className, ...content) => {
    const element = document.createElement(tag)
    if (className) element.className = className
    element.append(...content)
    return element
}

export function remoteImage(value) {
    const safe = garrisonImageUrl(value)
    return safe.startsWith('https://') ? safe : ''
}

function image(url, alt = '', className = '') {
    const element = node('img', className)
    element.src = url
    element.alt = alt
    element.loading = 'lazy'
    element.referrerPolicy = 'no-referrer'
    element.addEventListener('error', () => element.remove(), { once: true })
    return element
}

function imageIf(url, alt, className) {
    return url ? [image(url, alt, className)] : []
}

export function playerView(player) {
    const avatar = node('div', 'player-avatar', node('span', 'player-avatar-fallback', '博士'),
        ...imageIf(remoteImage(player.avatar), '玩家头像'))
    if (player.level) {
        avatar.append(node('span', 'player-level', node('strong', '', player.level), node('small', '', 'LV')))
    }
    const meta = node('div', 'player-meta', node('span', '', `UID ${player.uid}`))
    if (player.registered) meta.append(node('span', '', `入职 ${player.registered}`))
    return node('div', 'player', avatar,
        node('div', 'player-info', node('strong', 'player-name', `Dr.${player.name}`), meta))
}

export function setMessage(element, message = '', error = false) {
    element.textContent = message
    element.hidden = !message
    element.toggleAttribute('data-error', error)
}

export function emptyState(title, message, action) {
    const emblem = node('div', 'empty-emblem', node('span'), node('span'), node('span'))
    emblem.setAttribute('aria-hidden', 'true')
    return node('div', 'empty-state', emblem, node('h2', '', title), node('p', '', message), ...(action ? [action] : []))
}

export function loading() {
    const element = node('div', 'loading-lines', node('span'), node('span'), node('span'))
    element.setAttribute('aria-hidden', 'true')
    return element
}

const result = record => record.statusUnknown ? 'unknown' : record.success ? 'success' : 'interrupted'
const value = number => number == null ? '—' : new Intl.NumberFormat('zh-CN').format(number)
const status = record => node('span', 'result-label', record.resultLabel)
const round = record => node('strong', '', String(record.passRound))
function tone(label, id) {
    const element = node('span', '', label)
    element.dataset.tone = id
    return element
}

function strategyLabel(strategy) {
    return node('span', 'record-strategy', ...imageIf(remoteImage(strategy.iconUrl), '', 'strategy-icon'),
        node('span', '', strategy.name || '小队暂未提供'))
}

function recordRow(record, onOpen) {
    const summary = node('span', 'record-summary', round(record), node('span', '', '轮'), status(record))
    const meta = node('span', 'record-meta', tone(record.mode, record.modeTone), tone(record.difficulty, record.difficultyTone),
        strategyLabel(record.strategy), node('span', '', record.date))
    const faces = record.operators.slice(0, 10).flatMap(operator => imageIf(remoteImage(operator.avatarUrl), ''))
    const roster = node('span', 'roster-mini', ...faces)
    roster.setAttribute('aria-hidden', 'true')
    const arrow = node('span', '', '›')
    arrow.setAttribute('aria-hidden', 'true')
    const button = node('button', 'record', node('span', '', summary, meta), node('span', 'record-end', roster, arrow))
    button.type = 'button'
    button.dataset.result = result(record)
    button.addEventListener('click', () => onOpen(record))
    return node('li', '', button)
}

export const historyPageSize = 12

export function historyView(records, page, onPage, onOpen) {
    if (!records.length) return emptyState('本赛季暂无战绩', '森空岛当前没有返回此赛季的对局。可以切换赛季或稍后刷新。')
    const pages = Math.ceil(records.length / historyPageSize)
    const entries = records.slice((page - 1) * historyPageSize, page * historyPageSize)
    const list = node('ul', 'history', ...entries.map(record => recordRow(record, onOpen)))
    const container = node('div', 'records', node('p', 'records-meta', `森空岛当前可查 ${records.length} 场`), list)
    if (pages > 1) {
        const previous = node('button', 'button small', '上一页')
        const next = node('button', 'button small', '下一页')
        previous.type = next.type = 'button'
        previous.disabled = page === 1
        next.disabled = page === pages
        previous.addEventListener('click', () => onPage(page - 1))
        next.addEventListener('click', () => onPage(page + 1))
        container.append(node('div', 'pager', previous, node('span', '', `第 ${page} / ${pages} 页`), next))
    }
    return container
}

function metric(label, amount) {
    return node('div', '', node('dt', '', label), node('dd', '', typeof amount === 'string' ? amount : value(amount)))
}

function statisticsRanking(kind, entries, emptyLabel = '暂无数据') {
    const strategy = kind === 'strategy'
    const rows = entries.slice(0, 5).map(entry => {
        const icon = node('span', 'stat-rank-icon', node('span', '', '◇'), ...imageIf(remoteImage(entry.iconUrl), ''))
        icon.setAttribute('aria-hidden', 'true')
        const result = strategy
            ? `胜率 ${entry.winRate === null ? '—' : entry.winRate + '%'}`
            : `最高 ${entry.maxLayer === null ? '—' : value(entry.maxLayer) + '层'}`
        return node('li', 'stat-rank-entry', icon,
            node('p', 'stat-rank-count', node('strong', '', value(entry.games)), ' 场'),
            node('p', 'stat-rank-name', entry.name), node('p', 'stat-rank-metric', result))
    })
    const section = node('section', 'stat-ranking', node('h4', '', strategy ? '常用策略' : '常用盟约'),
        rows.length ? node('ul', 'stat-rank-list', ...rows) : node('p', 'stat-note', emptyLabel))
    section.dataset.kind = kind
    return section
}

export function statisticsView(stats, notice) {
    const totals = node('dl', 'stat-totals',
        metric('累计对局', stats.total), metric('模拟成功', stats.wins),
        metric('累计击败', stats.kills), metric('最近奖杯', stats.trophies))
    const { boss, duration, coverage } = stats
    const sample = reported => `${reported} / ${coverage.total} 局`
    const extra = node('div', 'stat-extra',
        node('section', 'stat-card', node('h3', '', 'Boss 击杀'),
            node('strong', 'stat-amount', boss.reported ? value(boss.total) : '暂无数据'),
            node('p', '', `普通 ${value(boss.normal)} · 隐秘 ${value(boss.hidden)}`),
            node('p', 'stat-note', `数据覆盖 ${sample(boss.reported)}`)),
        node('section', 'stat-card', node('h3', '', '累计耗时'),
            node('strong', 'stat-amount', duration.reported ? formatGarrisonDuration(duration.totalSec) : '暂无数据'),
            node('p', '', `平均 ${formatGarrisonDuration(duration.avgSec)}`),
            node('p', '', `最短 ${formatGarrisonDuration(duration.minSec)} · 最长 ${formatGarrisonDuration(duration.maxSec)}`),
            node('p', 'stat-note', `数据覆盖 ${sample(duration.reported)}`)))
    const head = node('tr', '', ...['模式', '难度', '成功', '对局'].map(label => {
        const th = node('th', '', label)
        th.scope = 'col'
        return th
    }))
    const rows = stats.difficulties.map(group => node('tr', '', node('td', '', tone(group.mode, group.modeTone)),
        node('td', '', tone(group.label, group.tone)), node('td', '', value(group.wins)), node('td', '', value(group.total))))
    const table = rows.length
        ? node('table', 'stat-table', node('caption', 'visually-hidden', '按模式与难度统计'), node('thead', '', head), node('tbody', '', ...rows))
        : node('p', 'stat-note stat-source', '本赛季暂未收录对局。')
    return node('div', 'statistics', totals, extra,
        node('section', 'stat-preferences', node('h3', '', '偏好统计'),
            statisticsRanking('strategy', stats.strategies),
            statisticsRanking('bond', stats.bonds, coverage.bondsReported ? '暂无上榜盟约' : '暂无数据')),
        table, node('div', 'stat-source',
            node('p', 'stat-note', '按此浏览器已收录的对局累计。首次同步仅覆盖森空岛当前返回的战绩。'),
            node('p', 'stat-note', `数据覆盖 · 普通击败 ${sample(stats.killsReported)} · 策略 ${sample(coverage.strategyReported)} · 盟约 ${sample(coverage.bondsReported)}`),
            ...(notice ? [node('p', 'stat-note stat-warning', notice)] : [])))
}

function detailIcon(label, url, fallback, { description = '', glow = '' } = {}) {
    const imageUrl = remoteImage(url)
    const button = node('button', 'detail-icon', node('span', 'icon-fallback', fallback),
        ...imageIf(imageUrl, ''), ...imageIf(imageUrl && remoteImage(glow), '', 'icon-glow'))
    button.type = 'button'
    button.dataset.tip = label
    button.setAttribute('aria-label', label)
    if (description) {
        button.dataset.description = description
        button.setAttribute('aria-description', description)
    }
    return button
}

const equipmentIcon = item => detailIcon(item.name, item.iconUrl, '装备', { description: item.description })

function loadoutSlot(kind, name, url, glow) {
    if (name) return detailIcon(`${kind}：${name}`, url, kind, { glow })
    return node('span', 'detail-icon empty-slot', '未选')
}

function operatorCard(operator, asset) {
    const portrait = remoteImage(operator.portraitUrl)
    const background = image(asset(`portrait-tier-${operator.tierIcon ? operator.tier : 1}.png`), '', 'tier-bg')
    const art = node('div', operator.portraitIsAvatar ? 'operator-art avatar-only' : 'operator-art',
        background, node('span', 'portrait-fallback', '暂无立绘'), ...imageIf(portrait, '', 'operator-portrait'))
    const badges = node('div', 'operator-badges')
    if (operator.tierIcon) badges.append(image(asset(operator.tierIcon), `阶级 ${operator.tier}`, 'operator-tier'))
    else if (operator.tier > 0) badges.append(node('span', 'operator-tier-fallback', `阶级 ${operator.tier}`))
    if (operator.level != null) {
        const elite = operator.eliteIcon
            ? [image(asset(operator.eliteIcon), `精英 ${operator.evolvePhase}`)] : []
        const level = node('div', 'operator-level', ...elite, node('span', '', String(operator.level)))
        level.title = [`等级 ${operator.level}`, operator.mergeLevel ? `合并等级 ${operator.mergeLevel}` : ''].filter(Boolean).join(' / ')
        level.classList.toggle('merged', operator.mergeLevel > 0)
        badges.append(level)
    }
    const loadout = node('div', 'operator-loadout',
        loadoutSlot('技能', operator.skillName, operator.skillIconUrl),
        loadoutSlot('模组', operator.moduleName, operator.moduleIconUrl, operator.moduleShiningUrl))
    const card = node('div', 'operator-card', art, badges, loadout)
    const equips = operator.equips.length
        ? [node('div', 'operator-equips', ...operator.equips.map(equipmentIcon))] : []
    return node('li', 'operator', card, node('h4', 'operator-name', operator.name), ...equips)
}

function recordOverview(record) {
    const summary = node('div', 'record-summary', round(record), node('span', '', '轮'), status(record))
    const meta = node('div', 'record-meta', tone(record.mode, record.modeTone), tone(record.difficulty, record.difficultyTone),
        strategyLabel(record.strategy), node('span', '', record.seasonName), node('span', '', record.date))
    if (record.id) meta.append(node('span', 'detail-record-id', `战绩 ID ${record.id}`))
    const metrics = node('dl', 'detail-grid')
    if (record.killCnt != null) metrics.append(metric('击杀数', record.killCnt))
    if (record.bossKills) metrics.append(metric('普通 Boss', record.bossKills.normal), metric('隐秘 Boss', record.bossKills.hidden))
    if (record.durationSec != null) metrics.append(metric('耗时', formatGarrisonDuration(record.durationSec)))
    if (record.trophyBefore != null || record.trophyAfter != null) {
        metrics.append(node('div', '', node('dt', '', '奖杯变化'),
            node('dd', '', `${value(record.trophyBefore)} → ${value(record.trophyAfter)}`)))
    }
    if (record.coinCost != null) metrics.append(metric('资金消耗', record.coinCost))
    const overview = node('div', 'detail-overview', node('div', 'overview-summary', summary, meta), ...(metrics.childElementCount ? [metrics] : []))
    overview.dataset.result = result(record)
    return overview
}

function bondRow(bond) {
    const state = node('span', 'bond-state', bond.active == null ? '激活状态未知' : bond.active ? '已激活' : '未激活')
    const row = node('li', 'detail-bond', ...imageIf(remoteImage(bond.iconUrl), ''),
        node('div', '', node('strong', '', bond.name), state), node('span', 'bond-layer', `${bond.layer} 层`))
    row.toggleAttribute('data-active', bond.active)
    return row
}

export function detailView(record, asset) {
    const roster = record.operators.length ? node('ul', 'detail-roster', ...record.operators.map(operator => operatorCard(operator, asset)))
        : node('p', 'detail-empty', '本局无可展示阵容。')
    const rosterHeader = node('div', 'detail-section-heading', node('h3', '', '最终阵容'),
        node('span', '', `${record.operators.length} 名干员`))
    const bonds = record.bonds.length ? node('ul', 'detail-bonds', ...record.bonds.map(bondRow))
        : node('p', 'detail-empty', '本局无可展示盟约。')
    const items = record.items.length ? node('div', 'detail-equips', ...record.items.map(equipmentIcon))
        : node('p', 'detail-empty', '本局无可展示装备。')
    const notices = record.resourceUnavailable
        ? [node('p', 'detail-note', '森空岛未返回此版本的资料，部分内容以 ID 显示。')] : []
    return [
        recordOverview(record), ...notices,
        node('div', 'detail-layout', node('section', 'detail-section', rosterHeader, roster),
            node('div', 'detail-side',
                node('section', 'detail-section', node('div', 'detail-section-heading', node('h3', '', '盟约')), bonds),
                node('section', 'detail-section', node('div', 'detail-section-heading', node('h3', '', '装备')), items)))
    ]
}
