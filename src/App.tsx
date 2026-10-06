import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { WritingAISuggestion } from './types';
import type { DemoSubmission, FinalScores, PublishedReport } from '../server/reviewService';
import { DEMO_RESPONSE } from './demoContent';

async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch('/api' + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result as T;
}

function Essay({ text, annotations = [] }: { text: string; annotations?: WritingAISuggestion[] }) {
  const content: ReactNode[] = [];
  let offset = 0;
  for (const item of [...annotations].filter(a => a.decision !== 'REJECTED').sort((a, b) => a.start_offset - b.start_offset)) {
    if (item.start_offset < offset) continue;
    content.push(text.slice(offset, item.start_offset));
    content.push(<mark key={item.id} title={item.issue}>{text.slice(item.start_offset, item.end_offset)}</mark>);
    offset = item.end_offset;
  }
  content.push(text.slice(offset));
  return <div className="essay">{content}</div>;
}

function SuggestionCard({ item, busy, decide }: { item: WritingAISuggestion; busy: boolean; decide: (id: string, decision: string, revision?: string) => void }) {
  const [revision, setRevision] = useState(item.suggested_revision);
  return <article className={'suggestion ' + item.decision.toLowerCase()}>
    <div className="card-top"><span className="tag">{item.criterion} · {item.severity.toLowerCase()}</span><span className="decision">{item.decision.toLowerCase()}</span></div>
    <h3>{item.issue}</h3><blockquote>{item.original_text}</blockquote>
    <p>{item.explanation}</p>
    <label>Suggested revision<input value={revision} disabled={busy} onChange={e => setRevision(e.target.value)} /></label>
    <div className="actions"><button disabled={busy} onClick={() => decide(item.id, 'ACCEPTED')}>Accept</button><button disabled={busy || !revision.trim()} onClick={() => decide(item.id, 'EDITED', revision)}>Save edit</button><button className="quiet" disabled={busy} onClick={() => decide(item.id, 'REJECTED')}>Reject</button></div>
  </article>;
}

const scoreLabels: Record<keyof FinalScores, string> = { task: 'Task response', cc: 'Coherence', lr: 'Vocabulary', gra: 'Grammar' };

export function App() {
  const [config, setConfig] = useState<{ mode: string; prompt: string }>();
  const [text, setText] = useState(DEMO_RESPONSE);
  const [submission, setSubmission] = useState<DemoSubmission>();
  const [report, setReport] = useState<PublishedReport>();
  const [tab, setTab] = useState<'write' | 'review' | 'report'>('write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scores, setScores] = useState<FinalScores>({ task: 6, cc: 6, lr: 6, gra: 6 });
  const [notes, setNotes] = useState('');
  const [verified, setVerified] = useState(false);
  useEffect(() => { request<{ mode: string; prompt: string }>('/config').then(setConfig).catch(() => setError('Start both the web interface and API with npm run dev.')); }, []);
  async function work(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Request failed.'); }
    finally { setBusy(false); }
  }
  async function submit() {
    await work(async () => {
      const item = await request<DemoSubmission>('/submissions', { response: text });
      setSubmission(item); setReport(undefined); setNotes(''); setVerified(false); setTab('review');
    });
  }
  async function analyze() {
    await work(async () => {
      const item = await request<DemoSubmission>(`/submissions/${submission!.id}/analyze`, {});
      setSubmission(item);
      const assessment = item.analysis!.criterionAssessment;
      setScores({ task: assessment.task_criterion.estimated_band, cc: assessment.cc.estimated_band, lr: assessment.lr.estimated_band, gra: assessment.gra.estimated_band });
    });
  }
  async function decide(id: string, decision: string, revision?: string) {
    await work(async () => setSubmission(await request<DemoSubmission>(`/submissions/${submission!.id}/suggestions/${id}`, { decision, revision }, 'PATCH')));
  }
  async function publish() {
    await work(async () => {
      const item = await request<DemoSubmission>(`/submissions/${submission!.id}/publish`, { scores, notes, verified });
      const published = await request<PublishedReport>(`/submissions/${item.id}/report`);
      setSubmission(item); setReport(published); setTab('report');
    });
  }
  const annotations = submission?.analysis?.annotations ?? [];
  const pending = annotations.filter(a => a.decision === 'PENDING').length;
  const readOnly = submission?.status === 'PUBLISHED';
  return <div className="page">
    <header className="header"><a className="brand" href="/">WR / <strong>Writing Review</strong></a><span className="environment">LOCAL PORTFOLIO DEMO</span></header>
    <main>
      <section className="hero"><div><p className="eyebrow">IELTS WRITING REVIEW PLATFORM</p><h1>AI drafts.<br /><span>People decide.</span></h1><p className="intro">A writing workflow with structured estimates, anchored feedback, and human verification before publication.</p></div><aside className="pipeline"><span className="step-label">THE REVIEW PIPELINE</span><div><b>01</b><span>Submit original writing</span></div><div><b>02</b><span>Inspect AI suggestions</span></div><div><b>03</b><span>Verify & publish a report</span></div></aside></section>
      <div className="notice"><span className="notice-dot" /><div><strong>{config?.mode === 'gemini' ? 'Gemini provider · server-side credentials' : 'Mock provider · no external AI calls'}</strong><p>Synthetic content only. {config?.mode === 'gemini' ? 'Submitted text is sent to Google for analysis.' : 'Estimates are illustrative, not a real assessment.'} No production accounts or student records.</p></div></div>
      {error && <div className="error" role="alert">{error}</div>}
      <nav className="tabs" aria-label="Workflow"><button className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>01 Write</button><button className={tab === 'review' ? 'active' : ''} disabled={!submission} onClick={() => setTab('review')}>02 Review</button><button className={tab === 'report' ? 'active' : ''} disabled={!report} onClick={() => setTab('report')}>03 Report</button></nav>
      {tab === 'write' && <section className="workspace write-grid"><div className="panel task"><p className="eyebrow">ORIGINAL DEMONSTRATION TASK · TASK 2</p><h2>A quieter place to read</h2><p>{config?.prompt ?? 'Loading demonstration task…'}</p><div className="task-note">Written specifically for this demo. No commercial examination material is used.</div></div><div className="panel"><div className="panel-heading"><h2>Your synthetic response</h2><button className="text-button" disabled={busy} onClick={() => setText(DEMO_RESPONSE)}>Load sample</button></div><label className="sr-only" htmlFor="response">Synthetic writing response</label><textarea id="response" className="response-input" value={text} onChange={e => setText(e.target.value)} maxLength={5000} /><div className="editor-bottom"><span>{text.trim().split(/\s+/).filter(Boolean).length} words · Original text stays intact</span><button className="primary" disabled={busy || !config || text.trim().length < 20} onClick={submit}>{busy ? 'Submitting…' : 'Submit synthetic essay →'}</button></div></div></section>}
      {tab === 'review' && submission && <section className="workspace review-grid"><div className="panel original"><p className="eyebrow">IMMUTABLE SUBMISSION</p><h2>Original writing</h2><Essay text={submission.response} annotations={annotations} />{submission.analysis && <div className="estimate"><span>AI draft estimate</span><strong>{submission.analysis.overall_band?.toFixed(1)}</strong><small>{submission.analysis.scoring_stage?.provider === 'mock' ? 'Illustrative mock estimate' : 'Requires human interpretation'}</small></div>}</div><div className="review-column"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">HUMAN REVIEW</p><h2>{submission.analysis ? `${annotations.length - pending} / ${annotations.length} suggestions resolved` : 'Generate a review draft'}</h2></div>{submission.analysis && <span className="tag">{readOnly ? 'Published' : 'Draft'}</span>}</div>{!submission.analysis ? <><p>Scoring and feedback run in separate stages. Accept, edit, or reject each suggestion before publishing.</p><button className="primary" disabled={busy} onClick={analyze}>{busy ? 'Analyzing…' : config?.mode === 'gemini' ? 'Analyze with Gemini →' : 'Generate mock feedback →'}</button></> : <><div className="progress"><span style={{ width: `${annotations.length ? (annotations.length - pending) / annotations.length * 100 : 100}%` }} /></div><p className="muted">Suggestions are anchored to exact characters. Decisions never change the submitted essay.</p></>}{submission.analysis?.feedback_unavailable && <div className="error">Feedback was unavailable; scoring was preserved.<button disabled={busy} onClick={analyze}>Retry feedback</button></div>}</div>
        {annotations.map(item => <SuggestionCard key={item.id} item={item} busy={busy || !!readOnly} decide={decide} />)}
        {submission.analysis && !readOnly && <div className="panel verification"><p className="eyebrow">VERIFICATION & PUBLICATION</p><h2>Reviewer estimates</h2><p className="muted">Separate from the frozen AI estimates. This demo does not issue official grades.</p><div className="score-inputs">{(Object.keys(scoreLabels) as (keyof FinalScores)[]).map(key => <label key={key}>{scoreLabels[key]}<input type="number" min="0" max="9" step="0.5" value={scores[key]} onChange={e => setScores({ ...scores, [key]: Number(e.target.value) })} /></label>)}</div><label>Reviewer note<textarea value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} placeholder="Explain what you verified and what the writer should practise next." /></label><label className="check"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />I have checked the response, suggestions, and estimates.</label><button className="primary" disabled={busy || pending > 0 || !verified || notes.trim().length < 10 || submission.analysis.feedback_unavailable} onClick={publish}>{busy ? 'Publishing…' : 'Publish verified demo report →'}</button>{pending > 0 && <small>Resolve {pending} remaining suggestion{pending === 1 ? '' : 's'} first.</small>}</div>}
      </div></section>}
      {tab === 'report' && report && <section className="workspace"><div className="panel report"><div className="panel-heading"><div><p className="eyebrow">VERIFIED DEMO REPORT</p><h2>Feedback ready for the writer</h2></div><span className="tag">Published snapshot</span></div><div className="report-score"><strong>{report.finalBand.toFixed(1)}</strong><div>Reviewer estimate<p className="muted">AI draft: {report.aiEstimate.toFixed(1)} · Not an official result</p></div></div><div className="report-columns"><div><h3>Reviewer note</h3><p>{report.notes}</p><h3>Accepted feedback</h3>{report.annotations.length ? report.annotations.map(a => <div className="report-item" key={a.id}><strong>{a.issue}</strong><p><del>{a.original_text}</del> → {a.suggested_revision}</p><span>{a.explanation}</span></div>) : <p>No suggestions were accepted.</p>}</div><div><h3>Original response</h3><Essay text={report.response} annotations={report.annotations} /></div></div><p className="muted">This report is a read-only snapshot. Create a new submission to continue the demonstration.</p><button onClick={() => { setTab('write'); }}>Start another submission</button></div></section>}
    </main><footer>React · TypeScript · Node/Express · Two-stage AI review <span>Local demo. Data resets when the API restarts.</span></footer>
  </div>;
}
