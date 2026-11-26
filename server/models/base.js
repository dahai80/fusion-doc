// =============================================================================
// Fusion-Doc — model layer base class
// Wraps a SQLite query builder, with JSON file fallback
// Modeled on DocMost Prisma + BookStack Eloquent
//
// ⚠️ P3-27 maintainability: orphan layer, currently unreferenced (see notes in ./index.js).
//    WHERE field names/ORDER BY are interpolated directly; identifiers must be whitelist-validated when wiring this in.
// =============================================================================

const { uid, now } = require('../utils/helpers');

// S8 fix: interpolating identifiers (table names/field names/ORDER BY columns) directly into SQL is an injection risk.
// Although this layer is currently an unreferenced orphan, passing user-controlled field names once it is wired in would revive the injection.
// Whitelist guard here: identifiers may only contain [A-Za-z0-9_] and must be non-empty, ruling out quote/semicolon/space injection.
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertIdentifier(name, label) {
    if (typeof name !== 'string' || !IDENT_RE.test(name)) {
        throw new Error(`[Model] Invalid identifier (${label}): ${String(name)}`);
    }
    return name;
}

class Model {
  constructor(db, tableName, jsonDir = null) {
    this.db = db;
    this.tableName = assertIdentifier(tableName, 'tableName');
    this.jsonDir = jsonDir || tableName;
  }

  // ── Find all ──────────────────────────────────────────────────────────
  all(options = {}) {
    const { orderBy = null, orderDir = 'ASC', limit = null, offset = null } = options;
    if (this.db) {
      let sql = `SELECT * FROM ${this.tableName}`;
      if (orderBy) sql += ` ORDER BY ${assertIdentifier(orderBy, 'orderBy')} ${orderDir === 'DESC' ? 'DESC' : 'ASC'}`;
      if (limit != null) sql += ` LIMIT ${parseInt(limit, 10) || 0}`;
      if (offset != null) sql += ` OFFSET ${parseInt(offset, 10) || 0}`;
      return this.db.prepare(sql).all();
    }
    return this._listJSON();
  }

  // ── Find by ID ────────────────────────────────────────────────────────
  find(id) {
    if (this.db) {
      return this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id);
    }
    return this._readJSON(id);
  }

  // ── Find by condition (single) ────────────────────────────────────────
  findBy(field, value) {
    if (this.db) {
      assertIdentifier(field, 'findBy.field');
      return this.db.prepare(`SELECT * FROM ${this.tableName} WHERE ${field} = ?`).get(value);
    }
    return this._listJSON().find(item => item[field] === value) || null;
  }

  // ── Find by condition (multiple) ──────────────────────────────────────
  where(field, value) {
    if (this.db) {
      assertIdentifier(field, 'where.field');
      return this.db.prepare(`SELECT * FROM ${this.tableName} WHERE ${field} = ?`).all(value);
    }
    return this._listJSON().filter(item => item[field] === value);
  }

  // ── Custom query ──────────────────────────────────────────────────────
  query(sql, params = []) {
    if (this.db) {
      return this.db.prepare(sql).all(...params);
    }
    return [];
  }

  // ── Create ────────────────────────────────────────────────────────────
  create(data) {
    const id = data.id || uid();
    const record = { id, ...data, created_at: data.created_at || now(), updated_at: data.updated_at || now() };

    if (this.db) {
      const keys = Object.keys(record);
      // S8: validate that all column names are legal, preventing column-name injection via data keys
      keys.forEach(k => assertIdentifier(k, 'create.key'));
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(k => record[k]);
      this.db.prepare(`INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`).run(...values);
    } else {
      this._writeJSON(id, record);
    }
    return record;
  }

  // ── Update ────────────────────────────────────────────────────────────
  update(id, data) {
    const record = { ...data, updated_at: now() };

    if (this.db) {
      const keys = Object.keys(record);
      keys.forEach(k => assertIdentifier(k, 'update.key'));
      const setClause = keys.map(k => `${k} = ?`).join(', ');
      const values = keys.map(k => record[k]);
      this.db.prepare(`UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`).run(...values, id);
    } else {
      const existing = this._readJSON(id);
      if (existing) {
        Object.assign(existing, record);
        this._writeJSON(id, existing);
      }
    }
    return { ...this.find(id), updated: true };
  }

  // ── Delete ────────────────────────────────────────────────────────────
  delete(id) {
    if (this.db) {
      this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
    } else {
      this._deleteJSON(id);
    }
    return { deleted: true, id };
  }

  // ── Count ─────────────────────────────────────────────────────────────
  count(where = null) {
    if (this.db) {
      if (where) {
        assertIdentifier(where.field, 'count.where.field');
        return this.db.prepare(`SELECT COUNT(*) as c FROM ${this.tableName} WHERE ${where.field} = ?`).get(where.value).c;
      }
      return this.db.prepare(`SELECT COUNT(*) as c FROM ${this.tableName}`).get().c;
    }
    return this._listJSON().length;
  }

  // ── JSON fallback storage ─────────────────────────────────────────────
  _readJSON(id) {
    const { readJSON } = require('../db');
    return readJSON(this.jsonDir, id);
  }

  _writeJSON(id, data) {
    const { writeJSON } = require('../db');
    writeJSON(this.jsonDir, id, data);
  }

  _listJSON() {
    const { listJSON } = require('../db');
    return listJSON(this.jsonDir);
  }

  _deleteJSON(id) {
    const { deleteJSON } = require('../db');
    deleteJSON(this.jsonDir, id);
  }
}

module.exports = Model;