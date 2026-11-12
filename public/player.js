// Avatar paths and identity fields follow arknights-plugin/model/playerView.js.
export function playerIdentity(data = {}, role = {}) {
    const status = data?.status || {}
    const avatar = status.avatar || {}
    const url = typeof avatar.url === 'string' && /^https:\/\/(?:web|bbs)\.hycdn\.cn\//.test(avatar.url) ? avatar.url : ''
    const type = avatar.type === 'ICON' ? 'avatar' : 'char_skin/avatar'
    const id = avatar.id == null ? '' : encodeURIComponent(String(avatar.id)).replace(/'/g, '%27')
    const level = status.level
    const ts = Number(status.registerTs)
    const date = new Date(ts < 1e12 ? ts * 1000 : ts)
    return {
        name: String(status.name || role.name || '博士'),
        uid: String(role.uid || status.uid || '—'),
        level: level != null && level !== '' && Number.isFinite(Number(level)) ? String(level) : '',
        avatar: url || (id ? `https://web.hycdn.cn/arknights/game/assets/${type}/${id}.png` : ''),
        registered: ts > 0 && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(date) : ''
    }
}
