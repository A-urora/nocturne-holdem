/*! Nocturne Hold'em — room snapshot persistence (MIT) */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

let PoolClass = null;
try {
  ({ Pool: PoolClass } = require("pg"));
} catch (error) {
  /* pg is optional; local/file persistence is still available. */
}

/**
 * Stores full room snapshots in a JSON file and, when DATABASE_URL is set, in
 * Postgres. The file is a local-dev fallback; Render's free filesystem is
 * ephemeral, so production rooms must live in Postgres to survive a cold start.
 */
class RoomStore {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, "data");
    this.file = path.join(this.dataDir, "rooms.json");
    this.databaseUrl = String(options.databaseUrl || "").trim();
    this.snapshots = new Map();
    this.storageError = "";
    this.pool = null;
    this.remoteReady = false;
    this.queue = Promise.resolve();
    this._loadFile();
    if (this.databaseUrl) this.ready = this._initDatabase();
    else this.ready = Promise.resolve();
  }

  _loadFile() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, "utf8");
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : parsed && parsed.rooms;
      if (!Array.isArray(rows)) return;
      for (const snapshot of rows) {
        const code = snapshot && snapshot.room && snapshot.room.code;
        if (code) this.snapshots.set(String(code), snapshot);
      }
    } catch (error) {
      this.storageError = "读取房间存档失败：" + (error.message || "未知错误");
    }
  }

  _writeFile() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = this.file + ".tmp";
      fs.writeFileSync(
        tmp,
        JSON.stringify({ version: 1, rooms: [...this.snapshots.values()] }),
        "utf8"
      );
      fs.renameSync(tmp, this.file);
      if (!this.pool) this.storageError = "";
      return true;
    } catch (error) {
      this.storageError = "保存房间存档失败：" + (error.message || "未知错误");
      return false;
    }
  }

  async _initDatabase() {
    if (!PoolClass) {
      this.storageError = "未安装 pg，房间只会写入本地 JSON 文件。";
      return;
    }
    try {
      const useSsl =
        /sslmode=require/i.test(this.databaseUrl) ||
        /\.render\.com/i.test(this.databaseUrl) ||
        process.env.PGSSL === "true";
      this.pool = new PoolClass({
        connectionString: this.databaseUrl,
        ssl: useSsl ? { rejectUnauthorized: false } : false,
        max: 2,
        connectionTimeoutMillis: 8000,
      });
      await this.pool.query(
        "CREATE TABLE IF NOT EXISTS nocturne_rooms (" +
          "code text PRIMARY KEY, " +
          "payload jsonb NOT NULL, " +
          "updated_at timestamptz NOT NULL DEFAULT now())"
      );
      const result = await this.pool.query(
        "SELECT payload FROM nocturne_rooms ORDER BY updated_at DESC LIMIT 2000"
      );
      const remote = new Map();
      for (const row of result.rows) {
        const snapshot = row && row.payload;
        const code = snapshot && snapshot.room && snapshot.room.code;
        if (code) remote.set(String(code), snapshot);
      }
      if (remote.size) {
        this.snapshots = remote;
        this._writeFile();
      } else if (this.snapshots.size) {
        // First boot with a legacy file: seed Postgres from it.
        for (const snapshot of this.snapshots.values()) {
          await this._saveDatabaseNow(snapshot);
        }
      }
      this.remoteReady = true;
      this.storageError = "";
    } catch (error) {
      this.storageError = "连接房间数据库失败：" + (error.message || "未知错误");
      this.remoteReady = false;
      if (this.pool) {
        try {
          await this.pool.end();
        } catch (closeError) {
          /* ignore */
        }
        this.pool = null;
      }
    }
  }

  _saveDatabaseNow(snapshot) {
    if (!this.pool) return Promise.resolve();
    const code = snapshot && snapshot.room && snapshot.room.code;
    if (!code) return Promise.resolve();
    return this.pool.query(
      "INSERT INTO nocturne_rooms (code, payload, updated_at) VALUES ($1, $2, now()) " +
        "ON CONFLICT (code) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()",
      [String(code), JSON.stringify(snapshot)]
    );
  }

  _queueDatabaseSave(snapshot) {
    if (!this.pool) return;
    const code = snapshot && snapshot.room && snapshot.room.code;
    if (!code) return;
    const json = JSON.stringify(snapshot);
    this.queue = this.queue
      .catch(() => {})
      .then(() => this.ready)
      .then(() => {
        if (!this.pool) return null;
        return this.pool.query(
          "INSERT INTO nocturne_rooms (code, payload, updated_at) VALUES ($1, $2, now()) " +
            "ON CONFLICT (code) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()",
          [String(code), json]
        );
      })
      .then(() => {
        this.storageError = "";
      })
      .catch((error) => {
        this.storageError = "保存房间数据库失败：" + (error.message || "未知错误");
      });
  }

  _queueDatabaseDelete(code) {
    if (!this.pool) return;
    this.queue = this.queue
      .catch(() => {})
      .then(() => this.ready)
      .then(() => {
        if (!this.pool) return null;
        return this.pool.query("DELETE FROM nocturne_rooms WHERE code = $1", [String(code)]);
      })
      .catch((error) => {
        this.storageError = "删除房间数据库记录失败：" + (error.message || "未知错误");
      });
  }

  all() {
    return [...this.snapshots.values()];
  }

  get(code) {
    return this.snapshots.get(String(code || "")) || null;
  }

  save(snapshot) {
    const code = snapshot && snapshot.room && snapshot.room.code;
    if (!code) return false;
    const payload = JSON.parse(JSON.stringify(snapshot));
    this.snapshots.set(String(code), payload);
    this._writeFile();
    this._queueDatabaseSave(payload);
    return true;
  }

  remove(code) {
    const key = String(code || "");
    if (!key) return;
    this.snapshots.delete(key);
    this._writeFile();
    this._queueDatabaseDelete(key);
  }

  async flush() {
    await this.ready;
    await this.queue;
  }

  async close() {
    await this.flush();
    if (this.pool) {
      try {
        await this.pool.end();
      } catch (error) {
        /* ignore */
      }
    }
  }

  status() {
    return {
      mode: this.pool ? (this.remoteReady ? "postgres" : "connecting") : "file",
      rooms: this.snapshots.size,
      storageError: this.storageError,
    };
  }
}

module.exports = { RoomStore };
