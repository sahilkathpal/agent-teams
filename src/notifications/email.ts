import { Resend } from "resend";
import type { MetaAgentOutput } from "../models/change-proposal.js";
import type { CitationScorecard } from "../models/citation-scorecard.js";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function confidenceColor(c: string): string {
  switch (c) {
    case "high": return "#16a34a";
    case "medium": return "#ca8a04";
    case "low": return "#dc2626";
    default: return "#6b7280";
  }
}

function renderProposalHtml(output: MetaAgentOutput, scorecard?: CitationScorecard): string {
  const sections: string[] = [];

  // Header
  sections.push(`
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; color: #1f2937;">
      <h1 style="font-size: 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 16px;">
        Meta-Agent Report
      </h1>
      <p style="color: #6b7280; font-size: 13px; margin-bottom: 24px;">
        Run: ${esc(output.run_id)} &middot; ${esc(output.analyzed_at)}
      </p>
  `);

  // GEO Scorecard
  if (scorecard) {
    const engines = Object.entries(scorecard.citations_by_engine)
      .sort(([, a], [, b]) => b - a)
      .map(([engine, count]) => `${esc(engine)}: ${count}`)
      .join(" &middot; ");

    const stars = scorecard.geo_quadrant.filter((q) => q.quadrant === "star").length;
    const orphans = scorecard.geo_quadrant.filter((q) => q.quadrant === "orphan").length;

    sections.push(`
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <h2 style="font-size: 14px; margin: 0 0 12px 0; color: #475569;">GEO Scorecard</h2>
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Coverage</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600;">${scorecard.citation_coverage_pct}% <span style="font-weight: 400; color: #94a3b8;">(${scorecard.prompts_tracked} prompts)</span></td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Share of Voice</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600;">${scorecard.position_weighted_sov}%</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Median Position</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600;">${scorecard.median_citation_position ?? "n/a"}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Articles Cited (7d)</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600;">${scorecard.articles_cited_7d} <span style="font-weight: 400; color: #94a3b8;">(${stars} stars, ${orphans} orphans)</span></td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Engines</td>
            <td style="padding: 4px 0; text-align: right; font-size: 13px;">${engines}</td>
          </tr>
        </table>
      </div>
    `);
  }

  // Strategy Notes
  if (output.strategy_notes.length > 0) {
    sections.push(`
      <h2 style="font-size: 16px; margin-top: 24px;">Strategy Notes</h2>
      <ul style="padding-left: 20px; line-height: 1.6;">
        ${output.strategy_notes.map((n) => `<li>${esc(n)}</li>`).join("\n")}
      </ul>
    `);
  }

  // Proposals
  if (output.proposals.length > 0) {
    sections.push(`<h2 style="font-size: 16px; margin-top: 24px;">Proposals (${output.proposals.length})</h2>`);

    for (const p of output.proposals) {
      const impact = Object.entries(p.expected_impact)
        .map(([k, v]) => `${esc(k)}: ${esc(v)}`)
        .join(", ");

      sections.push(`
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <strong>${esc(p.proposal_id)}</strong>
            <span style="color: ${confidenceColor(p.confidence)}; font-weight: 600; font-size: 13px;">${esc(p.confidence)}</span>
          </div>
          <p style="margin: 4px 0; font-size: 13px; color: #6b7280;">Agent: <strong>${esc(p.agent)}</strong></p>
          <p style="margin: 8px 0;"><strong>Change:</strong> ${esc(p.proposed_change)}</p>
          <p style="margin: 8px 0; font-size: 14px;">${esc(p.reasoning)}</p>
          ${impact ? `<p style="margin: 8px 0; font-size: 13px; color: #6b7280;">Expected impact: ${impact}</p>` : ""}
          <div style="background: #f3f4f6; border-radius: 4px; padding: 8px 12px; margin-top: 12px; font-family: monospace; font-size: 12px; line-height: 1.8;">
            npm run proposals -- --apply ${esc(p.proposal_id)}<br>
            npm run proposals -- --reject ${esc(p.proposal_id)} "reason"
          </div>
        </div>
      `);
    }
  }

  // Learnings & Analysis
  const mu = output.memory_updates;
  const hasInsights = mu.add_insights.length > 0 || mu.update_insights.length > 0 || mu.retire_insights.length > 0;
  const hasHypotheses = mu.add_hypotheses.length > 0 || mu.hypothesis_results.length > 0;

  if (hasInsights || hasHypotheses) {
    sections.push(`<h2 style="font-size: 16px; margin-top: 24px;">Learnings</h2>`);

    if (mu.add_insights.length > 0) {
      sections.push(`<h3 style="font-size: 14px;">New Insights</h3><ul style="padding-left: 20px;">`);
      for (const i of mu.add_insights) {
        const pct = Math.round(i.confidence * 100);
        sections.push(`<li style="margin-bottom: 8px;"><strong>${esc(i.claim)}</strong> <span style="color: #6b7280; font-size: 12px;">(${pct}% confidence)</span><br><span style="font-size: 13px;">${esc(i.evidence)}</span></li>`);
      }
      sections.push(`</ul>`);
    }

    if (mu.update_insights.length > 0) {
      sections.push(`<h3 style="font-size: 14px;">Updated Insights</h3><ul style="padding-left: 20px;">`);
      for (const i of mu.update_insights) {
        const pct = Math.round(i.new_confidence * 100);
        sections.push(`<li style="margin-bottom: 8px;"><strong>${esc(i.claim)}</strong> → ${pct}% confidence${i.new_evidence ? `<br><span style="font-size: 13px;">${esc(i.new_evidence)}</span>` : ""}</li>`);
      }
      sections.push(`</ul>`);
    }

    if (mu.retire_insights.length > 0) {
      sections.push(`<h3 style="font-size: 14px; color: #6b7280;">Retired Insights</h3><ul style="padding-left: 20px;">`);
      for (const i of mu.retire_insights) {
        sections.push(`<li style="margin-bottom: 8px;"><s>${esc(i.claim)}</s><br><span style="font-size: 13px;">${esc(i.reason)}</span></li>`);
      }
      sections.push(`</ul>`);
    }

    if (mu.hypothesis_results.length > 0) {
      sections.push(`<h3 style="font-size: 14px;">Hypothesis Results</h3><ul style="padding-left: 20px;">`);
      for (const h of mu.hypothesis_results) {
        const icon = h.result === "confirmed" ? "&#x2705;" : h.result === "rejected" ? "&#x274C;" : "&#x2753;";
        sections.push(`<li style="margin-bottom: 8px;">${icon} <strong>${esc(h.hypothesis)}</strong> — <em>${esc(h.result)}</em><br><span style="font-size: 13px;">${esc(h.evidence)}</span></li>`);
      }
      sections.push(`</ul>`);
    }

    if (mu.add_hypotheses.length > 0) {
      sections.push(`<h3 style="font-size: 14px;">New Hypotheses Under Test</h3><ul style="padding-left: 20px;">`);
      for (const h of mu.add_hypotheses) {
        sections.push(`<li style="margin-bottom: 8px;"><strong>${esc(h.hypothesis)}</strong><br><span style="font-size: 13px; color: #6b7280;">Test: ${esc(h.test_criteria)} (${h.cycles_needed} cycles)</span></li>`);
      }
      sections.push(`</ul>`);
    }
  }

  // Prompt Curation
  const hasAdds = output.prompt_updates.add.length > 0;
  const hasRetires = output.prompt_updates.retire.length > 0;
  const hasReclusters = output.prompt_updates.recluster.length > 0;

  if (hasAdds || hasRetires || hasReclusters) {
    sections.push(`<h2 style="font-size: 16px; margin-top: 24px;">Prompt Curation</h2>`);

    if (hasAdds) {
      sections.push(`<h3 style="font-size: 14px; color: #16a34a;">Add (${output.prompt_updates.add.length})</h3><ul style="padding-left: 20px;">`);
      for (const p of output.prompt_updates.add) {
        sections.push(`<li style="margin-bottom: 8px;"><strong>"${esc(p.prompt)}"</strong><br><span style="font-size: 13px; color: #6b7280;">Cluster: ${esc(p.cluster)} &middot; Source: ${esc(p.source)} &middot; Volume: ${esc(p.expected_volume)}</span><br><span style="font-size: 13px;">${esc(p.reason)}</span></li>`);
      }
      sections.push(`</ul>`);
    }

    if (hasRetires) {
      sections.push(`<h3 style="font-size: 14px; color: #dc2626;">Retire (${output.prompt_updates.retire.length})</h3><ul style="padding-left: 20px;">`);
      for (const p of output.prompt_updates.retire) {
        sections.push(`<li style="margin-bottom: 8px;"><strong>"${esc(p.prompt)}"</strong><br><span style="font-size: 13px;">${esc(p.reason)}</span></li>`);
      }
      sections.push(`</ul>`);
    }

    if (hasReclusters) {
      sections.push(`<h3 style="font-size: 14px; color: #ca8a04;">Recluster (${output.prompt_updates.recluster.length})</h3><ul style="padding-left: 20px;">`);
      for (const p of output.prompt_updates.recluster) {
        sections.push(`<li style="margin-bottom: 8px;"><strong>"${esc(p.prompt)}"</strong>: ${esc(p.from_cluster ?? "(none)")} → ${esc(p.to_cluster)}<br><span style="font-size: 13px;">${esc(p.reason)}</span></li>`);
      }
      sections.push(`</ul>`);
    }

    sections.push(`
      <div style="background: #f3f4f6; border-radius: 4px; padding: 8px 12px; margin-top: 12px; font-family: monospace; font-size: 12px;">
        npm run proposals -- --apply-prompts
      </div>
    `);
  }

  // Footer
  sections.push(`
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 32px;">
      <p style="font-size: 12px; color: #9ca3af; margin-top: 12px;">
        Run <code>npm run proposals</code> to review all details.
      </p>
    </div>
  `);

  return sections.join("\n");
}

// ── Pipeline report types ───────────────────────────────────────

export interface StageStatus {
  name: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  error?: string;
}

export interface PipelineReport {
  run_id: string;
  duration_ms: number;
  stages: StageStatus[];
  scorecard: CitationScorecard | null;
  scout_summary: { hot_topics: number; rising_tools: number; pain_points: number } | null;
  strategist_summary: { plans_count: number; plans: Array<{ plan_id: string; topic: string; score: number; reasoning?: string }>; strategy_notes?: string[] } | null;
  researcher_summary: { completed: number; failed: number } | null;
  creator_summary: { articles: Array<{ title: string; slug: string; ghost_url?: string }>; failed: number } | null;
  costs: Record<string, number>;
  total_cost_usd: number;
  stage_failures: Array<{ stage: string; error: string }>;
}

function renderPipelineHtml(report: PipelineReport): string {
  const sections: string[] = [];
  const duration = report.duration_ms > 60000
    ? `${Math.round(report.duration_ms / 60000)}m`
    : `${Math.round(report.duration_ms / 1000)}s`;

  sections.push(`
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; color: #1f2937;">
      <h1 style="font-size: 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 16px;">
        Pipeline Run Report
      </h1>
      <p style="color: #6b7280; font-size: 13px; margin-bottom: 24px;">
        Run: ${esc(report.run_id)} &middot; Duration: ${duration} &middot; Cost: $${report.total_cost_usd.toFixed(2)}
      </p>
  `);

  // Pipeline state
  if (report.stages.length > 0) {
    function stageIcon(status: string): string {
      switch (status) {
        case "done": return "&#x2705;";
        case "failed": return "&#x274C;";
        case "running": return "&#x1F504;";
        case "skipped": return "&#x23ED;";
        default: return "&#x23F3;";
      }
    }
    function stageColor(status: string): string {
      switch (status) {
        case "done": return "#16a34a";
        case "failed": return "#dc2626";
        case "running": return "#2563eb";
        case "skipped": return "#94a3b8";
        default: return "#94a3b8";
      }
    }

    sections.push(`
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <h2 style="font-size: 14px; margin: 0 0 12px 0; color: #475569;">Pipeline Stages</h2>
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          ${report.stages.map((s) => `
            <tr>
              <td style="padding: 4px 0; width: 24px;">${stageIcon(s.status)}</td>
              <td style="padding: 4px 0; font-weight: 500;">${esc(s.name)}</td>
              <td style="padding: 4px 0; text-align: right; color: ${stageColor(s.status)}; font-size: 13px;">${esc(s.status)}${s.error ? ` — <span style="color: #dc2626;">${esc(s.error.slice(0, 60))}</span>` : ""}</td>
            </tr>
          `).join("")}
        </table>
      </div>
    `);
  }

  // Scorecard
  if (report.scorecard) {
    const sc = report.scorecard;
    const engines = Object.entries(sc.citations_by_engine)
      .sort(([, a], [, b]) => b - a)
      .map(([engine, count]) => `${esc(engine)}: ${count}`)
      .join(" &middot; ");
    const stars = sc.geo_quadrant.filter((q) => q.quadrant === "star").length;
    const orphans = sc.geo_quadrant.filter((q) => q.quadrant === "orphan").length;

    sections.push(`
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <h2 style="font-size: 14px; margin: 0 0 12px 0; color: #475569;">GEO Scorecard</h2>
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr><td style="padding: 4px 0; color: #64748b;">Coverage</td><td style="padding: 4px 0; text-align: right; font-weight: 600;">${sc.citation_coverage_pct}% <span style="font-weight: 400; color: #94a3b8;">(${sc.prompts_tracked} prompts)</span></td></tr>
          <tr><td style="padding: 4px 0; color: #64748b;">Share of Voice</td><td style="padding: 4px 0; text-align: right; font-weight: 600;">${sc.position_weighted_sov}%</td></tr>
          <tr><td style="padding: 4px 0; color: #64748b;">Median Position</td><td style="padding: 4px 0; text-align: right; font-weight: 600;">${sc.median_citation_position ?? "n/a"}</td></tr>
          <tr><td style="padding: 4px 0; color: #64748b;">Articles Cited (7d)</td><td style="padding: 4px 0; text-align: right; font-weight: 600;">${sc.articles_cited_7d} <span style="font-weight: 400; color: #94a3b8;">(${stars} stars, ${orphans} orphans)</span></td></tr>
          <tr><td style="padding: 4px 0; color: #64748b;">Engines</td><td style="padding: 4px 0; text-align: right; font-size: 13px;">${engines}</td></tr>
        </table>
      </div>
    `);
  }

  // Scout
  if (report.scout_summary) {
    const s = report.scout_summary;
    sections.push(`
      <h2 style="font-size: 16px; margin-top: 24px;">Scout</h2>
      <p style="font-size: 14px;">${s.hot_topics} hot topics, ${s.rising_tools} rising tools, ${s.pain_points} pain points</p>
    `);
  }

  // Strategist
  if (report.strategist_summary) {
    const strat = report.strategist_summary;

    // Strategy notes — high-level reasoning
    if (strat.strategy_notes && strat.strategy_notes.length > 0) {
      sections.push(`<h2 style="font-size: 16px; margin-top: 24px;">Strategist Reasoning</h2>`);
      sections.push(`<ul style="padding-left: 20px; font-size: 14px; color: #374151;">`);
      for (const note of strat.strategy_notes) {
        sections.push(`<li style="margin-bottom: 8px;">${esc(note)}</li>`);
      }
      sections.push(`</ul>`);
    }

    // Per-plan table with reasoning
    sections.push(`<h2 style="font-size: 16px; margin-top: 24px;">Content Plans (${strat.plans_count})</h2>`);
    for (const p of strat.plans) {
      sections.push(`
        <div style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 14px;">${esc(p.plan_id)}</strong>
            <span style="font-size: 13px; color: #6b7280;">${esc(p.topic)} · <strong>${p.score}/50</strong></span>
          </div>
          ${p.reasoning ? `<p style="font-size: 13px; color: #4b5563; margin: 6px 0 0 0;">${esc(p.reasoning)}</p>` : ""}
        </div>
      `);
    }
  }

  // Researcher
  if (report.researcher_summary) {
    const r = report.researcher_summary;
    sections.push(`
      <h2 style="font-size: 16px; margin-top: 24px;">Research</h2>
      <p style="font-size: 14px;">${r.completed} briefs completed${r.failed > 0 ? `, <span style="color: #dc2626;">${r.failed} failed</span>` : ""}</p>
    `);
  }

  // Creator
  if (report.creator_summary) {
    const c = report.creator_summary;
    if (c.articles.length > 0) {
      sections.push(`<h2 style="font-size: 16px; margin-top: 24px;">Articles Created (${c.articles.length})</h2><ul style="padding-left: 20px;">`);
      for (const a of c.articles) {
        const link = a.ghost_url ? `<a href="${esc(a.ghost_url)}" style="color: #2563eb;">${esc(a.title)}</a>` : esc(a.title);
        sections.push(`<li style="margin-bottom: 6px;">${link} <span style="color: #94a3b8; font-size: 13px;">(${esc(a.slug)})</span></li>`);
      }
      sections.push(`</ul>`);
    }
    if (c.failed > 0) {
      sections.push(`<p style="color: #dc2626; font-size: 14px;">${c.failed} creator(s) failed</p>`);
    }
  }

  // Costs
  const costEntries = Object.entries(report.costs).filter(([, v]) => v > 0);
  if (costEntries.length > 0) {
    sections.push(`<h2 style="font-size: 16px; margin-top: 24px;">Costs</h2>`);
    sections.push(`<table style="width: 100%; font-size: 14px; border-collapse: collapse;">`);
    for (const [agent, cost] of costEntries.sort(([, a], [, b]) => b - a)) {
      sections.push(`<tr style="border-bottom: 1px solid #f3f4f6;"><td style="padding: 4px 0;">${esc(agent)}</td><td style="padding: 4px 0; text-align: right; font-family: monospace;">$${cost.toFixed(4)}</td></tr>`);
    }
    sections.push(`<tr style="border-top: 2px solid #e5e7eb;"><td style="padding: 6px 0; font-weight: 600;">Total</td><td style="padding: 6px 0; text-align: right; font-family: monospace; font-weight: 600;">$${report.total_cost_usd.toFixed(4)}</td></tr>`);
    sections.push(`</table>`);
  }

  // Failures
  if (report.stage_failures.length > 0) {
    sections.push(`<h2 style="font-size: 16px; margin-top: 24px; color: #dc2626;">Failures</h2><ul style="padding-left: 20px;">`);
    for (const f of report.stage_failures) {
      sections.push(`<li style="margin-bottom: 6px;"><strong>${esc(f.stage)}</strong>: ${esc(f.error)}</li>`);
    }
    sections.push(`</ul>`);
  }

  sections.push(`
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 32px;">
      <p style="font-size: 12px; color: #9ca3af; margin-top: 12px;">
        Run directory: data/runs/${esc(report.run_id)}
      </p>
    </div>
  `);

  return sections.join("\n");
}

export async function sendPipelineReport(report: PipelineReport): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;

  if (!apiKey || !to) return;

  const from = process.env.NOTIFY_FROM ?? "onboarding@resend.dev";
  const resend = new Resend(apiKey);
  const html = renderPipelineHtml(report);

  const articleCount = report.creator_summary?.articles.length ?? 0;
  const subject = `[Agent Teams] Run complete — ${articleCount} article(s), $${report.total_cost_usd.toFixed(2)} — ${report.run_id}`;

  try {
    await resend.emails.send({ from, to, subject, html });
    console.log(`  [email] Pipeline report sent to ${to}`);
  } catch (err) {
    console.warn(`  [email] Failed to send: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function sendProposalEmail(output: MetaAgentOutput, scorecard?: CitationScorecard): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;

  if (!apiKey || !to) {
    return;
  }

  const from = process.env.NOTIFY_FROM ?? "onboarding@resend.dev";
  const resend = new Resend(apiKey);
  const html = renderProposalHtml(output, scorecard);

  const parts: string[] = [];
  if (output.proposals.length > 0) parts.push(`${output.proposals.length} proposal(s)`);
  if (output.prompt_updates.add.length > 0) parts.push(`${output.prompt_updates.add.length} prompt add(s)`);
  if (output.prompt_updates.retire.length > 0) parts.push(`${output.prompt_updates.retire.length} retire(s)`);
  const insightCount = output.memory_updates.add_insights.length + output.memory_updates.update_insights.length;
  if (insightCount > 0 && parts.length === 0) parts.push(`${insightCount} insight(s)`);
  if (output.memory_updates.hypothesis_results.length > 0) parts.push(`${output.memory_updates.hypothesis_results.length} hypothesis result(s)`);
  const summary = parts.length > 0 ? parts.join(", ") : "status update";

  const subject = `[Agent Teams] ${summary} — ${output.run_id}`;

  try {
    await resend.emails.send({ from, to, subject, html });
    console.log(`  [email] Proposal summary sent to ${to}`);
  } catch (err) {
    console.warn(`  [email] Failed to send: ${err instanceof Error ? err.message : String(err)}`);
  }
}
