'use client';

import { useState, useRef, useCallback } from 'react';
import type { ABTestResult } from '@/lib/stats';

// ─── Types ─────────────────────────────────────────────────────────────────

interface AnalysisResult {
  stats: ABTestResult;
  labelA: string;
  labelB: string;
  metricName: string;
}

type InputMode = 'manual' | 'csv' | 'image';

// ─── Helpers ───────────────────────────────────────────────────────────────

function pct(v: number, d = 2) {
  return (v * 100).toFixed(d) + '%';
}

function fmtP(p: number) {
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

function fmtNum(n: number) {
  return n.toLocaleString('fr-FR');
}

function renderMarkdown(text: string) {
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, (m) => m.trim() ? `<p>${m}</p>` : '')
    .replace(/<p><\/p>/g, '');
}

// ─── Sub-components ────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-4">
      <div style={{ color: 'var(--muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }} className="mb-1">{label}</div>
      <div style={{ color: color || 'var(--text)', fontSize: '1.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ color: 'var(--muted)', fontSize: '0.75rem', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  );
}

function InputField({
  label, value, onChange, placeholder, type = 'number', min, style
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div style={style}>
      <label style={{ color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 500, display: 'block', marginBottom: '0.35rem' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        style={{
          width: '100%',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '0.55rem 0.75rem',
          color: 'var(--text)',
          fontSize: '0.875rem',
          outline: 'none',
          transition: 'border-color 0.15s',
        }}
        onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
      />
    </div>
  );
}

function CIBar({ lo, hi, mid }: { lo: number; hi: number; mid: number }) {
  const scale = 100;
  const barLo = Math.max(0, lo * scale);
  const barWidth = (hi - lo) * scale;
  const midPos = mid * scale;
  return (
    <div style={{ flex: 1, position: 'relative', height: '20px', background: 'var(--surface)', borderRadius: '4px', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: `${barLo}%`, width: `${barWidth}%`, height: '100%', background: 'rgba(232,255,71,0.15)', borderRadius: '2px' }} />
      <div style={{ position: 'absolute', left: `${midPos}%`, top: '20%', width: '2px', height: '60%', background: 'var(--accent)', borderRadius: '1px' }} />
    </div>
  );
}

// ─── Results panel ─────────────────────────────────────────────────────────

function Results({
  result, onInsights, insights, loadingInsights, context, onContextChange,
}: {
  result: AnalysisResult;
  onInsights: () => void;
  insights: string;
  loadingInsights: boolean;
  context: string;
  onContextChange: (v: string) => void;
}) {
  const { stats, labelA, labelB, metricName } = result;
  const winnerColor = stats.winner === 'B' ? 'var(--green)' : stats.winner === 'A' ? 'var(--red)' : 'var(--orange)';
  const verdictBg = stats.winner === 'B' ? 'var(--green-dim)' : stats.winner === 'A' ? 'var(--red-dim)' : 'var(--orange-dim)';
  const upliftSign = stats.relativeUplift >= 0 ? '+' : '';
  const srmRatio = Math.abs(stats.visitorsA - stats.visitorsB) / Math.max(stats.visitorsA, stats.visitorsB);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Verdict banner */}
      <div style={{ background: verdictBg, border: `1px solid ${winnerColor}33`, borderRadius: '12px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ fontSize: '2rem' }}>
          {stats.significant ? (stats.winner === 'B' ? '✅' : '⚠️') : '⏳'}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: winnerColor }}>
            {stats.significant
              ? stats.winner === 'B'
                ? `${labelB} gagne — test significatif`
                : `${labelA} devant — ${labelB} sous-performe`
              : 'Pas encore significatif'}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: '0.82rem', marginTop: '0.2rem' }}>
            {stats.significant
              ? `p = ${fmtP(stats.pValue)} · Confiance ${pct(stats.confidenceLevel, 0)} · Uplift ${upliftSign}${pct(stats.relativeUplift)}`
              : `p = ${fmtP(stats.pValue)} · Il manque ~${fmtNum(stats.additionalSamplesNeeded ?? 0)} visiteurs (puissance : ${pct(stats.observedPower)})`}
          </div>
        </div>
      </div>

      {/* Key stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
        <StatCard label={`Taux ${labelA}`} value={pct(stats.rateA)} sub={`${fmtNum(stats.conversionsA)} / ${fmtNum(stats.visitorsA)}`} />
        <StatCard label={`Taux ${labelB}`} value={pct(stats.rateB)} sub={`${fmtNum(stats.conversionsB)} / ${fmtNum(stats.visitorsB)}`} color={stats.relativeUplift >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="Uplift relatif" value={`${upliftSign}${pct(stats.relativeUplift)}`} sub={`Diff abs. ${upliftSign}${pct(stats.absoluteDiff)}`} color={stats.relativeUplift >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="p-value" value={fmtP(stats.pValue)} sub={stats.significant ? '✓ < α' : `> α`} color={stats.significant ? 'var(--green)' : 'var(--orange)'} />
        <StatCard label="Z-score" value={stats.zScore.toFixed(3)} />
        <StatCard label="Puissance" value={pct(stats.observedPower)} sub={stats.observedPower >= 0.8 ? '✓ ≥ 80%' : '⚠️ < 80%'} color={stats.observedPower >= 0.8 ? 'var(--green)' : 'var(--orange)'} />
      </div>

      {/* CI */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
        <div style={{ color: 'var(--muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '0.75rem' }}>Intervalles de confiance 95%</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { label: labelA, lo: stats.ciA[0], hi: stats.ciA[1], mid: stats.rateA },
            { label: labelB, lo: stats.ciB[0], hi: stats.ciB[1], mid: stats.rateB },
          ].map(({ label, lo, hi, mid }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: '70px', fontSize: '0.8rem', color: 'var(--muted)', flexShrink: 0 }}>{label}</div>
              <CIBar lo={lo} hi={hi} mid={mid} />
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{pct(lo)} – {pct(hi)}</div>
            </div>
          ))}
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
            Diff ({labelB}−{labelA}) : [{pct(stats.ciDiff[0])} ; {pct(stats.ciDiff[1])}]
            {stats.ciDiff[0] > 0 || stats.ciDiff[1] < 0 ? ' → Ne contient pas 0 ✓' : ' → Contient 0 (non-significatif)'}
          </div>
        </div>
      </div>

      {/* Sample size */}
      {!stats.significant && stats.sampleSizeNeeded && (
        <div style={{ background: 'var(--orange-dim)', border: '1px solid rgba(251,146,60,0.3)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--orange)', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Taille d&apos;échantillon recommandée</div>
          <div style={{ fontSize: '0.85rem', color: '#d0d0d0', lineHeight: 1.6 }}>
            Pour détecter l&apos;uplift observé ({upliftSign}{pct(stats.relativeUplift)}) avec 80% de puissance,
            il faut <strong>{fmtNum(stats.sampleSizeNeeded)}</strong> visiteurs par variante.
            Il manque environ <strong>{fmtNum(stats.additionalSamplesNeeded ?? 0)}</strong> visiteurs au total.
          </div>
        </div>
      )}

      {/* SRM */}
      {srmRatio > 0.1 && (
        <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: '0.3rem', fontSize: '0.9rem' }}>⚠️ Sample Ratio Mismatch (SRM)</div>
          <div style={{ fontSize: '0.85rem', color: '#d0d0d0', lineHeight: 1.6 }}>
            Écart de {pct(srmRatio)} entre les groupes ({fmtNum(stats.visitorsA)} vs {fmtNum(stats.visitorsB)}).
            Un problème d&apos;allocation peut biaiser les résultats — vérifier la randomisation.
          </div>
        </div>
      )}

      {/* Insights */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: insights || loadingInsights ? '1px solid var(--border)' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>Analyse IA — Insights & Biais</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Contexte métier optionnel</div>
              <textarea
                value={context}
                onChange={(e) => onContextChange(e.target.value)}
                placeholder="Ex: page checkout, segment mobile, lancé après une mise à jour…"
                rows={2}
                style={{
                  width: '100%',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '0.5rem 0.7rem',
                  color: 'var(--text)',
                  fontSize: '0.8rem',
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
              />
            </div>
            <button
              onClick={onInsights}
              disabled={loadingInsights}
              style={{
                background: loadingInsights ? 'var(--border)' : 'var(--accent)',
                color: loadingInsights ? 'var(--muted)' : '#0a0a0a',
                border: 'none',
                borderRadius: '8px',
                padding: '0.6rem 1.2rem',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: loadingInsights ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
                alignSelf: 'flex-end',
                transition: 'opacity 0.15s',
              }}
            >
              {loadingInsights ? '⟳ Analyse...' : insights ? '↺ Relancer' : '✦ Analyser'}
            </button>
          </div>
        </div>
        {(insights || loadingInsights) && (
          <div style={{ padding: '1rem 1.25rem' }}>
            {loadingInsights && !insights && (
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Claude réfléchit...</div>
            )}
            {insights && (
              <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(insights) }} />
            )}
          </div>
        )}
      </div>

    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function Home() {
  const [mode, setMode] = useState<InputMode>('manual');
  const [labelA, setLabelA] = useState('Control');
  const [labelB, setLabelB] = useState('Variant');
  const [metricName, setMetricName] = useState('Conversions');
  const [visitorsA, setVisitorsA] = useState('');
  const [conversionsA, setConversionsA] = useState('');
  const [visitorsB, setVisitorsB] = useState('');
  const [conversionsB, setConversionsB] = useState('');
  const [alpha, setAlpha] = useState('0.05');
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [insights, setInsights] = useState('');
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [context, setContext] = useState('');

  const handleFile = useCallback((f: File) => { setFile(f); setError(null); }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setInsights('');
    try {
      const fd = new FormData();
      fd.append('alpha', alpha);
      if (mode === 'manual') {
        fd.append('mode', 'manual');
        fd.append('visitorsA', visitorsA);
        fd.append('conversionsA', conversionsA);
        fd.append('visitorsB', visitorsB);
        fd.append('conversionsB', conversionsB);
        fd.append('labelA', labelA);
        fd.append('labelB', labelB);
        fd.append('metricName', metricName);
      } else if (mode === 'csv' && file) {
        fd.append('mode', 'csv');
        fd.append('file', file);
      } else if (mode === 'image' && file) {
        const imgFd = new FormData();
        imgFd.append('file', file);
        const imgRes = await fetch('/api/parse-image', { method: 'POST', body: imgFd });
        const imgData = await imgRes.json();
        if (!imgRes.ok || imgData.error) throw new Error(imgData.error || 'Erreur parsing image');
        fd.append('mode', 'manual');
        fd.append('visitorsA', String(imgData.visitorsA));
        fd.append('conversionsA', String(imgData.conversionsA));
        fd.append('visitorsB', String(imgData.visitorsB));
        fd.append('conversionsB', String(imgData.conversionsB));
        fd.append('labelA', imgData.labelA || 'Control');
        fd.append('labelB', imgData.labelB || 'Variant');
        fd.append('metricName', imgData.metricName || 'Conversions');
      }
      const res = await fetch('/api/analyze', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  const fetchInsights = async () => {
    if (!result) return;
    setLoadingInsights(true);
    setInsights('');
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...result, context }),
      });
      if (!res.ok) throw new Error('Erreur insights');
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setInsights((prev) => prev + dec.decode(value));
      }
    } catch (e) {
      setInsights('Erreur lors de la génération des insights.');
      console.error(e);
    } finally {
      setLoadingInsights(false);
    }
  };

  const canAnalyze = mode === 'manual'
    ? !!(visitorsA && conversionsA && visitorsB && conversionsB)
    : !!file;

  return (
    <main style={{ minHeight: '100vh', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: '780px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.4rem' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--accent)' }}>A/B Analyzer</h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.1rem 0.4rem' }}>z-test · IC95% · power</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Colle tes données, obtiens un verdict + analyse business IA.</p>
        </div>

        {/* Input card */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem' }}>

          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', background: 'var(--surface)', borderRadius: '10px', padding: '4px' }}>
            {(['manual', 'csv', 'image'] as InputMode[]).map((m) => (
              <button key={m} onClick={() => { setMode(m); setFile(null); setError(null); }} style={{
                flex: 1, padding: '0.45rem', borderRadius: '7px', border: 'none',
                background: mode === m ? 'var(--card)' : 'transparent',
                color: mode === m ? 'var(--text)' : 'var(--muted)',
                fontWeight: mode === m ? 600 : 400,
                fontSize: '0.82rem', cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {m === 'manual' ? '✎ Manuel' : m === 'csv' ? '📊 CSV' : '🖼 Image'}
              </button>
            ))}
          </div>

          {/* Manual */}
          {mode === 'manual' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <InputField label="Variante A" value={labelA} onChange={setLabelA} type="text" placeholder="Control" />
                <InputField label="Variante B" value={labelB} onChange={setLabelB} type="text" placeholder="Variant" />
                <InputField label="Métrique" value={metricName} onChange={setMetricName} type="text" placeholder="Conversions" />
              </div>
              <div style={{ height: '1px', background: 'var(--border)' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div style={{ background: 'var(--surface)', borderRadius: '10px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--blue)', marginBottom: '0.75rem' }}>Variante A — {labelA}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <InputField label="Visiteurs" value={visitorsA} onChange={setVisitorsA} placeholder="ex: 5000" min="1" />
                    <InputField label={metricName} value={conversionsA} onChange={setConversionsA} placeholder="ex: 250" min="0" />
                  </div>
                </div>
                <div style={{ background: 'var(--surface)', borderRadius: '10px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)', marginBottom: '0.75rem' }}>Variante B — {labelB}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <InputField label="Visiteurs" value={visitorsB} onChange={setVisitorsB} placeholder="ex: 5000" min="1" />
                    <InputField label={metricName} value={conversionsB} onChange={setConversionsB} placeholder="ex: 300" min="0" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* File upload */}
          {(mode === 'csv' || mode === 'image') && (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragActive ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '12px', padding: '2.5rem 1rem', textAlign: 'center',
                cursor: 'pointer', transition: 'all 0.15s',
                background: dragActive ? 'var(--accent-dim)' : 'var(--surface)',
              }}
            >
              <input ref={fileRef} type="file"
                accept={mode === 'csv' ? '.csv,.tsv,.txt' : 'image/*'}
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {file ? (
                <div>
                  <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>✓</div>
                  <div style={{ fontWeight: 600 }}>{file.name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.3rem' }}>{(file.size / 1024).toFixed(1)} KB · Cliquer pour changer</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{mode === 'csv' ? '📋' : '📸'}</div>
                  <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>
                    {mode === 'csv' ? 'Déposer votre export CSV' : 'Déposer votre screenshot'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    {mode === 'csv'
                      ? 'Colonnes : variant + visiteurs + conversions (ou taux)'
                      : 'Claude extrait les chiffres automatiquement'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Alpha + button */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
            <div style={{ width: '120px' }}>
              <label style={{ color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 500, display: 'block', marginBottom: '0.35rem' }}>Seuil α</label>
              <select value={alpha} onChange={(e) => setAlpha(e.target.value)} style={{
                width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '8px', padding: '0.55rem 0.75rem', color: 'var(--text)',
                fontSize: '0.875rem', outline: 'none',
              }}>
                <option value="0.01">α = 1%</option>
                <option value="0.05">α = 5%</option>
                <option value="0.1">α = 10%</option>
              </select>
            </div>
            <button onClick={analyze} disabled={loading || !canAnalyze} style={{
              flex: 1, background: loading || !canAnalyze ? 'var(--border)' : 'var(--accent)',
              color: loading || !canAnalyze ? 'var(--muted)' : '#0a0a0a',
              border: 'none', borderRadius: '8px', padding: '0.6rem 1.5rem',
              fontWeight: 700, fontSize: '0.95rem',
              cursor: loading || !canAnalyze ? 'default' : 'pointer', transition: 'opacity 0.15s',
            }}>
              {loading ? 'Analyse...' : 'Analyser →'}
            </button>
          </div>

          {error && (
            <div style={{ marginTop: '0.75rem', background: 'var(--red-dim)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '8px', padding: '0.6rem 0.9rem', fontSize: '0.82rem', color: 'var(--red)' }}>
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {result && (
          <Results
            result={result}
            onInsights={fetchInsights}
            insights={insights}
            loadingInsights={loadingInsights}
            context={context}
            onContextChange={setContext}
          />
        )}

        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.72rem', marginTop: '3rem', paddingBottom: '2rem' }}>
          z-test deux proportions · IC bilatéral 95% · Power Welch · Claude Opus 4.6
        </div>
      </div>
    </main>
  );
}
