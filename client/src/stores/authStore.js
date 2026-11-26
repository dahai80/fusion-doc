// P0-F1 fix: client auth integration. The original api.js sent no Authorization header, so production returned 401 for everything and the product was unusable.
// authStore manages the token (persisted in localStorage) and provides login/setup/logout/me for api.js and the App gateway.
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

    // Startup probe: installed? If a token exists, verify via /api/users/me
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
                    // Token invalid, clear it
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
            if (!token) throw new Error('Login response missing token');
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
            if (!token) throw new Error('Setup response missing token');
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

// Non-React accessor (lets api.js read the token synchronously to build headers)
export function getAuthToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}
