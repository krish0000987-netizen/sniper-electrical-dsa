import pg from "pg";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// Remote Postgres (e.g. Supabase) requires TLS; local Postgres usually has no
// SSL listener. Opt in/out explicitly with DATABASE_SSL=true|false, otherwise
// auto-detect: loopback hosts connect plain, everything else uses TLS.
function resolveSsl(): pg.PoolConfig["ssl"] | undefined {
  const flag = process.env.DATABASE_SSL;
  if (flag === "true") return { rejectUnauthorized: false };
  if (flag === "false") return undefined;
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname;
    return /^(127\.0\.0\.1|localhost|::1)$/i.test(host) ? undefined : { rejectUnauthorized: false };
  } catch {
    return { rejectUnauthorized: false };
  }
}

/**
 * Per-process test isolation on Postgres. The legacy suites each point
 * NEXUS_DB at their own SQLite file in tmpdir; under the PG backend every
 * process shared one database, so parallel test files polluted each other's
 * rows and identity counters drifted between runs. When NEXUS_DB is present
 * we recreate that isolation with a dedicated, pid+path-keyed schema and pin
 * every pooled connection to it via search_path.
 */
// SQLite returned every value as a JS number/string; PG's bigint (oid 20) and
// numeric (oid 1700) come back as strings, which breaks strict arithmetic
// assertions and downstream math throughout the app. Coerce them to Number so
// PG behaves like the SQLite backend it replaced. Values here are rupees / ids
// far below 2^53, so no precision is lost.
pg.types.setTypeParser(20, (v: string) => Number(v));
pg.types.setTypeParser(1700, (v: string) => Number(v));

export const TEST_SCHEMA: string | undefined = (() => {
  const raw = process.env.NEXUS_DB;
  if (!raw) return undefined;
  const hash = createHash("md5").update(raw).digest("hex").slice(0, 8);
  return `nx_${process.pid.toString(36)}_${hash}`;
})();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSsl(),
  ...(TEST_SCHEMA ? { options: `-c search_path=${TEST_SCHEMA}` } : {})
});

const transactionStorage = new AsyncLocalStorage<pg.PoolClient>();

async function getClient(): Promise<pg.Pool | pg.PoolClient> {
  return transactionStorage.getStore() || pool;
}

function sqliteToPgSql(sql: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let paramIndex = 1;
  let result = "";
  
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'" && sql[i - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      result += char;
    } else if (char === '"' && sql[i - 1] !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      result += char;
    } else if (char === "`" && sql[i - 1] !== "\\") {
      inBacktick = !inBacktick;
      result += char;
    } else if (char === "?" && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      result += `$${paramIndex++}`;
    } else {
      result += char;
    }
  }
  return result;
}

export function translateSql(sql: string): string {
  let s = sql.trim();
  
  // Translate SQLite datetime('now') / date('now') and modifiers.
  // date(...) must map to CURRENT_DATE (date vs timestamp comparison errors in PG).
  s = s.replace(/\bdate\('now'\s*\)/gi, "CURRENT_DATE");
  s = s.replace(/\bdate\('now',\s*'([^']+)'\)/gi, (_m, interval) => `(CURRENT_DATE + INTERVAL '${interval}')`);
  // SQLite date(col) parses its TEXT arg; PG has no date(text). Cast instead.
  s = s.replace(/\bdate\(([A-Za-z_][A-Za-z0-9_.]*)\)/gi, "CAST($1 AS DATE)");
  s = s.replace(/\bdate\('now',\s*([^)]+)\)/gi, (_m, val) => {
    if (val.trim() === "?") return `(CURRENT_DATE + CAST(? AS INTERVAL))`;
    return _m;
  });
  s = s.replace(/\bdatetime\('now'\s*\)/gi, "CURRENT_TIMESTAMP");
  s = s.replace(/\bdatetime\('now',\s*'([^']+)'\)/gi, (_m, interval) => `(CURRENT_TIMESTAMP + INTERVAL '${interval}')`);

  // datetime('now') used as a VALUE against TEXT timestamp columns (schema
  // stores *_at as TEXT, like SQLite). CURRENT_TIMESTAMP is timestamptz and
  // clashes in `CASE WHEN ... THEN datetime('now') ELSE col END` updates, so
  // when the THEN branch feeds such a CASE, keep it TEXT via TO_CHAR.
  s = s.replace(/THEN CURRENT_TIMESTAMP(?=\s+ELSE\s+[A-Za-z_][A-Za-z0-9_.]*\s+END)/gi,
    "THEN TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')");
  s = s.replace(/\bdatetime\('now',\s*([^)]+)\)/gi, (_m, val) => {
    if (val.trim() === "?") return `(CURRENT_TIMESTAMP + CAST(? AS INTERVAL))`;
    return _m;
  });

  // julianday(...) has no PG equivalent; SQLite stores timestamps as TEXT.
  // Julian day numbers are only ever used in differences, so express both
  // sides as epoch-days: EXTRACT(EPOCH FROM CAST(x AS TIMESTAMP))/86400.0
  s = s.replace(/\bjulianday\('now'\)/gi, "(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)/86400.0)");
  s = s.replace(/\bjulianday\(([^()]+)\)/gi, (_m, arg) => `(EXTRACT(EPOCH FROM CAST(${arg} AS TIMESTAMP))/86400.0)`);

  // strftime('%Y-%m', col) / ('%Y-%m-%d', col) → TO_CHAR over a timestamp cast
  s = s.replace(/\bstrftime\('%Y-%m-%d',\s*([^()]+)\)/gi, (_m, arg) => `TO_CHAR(CAST(${arg} AS TIMESTAMP), 'YYYY-MM-DD')`);
  s = s.replace(/\bstrftime\('%Y-%m',\s*([^()]+)\)/gi, (_m, arg) => `TO_CHAR(CAST(${arg} AS TIMESTAMP), 'YYYY-MM')`);

  // Translate INSERT OR IGNORE and INSERT OR REPLACE
  if (/INSERT OR IGNORE INTO gn_attendance/i.test(s)) {
    s = s.replace(/INSERT OR IGNORE INTO gn_attendance/i, "INSERT INTO gn_attendance");
    s += " ON CONFLICT DO NOTHING";
  } else if (/INSERT OR IGNORE INTO gn_payroll/i.test(s)) {
    s = s.replace(/INSERT OR IGNORE INTO gn_payroll/i, "INSERT INTO gn_payroll");
    s += " ON CONFLICT (user_id, month) DO NOTHING";
  } else if (/INSERT OR IGNORE INTO/i.test(s)) {
    s = s.replace(/INSERT OR IGNORE INTO/i, "INSERT INTO");
    s += " ON CONFLICT DO NOTHING";
  }

  if (/INSERT OR REPLACE INTO system_config/i.test(s)) {
    s = s.replace(/INSERT OR REPLACE INTO system_config/i, "INSERT INTO system_config");
    s += " ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at";
  } else if (/INSERT OR REPLACE INTO gn_payroll/i.test(s)) {
    s = s.replace(/INSERT OR REPLACE INTO gn_payroll/i, "INSERT INTO gn_payroll");
    s += " ON CONFLICT (user_id, month) DO UPDATE SET basic = EXCLUDED.basic, hra = EXCLUDED.hra, allowance = EXCLUDED.allowance, gross = EXCLUDED.gross, tds = EXCLUDED.tds, net = EXCLUDED.net, status = EXCLUDED.status";
  } else if (/INSERT OR REPLACE INTO gn_roles/i.test(s)) {
    s = s.replace(/INSERT OR REPLACE INTO gn_roles/i, "INSERT INTO gn_roles");
    s += " ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, designation = EXCLUDED.designation, partner_type = EXCLUDED.partner_type, is_system = EXCLUDED.is_system";
  } else if (/INSERT OR REPLACE INTO gn_role_permissions/i.test(s)) {
    s = s.replace(/INSERT OR REPLACE INTO gn_role_permissions/i, "INSERT INTO gn_role_permissions");
    s += " ON CONFLICT (tenant_id, role_id, module, action) DO UPDATE SET scope = EXCLUDED.scope, allowed = EXCLUDED.allowed";
  }

  // Replace sqlite_master with pg_tables
  s = s.replace(/sqlite_master/gi, "pg_tables");

  // Translate SQLite scalar MAX(0, ...) to PostgreSQL GREATEST(0, ...)
  s = s.replace(/\bMAX\s*\(\s*0\s*,\s*/gi, "GREATEST(0, ");

  // SQLite json_extract(col, '$.key') → Postgres jsonb path extraction. The
  // mapped/validation columns store JSON.stringify'd objects as TEXT.
  s = s.replace(/\bjson_extract\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,\s*'\$\.([A-Za-z0-9_]+)'\s*\)/gi,
    (_m, col, key) => `(CAST(${col} AS jsonb) ->> '${key}')`);

  // Convert parameters ? to $1, $2, ...
  s = sqliteToPgSql(s);

  // Append RETURNING id to INSERT statements to fetch lastId
  if (s.trim().toUpperCase().startsWith("INSERT ") && !s.toUpperCase().includes("RETURNING ")) {
    s += " RETURNING id";
  }

  return s;
}

function translateDdl(sql: string): string {
  let s = sql;
  s = s.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, "SERIAL PRIMARY KEY");
  s = s.replace(/\(datetime\('now'\)\)/gi, "CURRENT_TIMESTAMP");
  s = s.replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP");
  s = s.replace(/PRAGMA journal_mode\s*=\s*WAL;/gi, "");
  s = s.replace(/PRAGMA foreign_keys\s*=\s*\w+;/gi, "");
  return s;
}

class PostgresDbWrapper {
  async exec(sql: string): Promise<void> {
    const translated = translateDdl(sql);
    const client = await getClient();
    await client.query(translated);
  }
}

const _db = new PostgresDbWrapper();

export function db(): PostgresDbWrapper {
  return _db;
}

export type Row = Record<string, any>;

export const DB_PATH = process.env.DATABASE_URL || "";

// Untrusted identifiers never reach the pool options or DDL: the schema name
// is built only from a base-36 pid and a hex digest.
export const TEST_SCHEMA_REGEX = /^nx_[a-z0-9_]+$/;

export async function q<T = any>(sql: string, params: unknown[] = []){
  const translated = translateSql(sql);
  const client = await getClient();
  const res = await client.query(translated, params);
  return res.rows;
}

export async function q1<T = any>(sql: string, params: unknown[] = []){
  const translated = translateSql(sql);
  const client = await getClient();
  const res = await client.query(translated, params);
  return res.rows[0];
}

export async function run(sql: string, params: unknown[] = []){
  const translated = translateSql(sql);
  const client = await getClient();
  const res = await client.query(translated, params);
  const lastId = res.rows[0]?.id ? Number(res.rows[0].id) : 0;
  return { lastId, changes: res.rowCount ?? 0 };
}

export async function tx<T>(fn: () => Promise<T>){
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await transactionStorage.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function now(): Promise<string> {
  return new Date().toISOString();
}

/**
 * Run fn under a session-level advisory lock on its own pooled connection.
 * Unlike pg_advisory_xact_lock this spans arbitrary queries/transactions
 * inside fn, so multi-process boots (parallel tests, serverless cold-start
 * races) can serialize expensive one-time work such as demo seeding.
 */
export async function withSessionLock<T>(key: number, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [key]);
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [key]).catch(() => {});
    client.release();
  }
}
