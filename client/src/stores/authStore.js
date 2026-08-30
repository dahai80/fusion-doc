// P0-F1 修复: 客户端鉴权对接。原 api.js 不带 Authorization, 生产模式全量 401, 产品不可用。
// authStore 管理 token (localStorage 持久), 提供 login/setup/logout/me, 供 api.js 与 App 网关使用。
import { create } from 'zustand';
import { api } from '../lib/api';

const TOKEN_KEY = 'fusion-doc-token';
const USER_KEY = 'fusion-doc-user';

function loadToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}
function loadUser() {
    try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

export const useAuthStore = create((set, get) => ({
    token: loadToken(),
    user: loadUser(),
    loading: false,
    error: null,

    // 启动探测: 已安装? 有 token 验证 /api/users/me
    async bootstrap() {
        set({ loading: true, error: null });
        try {
            const setup = await api('GET', '/system/setup');
            const needsSetup = setup?.setup === true || setup?.data?.setup === true;
            if (needsSetup) { set({ loading: false }); return { needsSetup: true }; }
            const token = get().token;
            if (token) {
                try {
                    const me = await api('POST', '/users/me', {});
                    set({ user: me?.data || me, loading: false });
                    return { needsSetup: false };
                } catch (e) {
                    // token 失效, 清除
                    get().logout();
                    set({ loading: false });
                    return { needsSetup: false };
                }
            }
            set({ loading: false });
            return { needsSetup: false };
        } catch (e) {
            set({ loading: false, error: e.message });
            return { needsSetup: false };
        }
    },

    async login(email, password) {
        set({ loading: true, error: null });
        try {
            const data = await api('POST', '/auth/login', { email, password });
            const token = data?.token;
            const user = data?.user;
            if (!token) throw new Error('登录响应缺 token');
            try {
                localStorage.setItem(TOKEN_KEY, token);
                localStorage.setItem(USER_KEY, JSON.stringify(user));
            } catch {}
            set({ token, user, loading: false });
            return user;
        } catch (e) {
            set({ loading: false, error: e.message });
            throw e;
        }
    },

    async setup(email, name, password) {
        set({ loading: true, error: null });
        try {
            const data = await api('POST', '/auth/setup', { email, name, password });
            const token = data?.token;
            const user = data?.user;
            if (!token) throw new Error('安装响应缺 token');
            try {
                localStorage.setItem(TOKEN_KEY, token);
                localStorage.setItem(USER_KEY, JSON.stringify(user));
            } catch {}
            set({ token, user, loading: false });
            return user;
        } catch (e) {
            set({ loading: false, error: e.message });
            throw e;
        }
    },

    logout() {
        try {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
        } catch {}
        set({ token: null, user: null });
    },
}));

// 非 React 读取 (供 api.js 同步取 token 拼头)
export function getAuthToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}
