import Parallel from "parallel-web";
import "dotenv/config";
import { log } from "../utils/run-logger.js";

export interface SearchResult {
  url: string;
  title: string;
  domain: string;
  excerpts: string[];
}

export interface ExtractResult {
  url: string;
  title: string | undefined;
  publish_date: string | undefined;
  excerpts: string[];
}

let _client: Parallel | null = null;
function client(): Parallel {
  if (!_client) {
    const key = process.env.PARALLEL_API_KEY;
    if (!key) throw new Error("PARALLEL_API_KEY not set");
    _client = new Parallel({ apiKey: key });
  }
  return _client;
}

/**
 * Semantic web search via Parallel API.
 *
 * Use includeDomains to scope to a site (e.g. ["reddit.com/r/ClaudeCode"] or ["reddit.com"]).
 * Use excludeDomains to filter out sources (e.g. ["reddit.com", "twitter.com"]).
 * Use afterDate (YYYY-MM-DD) to filter to content published after a date.
 */
export async function searchWeb(
  query: string,
  opts?: {
    maxResults?: number;
    includeDomains?: string[];
    excludeDomains?: string[];
    afterDate?: string;
    sessionId?: string;
  },
): Promise<SearchResult[]> {
  try {
    const hasSourcePolicy =
      opts?.includeDomains?.length ||
      opts?.excludeDomains?.length ||
      opts?.afterDate;

    const response = await client().search({
      search_queries: [query],
      objective: query,
      advanced_settings: {
        max_results: opts?.maxResults ?? 10,
        ...(hasSourcePolicy
          ? {
              source_policy: {
                ...(opts?.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
                ...(opts?.excludeDomains?.length ? { exclude_domains: opts.excludeDomains } : {}),
                ...(opts?.afterDate ? { after_date: opts.afterDate } : {}),
              },
            }
          : {}),
      },
      ...(opts?.sessionId ? { session_id: opts.sessionId } : {}),
    });

    return response.results
      .filter((r: any) => r.url && r.title)
      .map((r: any) => ({
        url: r.url,
        title: r.title!,
        domain: new URL(r.url).hostname,
        excerpts: r.excerpts ?? [],
      }));
  } catch (err) {
    const msg = `[parallel] search failed: ${err instanceof Error ? err.message : err}`;
    console.warn(msg);
    log(msg);
    return [];
  }
}

/**
 * Extract full content from URLs via Parallel API.
 * Supports up to 20 URLs per call.
 */
export async function extractContent(
  urls: string[],
  opts?: {
    objective?: string;
    sessionId?: string;
  },
): Promise<ExtractResult[]> {
  if (urls.length === 0) return [];

  try {
    const response = await client().extract({
      urls,
      ...(opts?.objective ? { objective: opts.objective } : {}),
      ...(opts?.sessionId ? { session_id: opts.sessionId } : {}),
    });

    return response.results.map((r: any) => ({
      url: r.url,
      title: r.title ?? undefined,
      publish_date: r.publish_date ?? undefined,
      excerpts: r.excerpts ?? [],
    }));
  } catch (err) {
    const msg = `[parallel] extract failed: ${err instanceof Error ? err.message : err}`;
    console.warn(msg);
    log(msg);
    return [];
  }
}
