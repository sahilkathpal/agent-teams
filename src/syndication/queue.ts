import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const QUEUE_PATH = resolve(import.meta.dirname, "../../data/syndication-queue.json");

export interface SyndicationQueueItem {
  article_slug: string;
  ghost_post_id: string;
  canonical_url: string;
  title: string;
  markdown: string;
  tags: string[];
  plan_id: string;
  platforms: string[];
  enqueued_at: string;
}

function readQueue(): SyndicationQueueItem[] {
  if (!existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, "utf-8")) as SyndicationQueueItem[];
  } catch {
    return [];
  }
}

function writeQueue(items: SyndicationQueueItem[]): void {
  writeFileSync(QUEUE_PATH, JSON.stringify(items, null, 2));
}

export function enqueue(item: Omit<SyndicationQueueItem, "enqueued_at">): void {
  const queue = readQueue();

  // Dedup: skip if ghost_post_id already queued
  if (queue.some((q) => q.ghost_post_id === item.ghost_post_id)) {
    console.log(`[syndication-queue] already queued: ${item.article_slug}`);
    return;
  }

  queue.push({ ...item, enqueued_at: new Date().toISOString() });
  writeQueue(queue);
  console.log(`[syndication-queue] enqueued "${item.title}" (queue length: ${queue.length})`);
}

export function dequeue(limit: number): SyndicationQueueItem[] {
  const queue = readQueue();
  if (queue.length === 0) return [];
  const batch = queue.splice(0, limit);
  writeQueue(queue);
  return batch;
}

export function queueLength(): number {
  return readQueue().length;
}

export function peekQueue(): SyndicationQueueItem[] {
  return readQueue();
}
