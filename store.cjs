const { randomBytes, createHash, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const derive = promisify(scrypt);
const secret = () => randomBytes(24).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const date = () => new Date().toISOString();
const username = (value) => typeof value === "string" && /^[a-z][a-z0-9._-]{2,49}$/.test(value);
const roles = ["admin", "editor", "viewer"];
const defaultLifetime = 12 * 60 * 60 * 1000;

async function passwordHash(password, salt = secret()) {
  const digest = await derive(password, salt, 64);
  return salt + ":" + digest.toString("hex");
}
async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  const [, actual] = (await passwordHash(password, salt)).split(":");
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function openStore(filename) {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      name TEXT PRIMARY KEY, password TEXT NOT NULL, role TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      digest TEXT PRIMARY KEY, name TEXT NOT NULL REFERENCES users(name) ON DELETE CASCADE, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL, updated_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL,
      revision INTEGER NOT NULL, proposal TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL, author TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shares (
      digest TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES versions(id),
      expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      label TEXT NOT NULL, kind TEXT NOT NULL, content_type TEXT NOT NULL,
      body BLOB NOT NULL, created TEXT NOT NULL, author TEXT NOT NULL
    );
  `);
  const query = (sql, ...params) => db.prepare(sql).all(...params);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const byProject = (id) => {
    const row = get("SELECT * FROM projects WHERE id=?", id);
    return row && { ...row, state: JSON.parse(row.state) };
  };
  const session = (token) => token && get(
    "SELECT u.name,u.role FROM sessions s JOIN users u ON s.name=u.name WHERE s.digest=? AND s.expires>?", hash(token), Date.now(),
  );
  async function addUser(name, password, role) {
    if (!username(name) || typeof password !== "string" || password.length < 12 || password.length > 200 || !roles.includes(role)) {
      return false;
    }
    const encoded = await passwordHash(password);
    return run("INSERT OR IGNORE INTO users VALUES (?,?,?,?)", name, encoded, role, date()).changes === 1;
  }
  async function bootstrap(name, password) {
    if (get("SELECT count(*) AS n FROM users").n) return;
    if (!await addUser(name, password, "admin")) throw new Error("Configure ADMIN_USER and ADMIN_PASSWORD (12+ characters).");
  }
  async function login(name, password) {
    const row = username(name) && get("SELECT * FROM users WHERE name=?", name);
    if (!row) {
      await derive(password, "nonexistent-account", 64);
      return null;
    }
    if (!await verifyPassword(password, row.password)) return null;
    const token = secret();
    run("DELETE FROM sessions WHERE expires<=?", Date.now());
    run("INSERT INTO sessions VALUES (?,?,?)", hash(token), name, Date.now() + defaultLifetime);
    return token;
  }
  return {
    db, query, get, run, session, byProject, bootstrap, login, addUser, hash, secret, date, defaultLifetime,
    revokeSession(token) { if (token) run("DELETE FROM sessions WHERE digest=?", hash(token)); },
  };
}

module.exports = { openStore };
