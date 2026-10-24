// issue #51: Union Web shell 内嵌模式探测 (PRD R-8 ③/④)
// 嵌入判定: ?embedded=1 或挂载于 /shell/<id>/ 路径 (gateway 同源 iframe)。
// 内嵌时: 隐藏自有导航 chrome, 鉴权剥离 (网关 /shell/ 代理注入服务凭证, 客户端零 token)。
function detectEmbedded() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('embedded') === '1') return true;
    } catch { /* SSR/测试环境兜底走路径判定 */ }
    return typeof window !== 'undefined' && window.location.pathname.startsWith('/shell/');
}

export const isEmbedded = detectEmbedded();

// shell 挂载基路径: /shell/fusion-doc/(index.html)? → /shell/fusion-doc; 独立模式返回 ''
export function shellBasePath() {
    if (typeof window === 'undefined') return '';
    const m = window.location.pathname.match(/^(\/shell\/[^/]+)/);
    return m ? m[1] : '';
}
