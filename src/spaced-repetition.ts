export type Repetition = {
  problemId: string;
  repetition: number;
  interval: number;
  nextReview: string;
};

export type Config = {
  firstIntervalDays: number;
  repFactor: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfToday(): Date {
  const now = new Date();
  return new Date(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + 1 * MS_PER_DAY);
}

function addDays(date: Date, days: number): string {
  const next = new Date(date.getTime() + days * MS_PER_DAY);
  return next.toISOString();
}

export function buildNewRepetition(problemId: string, config: Config): Repetition {
  const today = startOfToday();
  const interval = Math.max(1, Math.round(config.firstIntervalDays));

  return {
    problemId,
    repetition: 1,
    interval,
    nextReview: addDays(today, interval)
  };
}

export function applyReview(current: Repetition, quality: number, config: Config): Repetition {
  const today = startOfToday();

  if (quality < 3) {
    const resetInterval = Math.max(1, Math.round(config.firstIntervalDays));
    return {
      ...current,
      repetition: 1,
      interval: resetInterval,
      nextReview: addDays(today, resetInterval)
    };
  }

  const nextRepetition = current.repetition + 1;
  const nextInterval = Math.max(1, Math.round(current.interval * config.repFactor));

  return {
    ...current,
    repetition: nextRepetition,
    interval: nextInterval,
    nextReview: addDays(today, nextInterval)
  };
}

export function isDue(nextReviewIso: string): boolean {
  const reviewDate = new Date(nextReviewIso);
  const today = startOfToday();
  return reviewDate.getTime() <= today.getTime();
}

export function parseLeetCodeSlug(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/problems\/([^/]+)\/?/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
