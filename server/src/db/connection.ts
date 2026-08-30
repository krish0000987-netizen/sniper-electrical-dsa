import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
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
  
  // Translate SQLite datetime('now') / date('now') and modifiers
  s = s.replace(/(?:datetime|date)\('now'\)/gi, "CURRENT_TIMESTAMP");
  s = s.replace(/(?:datetime|date)\('now',\s*'([^']+)'\)/gi, (match, interval) => {
    return `CURRENT_TIMESTAMP + INTERVAL '${interval}'`;
  });
  s = s.replace(/(?:datetime|date)\('now',\s*([^)]+)\)/gi, (match, val) => {
    if (val.trim() === "?") {
      return `CURRENT_TIMESTAMP + CAST(? AS INTERVAL)`;
    }
    return match;
  });

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
