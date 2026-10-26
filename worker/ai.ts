/**
 * Workers AI embedding + hybrid search.
 *
 * Uses @cf/baai/bge-m3 (1024-dim, multilingual incl. Traditional Chinese).
 * Free tier: 10,000 neurons/day.
 */

import { keywordSearch } from "./fts";

export const EMBEDDING_MODEL = "@cf/baai/bge-m3";

export interface SearchResult {
  id: string;
  title: string;
  snippet?: string;
  score: number;
  source: "keyword" | "semantic" | "hybrid";
}

/**
 * Generate embedding for text using Workers AI.
 * Returns null if AI binding is not available or fails.
 */
export async function generateEmbedding(env: Env, text: string): Promise<number[] | null> {
  if (!env.AI) {
    return null;
  }

  try {
    // Truncate to stay within model context limits.
    const truncated = text.slice(0, 4000);
    const response = await env.AI.run(EMBEDDING_MODEL, { text: truncated });

    // Workers AI returns { data: number[][] } (batch) — take the first vector.
    const raw = (response as any)?.data;
    let vector: number[] | null = null;
    if (Array.isArray(raw)) {
      if (Array.isArray(raw[0])) vector = raw[0] as number[];
      else if (typeof raw[0] === "number") vector = raw as number[];
    }
    if (!vector || vector.length === 0) {
      console.error("[ai] Unexpected embedding shape:", JSON.stringify(response).slice(0, 200));
      return null;
    }
    return vector;
  } catch (err) {
    console.error("[ai] Embedding generation failed:", err);
    return null;
  }
}

/**
 * Store embedding vector for a note.
 */
export async function storeEmbedding(
  db: D1Database,
  noteId: string,
  vector: number[],
  model: string,
): Promise<void> {
  const ts = Date.now();
  await db
    .prepare(
      `INSERT INTO note_embeddings (note_id, vector, model, dimensions, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(note_id) DO UPDATE SET vector = excluded.vector, model = excluded.model, updated_at = excluded.updated_at`,
    )
    .bind(noteId, JSON.stringify(vector), model, vector.length, ts)
    .run();
}

/**
 * Get embedding for a note.
 */
export async function getEmbedding(
  db: D1Database,
  noteId: string,
): Promise<{ vector: number[]; model: string } | null> {
  const row = await db
    .prepare(`SELECT vector, model FROM note_embeddings WHERE note_id = ?1`)
    .bind(noteId)
    .first<{ vector: string; model: string }>();

  if (!row) return null;

  try {
    return { vector: JSON.parse(row.vector), model: row.model };
  } catch {
    return null;
  }
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Get all embeddings for an account.
 */
export async function getAccountEmbeddings(
  db: D1Database,
  accountId: string,
): Promise<Array<{ note_id: string; vector: number[] }>> {
  const { results } = await db
    .prepare(
      `SELECT ne.note_id, ne.vector
         FROM note_embeddings ne
         JOIN notes n ON n.id = ne.note_id
        WHERE n.account_id = ?1 AND n.deleted_at IS NULL`,
    )
    .bind(accountId)
    .all<{ note_id: string; vector: string }>();

  return (results ?? [])
    .map((r) => {
      try {
        return { note_id: r.note_id, vector: JSON.parse(r.vector) };
      } catch {
        return null;
      }
    })
    .filter((r): r is { note_id: string; vector: number[] } => r !== null);
}

/**
 * Semantic search: find notes most similar to query embedding.
 */
export async function semanticSearch(
  db: D1Database,
  queryEmbedding: number[],
  accountId: string,
  limit: number,
): Promise<SearchResult[]> {
  const embeddings = await getAccountEmbeddings(db, accountId);

  // Compute cosine similarity for each note.
  const scored = embeddings
    .map((e) => ({
      note_id: e.note_id,
      score: cosineSimilarity(queryEmbedding, e.vector),
    }))
    .filter((s) => s.score > 0.1) // threshold to filter noise
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Fetch note details.
  const results: SearchResult[] = [];
  for (const s of scored) {
    const note = await db
      .prepare(`SELECT id, title FROM notes WHERE id = ?1`)
      .bind(s.note_id)
      .first<{ id: string; title: string }>();

    if (note) {
      results.push({
        id: note.id,
        title: note.title,
        score: s.score,
        source: "semantic",
      });
    }
  }

  return results;
}

/**
 * Hybrid search: combine keyword (FTS5) and semantic results using RRF.
 */
export async function hybridSearch(
  db: D1Database,
  env: Env,
  query: string,
  accountId: string,
  limit: number = 20,
): Promise<SearchResult[]> {
  const k = 60; // RRF constant

  // Get keyword results (shared, injection-safe, CJK-aware; see worker/fts.ts).
  const snippets = new Map<string, string>();
  const hits = await keywordSearch(db, accountId, query, limit);
  const keywordResults: SearchResult[] = hits.map((r, i) => {
    if (r.snippet) snippets.set(r.id, r.snippet);
    return {
      id: r.id,
      title: r.title,
      snippet: r.snippet ?? undefined,
      score: 1 / (k + i + 1),
      source: "keyword" as const,
    };
  });

  // Get semantic results (if AI available).
  let semanticResults: SearchResult[] = [];
  if (env.AI) {
    const queryEmbedding = await generateEmbedding(env, query);
    if (queryEmbedding) {
      semanticResults = await semanticSearch(db, queryEmbedding, accountId, limit);
      // Apply RRF scoring.
      semanticResults = semanticResults.map((r, i) => ({
        ...r,
        score: 1 / (k + i + 1),
      }));
    }
  }

  // Merge with RRF.
  const scores = new Map<string, { score: number; sources: Set<string> }>();

  for (const r of keywordResults) {
    const existing = scores.get(r.id);
    if (existing) {
      existing.score += r.score;
      existing.sources.add("keyword");
    } else {
      scores.set(r.id, { score: r.score, sources: new Set(["keyword"]) });
    }
  }

  for (const r of semanticResults) {
    const existing = scores.get(r.id);
    if (existing) {
      existing.score += r.score;
      existing.sources.add("semantic");
    } else {
      scores.set(r.id, { score: r.score, sources: new Set(["semantic"]) });
    }
  }

  // Sort by combined score and fetch full details.
  const sorted = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit);

  const finalResults: SearchResult[] = [];
  for (const [id, data] of sorted) {
    const note = await db
      .prepare(`SELECT id, title FROM notes WHERE id = ?1`)
      .bind(id)
      .first<{ id: string; title: string }>();

    if (note) {
      finalResults.push({
        id: note.id,
        title: note.title,
        snippet: snippets.get(id),
        score: data.score,
        source: data.sources.size > 1 ? "hybrid" : (data.sources.has("keyword") ? "keyword" : "semantic"),
      });
    }
  }

  return finalResults;
}
