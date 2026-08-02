const API_BASE = '/api';

export async function api(method, path, body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body && method !== 'GET') {
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${API_BASE}${path}`, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || `API ${res.status}`);
    }
    return res.json();
}

export async function apiStream(path, body, onChunk, onDone) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`API ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                    onDone?.();
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    onChunk(parsed);
                } catch {
                    onChunk({ text: data });
                }
            }
        }
    }
    onDone?.();
}

export async function apiUpload(path, file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) {
        throw new Error(`Upload failed: ${res.status}`);
    }
    return res.json();
}

export function searchPages(q) {
    return api('GET', `/search?q=${encodeURIComponent(q)}`);
}
