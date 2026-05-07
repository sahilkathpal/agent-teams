import { writeFileSync } from "node:fs";
import type { DistributionReport, SyndicationResult, PlaybookItem } from "../models/distribution-report.js";
import type { DistributionPlaybook } from "../models/content-plan.js";
import type { ContentDraft } from "../models/content-draft.js";
import "dotenv/config";

// ── Dev.to syndication ──────────────────────────────────────────────

export async function syndicateToDevto(opts: {
  title: string;
  markdown: string;
  canonicalUrl: string;
  tags: string[];
  description: string;
}): Promise<SyndicationResult> {
  const apiKey = process.env.DEVTO_API_KEY;
  if (!apiKey) {
    return { platform: "devto", url: "", published_at: "", status: "failed", error: "DEVTO_API_KEY not set" };
  }

  try {
    const response = await fetch("https://dev.to/api/articles", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        article: {
          title: opts.title,
          body_markdown: opts.markdown,
          published: true,
          tags: opts.tags.slice(0, 4).join(","),
          canonical_url: opts.canonicalUrl,
          description: opts.description,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { platform: "devto", url: "", published_at: "", status: "failed", error: `${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = (await response.json()) as { id: number; url: string };
    console.log(`  Dev.to published: ${data.url}`);
    return { platform: "devto", url: data.url, published_at: new Date().toISOString(), status: "published" };
  } catch (err) {
    return { platform: "devto", url: "", published_at: "", status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Hashnode syndication ────────────────────────────────────────────

export async function syndicateToHashnode(opts: {
  title: string;
  markdown: string;
  canonicalUrl: string;
  tags: string[];
}): Promise<SyndicationResult> {
  const pat = process.env.HASHNODE_PAT;
  const pubId = process.env.HASHNODE_PUBLICATION_ID;

  if (!pat || !pubId) {
    return { platform: "hashnode", url: "", published_at: "", status: "failed", error: "HASHNODE_PAT or HASHNODE_PUBLICATION_ID not set" };
  }

  const slug = opts.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 250);

  const mutation = `
    mutation PublishPost($input: PublishPostInput!) {
      publishPost(input: $input) {
        post { id title slug url }
      }
    }
  `;

  const variables = {
    input: {
      title: opts.title,
      contentMarkdown: opts.markdown,
      publicationId: pubId,
      slug,
      originalArticleURL: opts.canonicalUrl,
      tags: opts.tags.slice(0, 5).map((t) => ({
        slug: t.toLowerCase().replace(/\s+/g, "-"),
        name: t,
      })),
    },
  };

  try {
    const response = await fetch("https://gql.hashnode.com", {
      method: "POST",
      headers: {
        Authorization: pat,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: mutation, variables }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { platform: "hashnode", url: "", published_at: "", status: "failed", error: `${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = (await response.json()) as {
      data?: { publishPost?: { post?: { url: string } } };
      errors?: Array<{ message: string }>;
    };

    if (data.errors?.length) {
      return { platform: "hashnode", url: "", published_at: "", status: "failed", error: data.errors[0].message };
    }

    const postUrl = data.data?.publishPost?.post?.url ?? "";
    console.log(`  Hashnode published: ${postUrl}`);
    return { platform: "hashnode", url: postUrl, published_at: new Date().toISOString(), status: "published" };
  } catch (err) {
    return { platform: "hashnode", url: "", published_at: "", status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Distributor agent ───────────────────────────────────────────────

/**
 * Distributor agent — handles syndication to Dev.to/Hashnode and
 * outputs human playbook items for manual distribution channels.
 */
export async function runDistributor(opts: {
  draft: ContentDraft;
  canonicalUrl: string;
  playbook: DistributionPlaybook;
  outPath: string;
}): Promise<DistributionReport> {
  console.log(`[distributor] Distributing: "${opts.draft.title}"`);

  const syndicationResults: SyndicationResult[] = [];

  // Run syndication targets (legacy: playbook may have syndication_targets from old schema)
  const syndicationTargets = (opts.playbook as Record<string, unknown>).syndication_targets as Array<{ platform: string; type?: string }> ?? [];
  for (const target of syndicationTargets) {
    if (target.type !== "syndication") continue;

    const platform = target.platform.toLowerCase();
    console.log(`  Syndicating to ${platform}...`);

    const tags = opts.draft.geo_targets
      .slice(0, 4)
      .map((t) => t.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20));

    if (platform === "devto" || platform === "dev.to") {
      const result = await syndicateToDevto({
        title: opts.draft.title,
        markdown: opts.draft.markdown,
        canonicalUrl: opts.canonicalUrl,
        tags,
        description: opts.draft.meta_description,
      });
      syndicationResults.push(result);
    } else if (platform === "hashnode") {
      const result = await syndicateToHashnode({
        title: opts.draft.title,
        markdown: opts.draft.markdown,
        canonicalUrl: opts.canonicalUrl,
        tags,
      });
      syndicationResults.push(result);
    } else {
      console.log(`    Skipping unknown syndication platform: ${platform}`);
    }
  }

  // Build manual playbook items (legacy: playbook may have manual_playbook from old schema)
  const manualTargets = (opts.playbook as Record<string, unknown>).manual_playbook as Array<Record<string, unknown>> ?? [];
  const manualPlaybook: PlaybookItem[] = manualTargets.map((target) => ({
    platform: String(target.platform ?? ""),
    action: String(target.action || target.format || ""),
    target_url: undefined,
    talking_points: (target.talking_points as string[] | undefined) || (target.reason ? [String(target.reason)] : []),
    priority: (["high", "medium", "low"].includes(String(target.priority ?? "")) ? target.priority : "medium") as "high" | "medium" | "low",
    status: "pending" as const,
  }));

  const report: DistributionReport = {
    plan_id: opts.draft.plan_id,
    canonical_url: opts.canonicalUrl,
    syndication_results: syndicationResults,
    manual_playbook: manualPlaybook,
    distributed_at: new Date().toISOString(),
  };

  const published = syndicationResults.filter((r) => r.status === "published").length;
  const failed = syndicationResults.filter((r) => r.status === "failed").length;
  console.log(`  Syndication: ${published} published, ${failed} failed`);
  console.log(`  Manual playbook: ${manualPlaybook.length} items`);

  writeFileSync(opts.outPath, JSON.stringify(report, null, 2));
  return report;
}
