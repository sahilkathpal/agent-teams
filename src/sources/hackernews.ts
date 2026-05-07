export interface HNHit {
  title: string;
  url: string | null;
  points: number;
  num_comments: number;
  created_at: string;
  objectID: string;
}

/**
 * Search Hacker News via Algolia API.
 */
export async function searchHN(
  query: string,
  opts?: { daysBack?: number; hitsPerPage?: number; sortByDate?: boolean },
): Promise<HNHit[]> {
  const { daysBack = 30, hitsPerPage = 20, sortByDate = true } = opts ?? {};
  const since = Math.floor(Date.now() / 1000) - daysBack * 86400;
  const params = new URLSearchParams({
    query,
    tags: "story",
    numericFilters: `created_at_i>${since}`,
    hitsPerPage: String(hitsPerPage),
  });

  const endpoint = sortByDate ? "search_by_date" : "search";
  const url = `https://hn.algolia.com/api/v1/${endpoint}?${params}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`[hn] Search failed for "${query}": ${res.status}`);
      return [];
    }

    const json = (await res.json()) as { hits?: Array<Record<string, unknown>> };
    return (json.hits ?? []).map((h) => ({
      title: h.title as string,
      url: (h.url as string) ?? null,
      points: (h.points as number) ?? 0,
      num_comments: (h.num_comments as number) ?? 0,
      created_at: h.created_at as string,
      objectID: h.objectID as string,
    }));
  } catch (err) {
    console.warn("[hn] Search error:", err instanceof Error ? err.message : err);
    return [];
  }
}
