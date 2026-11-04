/**
 * In-memory stand-in for src/config/db.js, so tests can run real routes and services.
 *
 *   vi.mock('../../src/config/db.js', async () => (await import('../helpers/fakeDb.js')).fakeDbModule);
 *
 * It holds no production logic. It rejects a query whose $n placeholders do not match its
 * parameters, as Postgres would, and selectWhere() evaluates the WHERE clause the production
 * code actually sent. Keep this file free of imports from src/: the mock factory loads it
 * while src/config/db.js is being resolved.
 */
export const db = { respond: () => null, log: [] };

async function run(sql, params = []) {
  const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  const highest = placeholders.length > 0 ? Math.max(...placeholders) : 0;
  if (highest !== params.length) {
    throw new Error(`bind message supplies ${params.length} parameters, but statement requires ${highest}: ${sql}`);
  }
  db.log.push({ sql, params });
  if (/SELECT role FROM users/.test(sql)) return { rows: [{ role: 'admin' }] };
  return db.respond(sql, params) || { rows: [] };
}

const query = run;
const getClient = async () => ({ query: run, release: () => {} });

export const fakeDbModule = { query, getClient, default: { query, connect: getClient } };

export function resetDb() {
  db.log.length = 0;
  db.respond = () => null;
}

export const sqlRan = (pattern) => db.log.filter((entry) => pattern.test(entry.sql));

const COMPARE = {
  '=': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
};

function clauseMatches(clause, params, row) {
  const comparison = /^(?:\w+\.)?(\w+)\s*(<=|>=|!=|=|<|>)\s*\$(\d+)$/.exec(clause);
  if (comparison) {
    const [, column, operator, position] = comparison;
    return COMPARE[operator](row[column], params[Number(position) - 1]);
  }
  const notFalse = /^(?:\w+\.)?(\w+)\s+IS NOT FALSE$/i.exec(clause);
  if (notFalse) return row[notFalse[1]] !== false;
  throw new Error(`fakeDb cannot evaluate WHERE clause: ${clause}`);
}

/**
 * The rows the query's own AND-joined WHERE clause selects. A clause it cannot read throws, so a
 * reworded query fails the test instead of silently matching everything. Columns are looked up by
 * bare name, so a joined column such as b.year has to be on the fixture row as `year`.
 */
export function selectWhere(sql, params, rows) {
  const where = /\bWHERE\b([\s\S]*?)(?:\bORDER BY\b|\bGROUP BY\b|\bLIMIT\b|\bRETURNING\b|\bFOR UPDATE\b|$)/i.exec(sql);
  if (!where) throw new Error(`fakeDb found no WHERE clause in: ${sql}`);
  const clauses = where[1].split(/\bAND\b/i).map((clause) => clause.trim());
  return rows.filter((row) => clauses.every((clause) => clauseMatches(clause, params, row)));
}
