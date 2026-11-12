export function bindDetailTooltips(dialog) {
    const tip = dialog.querySelector('.detail-tip')
    const native = typeof tip.showPopover === 'function'
    if (!native) tip.hidden = true

    let anchor = null
    let pinned = false
    let dismissTimer
    const icon = target => target?.closest?.('[data-tip]')

    function hide() {
        clearTimeout(dismissTimer)
        if (!anchor) return
        if (native) tip.hidePopover()
        else tip.hidden = true
        anchor = null
        pinned = false
    }

    function show(button) {
        clearTimeout(dismissTimer)
        if (anchor === button) return
        pinned = false
        const wasOpen = Boolean(anchor)
        anchor = button
        tip.replaceChildren(Object.assign(document.createElement('strong'), { textContent: button.dataset.tip }))
        if (button.dataset.description) {
            tip.append(Object.assign(document.createElement('p'), { textContent: button.dataset.description }))
        }
        if (!wasOpen) {
            if (native) tip.showPopover()
            else tip.hidden = false
        }
        const { left, right, top, bottom } = button.getBoundingClientRect()
        const { width, height } = tip.getBoundingClientRect()
        const centered = (left + right - width) / 2
        tip.style.left = Math.max(8, Math.min(centered, innerWidth - width - 8)) + 'px'
        tip.style.top = (bottom + height + 14 <= innerHeight ? bottom + 6 : Math.max(8, top - height - 6)) + 'px'
    }

    function dismissSoon() {
        clearTimeout(dismissTimer)
        if (!pinned) dismissTimer = setTimeout(hide, 140)
    }

    dialog.addEventListener('pointerover', event => {
        const button = icon(event.target)
        if (button && event.pointerType !== 'touch') show(button)
    })
    dialog.addEventListener('pointerout', event => {
        if (anchor && icon(event.target) === anchor && !anchor.contains(event.relatedTarget)) dismissSoon()
    })
    tip.addEventListener('pointerenter', () => clearTimeout(dismissTimer))
    tip.addEventListener('pointerleave', event => {
        if (anchor && !anchor.contains(event.relatedTarget)) dismissSoon()
    })
    dialog.addEventListener('focusin', event => {
        const button = icon(event.target)
        if (button?.matches(':focus-visible')) show(button)
    })
    dialog.addEventListener('focusout', event => {
        if (anchor && icon(event.target) === anchor && !anchor.contains(event.relatedTarget)) {
            pinned = false
            dismissSoon()
        }
    })
    dialog.addEventListener('click', event => {
        const button = icon(event.target)
        if (button) {
            if (anchor === button && pinned) hide()
            else {
                show(button)
                pinned = true
            }
        } else if (!tip.contains(event.target)) {
            hide()
        }
    })
    dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape' && anchor) {
            event.preventDefault()
            hide()
        }
    })
    dialog.addEventListener('cancel', event => {
        if (anchor) {
            event.preventDefault()
            hide()
        }
    })
    dialog.addEventListener('scroll', hide)
    dialog.addEventListener('close', hide)
    window.addEventListener('resize', hide)
}
