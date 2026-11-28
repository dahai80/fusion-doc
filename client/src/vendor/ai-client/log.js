const PREFIX = '[fusion-office]'

export function log(scope, ...args) {
    console.log(`${PREFIX}[${scope}]`, ...args)
}

export function warn(scope, ...args) {
    console.warn(`${PREFIX}[${scope}]`, ...args)
}

export function error(scope, ...args) {
    console.error(`${PREFIX}[${scope}]`, ...args)
}
