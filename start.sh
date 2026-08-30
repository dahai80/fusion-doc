#!/usr/bin/env bash
# fusion-doc lifecycle manager (start|stop|restart|status)
# Node 服务端口 11449（health endpoint: /api/health，auth 白名单）。
# Callers: fusion-studio UpstreamServiceManager (auto-start on launch + manual start)。
# Affected API: start.sh start|stop|restart|status; status exits 0 if running, 1 if not。
# Data schemas: PID file .fusion-doc.pid; logs/stdout.log + logs/stderr.log。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE="${SCRIPT_DIR}/.fusion-doc.pid"
LOG_DIR="${SCRIPT_DIR}/logs"
STDOUT_LOG="${LOG_DIR}/stdout.log"
STDERR_LOG="${LOG_DIR}/stderr.log"
PORT="${FUSION_DOC_PORT:-11449}"
HOST="${FUSION_DOC_HOST:-127.0.0.1}"
# E4 修复: 日志轮转阈值。单文件超此大小即滚动备份 (保留 .1 副本), 防日志无界增长填盘。
LOG_MAX_BYTES="${FUSION_DOC_LOG_MAX_BYTES:-10485760}"   # 默认 10MB
LOG_KEEP="${FUSION_DOC_LOG_KEEP:-3}"                    # 保留副本数
# E6 修复: 运行时数据保留期 (天)。start 时清理过期 exports/versions。
DATA_RETAIN_DAYS="${FUSION_DOC_DATA_RETAIN_DAYS:-30}"
# E5 修复: 自动重启。进程崩溃后由 supervisor 循环拉起 (R4 已使 uncaughtException 退出)。
# 默认开。设 0 关闭 (退回 nohup 一次性)。生产商用建议保持开启或改用 launchd/pm2。
AUTORESTART="${FUSION_DOC_AUTORESTART:-1}"
RESTART_BACKOFF_MAX="${FUSION_DOC_RESTART_BACKOFF_MAX:-30}"   # 退避上限秒

mkdir -p "$LOG_DIR" data/{db,storage,exports,versions,logs}

log_info()  { printf "\033[0;32m[INFO]\033[0m  %s\n" "$*"; }
log_warn()  { printf "\033[0;33m[WARN]\033[0m %s\n" "$*"; }
log_error() { printf "\033[0;31m[ERROR]\033[0m %s\n" "$*"; }

# E4 修复: 按大小轮转日志。超过 LOG_MAX_BYTES 即 mv 为 .1 (链式保留 LOG_KEEP 个), 再建空文件。
rotate_log() {
    local f="$1"
    [ -f "$f" ] || return 0
    local size
    size=$(wc -c < "$f" 2>/dev/null || echo 0)
    if [ "$size" -gt "$LOG_MAX_BYTES" ]; then
        # 链式滚动: .2->.3, .1->.2, current->.1, 删除超 KEEP 的
        local i="$LOG_KEEP"
        while [ "$i" -gt 1 ]; do
            local prev=$((i - 1))
            [ -f "${f}.${prev}" ] && mv -f "${f}.${prev}" "${f}.${i}" 2>/dev/null || true
            i=$((i - 1))
        done
        mv -f "$f" "${f}.1" 2>/dev/null || true
        touch "$f"
        log_info "log rotated: $(basename "$f") (${size} bytes -> ${f}.1)"
    fi
    return 0
}

# E6 修复: 清理过期运行时数据 (exports/versions 超过保留期)。
cleanup_stale_data() {
    if [ "$DATA_RETAIN_DAYS" -le 0 ]; then return 0; fi
    local cutoff
    cutoff=$(date -v-${DATA_RETAIN_DAYS}d +%s 2>/dev/null || date -d "-${DATA_RETAIN_DAYS} days" +%s 2>/dev/null || echo 0)
    [ "$cutoff" -gt 0 ] || return 0
    local cleaned=0
    for dir in data/exports data/versions; do
        [ -d "$dir" ] || continue
        while IFS= read -r -d '' f; do
            local mtime
            mtime=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)
            if [ "$mtime" -gt 0 ] && [ "$mtime" -lt "$cutoff" ]; then
                rm -f "$f" && cleaned=$((cleaned + 1))
            fi
        done < <(find "$dir" -type f -print0 2>/dev/null)
    done
    [ "$cleaned" -gt 0 ] && log_info "cleanup: removed $cleaned stale export/version files (older than ${DATA_RETAIN_DAYS}d)"
    return 0
}

# E7 修复: 端口预检。避免 node 启动遇 EADDRINUSE 但脚本误报成功。
port_in_use() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && return 0 || return 1
    fi
    # 回退: nc 探测
    if command -v nc >/dev/null 2>&1; then
        nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 && return 0 || return 1
    fi
    return 1
}

is_running() {
    [ -f "$PID_FILE" ] || return 1
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [ -n "$pid" ] || return 1
    # E7 修复: kill -0 通过仅证进程存在, 不证它就是 fusion-doc。
    # 交叉验证: PID 的命令行含 server/index.js (直启) 或为 supervisor 子 shell (E5 守护),
    # 否则视为 stale PID (OS 回收复用)。
    if kill -0 "$pid" 2>/dev/null; then
        local cmd
        cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
        case "$cmd" in
            *server/index.js*) return 0 ;;
            *start.sh*|*fusion-doc*|*\(*)
                # supervisor 子 shell: 进一步看是否有 child 记录
                [ -f "${PID_FILE}.child" ] && return 0
                # 无 child 记录也可能是启动初期, 视为运行
                return 0
                ;;
            *)
                log_warn "stale PID $pid (now: ${cmd:-gone}), clearing"
                rm -f "$PID_FILE"
                return 1
                ;;
        esac
    fi
    rm -f "$PID_FILE"
    return 1
}

do_start() {
    if is_running; then
        log_info "fusion-doc already running (pid $(cat "$PID_FILE"))"
        return 0
    fi
    # E7 修复: 端口预检。被占且非自身进程则拒绝启动。
    if port_in_use && ! is_running; then
        log_error "port ${PORT} already in use by another process; aborting (set FUSION_DOC_PORT to change)"
        return 1
    fi
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js 未安装"
        return 1
    fi
    if ! node -e "require('better-sqlite3')" 2>/dev/null; then
        log_error "better-sqlite3 未安装，运行: npm install"
        return 1
    fi
    # E4 修复: 启动前轮转超额日志, 防追加写越过阈值后服务运行期间写失败。
    rotate_log "$STDOUT_LOG"
    rotate_log "$STDERR_LOG"
    # E6 修复: 启动前清理过期导出/版本, 控制磁盘占用。
    cleanup_stale_data
    set -a; [ -f .env ] && source .env; set +a
    export NODE_ENV="${NODE_ENV:-development}"
    # E10 修复: 版本从 package.json 读取, 不硬编码 (CLAUDE.md 明令 never hardcode version)
    local app_version
    app_version=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
    log_info "Fusion-Doc V${app_version}"
    log_info "starting fusion-doc on ${HOST}:${PORT} ..."
    # E5 修复: 受监管启动。AUTORESTART=1 时以子 shell 守护进程循环拉起 (R4 使崩溃必退出)。
    # 崩溃后指数退避重连, 防 GPU/端口未释放时紧邻重启风暴。PID 文件记 supervisor PID。
    if [ "$AUTORESTART" = "1" ]; then
        (
            # E5 修复: 子 shell 继承外层 set -e, wait 返回子进程非零退出码会立即杀死
            # 守护循环 (在 exit_code=$? 之前), 致崩溃后永不重启。此处关闭 -e, 让 wait
            # 自然返回并由 exit_code 捕获真实退出码, 循环继续。
            # 同时重定向子 shell 自身 stdout/stderr 到日志, 避免持有调用方管道 (如
            # `start.sh start | tail`) 致调用方永挂 — 守护进程生命周期长于调用方。
            exec >> "$STDOUT_LOG" 2>> "$STDERR_LOG"
            set +e
            backoff=1
            while true; do
                FUSION_DOC_PORT="$PORT" FUSION_DOC_HOST="$HOST" \
                    node server/index.js >> "$STDOUT_LOG" 2>> "$STDERR_LOG" &
                child=$!
                echo "$child" > "${PID_FILE}.child"
                wait "$child" 2>/dev/null
                exit_code=$?
                rm -f "${PID_FILE}.child"
                # 正常停 (stop.sh 已删 PID 文件并 SIGTERM) — 退出守护
                if [ ! -f "$PID_FILE" ]; then
                    log_info "supervisor: stop requested, exiting"
                    break
                fi
                log_warn "supervisor: node exited (code ${exit_code}), restart in ${backoff}s"
                sleep "$backoff"
                # 指数退避, 封顶 RESTART_BACKOFF_MAX
                backoff=$((backoff * 2))
                [ "$backoff" -gt "$RESTART_BACKOFF_MAX" ] && backoff="$RESTART_BACKOFF_MAX"
                # 重启前轮转超额日志 (E4)
                rotate_log "$STDOUT_LOG"
                rotate_log "$STDERR_LOG"
            done
        ) &
        local sup_pid=$!
        echo "$sup_pid" > "$PID_FILE"
        disown "$sup_pid" 2>/dev/null || true
        sleep 2
        if kill -0 "$sup_pid" 2>/dev/null; then
            log_info "fusion-doc started (supervisor pid $sup_pid, port $PORT, autorestart on)"
        else
            log_error "fusion-doc failed to start, see $STDERR_LOG"
            rm -f "$PID_FILE"
            return 1
        fi
    else
        FUSION_DOC_PORT="$PORT" FUSION_DOC_HOST="$HOST" \
            nohup node server/index.js >> "$STDOUT_LOG" 2>> "$STDERR_LOG" &
        local pid=$!
        echo "$pid" > "$PID_FILE"
        sleep 2
        if is_running; then
            log_info "fusion-doc started (pid $pid, port $PORT, autorestart off)"
        else
            log_error "fusion-doc failed to start, see $STDERR_LOG"
            rm -f "$PID_FILE"
            return 1
        fi
    fi
}

do_stop() {
    if ! is_running; then
        log_info "fusion-doc not running"
        rm -f "$PID_FILE" "${PID_FILE}.child"
        return 0
    fi
    local pid
    pid="$(cat "$PID_FILE")"
    log_info "stopping fusion-doc (pid $pid)"
    # E5 修复: 先删 PID 文件, 通知 supervisor 不再重启 (守护循环检测 PID 文件消失即退出)
    rm -f "$PID_FILE"
    # 先优雅 SIGTERM child (若存在), 再 term supervisor
    local child
    child=$(cat "${PID_FILE}.child" 2>/dev/null || true)
    if [ -n "$child" ]; then
        kill "$child" 2>/dev/null || true
    fi
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
        kill -0 "$pid" 2>/dev/null || break
        # supervisor 可能还在等 child 退出, 也确认 child 没了
        { [ -z "$child" ] || ! kill -0 "$child" 2>/dev/null; } && ! kill -0 "$pid" 2>/dev/null && break
        sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
        log_error "force kill (pid $pid)"
        kill -9 "$pid" 2>/dev/null || true
    fi
    [ -n "$child" ] && kill -0 "$child" 2>/dev/null && kill -9 "$child" 2>/dev/null || true
    rm -f "${PID_FILE}.child"
    log_info "fusion-doc stopped"
}

do_status() {
    if is_running; then
        echo "running (pid $(cat "$PID_FILE"), port $PORT)"
        return 0
    fi
    echo "stopped"
    return 1
}

ACTION="${1:-start}"
case "$ACTION" in
    start)  do_start ;;
    stop)   do_stop ;;
    status) do_status ;;
    restart) do_stop || true; do_start ;;
    *) echo "usage: $0 {start|stop|status|restart}" >&2; exit 1 ;;
esac
