import "dotenv/config";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { applyReview, buildNewRepetition, type Config, isDue, type Repetition } from "./spaced-repetition";

export type Problem = {
  id: string;
  title: string;
  difficulty: string;
  url: string;
};

export type DueItem = Repetition & { problem: Problem };

const DEFAULT_CONFIG: Config = {
  firstIntervalDays: 1,
  repFactor: 2
};

function resolveSqlitePath(rawUrl: string | undefined): string {
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  if (rawUrl.startsWith("file:")) {
    return rawUrl.slice("file:".length);
  }

  return rawUrl;
}

const db = new Database(resolveSqlitePath(process.env.DATABASE_URL));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repetitions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  repetition INTEGER NOT NULL,
  interval INTEGER NOT NULL,
  next_review TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE,
  UNIQUE(user_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_repetitions_user_next_review ON repetitions(user_id, next_review);

CREATE TABLE IF NOT EXISTS app_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT UNIQUE,
  first_interval_days INTEGER NOT NULL,
  rep_factor REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

async function ensureUserInternalId(userId: string): Promise<string> {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(userId) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }

  const id = randomUUID();
  db.prepare("INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, userId, new Date().toISOString(), new Date().toISOString());
  return id;
}

export async function userExists(userId: string): Promise<boolean> {
  const user = db.prepare("SELECT id FROM users WHERE username = ?").get(userId) as { id: string } | undefined;
  return user !== undefined;
}

export async function getConfig(userId: string): Promise<Config> {
  const internalUserId = await ensureUserInternalId(userId);
  db.prepare(
    `INSERT INTO app_config (user_id, first_interval_days, rep_factor, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO NOTHING`
  ).run(
    internalUserId,
    DEFAULT_CONFIG.firstIntervalDays,
    DEFAULT_CONFIG.repFactor,
    new Date().toISOString(),
    new Date().toISOString()
  );

  const config = db
    .prepare("SELECT first_interval_days AS firstIntervalDays, rep_factor AS repFactor FROM app_config WHERE user_id = ?")
    .get(internalUserId) as { firstIntervalDays: number; repFactor: number };

  return {
    firstIntervalDays: config.firstIntervalDays,
    repFactor: config.repFactor
  };
}

export async function updateConfig(userId: string, config: Config): Promise<Config> {
  const internalUserId = await ensureUserInternalId(userId);
  db.prepare(
    `INSERT INTO app_config (user_id, first_interval_days, rep_factor, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       first_interval_days = excluded.first_interval_days,
       rep_factor = excluded.rep_factor,
       updated_at = excluded.updated_at`
  ).run(
    internalUserId,
    Math.round(config.firstIntervalDays),
    config.repFactor,
    new Date().toISOString(),
    new Date().toISOString()
  );

  const updated = db
    .prepare("SELECT first_interval_days AS firstIntervalDays, rep_factor AS repFactor FROM app_config WHERE user_id = ?")
    .get(internalUserId) as { firstIntervalDays: number; repFactor: number };

  return {
    firstIntervalDays: updated.firstIntervalDays,
    repFactor: updated.repFactor
  };
}

export async function addProblem(userId: string, problem: Problem): Promise<{ created: boolean }> {
  const internalUserId = await ensureUserInternalId(userId);
  const existing = db
    .prepare("SELECT id FROM repetitions WHERE user_id = ? AND problem_id = ?")
    .get(internalUserId, problem.id) as { id: string } | undefined;

  if (existing) {
    return { created: false };
  }

  db.prepare(
    `INSERT INTO problems (id, title, difficulty, url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       difficulty = excluded.difficulty,
       url = excluded.url,
       updated_at = excluded.updated_at`
  ).run(problem.id, problem.title, problem.difficulty, problem.url, new Date().toISOString(), new Date().toISOString());

  const config = await getConfig(userId);
  const repetition = buildNewRepetition(problem.id, config);

  db.prepare(
    `INSERT INTO repetitions (id, user_id, problem_id, repetition, interval, next_review, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    internalUserId,
    repetition.problemId,
    repetition.repetition,
    repetition.interval,
    repetition.nextReview,
    new Date().toISOString(),
    new Date().toISOString()
  );

  return { created: true };
}

export async function getDueItems(userId: string): Promise<DueItem[]> {
  const internalUserId = await ensureUserInternalId(userId);
  const items = db
    .prepare(
      `SELECT
        r.problem_id AS problemId,
        r.repetition,
        r.interval,
        r.next_review AS nextReview,
        p.id AS problem_id_value,
        p.title AS problem_title,
        p.difficulty AS problem_difficulty,
        p.url AS problem_url
      FROM repetitions r
      INNER JOIN problems p ON p.id = r.problem_id
      WHERE r.user_id = ?
      ORDER BY r.next_review ASC`
    )
    .all(internalUserId) as Array<{
    problemId: string;
    repetition: number;
    interval: number;
    nextReview: string;
    problem_id_value: string;
    problem_title: string;
    problem_difficulty: string;
    problem_url: string;
  }>;

  return items
    .filter((item) => isDue(item.nextReview))
    .map((item) => ({
      problemId: item.problemId,
      repetition: item.repetition,
      interval: item.interval,
      nextReview: item.nextReview,
      problem: {
        id: item.problem_id_value,
        title: item.problem_title,
        difficulty: item.problem_difficulty,
        url: item.problem_url
      }
    }));
}

export async function updateReview(userId: string, problemId: string, quality: number): Promise<Repetition | null> {
  const internalUserId = await ensureUserInternalId(userId);
  const current = db
    .prepare(
      `SELECT problem_id AS problemId, repetition, interval, next_review AS nextReview
       FROM repetitions
       WHERE user_id = ? AND problem_id = ?`
    )
    .get(internalUserId, problemId) as
    | { problemId: string; repetition: number; interval: number; nextReview: string }
    | undefined;

  if (!current) {
    return null;
  }

  const config = await getConfig(userId);
  const next = applyReview(
    {
      problemId: current.problemId,
      repetition: current.repetition,
      interval: current.interval,
      nextReview: current.nextReview
    },
    quality,
    config
  );

  db.prepare(
    `UPDATE repetitions
     SET repetition = ?, interval = ?, next_review = ?, updated_at = ?
     WHERE user_id = ? AND problem_id = ?`
  ).run(next.repetition, next.interval, next.nextReview, new Date().toISOString(), internalUserId, problemId);

  return {
    problemId: next.problemId,
    repetition: next.repetition,
    interval: next.interval,
    nextReview: next.nextReview
  };
}
