import express, {Request, Response as ExpressResponse} from "express";
import {addProblem, getConfig, getDueItems, Problem, updateConfig, updateReview} from "./db";
import {validateLeetCodeProblemUrl} from "./service";

const app = express();
const port = 3000;

app.use(express.json());

app.get("/api/health", (_req: Request, res: ExpressResponse) => {
  res.json({ status: "ok" });
});

app.get("/api/config", async (_req: Request, res: ExpressResponse) => {
  const config = await getConfig();
  res.json(config);
});

app.post("/api/problems", async (req: Request, res: ExpressResponse) => {
  const { id, title, url } = req.body as Partial<Pick<Problem, "id" | "title" | "url">>;

  if (!id || !title || !url) {
    res.status(400).json({ error: "Missing required fields: id, title, url" });
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

  const result = await addProblem({ id, title, difficulty: validation.difficulty, url: validation.url });
  if (!result.created) {
    res.status(200).json({ message: "Problem already exists" });
    return;
  }

  res.status(201).json({ message: "Problem added" });
});

app.get("/api/due", async (_req: Request, res: ExpressResponse) => {
  const due = await getDueItems();
  res.json(due);
});

app.post("/api/review", async (req: Request, res: ExpressResponse) => {
  const { problemId, quality } = req.body as { problemId?: string; quality?: number };

  if (!problemId || typeof quality !== "number") {
    res.status(400).json({ error: "Missing required fields: problemId, quality" });
    return;
  }

  if (![1, 3, 5].includes(quality)) {
    res.status(400).json({ error: "quality must be one of 1, 3, 5" });
    return;
  }

  const repetition = await updateReview(problemId, quality);
  if (!repetition) {
    res.status(404).json({ error: "Problem repetition not found" });
    return;
  }

  res.json({ message: "Review updated", repetition });
});

app.post("/api/config", async (req: Request, res: ExpressResponse) => {
  const { firstIntervalDays, repFactor } = req.body as { firstIntervalDays?: number; repFactor?: number };

  if (typeof firstIntervalDays !== "number" || firstIntervalDays <= 0) {
    res.status(400).json({ error: "firstIntervalDays must be a positive number" });
    return;
  }

  if (typeof repFactor !== "number" || repFactor <= 1) {
    res.status(400).json({ error: "repFactor must be a number greater than 1" });
    return;
  }

  const config = await updateConfig({
    firstIntervalDays: Math.round(firstIntervalDays),
    repFactor
  });

  res.json({ message: "Config updated", config });
});

async function bootstrap(): Promise<void> {
  try {
    // Force a DB read at startup so Prisma/table issues fail fast with a clear log.
    await getConfig();
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server. Run `npm run db:push` and verify DATABASE_URL.", error);
    process.exit(1);
  }
}

void bootstrap();
