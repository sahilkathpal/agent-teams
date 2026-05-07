# Agent Teams: System Overview

A self-improving multi-agent system for GEO (Generative Engine Optimization) content. The system produces content, measures whether that content gets cited by AI search engines, and continuously improves itself based on what it learns.

---

## What the System Does

It runs a content pipeline on a recurring cycle. Each cycle: discover trending topics, decide what to write, research it, write and publish it, then measure whether the published content earns citations in AI search engines (ChatGPT, Perplexity, Google AI, Copilot). Over time, a meta-agent observes the accumulated evidence and improves the agents responsible for producing the content.

---

## Agents

An agent is the combination of four things:

- **A prompt** — its instructions, persona, and reasoning style
- **A tool grant** — which capabilities it's allowed to invoke
- **An output schema** — the typed structure it must produce
- **A version** — so every change is tracked and attributable

Agents are either LLM-powered (they reason and decide) or deterministic (they execute fixed logic). Both are first-class citizens in the pipeline.

### Tool Architecture

Tools are defined as typed contracts — a name, a description, and an input schema. When an agent calls a tool, the runner dispatches the call directly to the underlying API or function and returns a structured result. There are no intermediate bash subprocesses or CLI wrappers unless a tool genuinely requires shell execution (e.g. a content validator running external checks). The agent sees clean typed I/O, not serialized strings.

---

## The Content Pipeline

Five agents run in a fixed topology each cycle:

**Monitor** and **Scout** run in parallel to open the cycle:
- Monitor ingests fresh citation data from Otterly — which of our articles are being cited, by which engines, at what positions
- Scout searches HN, Reddit, and the web for trending topics in the target domain

**Strategist** takes the scorecard (from Monitor) and the trend signals (from Scout) and decides what to write — which topics, which angles, which distribution targets. It is aware of citation gaps: topics we should be ranking for but aren't.

**Researcher** investigates each content plan. It has real tool access and drives its own investigation — deciding which sources to query, whether to go deeper on a particular thread, which URLs to extract. It produces a research brief: signals, findings, quotable evidence, competitor content.

**Creator** writes and publishes. It produces GEO-optimized content, validates it, publishes to Ghost, and syndicates to distribution channels.

Every run is timestamped, state is persisted per stage, and failed runs can be resumed.

---

## Closing the Loop: Traces and Outcomes

**Traces** are the connective tissue between actions and outcomes. Every pipeline run records which agent versions produced which articles. When an article earns a citation, the trace tells you exactly which Scout version, Strategist version, Researcher version, and Creator version were responsible.

**Outcomes** are measured by the Scorer — a deterministic component that ingests citation data and computes a scorecard: citation coverage, position, share of voice (position-weighted), per-cluster performance, GEO quadrant per article. The scorecard is the objective signal.

**Attribution** is the result of joining traces to outcomes: version A of the Creator correlated with better citation rates than version B. This is what makes improvement systematic rather than intuitive.

---

## The Meta-Agent

The meta-agent is an observer. It has no tools and takes no direct actions. Its job is to read the accumulated evidence — scorecards over time, traces, agent version history, its own working memory — and produce two things:

**Proposals**: structured recommendations to change a specific agent's prompt, with reasoning, confidence, and expected impact. Once approved, a proposal is applied by intelligently editing the prompt (not appending), bumping the agent version, and recording the change.

**Working memory updates**: the meta-agent maintains persistent memory across cycles:
- *Insights* — claims with confidence scores, evidence, and expiry (confidence decays if not reconfirmed)
- *Hypotheses* — ideas under active test, with criteria and cycles remaining
- *Watch list* — signals and thresholds that should trigger action
- *Applied changes* — a record of what was changed, what was expected, and what was actually observed

**Reports**: periodic human-readable narratives of what the meta-agent is seeing — trend analysis, hypothesis results, areas of uncertainty. Not just proposals, but legible reasoning.

The meta-agent never self-approves. Changes require human sign-off. This is a policy choice: the loop is mechanically closeable, but human oversight is intentional for this version.

---

## The Two Loops

```
CONTENT LOOP (each cycle)
  Monitor + Scout → Strategist → Researcher → Creator → Publish
       ↓
  Citations ingested from search engines
       ↓
  Scorer computes scorecard
       ↓
  Trace links run → agent versions → articles → citations

LEARNING LOOP (periodic)
  Meta-agent reads: scorecards + traces + version history + working memory
       ↓
  Produces: proposals + memory updates + report
       ↓
  Human approves proposals
       ↓
  Prompts edited, versions bumped, changes recorded
       ↓
  Next content loop runs with updated agents
```

Each loop feeds the other. The content loop generates evidence. The learning loop turns evidence into improvement. The trace layer is what makes the connection between them precise rather than anecdotal.

---

## Design Principles

**Observable by default.** Every run is traced. Every agent change is versioned. Outcomes are measured, not estimated.

**Agents own their investigation.** Tool-calling agents decide how to use their tools — the system does not hardcode their search strategy. The output schema enforces what comes out; what happens inside is the agent's judgment.

**Improvement is systematic, not vibes.** The meta-agent has evidence, not opinions. Proposals cite the data behind them. Applied changes track expected vs. actual impact.

**Human in the loop by policy, not necessity.** The infrastructure supports full automation. The approval gate is a deliberate choice for this version.
