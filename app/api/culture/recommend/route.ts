/**
 * GET /api/culture/recommend
 *
 * Personalized trend recommendations based on Action's team feedback.
 * For trends marked feedback_useful >= 1 (the team's "yes, this is
 * relevant" votes), compute the centroid embedding. Then surface
 * unflagged active trends closest to that centroid via cosine.
 *
 * "You liked X — these other trends sit in the same conceptual space"
 */

import { NextResponse } from 'next/server'
import { sql } from '@/lib/culture-db'
import { cosineSimilarity } from '@/lib/trend-embeddings'

export const maxDuration = 30

interface Row {
  id: string; name: string; slug: string; description: string
  embedding: number[]
  feedback_useful: number
  feedback_generic: number
  growth_score: number | null
  vibe: string | null
  subculture: string | null
}

export async function GET() {
  await sql().query(`ALTER TABLE culture_trends ADD COLUMN IF NOT EXISTS embedding JSONB`)

  const rows = (await sql().query(
    `SELECT id, name, slug, description, embedding, feedback_useful, feedback_generic,
            growth_score, vibe, subculture
       FROM culture_trends
      WHERE status = 'active'
        AND embedding IS NOT NULL
        AND (verify_verdict IS NULL OR verify_verdict != 'fabricated')
      LIMIT 1000`,
  )) as Row[]

  // Liked = useful feedback > generic feedback AND >= 1 useful vote
  const liked = rows.filter((r) => (r.feedback_useful ?? 0) >= 1 && (r.feedback_useful ?? 0) > (r.feedback_generic ?? 0))
  const disliked = rows.filter((r) => (r.feedback_generic ?? 0) >= 1 && (r.feedback_generic ?? 0) > (r.feedback_useful ?? 0))
  const unrated = rows.filter((r) => (r.feedback_useful ?? 0) === 0 && (r.feedback_generic ?? 0) === 0)

  if (liked.length === 0) {
    return NextResponse.json({
      ok: true,
      message: 'No feedback signal yet. Mark trends as 👍 useful in the dashboard to seed recommendations.',
      likedCount: 0,
      recommendations: [],
    })
  }

  // Compute centroids: liked centroid + disliked centroid
  const dim = liked[0].embedding.length
  const likedCentroid = new Array(dim).fill(0)
  for (const l of liked) for (let i = 0; i < dim; i++) likedCentroid[i] += l.embedding[i]
  for (let i = 0; i < dim; i++) likedCentroid[i] /= liked.length

  let dislikedCentroid: number[] | null = null
  if (disliked.length > 0) {
    dislikedCentroid = new Array(dim).fill(0)
    for (const l of disliked) for (let i = 0; i < dim; i++) dislikedCentroid![i] += l.embedding[i]
    for (let i = 0; i < dim; i++) dislikedCentroid![i] /= disliked.length
  }

  // Score unrated by similarity to liked centroid - similarity to disliked centroid
  const scored = unrated.map((u) => {
    const simLiked = cosineSimilarity(u.embedding, likedCentroid)
    const simDisliked = dislikedCentroid ? cosineSimilarity(u.embedding, dislikedCentroid) : 0
    const score = simLiked - simDisliked * 0.5  // dislike penalty weight
    return { ...u, simLiked, simDisliked, score }
  })
  .sort((a, b) => b.score - a.score)
  .slice(0, 20)

  return NextResponse.json({
    ok: true,
    likedCount: liked.length,
    dislikedCount: disliked.length,
    unratedConsidered: unrated.length,
    recommendations: scored.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description.slice(0, 200),
      similarity: Math.round(r.simLiked * 1000) / 1000,
      score: Math.round(r.score * 1000) / 1000,
      growth: r.growth_score == null ? null : Number(r.growth_score),
      vibe: r.vibe,
      subculture: r.subculture,
    })),
    seedExamples: liked.slice(0, 5).map((l) => l.name),
  })
}
