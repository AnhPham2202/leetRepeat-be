const URL_CHECK_TIMEOUT_MS = 8000;
const UNKNOWN_DIFFICULTY = "unknown";

type UrlValidationResult = { ok: true; url: string; slug: string; difficulty: string } | { ok: false; error: string };
type LeetCodeQuestionResponse = {
  data?: {
    question?: {
      questionId: string;
      title: string;
      titleSlug: string;
      difficulty: string;
    } | null;
  };
};

function parseLeetCodeProblemUrl(rawUrl: string): { url: URL; slug: string } | null {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const match = parsed.pathname.match(/^\/problems\/([a-z0-9-]+)(?:\/(?:description|editorial|solutions|submissions)?)?\/?$/i);

    if (!["leetcode.com", "www.leetcode.com"].includes(hostname) || !["http:", "https:"].includes(parsed.protocol) || !match) {
      return null;
    }

    return { url: parsed, slug: match[1].toLowerCase() };
  } catch {
    return null;
  }
}

function hasLeetCodeProblemMarkers(html: string, slug: string): boolean {
  const normalized = html.toLowerCase();
  const problemPath = `/problems/${slug}`;
  const pageMarkers = ["__next_data__", "leetcode", "questionfrontendid", "questiontitle", "problemsetquestionlist"];
  const markerHits = pageMarkers.filter((marker) => normalized.includes(marker)).length;

  return normalized.includes(problemPath) && markerHits >= 2;
}

function isCloudflareChallenge(response: Response): boolean {
  return response.status === 403 && response.headers.get("cf-mitigated")?.toLowerCase() === "challenge";
}

async function validateLeetCodeProblemViaGraphql(
  slug: string,
  sourceUrl: URL
): Promise<{ slug: string; difficulty: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://leetcode.com",
        Referer: sourceUrl.toString()
      },
      body: JSON.stringify({
        operationName: "questionData",
        variables: { titleSlug: slug },
        query: `
          query questionData($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              questionId
              title
              titleSlug
              difficulty
            }
          }
        `
      })
    });

    if (!response.ok) {
      return null;
    }

    const result = (await response.json().catch(() => null)) as LeetCodeQuestionResponse | null;
    const question = result?.data?.question;

    if (question?.questionId && question.title && question.titleSlug === slug && question.difficulty) {
      return { slug, difficulty: question.difficulty.toLowerCase() };
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function validateLeetCodeProblemUrl(rawUrl: string): Promise<UrlValidationResult> {
  const parsed = parseLeetCodeProblemUrl(rawUrl);

  if (!parsed) {
    return { ok: false, error: "URL must be a LeetCode problem URL." };
  }

  const graphqlMeta = await validateLeetCodeProblemViaGraphql(parsed.slug, parsed.url);
  if (graphqlMeta) {
    return { ok: true, url: parsed.url.toString(), slug: parsed.slug, difficulty: graphqlMeta.difficulty };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(parsed.url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "LeetRepeat/1.0 (+https://leetcode.com)",
        Accept: "text/html,application/xhtml+xml"
      }
    });

    if (isCloudflareChallenge(response)) {
      return { ok: false, error: "LeetCode blocked page verification and GraphQL verification failed." };
    }

    if (response.status !== 200) {
      return { ok: false, error: "LeetCode URL did not return HTTP 200." };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return { ok: false, error: "LeetCode URL did not return an HTML page." };
    }

    const html = await response.text();
    if (!hasLeetCodeProblemMarkers(html, parsed.slug)) {
      return { ok: false, error: "URL does not look like a LeetCode problem page." };
    }

    return { ok: true, url: parsed.url.toString(), slug: parsed.slug, difficulty: UNKNOWN_DIFFICULTY };
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError" ? "Timed out while checking LeetCode URL." : "Could not verify LeetCode URL.";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export { parseLeetCodeProblemUrl, validateLeetCodeProblemViaGraphql, hasLeetCodeProblemMarkers, isCloudflareChallenge, validateLeetCodeProblemUrl };
export type { UrlValidationResult };
