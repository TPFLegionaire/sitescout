"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import type { QualityUser } from "@/app/auth";
import type { SecurityCandidateReviewRow, SecurityCandidateRow, SecurityImportRunRow, SecurityReviewView } from "@/lib/platform/security/security-data";

const DECISIONS = [
  ["reproducible", "Reproducible & actionable"], ["plausible", "Plausible, insufficient evidence"],
  ["duplicate", "Duplicate / supporting"], ["false_positive", "False positive"],
  ["out_of_scope", "Out of scope"], ["unsafe_evidence", "Unsafe / oversensitive evidence"],
] as const;
const STATUS_LABELS: Record<string, string> = { pending: "Pending review", awaiting_second_check: "Awaiting second check", reproducible: "Reproducible", plausible: "Plausible", duplicate: "Duplicate", false_positive: "False positive", out_of_scope: "Out of scope", unsafe_evidence: "Unsafe evidence" };
const SEVERITY_TONE: Record<string, string> = { critical: "#b4462f", high: "#c65f2a", medium: "#9a6a12", low: "#4d7c53", info: "#5a6b86", unknown: "#747c93" };
const STATUS_TONE: Record<string, string> = { pending: "#747c93", awaiting_second_check: "#9a6a12", reproducible: "#1f8a5b", false_positive: "#8a91a3", duplicate: "#8a91a3", out_of_scope: "#8a91a3", unsafe_evidence: "#b4462f", plausible: "#5a6b86" };

export function SecurityReview({ user, initial }: { user: QualityUser; initial: SecurityReviewView }) {
  const [view, setView] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const candidatesByRun = groupByRun(view.candidates);
  const reviewsByCandidate = groupReviews(view.reviews);

  async function refresh() {
    const response = await fetch("/api/security/imports", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { data?: SecurityReviewView; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.error ?? "The security review could not be refreshed.");
    setView(payload.data);
  }

  async function importReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setImportBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/security/imports", { method: "POST", body: new FormData(formElement) });
      const payload = (await response.json()) as { ok?: boolean; error?: string; idempotent?: boolean; candidateCount?: number };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "The Strix report could not be imported.");
      setNotice({ kind: "ok", text: payload.idempotent ? "This exact report is already registered for the selected target." : `Imported ${payload.candidateCount ?? 0} sanitised candidate(s) for human review.` });
      formElement.reset();
      await refresh();
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "The Strix report could not be imported." });
    } finally {
      setImportBusy(false);
    }
  }

  async function review(event: FormEvent<HTMLFormElement>, candidateId: string) {
    event.preventDefault();
    setBusyId(candidateId);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/security/candidates/${candidateId}/review`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: form.get("decision"), note: form.get("note"), reviewMinutes: form.get("reviewMinutes") || undefined }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; reviewStatus?: string; awaitingSecondCheck?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "The review could not be recorded.");
      setNotice({ kind: "ok", text: payload.awaitingSecondCheck ? "Recorded. A different reviewer must perform the mandatory second check." : `Recorded as “${STATUS_LABELS[payload.reviewStatus ?? ""] ?? payload.reviewStatus}”.` });
      await refresh();
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "The review could not be recorded." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="staff-shell">
      <header className="staff-header">
        <Link className="staff-brand" href="/"><span className="brand-mark" aria-hidden="true"><i /><b /></span><span><strong>SITESCOUT</strong><small>SECURITY REVIEW</small></span></Link>
        <nav><Link href="/">Control room</Link><Link className="active" href="/security">Security review</Link></nav>
        <div><strong>{user.displayName}</strong><small>{user.role.replaceAll("_", " ")}</small></div>
      </header>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 20px 40px", display: "grid", gap: 18 }}>
        <section className="panel" style={{ padding: 20 }}>
          <p className="kicker">RESTRICTED · SECURITY REVIEW</p><h2 style={{ margin: "6px 0 0", fontSize: 19 }}>Imported Strix candidates</h2>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
            Candidates are <strong>untrusted, sanitised evidence</strong> from Strix run separately against an approved disposable target. Raw exploit material stays in access-logged restricted storage. <strong>No candidate becomes a canonical finding automatically.</strong>
          </p>
        </section>

        <ImportForm targets={view.targets} busy={importBusy} onSubmit={importReport} />
        <Scorecard metrics={view.metrics} />
        {notice ? <div className={`notice ${notice.kind}`} role="status"><span>{notice.kind === "ok" ? "✓" : "!"}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div> : null}
        {view.imports.length ? view.imports.map((run) => (
          <ImportBlock key={run.id} run={run} candidates={candidatesByRun.get(run.id) ?? []} reviewsByCandidate={reviewsByCandidate} busyId={busyId} onReview={review} />
        )) : <section className="panel" style={{ padding: 20 }}><div className="empty">No Strix imports yet.</div></section>}
      </div>
    </main>
  );
}

function ImportForm({ targets, busy, onSubmit }: { targets: SecurityReviewView["targets"]; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <section className="panel" style={{ padding: 20 }}>
    <div className="panel-heading"><div><p className="kicker">IMPORT-ONLY BOUNDARY</p><h2>Upload a completed Strix report</h2></div></div>
    <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12 }}>SiteScout never launches Strix. Only reports produced separately for an explicitly approved registered target are accepted.</p>
    {targets.length ? <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 14 }}>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label style={fieldStyle}><span style={labelStyle}>Approved target</span><select name="targetId" required defaultValue=""><option value="" disabled>Select disposable target…</option>{targets.map((target) => <option key={target.targetId} value={target.targetId}>{target.siteName} · {target.targetName} · {target.environment}</option>)}</select></label>
        <label style={fieldStyle}><span style={labelStyle}>JSON or SARIF report</span><input name="report" type="file" required accept="application/json,.json,.sarif" /></label>
        <label style={fieldStyle}><span style={labelStyle}>Strix version (optional)</span><input name="sourceVersion" maxLength={50} /></label>
        <label style={fieldStyle}><span style={labelStyle}>External scan mode (optional)</span><input name="scanMode" maxLength={50} /></label>
      </div>
      <div><button className="primary small" disabled={busy} type="submit">{busy ? "Importing…" : "Import restricted report"}</button></div>
    </form> : <div className="empty" style={{ marginTop: 14 }}>No disposable target is registered, assigned to you and approved in deployment configuration.</div>}
  </section>;
}

function Scorecard({ metrics }: { metrics: SecurityReviewView["metrics"] }) {
  return <section className="panel" style={{ padding: 20 }}>
    <div className="panel-heading"><div><p className="kicker">EVALUATION SCORECARD</p><h2>Is Strix worth continuing?</h2></div></div>
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", marginTop: 14 }}>
      <Tile label="Imports" value={String(metrics.importCount)} detail={metrics.emptyImports ? `${metrics.emptyImports} empty · incomplete` : "candidates returned"} />
      <Tile label="Candidates" value={String(metrics.total)} detail={`${metrics.reviewedFinal} finalised`} /><Tile label="Pending" value={String(metrics.pending)} detail="awaiting first review" />
      <Tile label="2nd check" value={String(metrics.awaitingSecondCheck)} detail="high/critical/unknown" tone={metrics.awaitingSecondCheck ? "#9a6a12" : undefined} />
      <Tile label="False-positive" value={pct(metrics.rates.false_positive)} detail="of final reviews" tone="#b4462f" /><Tile label="Reproducible" value={pct(metrics.rates.reproducible)} detail="actionable" tone="#1f8a5b" />
      <Tile label="Duplicate" value={pct(metrics.rates.duplicate)} detail="of final reviews" /><Tile label="Unsafe evidence" value={String(metrics.byStatus.unsafe_evidence ?? 0)} detail="human classified" />
    </div>
    <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}><strong>Review burden:</strong> {metrics.reviewTime.medianPerCandidate != null ? `${round(metrics.reviewTime.medianPerCandidate)} min median` : "no timed reviews yet"}{metrics.reviewTime.perAccepted != null ? ` · ${round(metrics.reviewTime.perAccepted)} min per accepted issue` : ""}{metrics.backlog.projectedMinutes != null ? ` · backlog ≈ ${round(metrics.backlog.projectedMinutes)} min` : ""}.</div>
  </section>;
}

function Tile({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px" }}><div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#747c93" }}>{label}</div><div style={{ marginTop: 4, fontSize: 24, color: tone ?? "inherit" }}>{value}</div><div style={{ fontSize: 10, color: "#8c93a5" }}>{detail}</div></div>;
}

function ImportBlock({ run, candidates, reviewsByCandidate, busyId, onReview }: { run: SecurityImportRunRow; candidates: SecurityCandidateRow[]; reviewsByCandidate: Map<string, SecurityCandidateReviewRow[]>; busyId: string | null; onReview: (event: FormEvent<HTMLFormElement>, id: string) => void }) {
  const limitations = parseStringArray(run.limitationsJson);
  return <section className="panel" style={{ padding: 20 }}>
    <div className="panel-heading"><div><p className="kicker">IMPORT · {run.source.toUpperCase()}</p><h2>{run.targetLabel}</h2></div>{run.deletedAt ? <span style={{ fontSize: 11, color: "var(--muted)" }}>Raw artifact deleted</span> : <a className="target-link" href={`/api/security/artifacts/${run.id}`} target="_blank" rel="noreferrer"><span>Raw artifact</span><i aria-hidden="true">↓</i></a>}</div>
    <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>{run.candidateCount} candidate(s) · imported {formatDate(run.createdAt)} by {run.importedBy} · raw retention until {formatDate(run.retentionUntil)}{run.legalHold ? " · legal hold" : ""}</div>
    {limitations.length ? <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(154,106,18,.08)", fontSize: 12 }}>{limitations.map((line, i) => <div key={i}>{line}</div>)}</div> : null}
    <div style={{ display: "grid", gap: 14, marginTop: 16 }}>{candidates.length ? candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} reviews={reviewsByCandidate.get(candidate.id) ?? []} busy={busyId === candidate.id} onReview={onReview} />) : <div className="empty">No candidates in this import.</div>}</div>
  </section>;
}

function CandidateCard({ candidate, reviews, busy, onReview }: { candidate: SecurityCandidateRow; reviews: SecurityCandidateReviewRow[]; busy: boolean; onReview: (event: FormEvent<HTMLFormElement>, id: string) => void }) {
  const flags = parseStringArray(candidate.sanitizationFlagsJson);
  const reviewable = candidate.reviewStatus === "pending" || candidate.reviewStatus === "awaiting_second_check";
  return <article className="panel" style={{ padding: 16, boxShadow: "none" }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}><div><span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: SEVERITY_TONE[candidate.severity] ?? "#747c93", padding: "2px 7px", borderRadius: 5 }}>{candidate.severity}</span> <strong>{candidate.title}</strong></div><span style={{ fontSize: 10, fontWeight: 700, color: STATUS_TONE[candidate.reviewStatus] ?? "var(--muted)" }}>{STATUS_LABELS[candidate.reviewStatus] ?? candidate.reviewStatus}</span></div>
    <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{[candidate.cwe, candidate.method && `${candidate.method} ${candidate.endpoint}`, !candidate.method && candidate.endpoint, candidate.cvssVector].filter(Boolean).join(" · ")}</div>
    {candidate.summary ? <p style={{ margin: "10px 0 0", fontSize: 13 }}>{candidate.summary}</p> : null}{candidate.remediation ? <p style={{ margin: "8px 0 0", fontSize: 12 }}><strong>Remediation:</strong> {candidate.remediation}</p> : null}
    {candidate.sanitizationStatus !== "clean" ? <div style={{ marginTop: 10, padding: 8, border: "1px solid rgba(180,70,47,.25)", borderRadius: 8, color: "#b4462f", fontSize: 11 }}><strong>{candidate.sanitizationStatus === "quarantined" ? "Restricted" : "Redacted"} evidence:</strong> {flags.join(", ") || "sensitive content removed"}. Use the access-logged artifact only when necessary.</div> : null}
    {reviews.length ? <div style={{ marginTop: 10, display: "grid", gap: 4 }}>{reviews.map((review) => <div key={review.id} style={{ fontSize: 11, color: "var(--muted)" }}><strong>{review.stage} check:</strong> {review.decision.replaceAll("_", " ")} by {review.reviewerEmail}{review.note ? ` — “${review.note}”` : ""}{review.reviewMinutes != null ? ` · ${review.reviewMinutes} min` : ""}</div>)}</div> : null}
    {reviewable ? <form onSubmit={(event) => onReview(event, candidate.id)} style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}><select name="decision" defaultValue="" required><option value="" disabled>Classify…</option>{DECISIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><input name="reviewMinutes" type="number" min={0} max={600} step={1} placeholder="min" style={{ width: 74 }} /><input name="note" placeholder="Note only — no credentials, traffic or payloads" maxLength={2000} style={{ flex: "1 1 240px" }} /><button className="primary small" disabled={busy} type="submit">{busy ? "Saving…" : "Record"}</button></form> : null}
  </article>;
}

const fieldStyle = { display: "grid", gap: 4 } as const;
const labelStyle = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "#747c93" } as const;
function pct(value: number) { return `${Math.round((value ?? 0) * 100)}%`; }
function round(value: number) { return String(Math.round(value)); }
function groupByRun(candidates: SecurityCandidateRow[]) { const map = new Map<string, SecurityCandidateRow[]>(); for (const item of candidates) map.set(item.importRunId, [...(map.get(item.importRunId) ?? []), item]); return map; }
function groupReviews(reviews: SecurityCandidateReviewRow[]) { const map = new Map<string, SecurityCandidateReviewRow[]>(); for (const item of reviews) map.set(item.candidateId, [...(map.get(item.candidateId) ?? []), item]); return map; }
function parseStringArray(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
