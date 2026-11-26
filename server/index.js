// =============================================================================
// Fusion-Doc — core entry point (version in package.json)
// =============================================================================
// Architecture: modular MVC (Model-View-Controller)
// Vision: combine the strengths of 7 open-source projects + the Fusion ecosystem into a native, offline, intelligent document knowledge base for Apple Silicon
// =============================================================================
//
// Architecture overview:
//   server/
//   ├── index.js              ← lightweight entry point
//   ├── app.js                ← app core (lifecycle, middleware, plugins)
//   ├── config.js             ← configuration
//   ├── db.js                 ← database layer (SQLite + JSON fallback)
//   ├── middleware/           ← middleware stack (CORS/logging/auth/error handling)
//   ├── controllers/          ← controller layer (route dispatch)
//   ├── services/             ← service layer (business logic)
//   ├── models/              ← model layer (data wrappers)
//   ├── integrations/        ← integration layer (Fusion-MLX / Fusion-Coder / LibreOffice)
//   ├── plugins/             ← plugin system
//   └── utils/               ← utilities
//
// Ecosystem integrations:
//   - Fusion-MLX  → local LLM inference (chat/embeddings/rerank/RAG)
//   - Fusion-Coder → AI coding assistance
//   - Fusion-KB   → knowledge base management
//   - LibreOffice  → Office document format conversion
// =============================================================================

// ── Process title (issue #64): show fusion-doc instead of node in ps ──
// start.sh manages by pidfile (no pkill name matching), so renaming does not affect stop/status/restart.
process.title = 'fusion-doc';

const FusionDocApp = require('./app');

// ── Start the app ──────────────────────────────────────────────────────────────
const app = new FusionDocApp();

app.start().catch((err) => {
  console.error(`[Fusion-Doc] Startup failed: ${err.message}`);
  process.exit(1);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────────
// E14 fix: SIGINT/SIGTERM share the _shuttingDown reentrancy guard so repeated Ctrl+C doesn't run concurrent shutdowns.
// A9 fix: wrap shutdown in a 10s hard timeout so a stuck shutdown (hung DB close/WS drain) can't leave a zombie.
let _shuttingDown = false;
async function _gracefulShutdown(sig) {
  if (_shuttingDown) { console.warn(`[Fusion-Doc] Already shutting down, ignoring repeated ${sig}`); return; }
  _shuttingDown = true;
  console.log(`[Fusion-Doc] Received ${sig}, starting graceful shutdown...`);
  const forceTimer = setTimeout(() => {
    console.error('[Fusion-Doc] shutdown exceeded 10s, forcing exit');
    process.exit(1);
  }, 10000);
  try {
    await app.shutdown();
  } catch (e) {
    console.error(`[Fusion-Doc] shutdown error: ${e.message}`);
  } finally {
    clearTimeout(forceTimer);
    process.exit(0);
  }
}
process.on('SIGINT', () => _gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => _gracefulShutdown('SIGTERM'));
// R4 fix: process state is unpredictable after uncaughtException/unhandledRejection, so exit and let the supervisor restart.
// The old design only logged and kept serving in a damaged state, returning dirty data / half-written DB / lost WS drafts.
async function _fatalExit(reason, err) {
  console.error(`[Fusion-Doc] ${reason}: ${err && err.message || err}`);
  console.error((err && err.stack) || '');
  if (_shuttingDown) return;
  _shuttingDown = true;
  try { await app.shutdown(); } catch (_) { /* noop */ }
  process.exit(1);
}
process.on('uncaughtException', (err) => _fatalExit('Uncaught exception', err));
process.on('unhandledRejection', (err) => _fatalExit('Unhandled promise rejection', err));