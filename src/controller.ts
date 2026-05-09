import express, { Request, Response as ExpressResponse } from "express";
import { addProblem, getConfig, getDueItems, Problem, updateConfig, updateReview, userExists } from "./db";
import { validateLeetCodeProblemUrl } from "./service";

const app = express();
const port = 3000;
const USER_ID_MAX_LENGTH = 100;
const STARTUP_USER_ID = "bootstrap-user";

app.use(express.json());

function parseUserId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > USER_ID_MAX_LENGTH) {
    return null;
  }

  return normalized;
}

app.get("/api/health", (_req: Request, res: ExpressResponse) => {
  res.json({ status: "ok" });
});

app.get("/api/users/exists", async (req: Request, res: ExpressResponse) => {
  const userId = parseUserId(req.query.userId);
  if (!userId) {
    res.status(400).json({ error: "Missing or invalid userId query parameter" });
    return;
  }

  res.json({ exists: await userExists(userId) });
});

app.get("/api/config", async (req: Request, res: ExpressResponse) => {
  const userId = parseUserId(req.query.userId);
  if (!userId) {
    res.status(400).json({ error: "Missing or invalid userId query parameter" });
    return;
  }

  const config = await getConfig(userId);
  res.json(config);
});

app.post("/api/problems", async (req: Request, res: ExpressResponse) => {
  const { id, title, url, userId: rawUserId } = req.body as Partial<Pick<Problem, "id" | "title" | "url">> & { userId?: string };
  const userId = parseUserId(rawUserId);

  if (!userId || !id || !title || !url) {
    res.status(400).json({ error: "Missing required fields: userId, id, title, url" });
    return;
  }
  const validation = await validateLeetCodeProblemUrl(url);

  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  if (id !== validation.slug) {
    res.status(400).json({ error: "Problem id must match the LeetCode URL slug." });
    return;
  }

  const result = await addProblem(userId, { id, title, difficulty: validation.difficulty, url: validation.url });
  if (!result.created) {
    res.status(200).json({ message: "Problem already exists" });
    return;
  }

  res.status(201).json({ message: "Problem added" });
});

app.get("/api/due", async (req: Request, res: ExpressResponse) => {
  const userId = parseUserId(req.query.userId);
  if (!userId) {
    res.status(400).json({ error: "Missing or invalid userId query parameter" });
    return;
  }

  const due = await getDueItems(userId);
  res.json(due);
});

app.post("/api/review", async (req: Request, res: ExpressResponse) => {
  const { userId: rawUserId, problemId, quality } = req.body as { userId?: string; problemId?: string; quality?: number };
  const userId = parseUserId(rawUserId);

  if (!userId || !problemId || typeof quality !== "number") {
    res.status(400).json({ error: "Missing required fields: userId, problemId, quality" });
    return;
  }

  if (![1, 3, 5].includes(quality)) {
    res.status(400).json({ error: "quality must be one of 1, 3, 5" });
    return;
  }

  const repetition = await updateReview(userId, problemId, quality);
  if (!repetition) {
    res.status(404).json({ error: "Problem repetition not found" });
    return;
  }

  res.json({ message: "Review updated", repetition });
});

app.post("/api/config", async (req: Request, res: ExpressResponse) => {
  const { userId: rawUserId, firstIntervalDays, repFactor } = req.body as { userId?: string; firstIntervalDays?: number; repFactor?: number };
  const userId = parseUserId(rawUserId);

  if (!userId) {
    res.status(400).json({ error: "Missing required field: userId" });
    return;
  }

  if (typeof firstIntervalDays !== "number" || firstIntervalDays <= 0) {
    res.status(400).json({ error: "firstIntervalDays must be a positive number" });
    return;
  }

  if (typeof repFactor !== "number" || repFactor <= 1) {
    res.status(400).json({ error: "repFactor must be a number greater than 1" });
    return;
  }

  const config = await updateConfig(userId, {
    firstIntervalDays: Math.round(firstIntervalDays),
    repFactor
  });

  res.json({ message: "Config updated", config });
});

async function bootstrap(): Promise<void> {
  try {
    // Force a DB read at startup so Prisma/table issues fail fast with a clear log.
    await getConfig(STARTUP_USER_ID);
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server. Run `npm run db:push` and verify DATABASE_URL.", error);
    process.exit(1);
  }
}

void bootstrap();
