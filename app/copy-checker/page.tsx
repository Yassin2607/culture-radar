'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { CopyCheckResult, CopyIssue, BulkCopyResult } from '@/types/copy-checker'

interface PdfFile {
  name: string
  base64: string
}

export default function CopyCheckerPage() {
  // ── Brand guidelines state ────────────────────────────────────────────────
  const [pdfFile, setPdfFile] = useState<PdfFile | null>(null)
  const [savedOnServer, setSavedOnServer] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [guidelinesLoading, setGuidelinesLoading] = useState(true)
  const guidelinesInputRef = useRef<HTMLInputElement>(null)
  const [isDraggingGuidelines, setIsDraggingGuidelines] = useState(false)

  // ── Single copy check state ───────────────────────────────────────────────
  const [copyText, setCopyText] = useState('')
  const [result, setResult] = useState<CopyCheckResult | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Bulk draft check state ────────────────────────────────────────────────
  const [draftPdf, setDraftPdf] = useState<PdfFile | null>(null)
  const [isDraggingDraft, setIsDraggingDraft] = useState(false)
  const draftInputRef = useRef<HTMLInputElement>(null)
  const [bulkResults, setBulkResults] = useState<BulkCopyResult[]>([])
  const [bulkPhase, setBulkPhase] = useState<'idle' | 'extracting' | 'checking' | 'done'>('idle')
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkTotal, setBulkTotal] = useState(0)
  const [bulkChecked, setBulkChecked] = useState(0)

  // ── Auto-load saved guidelines on mount ──────────────────────────────────
  useEffect(() => {
    apiFetch('/api/brand-guidelines')
      .then((r) => r.json())
      .then((data) => {
        if (data.exists) {
          setPdfFile({ name: data.filename, base64: data.base64 })
          setSavedOnServer(true)
        }
      })
      .catch(() => {})
      .finally(() => setGuidelinesLoading(false))
  }, [])

  // ── Guidelines PDF helpers ────────────────────────────────────────────────
  function loadGuidelinesPdf(file: File) {
    if (file.type !== 'application/pdf') { setError('Please upload a PDF file.'); return }
    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(',')[1]
      setPdfFile({ name: file.name, base64 })
      setSavedOnServer(false)
      setResult(null)
      setError(null)
    }
    reader.readAsDataURL(file)
  }

  async function handleSaveGuidelines() {
    if (!pdfFile) return
    setIsSaving(true)
    try {
      await apiFetch('/api/brand-guidelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: pdfFile.base64, filename: pdfFile.name }),
      })
      setSavedOnServer(true)
    } catch { /* ignore */ }
    setIsSaving(false)
  }

  async function handleRemoveGuidelines() {
    await apiFetch('/api/brand-guidelines', { method: 'DELETE' })
    setPdfFile(null)
    setSavedOnServer(false)
    setResult(null)
  }

  // ── Single copy check ─────────────────────────────────────────────────────
  async function handleCheck() {
    if (!pdfFile || !copyText.trim()) return
    setIsChecking(true)
    setError(null)
    setResult(null)
    try {
      const res = await apiFetch('/api/copy-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: pdfFile.base64, copyText }),
      })
      if (!res.ok) { const b = await res.json(); throw new Error(b.error ?? `Request failed (${res.status})`) }
      setResult(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsChecking(false)
    }
  }

  // ── Draft PDF helpers ─────────────────────────────────────────────────────
  function loadDraftPdf(file: File) {
    if (file.type !== 'application/pdf') { setBulkError('Please upload a PDF file.'); return }
    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(',')[1]
      setDraftPdf({ name: file.name, base64 })
      setBulkResults([])
      setBulkPhase('idle')
      setBulkError(null)
    }
    reader.readAsDataURL(file)
  }

  // ── Bulk check ────────────────────────────────────────────────────────────
  async function handleBulkCheck() {
    if (!pdfFile || !draftPdf) return
    setBulkError(null)
    setBulkResults([])
    setBulkTotal(0)
    setBulkChecked(0)
    setBulkPhase('extracting')

    try {
      // Phase 1: extract all copies from the PDF
      const extractRes = await apiFetch('/api/copy-check/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftPdfBase64: draftPdf.base64 }),
      })
      if (!extractRes.ok) {
        const b = await extractRes.json()
        throw new Error(b.error ?? `Extraction failed (${extractRes.status})`)
      }
      const copies: Array<{ draftName: string; copyText: string }> = await extractRes.json()

      // Phase 2: check each copy individually with limited concurrency
      setBulkPhase('checking')
      setBulkTotal(copies.length)

      const CONCURRENCY = 5
      const results: BulkCopyResult[] = new Array(copies.length)

      for (let i = 0; i < copies.length; i += CONCURRENCY) {
        const chunk = copies.slice(i, i + CONCURRENCY)
        await Promise.all(
          chunk.map(async (copy, j) => {
            const idx = i + j
            try {
              const res = await apiFetch('/api/copy-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pdfBase64: pdfFile.base64, copyText: copy.copyText }),
              })
              const result = await res.json()
              results[idx] = { draftName: copy.draftName, copyText: copy.copyText, result }
            } catch (err) {
              results[idx] = {
                draftName: copy.draftName,
                copyText: copy.copyText,
                result: { status: 'warning', issues: [], suggestions: [], rewrittenOptions: [], summary: 'Check failed' },
                error: err instanceof Error ? err.message : 'Unknown error',
              }
            } finally {
              setBulkChecked((c) => c + 1)
            }
          })
        )
      }

      setBulkResults(results)
      setBulkPhase('done')
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Unknown error')
      setBulkPhase('idle')
    }
  }

  // ── Bulk export CSV ───────────────────────────────────────────────────────
  const exportBulkCsv = useCallback(() => {
    const headers = ['Draft', 'Copy', 'Status', 'Issues', 'Suggestions', 'Summary']
    const rows = bulkResults.map((r) => [
      r.draftName,
      r.copyText,
      r.result.status,
      r.result.issues.map((i) => `[${i.severity}] ${i.category}: ${i.description}`).join(' | '),
      r.result.suggestions.join(' | '),
      r.result.summary,
    ])
    const csv = [headers, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `draft-check-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [bulkResults])

  const canCheck = !!pdfFile && copyText.trim().length > 0 && !isChecking
  const canBulk = !!pdfFile && !!draftPdf && bulkPhase !== 'extracting' && bulkPhase !== 'checking'

  return (
    <div className="min-h-screen">
      {/* Page header */}
      <div className="border-b border-gray-200 bg-white px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="font-bold text-gray-900"
              style={{ fontFamily: 'var(--font-display)', fontSize: 26, letterSpacing: '0.01em', lineHeight: 1.1 }}
            >
              Copy Checker
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Check social media copy against brand guidelines — single or bulk from weekly drafts PDF
            </p>
          </div>
          {(copyText || result) && (
            <button
              onClick={() => { setCopyText(''); setResult(null); setError(null) }}
              className="text-sm font-medium text-gray-400 hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-red-50"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">

        {/* Error banner */}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4">
            <p className="text-sm font-semibold text-red-800 mb-1">Error</p>
            <p className="text-xs text-red-700 font-mono break-all">{error}</p>
          </div>
        )}

        {/* ── Brand guidelines (always visible, auto-loaded) ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Brand Guidelines PDF</h2>
            {savedOnServer && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Saved
              </span>
            )}
          </div>

          {guidelinesLoading ? (
            <div className="flex items-center gap-3 py-2">
              <span className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
              <span className="text-sm text-gray-400">Loading saved guidelines…</span>
            </div>
          ) : pdfFile ? (
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--action-red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{pdfFile.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{savedOnServer ? 'Auto-loads on every visit' : 'Not saved yet'}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {!savedOnServer && (
                  <button
                    onClick={handleSaveGuidelines}
                    disabled={isSaving}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors"
                    style={{ borderColor: 'var(--action-red)', color: 'var(--action-red)' }}
                  >
                    {isSaving ? 'Saving…' : 'Save for next time'}
                  </button>
                )}
                <button
                  onClick={() => guidelinesInputRef.current?.click()}
                  className="text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
                >
                  Replace
                </button>
                <button
                  onClick={handleRemoveGuidelines}
                  className="text-xs font-medium text-gray-400 hover:text-red-500 transition-colors"
                >
                  Remove
                </button>
              </div>
              <input ref={guidelinesInputRef} type="file" accept=".pdf,application/pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) loadGuidelinesPdf(f); e.target.value = '' }} />
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDraggingGuidelines(true) }}
              onDragLeave={() => setIsDraggingGuidelines(false)}
              onDrop={(e) => { e.preventDefault(); setIsDraggingGuidelines(false); const f = e.dataTransfer.files?.[0]; if (f) loadGuidelinesPdf(f) }}
              onClick={() => guidelinesInputRef.current?.click()}
              className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors"
              style={{ borderColor: isDraggingGuidelines ? 'var(--action-red)' : '#d1d5db', backgroundColor: isDraggingGuidelines ? '#fff5f5' : '#fafafa' }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
              <p className="text-sm font-medium text-gray-600">Drop brand guidelines PDF here or click to upload</p>
              <p className="text-xs text-gray-400 mt-1">You can save it so it loads automatically next time</p>
              <input ref={guidelinesInputRef} type="file" accept=".pdf,application/pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) loadGuidelinesPdf(f); e.target.value = '' }} />
            </div>
          )}
        </div>

        {/* ── Single copy check ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Single Copy Check</h2>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col gap-4">
            <textarea
              value={copyText}
              onChange={(e) => setCopyText(e.target.value)}
              placeholder="Paste your social media copy here…"
              rows={7}
              className="w-full resize-none rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all"
              style={{ fontFamily: 'var(--font-body)', lineHeight: 1.6 }}
            />
            <button
              onClick={handleCheck}
              disabled={!canCheck}
              className="w-full py-3 rounded-lg text-sm font-semibold text-white transition-all flex items-center justify-center gap-2"
              style={{
                backgroundColor: canCheck ? 'var(--action-red)' : '#d1d5db',
                cursor: canCheck ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--font-display)',
                fontSize: 15,
                letterSpacing: '0.02em',
              }}
            >
              {isChecking ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Checking…</>
              ) : (
                <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Check copy</>
              )}
            </button>
            {!pdfFile && <p className="text-xs text-center text-gray-400">Upload brand guidelines first</p>}
          </div>

          {result && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div className="flex items-center gap-3">
                <StatusBadge status={result.status} />
                <p className="text-sm text-gray-600">{result.summary}</p>
              </div>
              {result.issues.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Issues found</h3>
                  <div className="space-y-2">{result.issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}</div>
                </div>
              )}
              {result.suggestions.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Suggestions</h3>
                  <ul className="space-y-2">
                    {result.suggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="flex-shrink-0 mt-0.5 text-blue-500">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        </span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.rewrittenOptions.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Compliant alternatives</h3>
                  <div className="space-y-3">{result.rewrittenOptions.map((opt, i) => <RewriteOption key={i} index={i + 1} text={opt} />)}</div>
                </div>
              )}
              {result.issues.length === 0 && result.suggestions.length === 0 && (
                <p className="text-sm text-green-700 font-medium">No issues found. The copy looks great!</p>
              )}
            </div>
          )}
        </div>

        {/* ── Bulk Draft Check ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-gray-200" />
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Bulk Draft Check</h2>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Draft PDF upload */}
            <div className="lg:col-span-1">
              {draftPdf ? (
                <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{draftPdf.name}</p>
                    <p className="text-xs text-gray-400">Weekly drafts PDF</p>
                  </div>
                  <button onClick={() => draftInputRef.current?.click()} className="text-xs text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0">Replace</button>
                  <input ref={draftInputRef} type="file" accept=".pdf,application/pdf" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) loadDraftPdf(f); e.target.value = '' }} />
                </div>
              ) : (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingDraft(true) }}
                  onDragLeave={() => setIsDraggingDraft(false)}
                  onDrop={(e) => { e.preventDefault(); setIsDraggingDraft(false); const f = e.dataTransfer.files?.[0]; if (f) loadDraftPdf(f) }}
                  onClick={() => draftInputRef.current?.click()}
                  className="bg-white rounded-xl border-2 border-dashed p-8 flex flex-col items-center justify-center cursor-pointer transition-colors"
                  style={{ borderColor: isDraggingDraft ? '#3b82f6' : '#d1d5db', backgroundColor: isDraggingDraft ? '#eff6ff' : '#ffffff' }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="12" y1="18" x2="12" y2="12"/>
                    <line x1="9" y1="15" x2="15" y2="15"/>
                  </svg>
                  <p className="text-sm font-medium text-gray-600 text-center">Drop weekly drafts PDF</p>
                  <p className="text-xs text-gray-400 mt-1 text-center">All copies will be extracted automatically</p>
                  <input ref={draftInputRef} type="file" accept=".pdf,application/pdf" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) loadDraftPdf(f); e.target.value = '' }} />
                </div>
              )}
            </div>

            {/* Action + status */}
            <div className="lg:col-span-2 flex flex-col justify-center gap-3">
              <button
                onClick={handleBulkCheck}
                disabled={!canBulk}
                className="py-3 px-6 rounded-xl text-sm font-semibold text-white transition-all flex items-center justify-center gap-2"
                style={{
                  backgroundColor: canBulk ? '#1d4ed8' : '#d1d5db',
                  cursor: canBulk ? 'pointer' : 'not-allowed',
                  fontFamily: 'var(--font-display)',
                  fontSize: 15,
                  letterSpacing: '0.02em',
                }}
              >
                {bulkPhase === 'extracting' || bulkPhase === 'checking' ? (
                  <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {bulkPhase === 'extracting' ? 'Extracting copies…' : `Checking ${bulkChecked} of ${bulkTotal}…`}</>
                ) : (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>Extract &amp; Check all</>
                )}
              </button>

              {/* Progress bar */}
              {(bulkPhase === 'extracting' || bulkPhase === 'checking') && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{bulkPhase === 'extracting' ? 'Reading PDF and extracting copy blocks…' : `Checking copies against brand guidelines`}</span>
                    {bulkPhase === 'checking' && bulkTotal > 0 && (
                      <span className="font-medium tabular-nums">{bulkChecked}/{bulkTotal}</span>
                    )}
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    {bulkPhase === 'extracting' ? (
                      /* indeterminate animated bar */
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: '40%',
                          backgroundColor: '#1d4ed8',
                          animation: 'indeterminate-slide 1.4s ease-in-out infinite',
                        }}
                      />
                    ) : (
                      /* determinate bar */
                      <div
                        className="h-full rounded-full transition-all duration-300 ease-out"
                        style={{
                          width: bulkTotal > 0 ? `${Math.round((bulkChecked / bulkTotal) * 100)}%` : '0%',
                          backgroundColor: '#1d4ed8',
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              {!pdfFile && <p className="text-xs text-gray-400 text-center">Upload brand guidelines above first</p>}
              {pdfFile && !draftPdf && <p className="text-xs text-gray-400 text-center">Upload the weekly drafts PDF to continue</p>}
              {bulkPhase === 'done' && bulkResults.length > 0 && (
                <p className="text-xs text-center text-green-700 font-medium">{bulkResults.length} copies checked</p>
              )}
            </div>
          </div>

          {/* Bulk error */}
          {bulkError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4">
              <p className="text-sm font-semibold text-red-800 mb-1">Bulk check failed</p>
              <p className="text-xs text-red-700 font-mono break-all">{bulkError}</p>
            </div>
          )}

          {/* Bulk results table */}
          {bulkResults.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{bulkResults.length} copies checked</p>
                <button
                  onClick={exportBulkCsv}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                >
                  Export CSV
                </button>
              </div>
              <div className="divide-y divide-gray-100">
                {bulkResults.map((r, i) => <BulkResultRow key={i} item={r} />)}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'pass' | 'fail' | 'warning' }) {
  const styles = {
    pass: { bg: '#dcfce7', color: '#15803d', label: 'Pass' },
    fail: { bg: '#fee2e2', color: '#b91c1c', label: 'Fail' },
    warning: { bg: '#fef9c3', color: '#a16207', label: 'Warning' },
  }
  const s = styles[status]
  return (
    <span className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide flex-shrink-0" style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

function IssueRow({ issue }: { issue: CopyIssue }) {
  const isError = issue.severity === 'error'
  return (
    <div className="rounded-lg px-4 py-3 flex items-start gap-3" style={{ backgroundColor: isError ? '#fff1f2' : '#fffbeb' }}>
      <span className="flex-shrink-0 mt-0.5" style={{ color: isError ? '#b91c1c' : '#a16207' }}>
        {isError ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: isError ? '#b91c1c' : '#a16207' }}>{issue.category}</span>
        <p className="text-sm text-gray-700 mt-0.5">{issue.description}</p>
      </div>
    </div>
  )
}

function RewriteOption({ index, text }: { index: number; text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">Option {index}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          className="flex items-center gap-1.5 text-xs font-medium text-green-700 hover:text-green-900 transition-colors"
        >
          {copied ? (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
          ) : (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
          )}
        </button>
      </div>
      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  )
}

function BulkResultRow({ item }: { item: BulkCopyResult }) {
  const [expanded, setExpanded] = useState(false)
  const errorCount = item.result.issues.filter((i) => i.severity === 'error').length
  const warnCount = item.result.issues.filter((i) => i.severity === 'warning').length

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-5 py-3.5 flex items-center gap-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex-shrink-0 w-36 truncate">
          <p className="text-sm font-semibold text-gray-900 truncate">{item.draftName}</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-500 truncate">{item.copyText.replace(/\n/g, ' ').slice(0, 80)}{item.copyText.length > 80 ? '…' : ''}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <StatusBadge status={item.result.status} />
          {item.result.issues.length > 0 && (
            <span className="text-xs text-gray-500">
              {errorCount > 0 && <span className="text-red-600 font-semibold">{errorCount} error{errorCount > 1 ? 's' : ''}</span>}
              {errorCount > 0 && warnCount > 0 && ', '}
              {warnCount > 0 && <span className="text-yellow-600">{warnCount} warning{warnCount > 1 ? 's' : ''}</span>}
            </span>
          )}
          <span className="text-gray-300 text-sm">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 bg-gray-50 border-t border-gray-100 space-y-4">
          {/* Full copy */}
          <div className="pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Full copy</p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed bg-white rounded-lg border border-gray-200 px-4 py-3">{item.copyText}</p>
          </div>

          {item.error && (
            <p className="text-xs text-red-600 font-mono bg-red-50 rounded px-3 py-2">{item.error}</p>
          )}

          {item.result.issues.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Issues</p>
              <div className="space-y-2">{item.result.issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}</div>
            </div>
          )}

          {item.result.suggestions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Suggestions</p>
              <ul className="space-y-1.5">
                {item.result.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="flex-shrink-0 mt-0.5 text-blue-500">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item.result.rewrittenOptions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Compliant alternatives</p>
              <div className="space-y-3">{item.result.rewrittenOptions.map((opt, i) => <RewriteOption key={i} index={i + 1} text={opt} />)}</div>
            </div>
          )}

          {item.result.issues.length === 0 && item.result.suggestions.length === 0 && (
            <p className="text-sm text-green-700 font-medium pt-1">No issues found. This copy looks great!</p>
          )}
        </div>
      )}
    </div>
  )
}
