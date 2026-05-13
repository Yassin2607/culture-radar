'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'

interface Cluster {
  size: number
  avgPopularity: number
  avgGrowth: number
  dominantSubculture: string | null
  dominantVibe: string | null
  label?: string | null
  summary?: string | null
  members: Array<{ id: string; name: string; description: string }>
}

interface ClusterResp { ok: boolean; embeddedTotal: number; k: number; clusters: Cluster[] }

interface SubcultureTraj {
  subculture: string
  thisWeek: { count: number; avgGrowth: number }
  lastWeek: { count: number; avgGrowth: number }
  delta: number
  growthDelta: number
  trajectory: 'rising' | 'fading' | 'stable' | 'new' | 'gone'
  topTrends: string[]
}

interface SourceHealth {
  sourceName: string
  counts: { real: number; generic: number; fabricated: number; uncertain: number; unverified: number; total: number }
  realPct: number | null
  fakePct: number | null
  healthGrade: 'A' | 'B' | 'C' | 'D' | 'F'
}

interface CrossPlatformResp {
  totalAnalyzed: number
  byPlatform: Record<string, number>
  platformPairs: Array<{ pair: string; count: number }>
  multiPlatformTrends: Array<{ id: string; slug: string; name: string; platforms: string[]; platformCount: number; growth: number | null }>
  newsletterOnly: Array<{ id: string; slug: string; name: string; firstSeenAt: string }>
}

interface AnomalySpike {
  trendId: string; slug: string; name: string
  kind: 'spike' | 'freshman'
  current: number; baseline: number | null; delta: number | null; snapshots: number
  vibe: string | null; subculture: string | null; growth: number | null
}

interface Recommendation {
  id: string; slug: string; name: string; description: string
  similarity: number; score: number
  growth: number | null; vibe: string | null; subculture: string | null
}

interface ReverseDiscoverMatch {
  id: string; slug: string; name: string; description: string
  category: string; popularity: number; growth: number | null
  lifecycleStage: string | null; vibe: string | null; subculture: string | null
  actionAngle: string | null; actionRelevance: string | null
  productCategories: string[]; fitScore: number; compositeScore: number
}

export default function InsightsPage() {
  const [clusters, setClusters] = useState<ClusterResp | null>(null)
  const [subcultures, setSubcultures] = useState<SubcultureTraj[]>([])
  const [sources, setSources] = useState<SourceHealth[]>([])
  const [crossPlatform, setCrossPlatform] = useState<CrossPlatformResp | null>(null)
  const [anomalies, setAnomalies] = useState<AnomalySpike[]>([])
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [recoSeeds, setRecoSeeds] = useState<string[]>([])
  const [recoLikedCount, setRecoLikedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  // Reverse discovery state
  const [rdQuery, setRdQuery] = useState('')
  const [rdMatches, setRdMatches] = useState<ReverseDiscoverMatch[]>([])
  const [rdLoading, setRdLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      apiFetch('/api/culture/clusters?k=12&freshOnly=1').then((r) => r.json()),
      apiFetch('/api/culture/subculture-trajectory').then((r) => r.json()),
      apiFetch('/api/culture/source-health').then((r) => r.json()),
      apiFetch('/api/culture/cross-platform-velocity').then((r) => r.json()),
      apiFetch('/api/culture/anomalies').then((r) => r.json()),
      apiFetch('/api/culture/recommend').then((r) => r.json()),
    ]).then(([c, s, src, cp, an, rec]) => {
      setClusters(c)
      setSubcultures(s.subcultures ?? [])
      setSources(src.sources ?? [])
      setCrossPlatform(cp)
      setAnomalies(an.spikes ?? [])
      setRecommendations(rec.recommendations ?? [])
      setRecoSeeds(rec.seedExamples ?? [])
      setRecoLikedCount(rec.likedCount ?? 0)
      setLoading(false)
    }).catch((e) => {
      console.error(e); setLoading(false)
    })
  }, [])

  async function runReverseDiscover() {
    if (!rdQuery.trim()) return
    setRdLoading(true)
    try {
      const r = await apiFetch('/api/culture/reverse-discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: rdQuery.trim(), limit: 16 }),
      })
      const d = await r.json()
      setRdMatches(d.matches ?? [])
    } finally {
      setRdLoading(false)
    }
  }

  return (
    <div className="jai-app" style={{ minHeight: '100vh' }}>
      <div style={{ background: '#000', color: '#FFFDF3', padding: '32px 40px 20px' }}>
        <p>
          <Link href="/culture-radar" style={{ color: '#FF1300', textDecoration: 'none', fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.15em' }}>← CULTURE RADAR</Link>
        </p>
        <h1 style={{ margin: '12px 0 0', fontFamily: 'var(--font-jai-display)', fontSize: 48, lineHeight: 0.95, textTransform: 'uppercase', letterSpacing: '-0.025em' }}>
          Insights<span style={{ color: '#FF1300' }}>.</span>
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.7 }}>
          Meta-patterns in the trend data: emerging clusters, rising/fading subcultures, source health.
        </p>
      </div>
      <div style={{ height: 6, background: '#FF1300' }} />

      <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto' }}>
        {loading ? (
          <p className="jai-mono-label" style={{ color: '#FF1300' }}>Loading insights…</p>
        ) : (
          <>
            {/* Anomalies: sudden spikes */}
            {anomalies.length > 0 && (
              <Section title="Sudden spikes" subtitle="Trends whose popularity just jumped vs their 3-day baseline. 'Something popped overnight' early-warning.">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                  {anomalies.slice(0, 12).map((a) => (
                    <a key={a.trendId} href={`/culture-radar/trends/${a.slug}`} style={{ textDecoration: 'none' }}>
                      <div className="jai-card" style={{ padding: 12, background: a.kind === 'spike' ? '#000' : '#FFE4E0', color: a.kind === 'spike' ? '#FFFDF3' : '#000', border: '1px solid #FF1300', cursor: 'pointer' }}>
                        <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
                          {a.kind === 'spike' ? `↑ SPIKE · +${a.delta ?? 0}` : '✨ FRESHMAN'}
                        </p>
                        <p style={{ margin: '4px 0 6px', fontFamily: 'var(--font-jai-display)', fontSize: 14, textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.15 }}>
                          {a.name}
                        </p>
                        <p style={{ margin: 0, fontSize: 11, opacity: 0.7 }}>
                          {a.kind === 'spike'
                            ? `now ${a.current}, baseline ${a.baseline?.toFixed(1)} (${a.snapshots} snapshots)`
                            : `popularity ${a.current}, brand new`}
                        </p>
                        {(a.subculture || a.vibe) && (
                          <p style={{ margin: '4px 0 0', fontSize: 10, opacity: 0.6 }}>
                            {a.subculture && <>◇ {a.subculture} · </>}
                            {a.vibe}
                          </p>
                        )}
                      </div>
                    </a>
                  ))}
                </div>
              </Section>
            )}

            {/* Recommendations based on team feedback */}
            <Section title="Recommendations" subtitle={recoLikedCount === 0
              ? `Mark trends as 👍 useful in the dashboard. Then this engine surfaces other trends in the same conceptual neighbourhood via embedding similarity.`
              : `Based on ${recoLikedCount} trends you marked useful. Closest semantic neighbours from the unrated set, ranked by similarity (minus dislike penalty).`}>
              {recoLikedCount === 0 || recommendations.length === 0 ? (
                <p style={{ color: '#6b6b6b', fontSize: 12 }}>
                  {recoLikedCount === 0
                    ? '👍 No useful-feedback yet. Start marking trends as useful in the dashboard to seed this engine.'
                    : 'No matching unrated trends right now.'}
                </p>
              ) : (
                <>
                  {recoSeeds.length > 0 && (
                    <p style={{ fontSize: 11, color: '#6b6b6b', marginBottom: 10 }}>
                      Seeded from: {recoSeeds.map((s) => <strong key={s} style={{ color: '#000', marginRight: 6 }}>{s}</strong>)}
                    </p>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                    {recommendations.slice(0, 12).map((r) => (
                      <a key={r.id} href={`/culture-radar/trends/${r.slug}`} style={{ textDecoration: 'none' }}>
                        <div className="jai-card" style={{ padding: 12, background: '#FFFDF3', border: '1px solid #00000020', cursor: 'pointer' }}>
                          <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
                            ★ {(r.similarity * 100).toFixed(0)}% SIM
                            {r.growth != null && <> · GROWTH {r.growth.toFixed(1)}</>}
                          </p>
                          <p style={{ margin: '4px 0', fontFamily: 'var(--font-jai-display)', fontSize: 14, textTransform: 'uppercase', letterSpacing: '-0.01em', color: '#000', lineHeight: 1.15 }}>
                            {r.name}
                          </p>
                          <p style={{ margin: 0, fontSize: 11, color: '#1a1a1a', lineHeight: 1.4 }}>
                            {r.description.slice(0, 140)}{r.description.length > 140 ? '…' : ''}
                          </p>
                          {r.subculture && (
                            <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.1em', color: '#000' }}>
                              ◇ {r.subculture}
                            </p>
                          )}
                        </div>
                      </a>
                    ))}
                  </div>
                </>
              )}
            </Section>

            {/* Clusters */}
            <Section title="Emerging clusters" subtitle="K-means on Gemini embeddings of fresh trends (last 14 days). Each cluster groups trends by semantic similarity — may surface unnamed meta-patterns.">
              {!clusters || clusters.clusters.length === 0 ? (
                <p style={{ color: '#6b6b6b' }}>Not enough embedded trends yet. Embed runs daily via cron.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
                  {clusters.clusters.map((c, i) => (
                    <div key={i} className="jai-card" style={{ padding: 14, background: '#FFFDF3', border: '1px solid #00000020' }}>
                      <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
                        {c.label ? `◆ ${c.label.toUpperCase()}` : `CLUSTER #${i + 1}`} · {c.size} TRENDS
                      </p>
                      {c.summary && (
                        <p className="jai-serif" style={{ margin: '6px 0 4px', fontSize: 13, lineHeight: 1.4, color: '#000' }}>
                          {c.summary}
                        </p>
                      )}
                      <p style={{ margin: '4px 0 8px', fontSize: 11, color: '#6b6b6b' }}>
                        {c.dominantSubculture && <>◇ {c.dominantSubculture} · </>}
                        {c.dominantVibe && <>{c.dominantVibe} · </>}
                        avg pop {c.avgPopularity}/10 · growth {c.avgGrowth}/10
                      </p>
                      <ul style={{ margin: 0, padding: '0 0 0 18px' }}>
                        {c.members.slice(0, 5).map((m) => (
                          <li key={m.id} style={{ fontSize: 12, lineHeight: 1.4, marginBottom: 4, color: '#1a1a1a' }}>
                            <strong>{m.name}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Subculture trajectory */}
            <Section title="Subculture trajectory" subtitle="Per subculture: trend count this week vs last week. Rising / fading / stable / new / gone.">
              {subcultures.length === 0 ? (
                <p style={{ color: '#6b6b6b' }}>No subculture data yet.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                  {subcultures.map((s) => (
                    <SubcultureCard key={s.subculture} s={s} />
                  ))}
                </div>
              )}
            </Section>

            {/* Reverse discovery */}
            <Section title="Reverse discovery" subtitle="Type an Action product category (e.g. 'home cleaning', 'kids back to school', 'beauty essentials'). Returns the trends best matched to that category, ranked by fit + growth + urgency.">
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <input
                  value={rdQuery}
                  onChange={(e) => setRdQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runReverseDiscover() }}
                  placeholder="e.g. home cleaning, kids toys, beauty essentials…"
                  style={{
                    flex: '1 1 280px', minWidth: 200, padding: '10px 14px',
                    fontFamily: 'var(--font-body)', fontSize: 13,
                    border: '1px solid #00000020', background: '#FFFDF3',
                  }}
                />
                <button
                  onClick={runReverseDiscover}
                  disabled={rdLoading || !rdQuery.trim()}
                  className="jai-btn jai-btn-red"
                  style={{ minWidth: 140 }}
                >
                  {rdLoading ? 'Searching…' : 'Find trends →'}
                </button>
                {['Home cleaning', 'Kids toys', 'Beauty essentials', 'Garden', 'Back to school', 'Halloween decor'].map((p) => (
                  <button key={p} onClick={() => { setRdQuery(p); setTimeout(runReverseDiscover, 50) }} style={{ background: 'transparent', border: '1px solid #00000020', padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-jai-display)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {p}
                  </button>
                ))}
              </div>
              {rdMatches.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
                  {rdMatches.map((m) => (
                    <a key={m.id} href={`/culture-radar/trends/${m.slug}`} style={{ textDecoration: 'none' }}>
                      <div className="jai-card" style={{ padding: 12, background: '#FFFDF3', border: '1px solid #00000020', cursor: 'pointer' }}>
                        <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
                          FIT {m.fitScore} · SCORE {m.compositeScore} · {m.category}
                        </p>
                        <p style={{ margin: '4px 0 4px', fontFamily: 'var(--font-jai-display)', fontSize: 15, color: '#000', textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.15 }}>
                          {m.name}
                        </p>
                        <p style={{ margin: 0, fontSize: 12, color: '#1a1a1a', lineHeight: 1.4 }}>
                          {m.description.slice(0, 160)}{m.description.length > 160 ? '…' : ''}
                        </p>
                        {m.actionAngle && (
                          <p style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.4, padding: '6px 8px', background: '#FFE4E0', borderLeft: '3px solid #FF1300', color: '#000' }}>
                            <strong style={{ fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.1em', color: '#FF1300' }}>ANGLE: </strong>
                            {m.actionAngle.slice(0, 200)}{m.actionAngle.length > 200 ? '…' : ''}
                          </p>
                        )}
                        {m.productCategories.length > 0 && (
                          <p style={{ margin: '6px 0 0', fontSize: 10, color: '#6b6b6b' }}>
                            categories: {m.productCategories.slice(0, 4).join(' · ')}
                          </p>
                        )}
                      </div>
                    </a>
                  ))}
                </div>
              )}
              {rdMatches.length === 0 && rdQuery && !rdLoading && (
                <p style={{ color: '#6b6b6b', fontSize: 12 }}>No matches yet — try a different phrasing.</p>
              )}
            </Section>

            {/* Cross-platform velocity */}
            {crossPlatform && (
              <Section title="Cross-platform velocity" subtitle="Trends that span multiple platform classes (TikTok / Reddit / newsletter / etc) are higher-confidence signals. Newsletter-only items are often the EARLIEST signals — culture writers spot before mainstream.">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                  {/* Platform distribution */}
                  <div className="jai-card" style={{ padding: 14, background: '#FFFDF3', border: '1px solid #00000020' }}>
                    <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
                      PLATFORM DISTRIBUTION
                    </p>
                    <ul style={{ margin: '8px 0 0 0', padding: 0, listStyle: 'none' }}>
                      {Object.entries(crossPlatform.byPlatform).sort((a, b) => b[1] - a[1]).map(([p, n]) => (
                        <li key={p} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                          <span style={{ fontFamily: 'var(--font-jai-display)', letterSpacing: '0.05em' }}>{p}</span>
                          <strong>{n} trends</strong>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Multi-platform trends */}
                  <div className="jai-card" style={{ padding: 14, background: '#000', color: '#FFFDF3', border: '1px solid #FF1300' }}>
                    <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
                      3+ PLATFORM TRENDS · CROSS-CONFIRMED
                    </p>
                    <ol style={{ margin: '8px 0 0 0', padding: '0 0 0 18px' }}>
                      {crossPlatform.multiPlatformTrends.slice(0, 6).map((t) => (
                        <li key={t.id} style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.35 }}>
                          <a href={`/culture-radar/trends/${t.slug}`} style={{ color: '#FFFDF3', textDecoration: 'none' }}>
                            <strong>{t.name}</strong>
                          </a>
                          <span style={{ marginLeft: 6, fontFamily: 'var(--font-jai-display)', fontSize: 9, letterSpacing: '0.1em', color: '#FF1300' }}>
                            {t.platformCount}×
                          </span>
                          <div style={{ fontSize: 10, opacity: 0.5 }}>{t.platforms.join(' · ')}</div>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Newsletter-only (early signal) */}
                  <div className="jai-card" style={{ padding: 14, background: '#FFE4E0', border: '1px solid #FF1300' }}>
                    <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#FF1300' }}>
                      EARLY SIGNAL · NEWSLETTER-ONLY
                    </p>
                    <p style={{ margin: '4px 0 8px', fontSize: 11, color: '#6b6b6b' }}>
                      In a newsletter today, not yet on TikTok/Reddit. Culture writers ahead of the curve.
                    </p>
                    <ol style={{ margin: 0, padding: '0 0 0 18px' }}>
                      {crossPlatform.newsletterOnly.slice(0, 8).map((t) => (
                        <li key={t.id} style={{ marginBottom: 4, fontSize: 12, lineHeight: 1.3, color: '#1a1a1a' }}>
                          <a href={`/culture-radar/trends/${t.slug}`} style={{ color: '#1a1a1a', textDecoration: 'none' }}>
                            <strong>{t.name}</strong>
                          </a>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Platform pairs */}
                  <div className="jai-card" style={{ padding: 14, background: '#FAF6E6', border: '1px solid #00000020' }}>
                    <p className="jai-mono-label" style={{ margin: 0, fontSize: 10, color: '#000' }}>
                      PLATFORM JUMP HEATMAP
                    </p>
                    <p style={{ margin: '4px 0 8px', fontSize: 11, color: '#6b6b6b' }}>
                      Most common platform pairs (co-occurrence in source lists).
                    </p>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {crossPlatform.platformPairs.slice(0, 8).map((p) => (
                        <li key={p.pair} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                          <span style={{ fontFamily: 'var(--font-jai-display)', letterSpacing: '0.05em' }}>{p.pair}</span>
                          <strong>{p.count}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Section>
            )}

            {/* Source health */}
            <Section title="Source health scorecard" subtitle="Per source: what % of trends from this source were verified as real vs fabricated. Helps demote noisy sources.">
              {sources.length === 0 ? (
                <p style={{ color: '#6b6b6b' }}>Run /api/culture/verify-trends first.</p>
              ) : (
                <div style={{ overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#000', color: '#FFFDF3', fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.1em' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>SOURCE</th>
                        <th style={{ padding: '6px 8px' }}>GRADE</th>
                        <th style={{ padding: '6px 8px' }}>REAL%</th>
                        <th style={{ padding: '6px 8px' }}>FAKE%</th>
                        <th style={{ padding: '6px 8px' }}>TOTAL</th>
                        <th style={{ padding: '6px 8px' }}>FAB</th>
                        <th style={{ padding: '6px 8px' }}>GEN</th>
                        <th style={{ padding: '6px 8px' }}>UNV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map((src) => (
                        <tr key={src.sourceName} style={{ borderBottom: '1px solid #00000010' }}>
                          <td style={{ padding: '6px 8px', maxWidth: 320 }}>{src.sourceName}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <span style={{
                              fontFamily: 'var(--font-jai-display)', fontSize: 11,
                              padding: '2px 7px',
                              background: gradeColor(src.healthGrade),
                              color: '#FFFDF3',
                            }}>
                              {src.healthGrade}
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: '#047857' }}>{src.realPct ?? '—'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: '#b91c1c' }}>{src.fakePct ?? '—'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>{src.counts.total}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: '#b91c1c' }}>{src.counts.fabricated}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: '#a16207' }}>{src.counts.generic}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: '#9ca3af' }}>{src.counts.unverified}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-jai-display)', fontSize: 24, color: '#000', textTransform: 'uppercase', letterSpacing: '-0.01em' }}>
          {title}<span style={{ color: '#FF1300' }}>.</span>
        </span>
        {subtitle && <span style={{ fontSize: 11, color: '#6b6b6b', maxWidth: 540 }}>{subtitle}</span>}
        <div style={{ flex: 1, height: 1, background: '#00000020' }} />
      </div>
      {children}
    </div>
  )
}

function SubcultureCard({ s }: { s: SubcultureTraj }) {
  const colors: Record<string, { bg: string; fg: string; emoji: string }> = {
    rising:  { bg: '#FF1300', fg: '#FFFDF3', emoji: '↗' },
    fading:  { bg: '#9ca3af', fg: '#FFFDF3', emoji: '↘' },
    new:     { bg: '#000',    fg: '#FF1300', emoji: '✨' },
    gone:    { bg: '#FFFDF3', fg: '#9ca3af', emoji: '×' },
    stable:  { bg: '#FFFDF3', fg: '#000',    emoji: '→' },
  }
  const c = colors[s.trajectory]
  return (
    <div className="jai-card" style={{ padding: 12, background: '#FFFDF3', border: '1px solid #00000020' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-jai-display)', fontSize: 13, color: '#000', textTransform: 'uppercase' }}>
          ◇ {s.subculture}
        </span>
        <span style={{ fontFamily: 'var(--font-jai-display)', fontSize: 10, letterSpacing: '0.1em', padding: '2px 7px', background: c.bg, color: c.fg, border: c.bg === '#FFFDF3' ? '1px solid #00000020' : 'none' }}>
          {c.emoji} {s.trajectory.toUpperCase()}
        </span>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 11, color: '#6b6b6b' }}>
        This week <strong style={{ color: '#000' }}>{s.thisWeek.count}</strong> trends · last week {s.lastWeek.count}
        {s.delta !== 0 && <span style={{ color: s.delta > 0 ? '#FF1300' : '#6b6b6b' }}> ({s.delta > 0 ? '+' : ''}{s.delta})</span>}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#6b6b6b' }}>
        avg growth {s.thisWeek.avgGrowth} vs {s.lastWeek.avgGrowth}
      </p>
      {s.topTrends.length > 0 && (
        <ul style={{ margin: '6px 0 0', padding: '0 0 0 18px' }}>
          {s.topTrends.slice(0, 3).map((t) => (
            <li key={t} style={{ fontSize: 11, lineHeight: 1.3, marginBottom: 2, color: '#1a1a1a' }}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function gradeColor(g: string): string {
  if (g === 'A') return '#047857'
  if (g === 'B') return '#000'
  if (g === 'C') return '#a16207'
  if (g === 'D') return '#c2410c'
  return '#b91c1c'
}
