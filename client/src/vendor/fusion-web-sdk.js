// ── Vendored @fusion/web-sdk v0.1.2 (issue #62) ──
// Source: dahai80/fusion-web-shell tag v0.1.2, packages/sdk/src/index.ts
// Built: bun build src/index.ts --target browser --format esm
// Upstream fix: host bridge TypeError (fusion-web-shell#75/#76), cached-sync theme (issue #77, PR #78)
// src/retry.ts
class TimeoutError extends Error {
  constructor(ms) {
    super(`operation timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}
function isRetryableError(err) {
  if (err instanceof TimeoutError)
    return true;
  const status = err.status;
  if (typeof status === "number")
    return status >= 500 || status === 429;
  return true;
}
function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, opts) {
  let lastError;
  for (let attempt = 0;attempt <= opts.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === opts.retries || !isRetryableError(err))
        break;
      opts.onRetry?.(attempt + 1, err);
      const backoff = (opts.backoffMs ?? 300) * 2 ** attempt;
      await sleep(backoff);
    }
  }
  throw lastError;
}

class HttpError extends Error {
  status;
  code;
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

// src/theme.ts
function createThemeState(initial) {
  let current = initial;
  const listeners = new Set;
  return {
    get() {
      return current;
    },
    set(mode) {
      if (mode === current)
        return;
      current = mode;
      listeners.forEach((fn) => fn(mode));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
// src/poll.ts
function createPoller(opts) {
  let timer = null;
  let running = false;
  let failures = 0;
  function hiddenInterval() {
    return opts.hiddenIntervalMs ?? opts.intervalMs * 6;
  }
  function currentVisible() {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }
  async function tick() {
    if (!running)
      return;
    try {
      await opts.onTick();
      failures = 0;
    } catch (err) {
      failures++;
      console.warn("[fusion-sdk poller] tick failed", failures, err);
      if (failures >= (opts.failureThreshold ?? 3)) {
        opts.onError?.(err, failures);
      }
    } finally {
      schedule();
    }
  }
  function schedule() {
    if (!running)
      return;
    clear();
    const delay = currentVisible() ? opts.intervalMs : hiddenInterval();
    timer = setTimeout(() => void tick(), delay);
  }
  function clear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function onVisibilityChange() {
    if (!running)
      return;
    schedule();
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  return {
    start(immediate = true) {
      if (running)
        return;
      running = true;
      if (immediate)
        tick();
      else
        schedule();
    },
    stop() {
      running = false;
      clear();
    }
  };
}
// src/host.ts
function isHttpErrorResult(result) {
  return result !== null && typeof result === "object" && "__httpError" in result;
}
function createHostBridge(tabId, iframeWindow, options) {
  const origin = options.origin ?? window.location.origin;
  const disposers = [];
  let currentIframeWindow = iframeWindow;
  const pendingPings = new Set;
  let sdkAlive = false;
  let pingSeq = 0;
  let heartbeatTimer = null;
  function startHeartbeat(onLivenessChange, intervalMs = 30000, timeoutMs = 1e4) {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (!currentIframeWindow)
        return;
      const id = `ping-${tabId}-${++pingSeq}`;
      let answered = false;
      const resolver = (msgId) => {
        if (msgId === id) {
          answered = true;
        }
      };
      pendingPings.add(resolver);
      currentIframeWindow.postMessage({ type: "request", id, method: "ping", payload: null }, origin);
      setTimeout(() => {
        pendingPings.delete(resolver);
        if (answered) {
          onLivenessChange(true);
        } else if (sdkAlive) {
          console.warn("[host-bridge] heartbeat missed for", tabId);
          onLivenessChange(false);
        }
      }, timeoutMs);
    }, intervalMs);
  }
  function stopHeartbeat() {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }
  async function handleRequest(msg) {
    switch (msg.method) {
      case "http": {
        const req = msg.payload;
        try {
          const { status, data } = await options.proxyHttp({
            path: req.path,
            method: req.method ?? "GET",
            headers: req.headers,
            body: req.body
          });
          if (status >= 400) {
            const envelope = data;
            return {
              __httpError: true,
              status,
              code: envelope?.code ?? "http_error",
              message: envelope?.message ?? `status ${status}`
            };
          }
          return { status, ok: status < 400, data };
        } catch (err) {
          console.error("[host-bridge] http proxy failed:", err);
          throw new HttpError(502, "gateway_unreachable", "gateway request failed");
        }
      }
      case "toast":
        options.onToast(msg.payload);
        return { ok: true };
      case "tab":
        options.onActiveTask(tabId, msg.payload ?? null);
        return { ok: true };
      case "theme": {
        const mode = document.documentElement.classList.contains("light") ? "light" : "dark";
        return mode;
      }
      case "devices": {
        const mobile = window.matchMedia("(max-width: 767px)").matches;
        const info = { viewport: mobile ? "mobile" : "desktop", mode: null };
        return info;
      }
      default:
        throw new Error(`unknown bridge method: ${msg.method}`);
    }
  }
  function onMessage(ev) {
    if (ev.source !== currentIframeWindow || ev.origin !== origin)
      return;
    const raw = ev.data;
    if (raw.type === "response") {
      sdkAlive = true;
      if (typeof raw.id === "string")
        pendingPings.forEach((fn) => fn(raw.id));
      return;
    }
    const msg = ev.data;
    if (!raw || raw.type !== "request")
      return;
    if (typeof raw.id !== "string" || typeof msg.method !== "string")
      return;
    handleRequest(msg).then((result) => {
      if (isHttpErrorResult(result)) {
        const e = result;
        respond({
          type: "response",
          id: msg.id,
          ok: false,
          error: { code: e.code, message: e.message }
        });
      } else {
        respond({ type: "response", id: msg.id, ok: true, result });
      }
    }, (err) => {
      respond({
        type: "response",
        id: msg.id,
        ok: false,
        error: { code: err.name, message: err.message }
      });
    });
  }
  function respond(msg) {
    if (!currentIframeWindow)
      return;
    currentIframeWindow.postMessage(msg, origin);
  }
  function notify(event) {
    if (!currentIframeWindow)
      return;
    currentIframeWindow.postMessage(event, origin);
  }
  window.addEventListener("message", onMessage);
  disposers.push(() => window.removeEventListener("message", onMessage));
  return {
    get iframeWindow() {
      return currentIframeWindow;
    },
    set iframeWindow(w) {
      currentIframeWindow = w;
    },
    destroy() {
      disposers.forEach((d) => d());
      stopHeartbeat();
      currentIframeWindow = null;
    },
    notifyTheme(mode) {
      notify({ type: "event", event: "theme", payload: mode });
    },
    notifyVisibility(visible) {
      notify({ type: "event", event: "visibility", payload: visible });
    },
    notifyLang(lang) {
      notify({ type: "event", event: "lang", payload: lang });
    },
    get sdkAlive() {
      return sdkAlive;
    },
    startHeartbeat,
    stopHeartbeat
  };
}

// src/index.ts
var DEFAULT_TIMEOUT = 15000;
var DEFAULT_RETRIES = 2;
var requestSeq = 0;
var nextId = () => `req-${Date.now().toString(36)}-${++requestSeq}`;
function createBridge(deps, opts) {
  const pending = new Map;
  function handleMessage(msg) {
    if (!msg || typeof msg !== "object")
      return;
    if (msg.type === "response") {
      const entry = pending.get(msg.id);
      if (!entry)
        return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok)
        entry.resolve(msg.result);
      else
        entry.reject(new HttpError(502, msg.error?.code ?? "bridge_error", msg.error?.message ?? "bridge request failed"));
      return;
    }
    if (msg.type === "event") {
      eventListeners.get(msg.event)?.forEach((fn) => fn(msg.payload));
    }
  }
  const eventListeners = new Map;
  function call(method, payload, timeoutMs) {
    if (!deps.isEmbedded) {
      return Promise.reject(new Error("not embedded: bridge unavailable"));
    }
    const id = nextId();
    return withRetry(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`bridge timeout: ${method}`));
      }, timeoutMs ?? opts.timeoutMs);
      pending.set(id, { resolve, reject, timer });
      deps.send({ type: "request", id, method, payload });
    }), { retries: opts.retries, timeoutMs: timeoutMs ?? opts.timeoutMs }).catch((err) => {
      deps.log("error", `[fusion-sdk] ${method} failed:`, err);
      throw err;
    });
  }
  return { handleMessage, call, deps, eventListeners };
}
function standaloneSdk(log) {
  log("warn", "[fusion-sdk] standalone mode: http goes direct, no host APIs");
  const themeListeners = new Set;
  const mql = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  mql?.addEventListener("change", (e) => themeListeners.forEach((fn) => fn(e.matches ? "dark" : "light")));
  const request = async (path, init) => {
    const hasContentType = Object.keys(init?.headers ?? {}).some((k) => k.toLowerCase() === "content-type");
    const headers = init?.body !== undefined && !hasContentType ? { "content-type": "application/json", ...init?.headers } : init?.headers;
    const res = await fetch(path, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok)
      throw new HttpError(res.status, "http_error", `request failed: ${res.status}`);
    return { status: res.status, ok: true, data };
  };
  return {
    http: {
      request,
      get: (path) => request(path),
      post: (path, body) => request(path, { method: "POST", body }),
      put: (path, body) => request(path, { method: "PUT", body }),
      delete: (path) => request(path, { method: "DELETE" })
    },
    toast: {
      show(input) {
        log(input.level === "error" ? "error" : "log", `[toast:${input.level}]`, input.message);
      }
    },
    tab: {
      setActiveTask() {}
    },
    theme: {
      get: () => mql?.matches ? "dark" : "light",
      subscribe(listener) {
        themeListeners.add(listener);
        return () => themeListeners.delete(listener);
      }
    },
    devices: {
      get() {
        const mobile = typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;
        return { viewport: mobile ? "mobile" : "desktop", mode: null };
      }
    },
    visibility: {
      get: () => typeof document === "undefined" || document.visibilityState === "visible",
      subscribe(listener) {
        const fn = () => listener(document.visibilityState === "visible");
        document.addEventListener("visibilitychange", fn);
        return () => document.removeEventListener("visibilitychange", fn);
      }
    },
    i18n: {
      lang: () => typeof document !== "undefined" && document.documentElement.lang.startsWith("en") ? "en" : "zh",
      t: (zh, en) => typeof document !== "undefined" && document.documentElement.lang.startsWith("en") ? en : zh,
      subscribe(listener) {
        if (typeof document === "undefined")
          return () => {
            return;
          };
        const obs = new MutationObserver(() => listener(document.documentElement.lang.startsWith("en") ? "en" : "zh"));
        obs.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["lang"]
        });
        return () => obs.disconnect();
      }
    }
  };
}
function createShellSdk(options) {
  const opts = {
    origin: options?.origin ?? (typeof window !== "undefined" ? window.location.origin : ""),
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT,
    retries: options?.retries ?? DEFAULT_RETRIES
  };
  const log = (level, ...args) => {
    console[level](...args);
  };
  if (typeof window === "undefined" || window.parent === window) {
    return standaloneSdk(log);
  }
  const themeState = createThemeState(document.documentElement.classList.contains("light") ? "light" : "dark");
  const visListeners = new Set;
  const bridge = createBridge({
    isEmbedded: true,
    send: (msg) => window.parent.postMessage(msg, opts.origin),
    onEvent: (listener) => {
      return () => {
        return;
      };
    },
    log
  }, opts);
  bridge.eventListeners.set("theme", new Set([(payload) => themeState.set(payload)]));
  bridge.call("theme", null, 5000).then((mode) => themeState.set(mode)).catch(() => {
    return;
  });
  bridge.eventListeners.set("visibility", new Set([(payload) => visListeners.forEach((fn) => fn(payload))]));
  window.addEventListener("message", (ev) => {
    if (ev.origin !== opts.origin) {
      log("warn", "[fusion-sdk] dropped message from disallowed origin:", ev.origin);
      return;
    }
    if (ev.source !== window.parent) {
      log("warn", "[fusion-sdk] dropped message from non-parent source");
      return;
    }
    bridge.handleMessage(ev.data);
  });
  let lang = document.documentElement.lang.startsWith("en") ? "en" : "zh";
  const langListeners = new Set;
  window.addEventListener("message", (ev) => {
    if (ev.origin !== opts.origin || ev.source !== window.parent)
      return;
    const msg = ev.data;
    if (msg?.type !== "request" || msg.method !== "ping")
      return;
    window.parent.postMessage({ type: "response", id: msg.id, ok: true, result: "pong" }, opts.origin);
  });
  window.addEventListener("message", (ev) => {
    if (ev.origin !== opts.origin || ev.source !== window.parent)
      return;
    const msg = ev.data;
    if (msg?.type !== "event" || msg.event !== "lang")
      return;
    lang = msg.payload === "en" ? "en" : "zh";
    langListeners.forEach((fn) => fn(lang));
  });
  const http = {
    async request(path, init) {
      const res = await bridge.call("http", {
        path,
        method: init?.method ?? "GET",
        headers: init?.headers,
        body: init?.body,
        timeoutMs: init?.timeoutMs
      }, init?.timeoutMs);
      return res;
    },
    get: (path) => http.request(path),
    post: (path, body) => http.request(path, { method: "POST", body }),
    put: (path, body) => http.request(path, { method: "PUT", body }),
    delete: (path) => http.request(path, { method: "DELETE" })
  };
  return {
    http,
    toast: {
      show(input) {
        bridge.call("toast", input, 5000).catch(() => {
          return;
        });
      }
    },
    tab: {
      setActiveTask(task) {
        bridge.call("tab", task, 5000).catch(() => {
          return;
        });
      }
    },
    theme: {
      get: () => themeState.get(),
      subscribe(listener) {
        return themeState.subscribe(listener);
      }
    },
    devices: {
      get() {
        const mobile = window.matchMedia("(max-width: 767px)").matches;
        let mode = null;
        try {
          mode = JSON.parse(new URLSearchParams(window.location.search).get("devices") ?? "null");
        } catch {
          mode = null;
        }
        return { viewport: mobile ? "mobile" : "desktop", mode };
      }
    },
    visibility: {
      get: () => document.visibilityState === "visible",
      subscribe(listener) {
        visListeners.add(listener);
        return () => visListeners.delete(listener);
      }
    },
    i18n: {
      lang: () => lang,
      t: (zh, en) => lang === "en" ? en : zh,
      subscribe(listener) {
        langListeners.add(listener);
        return () => langListeners.delete(listener);
      }
    }
  };
}
export {
  withTimeout,
  withRetry,
  isRetryableError,
  createThemeState,
  createShellSdk,
  createPoller,
  createHostBridge,
  TimeoutError,
  HttpError
};
