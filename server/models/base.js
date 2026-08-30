// =============================================================================
// Fusion-Doc — 模型层基类
// 封装 SQLite 查询构建器，支持 JSON 文件降级
// 参考 DocMost Prisma + BookStack Eloquent 设计
//
// ⚠️ P3-27 维护性: 孤儿层, 当前未被引用 (见 ./index.js 说明)。
//    其中 WHERE 字段名/ORDER BY 直接插值, 接入时须对 identifier 做白名单校验。
// =============================================================================

const { uid, now } = require('../utils/helpers');

// S8 修复: identifier (表名/字段名/ORDER BY 列) 直接插值入 SQL 有注入风险。
// 虽本层当前为孤儿层未被引用, 但接入时若传用户可控字段名即可复活注入。
// 这里加白名单守卫: identifier 仅允许 [A-Za-z0-9_] 且非空, 杜绝引号/分号/空格注入。
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertIdentifier(name, label) {
    if (typeof name !== 'string' || !IDENT_RE.test(name)) {
        throw new Error(`[Model] 非法 identifier (${label}): ${String(name)}`);
    }
    return name;
}

class Model {
  constructor(db, tableName, jsonDir = null) {
    this.db = db;
    this.tableName = assertIdentifier(tableName, 'tableName');
    this.jsonDir = jsonDir || tableName;
  }

  // ── 查询全部 ──────────────────────────────────────────────────────────
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

  // ── 按 ID 查询 ────────────────────────────────────────────────────────
  find(id) {
    if (this.db) {
      return this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id);
    }
    return this._readJSON(id);
  }

  // ── 按条件查询（单条） ─────────────────────────────────────────────────
  findBy(field, value) {
    if (this.db) {
      assertIdentifier(field, 'findBy.field');
      return this.db.prepare(`SELECT * FROM ${this.tableName} WHERE ${field} = ?`).get(value);
    }
    return this._listJSON().find(item => item[field] === value) || null;
  }

  // ── 按条件查询（多条） ─────────────────────────────────────────────────
  where(field, value) {
    if (this.db) {
      assertIdentifier(field, 'where.field');
      return this.db.prepare(`SELECT * FROM ${this.tableName} WHERE ${field} = ?`).all(value);
    }
    return this._listJSON().filter(item => item[field] === value);
  }

  // ── 自定义查询 ─────────────────────────────────────────────────────────
  query(sql, params = []) {
    if (this.db) {
      return this.db.prepare(sql).all(...params);
    }
    return [];
  }

  // ── 创建 ───────────────────────────────────────────────────────────────
  create(data) {
    const id = data.id || uid();
    const record = { id, ...data, created_at: data.created_at || now(), updated_at: data.updated_at || now() };

    if (this.db) {
      const keys = Object.keys(record);
      // S8: 校验全部列名合法, 防 data 键注入列名
      keys.forEach(k => assertIdentifier(k, 'create.key'));
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(k => record[k]);
      this.db.prepare(`INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`).run(...values);
    } else {
      this._writeJSON(id, record);
    }
    return record;
  }

  // ── 更新 ───────────────────────────────────────────────────────────────
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

  // ── 删除 ───────────────────────────────────────────────────────────────
  delete(id) {
    if (this.db) {
      this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
    } else {
      this._deleteJSON(id);
    }
    return { deleted: true, id };
  }

  // ── 计数 ───────────────────────────────────────────────────────────────
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

  // ── JSON 降级存储 ──────────────────────────────────────────────────────
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