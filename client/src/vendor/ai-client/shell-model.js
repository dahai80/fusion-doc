// Inside the union shell, the host publishes the person's model preference
// through a same-origin localStorage handoff (documented in fusion-web-shell's
// README): `fusion.shell.model`, where '' means "gateway default". Outside the
// shell (standalone or dev) this reads nothing and the env fallback applies.

const SHELL_MODEL_KEY = 'fusion.shell.model'

export function inShell() {
    try {
        return window.location.pathname.startsWith('/shell/')
    } catch (err) {
        return false
    }
}

export function shellModel() {
    if (!inShell()) return ''
    try {
        return localStorage.getItem(SHELL_MODEL_KEY) || ''
    } catch (err) {
        return ''
    }
}
