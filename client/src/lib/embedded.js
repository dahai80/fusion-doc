// issue #51: Union Web shell embedded-mode detection (PRD R-8 ③/④)
// Embedded when: ?embedded=1 or mounted under the /shell/<id>/ path (gateway same-origin iframe).
// When embedded: hide our own navigation chrome, auth is stripped (gateway /shell/ proxy injects the service credential, zero tokens on the client).
function detectEmbedded() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('embedded') === '1') return true;
    } catch { /* SSR/test environment fallback: decide by path */ }
    return typeof window !== 'undefined' && window.location.pathname.startsWith('/shell/');
}

export const isEmbedded = detectEmbedded();

// shell mount base path: /shell/fusion-doc/(index.html)? → /shell/fusion-doc; returns '' in standalone mode
export function shellBasePath() {
    if (typeof window === 'undefined') return '';
    const m = window.location.pathname.match(/^(\/shell\/[^/]+)/);
    return m ? m[1] : '';
}
