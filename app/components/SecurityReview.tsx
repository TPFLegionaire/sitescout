"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import type { QualityUser } from "@/app/auth";
import type { SecurityCandidateRow, SecurityImportRunRow, SecurityReviewView } from "@/lib/platform/security/security-data";

const DECISIONS: Array<{ id: string; label: string }> = [
  { id: "reproducible", label: "Reproducible & actionable" },
  { id: "plausible", label: "Plausible, insufficient evidence" },
  { id: "duplicate", label: "Duplicate / supporting" },
  { id: "false_positive", label: "False positive" },
  { id: "out_of_scope", label: "Out of scope" },
  { id: "unsafe_evidence", label: "Unsafe / oversensitive evidence" },
];

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending review",
  awaiting_second_check: "Awaiting second check",
  reproducible: "Reproducible",
  plausible: "Plausible",
  duplicate: "Duplicate",
  false_positive: "False positive",
  out_of_scope: "Out of scope",
  unsafe_evidence: "Unsafe evidence",
};

const SEVERITY_TONE: Record<string, string> = { critical: "#b4462f", high: "#c65f2a", medium: "#9a6a12", low: "#4d7c53", info: "#5a6b86", unknown: "#747c93" };
const STATUS_TONE: Record<string, string> = { pending: "#747c93", awaiting_second_check: "#9a6a12", reproducible: "#1f8a5b", false_positive: "#8a91a3", duplicate: "#8a91a3", out_of_scope: "#8a91a3", unsafe_evidence: "#b4462f", plausible: "#5a6b86" };

export function SecurityReview({ user, initial }: { user: QualityUser; initial: SecurityReviewView }) {
  const [view, setView] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const candidatesByRun = groupByRun(view.candidates);

  async function refresh() {
    const response = await fetch("/api/security/imports", { cache: "no-store" });
    const payload = (await response.json()) as { data?: SecurityReviewView };
    if (response.ok && payload.data) setView(payload.data);
  }

  async function review(event: FormEvent<HTMLFormElement>, candidateId: string) {
    event.preventDefault();
    setBusyId(candidateId);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/security/candidates/${candidateId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: form.get("decision"), note: form.get("note") }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; reviewStatus?: string; awaitingSecondCheck?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "The review could not be recorded.");
      setNotice({
        kind: "ok",
        text: payload.awaitingSecondCheck ? "Recorded. A different reviewer must confirm this high/critical candidate." : `Recorded as “${STATUS_LABELS[payload.reviewStatus ?? ""] ?? payload.reviewStatus}”.`,
      });
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
        <Link className="staff-brand" href="/">
          <span className="brand-mark" aria-hidden="true"><i /><b /></span>
          <span><strong>SITESCOUT</strong><small>SECURITY REVIEW</small></span>
        </Link>
        <nav><Link href="/">Control room</Link><Link className="active" href="/security">Security review</Link></nav>
        <div><strong>{user.displayName}</strong><small>{user.role.replaceAll("_", " ")}</small></div>
      </header>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 20px 40px", display: "grid", gap: 18 }}>
        <section className="panel" style={{ padding: 20 }}>
          <p className="kicker">RESTRICTED · SECURITY REVIEW</p>
          <h2 style={{ margin: "6px 0 0", fontSize: 19, letterSpacing: "-.025em" }}>Imported Strix candidates</h2>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
            Candidates are <strong>untrusted, sanitised evidence</strong> imported from Strix run separately against a disposable target.
            Raw exploit material stays in the restricted artifact. <strong>No candidate becomes a canonical finding automatically</strong>, and a high or critical “reproducible” verdict needs a second, different reviewer.
          </p>
        </section>

        {notice ? <div className={`notice ${notice.kind}`} role="status"><span>{notice.kind === "ok" ? "✓" : "!"}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div> : null}

        {view.imports.length ? (
          view.imports.map((run) => <ImportBlock key={run.id} run={run} candidates={candidatesByRun.get(run.id) ?? []} busyId={busyId} onReview={review} />)
        ) : (
          <section className="panel" style={{ padding: 20 }}><div className="empty">No Strix imports yet. Import a report through the API to begin an evaluation.</div></section>
        )}
      </div>
    </main>
  );
}

function ImportBlock({ run, candidates, busyId, onReview }: { run: SecurityImportRunRow; candidates: SecurityCandidateRow[]; busyId: string | null; onReview: (event: FormEvent<HTMLFormElement>, candidateId: string) => void }) {
  const limitations = parseStringArray(run.limitationsJson);
  return (
    <section className="panel" style={{ padding: 20 }}>
      <div className="panel-heading">
        <div>
          <p className="kicker">IMPORT · {run.source.toUpperCase()}{run.sourceVersion ? ` ${run.sourceVersion}` : ""}</p>
          <h2>{run.targetLabel}</h2>
        </div>
        <a className="target-link" href={`/api/security/artifacts/${run.id}`} target="_blank" rel="noreferrer"><span>Raw artifact</span><i aria-hidden="true">↓</i></a>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
        {run.candidateCount} candidate{run.candidateCount === 1 ? "" : "s"} · imported {formatDate(run.createdAt)} by {run.importedBy}
        {run.scanMode ? ` · mode ${run.scanMode}` : ""}{run.model ? ` · model ${run.model}` : ""}{run.imageDigest ? ` · image ${run.imageDigest.slice(0, 20)}…` : ""}
      </div>
      {limitations.length ? (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(154,106,18,.08)", border: "1px solid rgba(154,106,18,.25)", fontSize: 12, color: "var(--muted)" }}>
          {limitations.map((line, index) => <div key={index}>{line}</div>)}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {candidates.length ? candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} busy={busyId === candidate.id} onReview={onReview} />) : <div className="empty">No candidates in this import.</div>}
      </div>
    </section>
  );
}

function CandidateCard({ candidate, busy, onReview }: { candidate: SecurityCandidateRow; busy: boolean; onReview: (event: FormEvent<HTMLFormElement>, candidateId: string) => void }) {
  return (
    <article className="panel" style={{ padding: 16, boxShadow: "none" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#fff", background: SEVERITY_TONE[candidate.severity] ?? "#747c93", padding: "2px 7px", borderRadius: 5 }}>{candidate.severity}</span>
          <strong style={{ fontSize: 15 }}>{candidate.title}</strong>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: STATUS_TONE[candidate.reviewStatus] ?? "var(--muted)" }}>{STATUS_LABELS[candidate.reviewStatus] ?? candidate.reviewStatus}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
        {[candidate.cwe, candidate.method && `${candidate.method} ${candidate.endpoint}`, !candidate.method && candidate.endpoint, candidate.cvssVector].filter(Boolean).join(" · ")}
      </div>
      {candidate.summary ? <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.5 }}>{candidate.summary}</p> : null}
      {candidate.remediation ? <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}><strong>Remediation:</strong> {candidate.remediation}</p> : null}
      {candidate.reviewedBy ? <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--muted)" }}>Reviewed by {candidate.reviewedBy}{candidate.secondCheckBy ? `, confirmed by ${candidate.secondCheckBy}` : ""}{candidate.reviewNote ? ` — “${candidate.reviewNote}”` : ""}</p> : null}

      <form onSubmit={(event) => onReview(event, candidate.id)} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <select name="decision" defaultValue="" required aria-label="Decision">
          <option value="" disabled>Classify…</option>
          {DECISIONS.map((decision) => <option key={decision.id} value={decision.id}>{decision.label}</option>)}
        </select>
        <input name="note" placeholder="Note (optional)" maxLength={2000} style={{ flex: "1 1 220px" }} />
        <button className="primary small" disabled={busy} type="submit">{busy ? "Saving…" : "Record"}</button>
      </form>
    </article>
  );
}

function groupByRun(candidates: SecurityCandidateRow[]) {
  const map = new Map<string, SecurityCandidateRow[]>();
  for (const candidate of candidates) {
    const list = map.get(candidate.importRunId);
    if (list) list.push(candidate);
    else map.set(candidate.importRunId, [candidate]);
  }
  return map;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
