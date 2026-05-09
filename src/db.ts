import { prisma } from "./prisma";
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

async function ensureUserInternalId(userId: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { username: userId },
    update: {},
    create: { username: userId }
  });

  return user.id;
}

export async function userExists(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { username: userId },
    select: { id: true }
  });

  return user !== null;
}

export async function getConfig(userId: string): Promise<Config> {
  const internalUserId = await ensureUserInternalId(userId);
  const config = await prisma.appConfig.upsert({
    where: { userId: internalUserId },
    update: {},
    create: {
      userId: internalUserId,
      firstIntervalDays: DEFAULT_CONFIG.firstIntervalDays,
      repFactor: DEFAULT_CONFIG.repFactor
    }
  });

  return {
    firstIntervalDays: config.firstIntervalDays,
    repFactor: config.repFactor
  };
}

export async function updateConfig(userId: string, config: Config): Promise<Config> {
  const internalUserId = await ensureUserInternalId(userId);
  const updated = await prisma.appConfig.upsert({
    where: { userId: internalUserId },
    update: {
      firstIntervalDays: Math.round(config.firstIntervalDays),
      repFactor: config.repFactor
    },
    create: {
      userId: internalUserId,
      firstIntervalDays: Math.round(config.firstIntervalDays),
      repFactor: config.repFactor
    }
  });

  return {
    firstIntervalDays: updated.firstIntervalDays,
    repFactor: updated.repFactor
  };
}

export async function addProblem(userId: string, problem: Problem): Promise<{ created: boolean }> {
  const internalUserId = await ensureUserInternalId(userId);
  const existing = await prisma.repetition.findUnique({
    where: {
      userId_problemId: {
        userId: internalUserId,
        problemId: problem.id
      }
    }
  });

  if (existing) {
    return { created: false };
  }

  await prisma.problem.upsert({
    where: { id: problem.id },
    update: {
      title: problem.title,
      difficulty: problem.difficulty,
      url: problem.url
    },
    create: {
      id: problem.id,
      title: problem.title,
      difficulty: problem.difficulty,
      url: problem.url
    }
  });

  const config = await getConfig(userId);
  const repetition = buildNewRepetition(problem.id, config);

  await prisma.repetition.create({
    data: {
      userId: internalUserId,
      problemId: repetition.problemId,
      repetition: repetition.repetition,
      interval: repetition.interval,
      nextReview: new Date(repetition.nextReview)
    }
  });

  return { created: true };
}

export async function getDueItems(userId: string): Promise<DueItem[]> {
  const internalUserId = await ensureUserInternalId(userId);
  const items = await prisma.repetition.findMany({
    where: { userId: internalUserId },
    include: { problem: true },
    orderBy: { nextReview: "asc" }
  });

  return items
    .filter((item) => isDue(item.nextReview.toISOString()))
    .map((item) => ({
      problemId: item.problemId,
      repetition: item.repetition,
      interval: item.interval,
      nextReview: item.nextReview.toISOString(),
      problem: {
        id: item.problem.id,
        title: item.problem.title,
        difficulty: item.problem.difficulty,
        url: item.problem.url
      }
    }));
}

export async function updateReview(userId: string, problemId: string, quality: number): Promise<Repetition | null> {
  const internalUserId = await ensureUserInternalId(userId);
  const current = await prisma.repetition.findUnique({
    where: {
      userId_problemId: {
        userId: internalUserId,
        problemId
      }
    }
  });

  if (!current) {
    return null;
  }

  const config = await getConfig(userId);
  const next = applyReview(
    {
      problemId: current.problemId,
      repetition: current.repetition,
      interval: current.interval,
      nextReview: current.nextReview.toISOString()
    },
    quality,
    config
  );

  const updated = await prisma.repetition.update({
    where: {
      userId_problemId: {
        userId: internalUserId,
        problemId
      }
    },
    data: {
      repetition: next.repetition,
      interval: next.interval,
      nextReview: new Date(next.nextReview)
    }
  });

  return {
    problemId: updated.problemId,
    repetition: updated.repetition,
    interval: updated.interval,
    nextReview: updated.nextReview.toISOString()
  };
}
