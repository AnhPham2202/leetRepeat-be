require("dotenv").config();
const Database = require("better-sqlite3");

function resolveSqlitePath(rawUrl) {
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  return rawUrl.startsWith("file:") ? rawUrl.slice("file:".length) : rawUrl;
}

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Usage: npm run sql -- "YOUR_SQL_HERE"');
  process.exit(1);
}

const db = new Database(resolveSqlitePath(process.env.DATABASE_URL));
db.pragma("foreign_keys = ON");

try {
  const normalized = query.replace(/^\s+/, "").toUpperCase();
  if (
    normalized.startsWith("SELECT") ||
    normalized.startsWith("PRAGMA") ||
    normalized.startsWith("WITH") ||
    normalized.startsWith("EXPLAIN")
  ) {
    const rows = db.prepare(query).all();
    console.table(rows);
  } else {
    const result = db.prepare(query).run();
    console.log(JSON.stringify({
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid
    }, null, 2));
  }
} catch (error) {
  console.error("SQL execution failed:", error.message);
  process.exit(1);
} finally {
  db.close();
}
