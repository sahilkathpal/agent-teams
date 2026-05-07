import { getDb, recordTrace } from "../db/helpers.js";

/**
 * Record a trace linking a pipeline run to the agent versions that produced it.
 */
export function recordPipelineTrace(opts: {
  runId: string;
  articleSlug?: string;
  topicId?: string;
  agentVersions: Record<string, string>;
}): string {
  const traceId = opts.articleSlug
    ? `${opts.runId}__${opts.articleSlug}`
    : opts.runId;

  recordTrace({
    trace_id: traceId,
    run_id: opts.runId,
    article_slug: opts.articleSlug,
    topic_id: opts.topicId,
    agent_versions: opts.agentVersions,
  });

  console.log(`  [trace] Recorded trace ${traceId}`);
  return traceId;
}

/**
 * Get all traces for a specific run.
 */
export function getRunTraces(runId: string): Array<{
  trace_id: string;
  article_slug: string | null;
  topic_id: string | null;
  agent_versions: Record<string, string>;
  created_at: string;
}> {
  const db = getDb();
  const rows = db.prepare(
    "SELECT trace_id, article_slug, topic_id, agent_versions, created_at FROM traces WHERE run_id = ?",
  ).all(runId) as Array<{
    trace_id: string;
    article_slug: string | null;
    topic_id: string | null;
    agent_versions: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    ...r,
    agent_versions: JSON.parse(r.agent_versions) as Record<string, string>,
  }));
}

/**
 * Get the trace for a specific article — tells you which agent versions produced it.
 */
export function getArticleTrace(articleSlug: string): {
  trace_id: string;
  run_id: string;
  agent_versions: Record<string, string>;
  created_at: string;
} | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT trace_id, run_id, agent_versions, created_at FROM traces WHERE article_slug = ? ORDER BY created_at DESC LIMIT 1",
  ).get(articleSlug) as {
    trace_id: string;
    run_id: string;
    agent_versions: string;
    created_at: string;
  } | undefined;

  if (!row) return null;
  return {
    ...row,
    agent_versions: JSON.parse(row.agent_versions) as Record<string, string>,
  };
}

/**
 * Get all traces with their articles and versions — for meta-agent analysis.
 */
export function getAllTraces(): Array<{
  trace_id: string;
  run_id: string;
  article_slug: string | null;
  topic_id: string | null;
  agent_versions: Record<string, string>;
  created_at: string;
}> {
  const db = getDb();
  const rows = db.prepare(
    "SELECT trace_id, run_id, article_slug, topic_id, agent_versions, created_at FROM traces ORDER BY created_at DESC",
  ).all() as Array<{
    trace_id: string;
    run_id: string;
    article_slug: string | null;
    topic_id: string | null;
    agent_versions: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    ...r,
    agent_versions: JSON.parse(r.agent_versions) as Record<string, string>,
  }));
}
