# Open-source document software analysis report

---

## 1. Project overview

| Project | Type | Stack | License | Size | Stars |
|---------|------|-------|---------|------|-------|
| **DocMost** | collaborative doc wiki | NestJS + React + TipTap + Yjs | AGPL-3.0 | ~50MB | high |
| **Wiki.js** | general wiki | Node.js + Vue.js + Markdown | AGPL-3.0 | ~100MB | high |
| **BookStack** | structured docs | PHP + Laravel + MySQL | MIT | ~30MB | medium |
| **Teedy (docs)** | document management | Java + Spring + Hibernate | GPL-2.0 | ~20MB | medium |
| **Zettlr** | Markdown editor | Electron + TypeScript + Vue | GPL-3.0 | ~50MB | medium |
| **MacDown** | macOS Markdown editor | Objective-C + Cocoa | MIT | ~10MB | medium |
| **LibreOffice Core** | office suite | C++ (608MB) | MPL-2.0 | 608MB | very high |

---

## 2. Per-project deep analysis

### 2.1 DocMost — collaborative doc wiki

**Repo:** https://github.com/docmost/docmost
**Version:** v0.95.0
**Stack:** NestJS + React + TypeScript + TipTap + Yjs + PostgreSQL + Redis

**Architecture:**
```
apps/
├── client/          <- React SPA (TipTap editor + Yjs collab)
│   ├── src/
│   │   ├── components/  <- shared UI components
│   │   ├── features/    <- feature modules (attachments/sharing/tags)
│   │   ├── hooks/       <- React Hooks
│   │   ├── lib/         <- utilities (api-client/config/router)
│   │   ├── pages/       <- pages (auth/dashboard/space/settings)
│   │   └── ee/          <- enterprise edition (AI Chat/MFA/Billing)
│   └── dist/           <- build output
└── server/          <- NestJS backend API
    ├── src/
    │   ├── core/         <- core modules (auth/attachment/page/space/user/search)
    │   ├── collaboration/<- Yjs collab engine (Hocuspocus)
    │   ├── integrations/ <- integrations (environment/mail/storage/queue/export/import)
    │   ├── ws/           <- WebSocket adapter
    │   └── common/       <- common (interceptors/logger/validators)
    └── dist/            <- build output
```

**Core strengths:**
- Real-time collab on Yjs CRDT + Hocuspocus, multi-user concurrent edit without conflict
- TipTap editor (ProseMirror wrapper) supports Markdown, rich text, tables, images, code blocks
- Built-in diagramming (Mermaid, Excalidraw, Draw.io)
- Permission system (CASL ability model)
- Space -> directory -> page three-level structure
- Modular NestJS architecture, clean dependency injection
- Frontend and backend managed in one monorepo (NX)

**Takeaways:**
- TipTap + Yjs collab approach reusable directly
- Frontend component library (Mantine UI) organization
- API route design (RESTful)
- Permission model (CASL)

---

### 2.2 Wiki.js — general wiki

**Repo:** https://github.com/requarks/wiki
**Version:** v2.0.0
**Stack:** Node.js + Vue.js + Markdown + Git + PostgreSQL

**Architecture:**
```
server/
├── controllers/     <- route controllers
├── core/            <- core engine
├── db/              <- database layer
├── graph/           <- GraphQL API
├── helpers/         <- utility functions
├── jobs/            <- background tasks
├── middlewares/     <- middleware
├── models/          <- data models
├── modules/         <- feature modules
├── templates/       <- email templates
├── themes/          <- theme system
└── views/           <- server-side render templates (Pug)

client/
├── components/      <- Vue components
├── helpers/         <- utility functions
├── modules/         <- feature modules
├── store/           <- Vuex state management
├── themes/          <- themes
└── scss/            <- styles
```

**Core strengths:**
- Markdown over rich text, Git as version-management backend
- Fine-grained permission system
- Multiple auth methods (LDAP, OAuth, SAML)
- Modular plugin architecture
- Theme system
- Powerful search (database-based or Typesense)
- Server-side rendering (Pug template engine)

**Takeaways:**
- Git as version-management backend concept
- Plugin architecture design
- Multi-auth integration
- Search architecture (database full-text + Typesense)

---

### 2.3 BookStack — structured docs

**Repo:** https://github.com/BookStackApp/BookStack
**Stack:** PHP + Laravel + MySQL

**Architecture:**
```
app/
├── Access/          <- auth/authorization
├── Activity/        <- activity log
├── Api/             <- REST API
├── Config/          <- config
├── Console/         <- commands
├── Entities/        <- entities (Models/Controllers/Repos)
│   ├── Models/      <- data models
│   ├── Repos/       <- data repositories
│   └── Controllers/ <- controllers
├── Exceptions/      <- exceptions
├── Exports/         <- exports
├── Http/            <- HTTP middleware
├── Permissions/     <- permissions
├── References/      <- references
├── Search/          <- search
├── Settings/        <- settings
├── Sorting/         <- sorting
├── Theming/         <- themes
├── Translation/     <- translation
├── Uploads/         <- uploads
├── Users/           <- users
└── Util/            <- utilities

routes/
├── web.php          <- web routes
└── api.php          <- API routes
```

**Core strengths:**
- Book -> chapter -> page three-level structure, naturally fits product docs/tutorials
- Clean MVC architecture, Laravel best practice
- Permission system (role + user + permission)
- Export (PDF, HTML, Markdown)
- Search (MySQL full-text)
- Multi-language
- REST API

**Takeaways:**
- Three-level doc structure (book -> chapter -> page)
- Clean MVC layering
- Export feature design
- Translation system design

---

### 2.4 Teedy (Sismics Docs) — document management

**Repo:** https://github.com/sismics/docs
**Version:** v1.12-SNAPSHOT
**Stack:** Java + Spring + Hibernate + PostgreSQL + Lucene

**Core strengths:**
- Document scan + OCR
- Full-text search (Lucene)
- Tag system
- Workflow approval
- File versioning
- 256-bit AES file encryption
- Supports PDF, ODT, DOCX, PPTX, images
- REST API

**Takeaways:**
- OCR document recognition
- Encrypted file storage
- Workflow design
- Tag system
- Version management

---

### 2.5 Zettlr — Markdown editor

**Repo:** https://github.com/Zettlr/Zettlr
**Version:** v4.6.0
**Stack:** Electron + TypeScript + Vue 3 + Pinia

**Architecture:**
```
source/
├── app/
│   ├── app-service-container.ts  <- dependency injection container
│   ├── lifecycle.ts              <- app lifecycle
│   └── service-providers/        <- service providers
├── common/                       <- common utilities
├── main.ts                       <- entry
├── pinia/                        <- state management
└── types/                        <- type definitions
```

**Core strengths:**
- Zettelkasten note-taking method
- Literature management (Zotero integration)
- Cross-platform (Electron)
- Tag management
- Full-text search
- Built-in PDF export
- Custom themes

**Takeaways:**
- Electron architecture design
- Dependency injection container pattern
- Note-taking method support (bidirectional links, tags)
- Literature management integration

---

### 2.6 MacDown — macOS Markdown editor

**Repo:** https://github.com/MacDownApp/macdown
**Stack:** Objective-C + Cocoa + WebKit

**Core strengths:**
- macOS native experience
- Live preview
- Syntax highlighting
- Theme customization
- Lightweight, fast

**Takeaways:**
- macOS native integration design
- Live preview mechanism
- Theme system

---

### 2.7 LibreOffice Core — office suite

**Repo:** https://github.com/LibreOffice/core
**Size:** 608MB
**Stack:** C++

**Core strengths:**
- Full Office format support (docx/xlsx/pptx/odt/ods/odp)
- All platforms
- Programmable (UNO API)
- LibreOffice Online version

**Takeaways:**
- Document format conversion engine
- Online editing architecture

---

## 3. Cross-comparison

### 3.1 Document structure

| Project | Structure level | Editor | Collab |
|---------|----------------|--------|--------|
| DocMost | space -> directory -> page | Markdown + rich text | ✅ real-time (Yjs) |
| Wiki.js | folder -> page | Markdown | ❌ |
| BookStack | book -> chapter -> page | Markdown + WYSIWYG | ❌ |
| Teedy | document -> tag | file upload | ❌ |
| Zettlr | folder -> file | Markdown | ❌ |

### 3.2 Storage

| Project | Database | File storage | Versioning |
|---------|----------|-------------|-----------|
| DocMost | PostgreSQL | local/S3/Azure | page history |
| Wiki.js | PostgreSQL | local/S3/Azure | Git |
| BookStack | MySQL | local/S3/Azure | page history |
| Teedy | PostgreSQL | local | file version |
| Zettlr | filesystem | local files | Git |

### 3.3 AI integration

| Project | AI chat | RAG | Local model |
|---------|---------|-----|-------------|
| DocMost | ✅ (enterprise) | ❌ | ❌ |
| Wiki.js | ❌ | ❌ | ❌ |
| BookStack | ❌ | ❌ | ❌ |
| Teedy | ❌ | ❌ | ❌ |
| Zettlr | ❌ | ❌ | ❌ |

---

## 4. Optimization suggestions for Fusion-Doc

### 4.1 Architecture level

**Borrow BookStack's MVC layering:**
```
server/
├── routes/          <- route layer (URL dispatch)
├── controllers/     <- controllers (request handling)
├── models/          <- data models
├── services/        <- business logic
├── middleware/      <- middleware (auth/CORS/log)
├── integrations/    <- external integrations (Fusion-MLX/storage)
└── utils/           <- utility functions
```

**Borrow Wiki.js's modular architecture:**
```
modules/
├── auth/            <- auth module
├── pages/           <- page module
├── spaces/          <- space module
├── search/          <- search module
├── ai/              <- AI module
├── files/           <- file module
└── export/          <- export module
```

### 4.2 Feature level

**From DocMost:**
- TipTap editor + Yjs real-time collab (core capability)
- Space -> directory -> page structure
- Permission system (CASL)

**From Wiki.js:**
- Markdown-first editing experience
- Git version-management backend
- Plugin architecture

**From BookStack:**
- Book -> chapter -> page three-level structure (fits product docs)
- Export feature (PDF/HTML/Markdown)
- Clean MVC architecture

**From Teedy:**
- OCR document recognition
- Encrypted file storage
- Tags + workflow

**From Zettlr:**
- Bidirectional links / graph
- Literature management
- Dependency injection container

### 4.3 Tech selection recommendation

| Feature | Recommended | Source |
|---------|-------------|--------|
| Editor | TipTap (ProseMirror) | DocMost |
| Real-time collab | Yjs + Hocuspocus | DocMost |
| Storage | SQLite (light) / PostgreSQL (prod) | own choice |
| Search | SQLite FTS5 / in-memory index | own choice |
| API | RESTful | general |
| Auth | JWT | general |
| Export | Pandoc / LibreOffice | LibreOffice |
| Versioning | page-history table | DocMost |
| AI integration | Fusion-MLX | own |

### 4.4 Fusion-Doc current architecture assessment

**Current state:** self-contained monolithic server (Node.js + SQLite/JSON storage)

**Pros:**
- Zero external deps, one-click start
- Frontend static files served directly
- SQLite/JSON dual-storage guarantee
- Native Fusion-MLX integration

**To optimize:**
- Route layer needs modular split (ref BookStack MVC)
- Data model needs completion (ref DocMost entity design)
- API needs to cover all DocMost frontend calls
- Need Yjs for real-time collab
- File upload/storage needs implementation
- Search needs completion (SQLite FTS5)

---

## 5. Summary

| Dimension | Best fit | Reason |
|-----------|----------|--------|
| Editor | **DocMost** | TipTap + Yjs real-time collab, most mature |
| Architecture | **BookStack + Wiki.js** | clean MVC + modular |
| Storage | **DocMost** | PostgreSQL mature and stable |
| Collab | **DocMost** | Yjs CRDT industry standard |
| Search | **Wiki.js + Teedy** | full-text search + Lucene |
| Export | **BookStack + LibreOffice** | PDF/HTML/Markdown + Office formats |
| Permission | **DocMost + BookStack** | CASL + role permission |
| AI | **Fusion-Doc self-built** | native Fusion-MLX integration |

**Conclusion:** Fusion-Doc takes **DocMost** as the frontend core, **BookStack** architecture as backend reference, **Wiki.js** modular design as organization, **Fusion-MLX** as the AI engine, **LibreOffice** for Office format support — the optimal combination.
