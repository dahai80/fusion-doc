#!/usr/bin/env bash
set -euo pipefail
BASE="http://localhost:11435"
PASS=0; FAIL=0; TOTAL=0
pass() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL+1)); echo "  [FAIL] $1: $2"; }
eq() { TOTAL=$((TOTAL+1)); local d="$1" e="$2" a="$3"
  if [ "$e" = "$a" ]; then pass "$d"; else fail "$d" "expect $e got $a"; fi; }
has() { TOTAL=$((TOTAL+1)); local d="$1" e="$2" a="$3"
  if echo "$a" | grep -q "$e"; then pass "$d"; else fail "$d" "missing '$e'"; fi; }
echo ""; echo "=== Fusion-Doc Test Suite ==="; echo ""

# 1. Health
echo "-- 1. Health --"
r=$(curl -sf "$BASE/api/health" --max-time 3 2>/dev/null || echo "")
eq "health 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/health" --max-time 3)"
has "app name" "Fusion-Doc" "$r"
has "status ok" '"status":"ok"' "$r"

# 2. Frontend
echo "-- 2. Frontend --"
eq "root 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/" --max-time 3)"
eq "home 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/home" --max-time 3)"
eq "login 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/login" --max-time 3)"
eq "js 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/assets/index-BgC9hh6t.js" --max-time 3)"
eq "css 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/assets/vendor-mantine-Cxq-_z9h.js" --max-time 3)"
has "title" "Fusion-Doc" "$(curl -sf "$BASE/" --max-time 3 | grep -o '<title>.*</title>')"
eq "manifest 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/manifest.json" --max-time 3)"

# 3. Setup
echo "-- 3. Setup --"
eq "setup 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/system/setup" --max-time 3)"

# 4. Auth
echo "-- 4. Auth --"
eq "register 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/setup" -H 'Content-Type: application/json' -d '{"email":"t@t.com","name":"T","password":"p"}' --max-time 3)"
eq "login 200" "200" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"t@t.com","password":"p"}' --max-time 3)"
eq "login fail 401" "401" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"x@x.com","password":"x"}' --max-time 3)"

# 5. Users
echo "-- 5. Users --"
eq "users 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/users" --max-time 3)"
eq "me 200" "200" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/users/me" --max-time 3)"

# 6. Content CRUD
echo "-- 6. Content --"
eq "workspaces 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/workspaces" --max-time 3)"
eq "create book 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/books" -H 'Content-Type: application/json' -d '{"name":"B","workspace_id":"w"}' --max-time 3)"
r=$(curl -sf -X POST "$BASE/api/books" -H 'Content-Type: application/json' -d '{"name":"B2","workspace_id":"w"}' --max-time 3 2>/dev/null || echo "")
BID=$(echo "$r" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
eq "create chapter 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/chapters" -H 'Content-Type: application/json' -d "{\"name\":\"C\",\"book_id\":\"$BID\"}" --max-time 3)"
r=$(curl -sf -X POST "$BASE/api/pages" -H 'Content-Type: application/json' -d "{\"title\":\"P\",\"content\":\"Hello\",\"book_id\":\"$BID\"}" --max-time 3 2>/dev/null || echo "")
PID=$(echo "$r" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
eq "get page 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/pages/$PID" --max-time 3)"
eq "update page 200" "200" "$(curl -so /dev/null -w '%{http_code}' -X PUT "$BASE/api/pages/$PID" -H 'Content-Type: application/json' -d '{"title":"U","content":"U"}' --max-time 3)"
eq "pages list 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/pages" --max-time 3)"
eq "delete page 200" "200" "$(curl -so /dev/null -w '%{http_code}' -X DELETE "$BASE/api/pages/$PID" --max-time 3)"

# 7. Versions
echo "-- 7. Versions --"
r=$(curl -sf -X POST "$BASE/api/pages" -H 'Content-Type: application/json' -d '{"title":"V"}' --max-time 3 2>/dev/null || echo "")
VID=$(echo "$r" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
eq "create version 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/pages/$VID/versions" -H 'Content-Type: application/json' -d '{"title":"v1","content":"c1"}' --max-time 3)"
eq "versions list 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/pages/$VID/versions" --max-time 3)"

# 8. Tags
echo "-- 8. Tags --"
eq "create tag 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/tags" -H 'Content-Type: application/json' -d '{"name":"urgent","color":"#f00"}' --max-time 3)"
eq "tags list 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/tags" --max-time 3)"

# 9. Search
echo "-- 9. Search --"
eq "search 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/search?q=test" --max-time 3)"
eq "advanced search 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/search/advanced?q=test" --max-time 3)"

# 10. Graph
echo "-- 10. Graph --"
eq "graph 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/graph" --max-time 3)"
eq "links 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/pages/$VID/links" --max-time 3)"
eq "create link 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/pages/$VID/links" -H 'Content-Type: application/json' -d "{\"target_page_id\":\"$VID\"}" --max-time 3)"

# 11. Favorites
echo "-- 11. Favorites --"
eq "fav list 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/favorites" --max-time 3)"
eq "add fav 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/favorites" -H 'Content-Type: application/json' -d "{\"page_id\":\"$VID\"}" --max-time 3)"

# 12. Comments
echo "-- 12. Comments --"
eq "create comment 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/comments" -H 'Content-Type: application/json' -d "{\"page_id\":\"$VID\",\"content\":\"nice\"}" --max-time 3)"
eq "comments list 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/comments?pageId=$VID" --max-time 3)"

# 13. Activity
echo "-- 13. Activity --"
eq "activity 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/activity" --max-time 3)"
eq "log activity 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/activity" -H 'Content-Type: application/json' -d '{"action":"test"}' --max-time 3)"

# 14. Files
echo "-- 14. Files --"
b64=$(echo "test" | base64)
eq "upload 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/files/upload" -H 'Content-Type: application/json' -d "{\"name\":\"t.txt\",\"mime\":\"text/plain\",\"content\":\"$b64\"}" --max-time 5)"
r=$(curl -sf -X POST "$BASE/api/files/upload" -H 'Content-Type: application/json' -d "{\"name\":\"t2.txt\",\"mime\":\"text/plain\",\"content\":\"$b64\",\"page_id\":\"$VID\"}" --max-time 5 2>/dev/null || echo "")
FID=$(echo "$r" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
eq "files list 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/files" --max-time 3)"
eq "download 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/files/$FID" --max-time 3)"
eq "delete file 200" "200" "$(curl -so /dev/null -w '%{http_code}' -X DELETE "$BASE/api/files/$FID" --max-time 3)"

# 15. AI
echo "-- 15. AI --"
eq "AI chat 200" "200" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/chat" -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}' --max-time 30)"
eq "AI GET 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/ai/chat" --max-time 3)"

# 16. Theme
echo "-- 16. Theme --"
eq "get theme 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/theme" --max-time 3)"
eq "set theme 200" "200" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/theme" -H 'Content-Type: application/json' -d '{"mode":"light"}' --max-time 3)"

# 17. Webhooks
echo "-- 17. Webhooks --"
eq "webhooks 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/webhooks" --max-time 3)"
eq "create webhook 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/webhooks" -H 'Content-Type: application/json' -d '{"name":"h","url":"http://localhost:9999/h"}' --max-time 3)"
eq "trigger webhook 200" "200" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/webhooks/trigger" -H 'Content-Type: application/json' -d '{"event":"test"}' --max-time 3)"

# 18. Metadata
echo "-- 18. Metadata --"
eq "metadata 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/metadata" --max-time 3)"
eq "create metadata 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/metadata" -H 'Content-Type: application/json' -d "{\"page_id\":\"$VID\",\"key\":\"k\",\"value\":\"v\"}" --max-time 3)"
eq "vocabulary 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/vocabulary" --max-time 3)"
eq "create vocab 201" "201" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/vocabulary" -H 'Content-Type: application/json' -d '{"name":"s","type":"select","values":["a","b"]}' --max-time 3)"

# 19. Export
echo "-- 19. Export --"
eq "export 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/export/markdown/$VID" --max-time 3)"

# 20. Branding
echo "-- 20. Branding --"
r=$(curl -sf "$BASE/api/branding" --max-time 3 2>/dev/null || echo "")
eq "branding 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/branding" --max-time 3)"
has "brand name" "Fusion-Doc" "$r"

# 21. RAG
echo "-- 21. RAG --"
r2=$(curl -sf -X POST "$BASE/api/pages" -H 'Content-Type: application/json' -d '{"title":"R"}' --max-time 3 2>/dev/null || echo "")
RID=$(echo "$r2" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
set +e
RC=$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/rag/index" -H 'Content-Type: application/json' -d "{\"page_id\":\"$RID\"}" --max-time 30 2>/dev/null || echo "000")
echo "  RAG index: $RC"
set -e
eq "RAG query 200" "200" "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/api/rag/query" -H 'Content-Type: application/json' -d '{"question":"hi"}' --max-time 30)"

# 22. Error handling
echo "-- 22. Errors --"
# SPA returns 200 for all non-API routes (SPA fallback behavior)
eq "unknown route 200" "200" "$(curl -so /dev/null -w '%{http_code}' "$BASE/nonexistent" --max-time 3)"
# API 404
eq "api 404" "404" "$(curl -so /dev/null -w '%{http_code}' "$BASE/api/nonexistent" --max-time 3)"
eq "CORS 204" "204" "$(curl -so /dev/null -w '%{http_code}' -X OPTIONS "$BASE/api/health" --max-time 3)"

# Summary
COV=$((PASS * 100 / TOTAL))
echo ""
echo "=== Results ==="
echo "Total: $TOTAL | Pass: $PASS | Fail: $FAIL | Coverage: ${COV}%"
echo "==============="
if [ "$FAIL" -gt 0 ]; then exit 1; fi