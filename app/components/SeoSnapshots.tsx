"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import type { QualityUser } from "@/app/auth";
import type { SeoBudget, SeoMetricRow, SeoSiteOption, SeoSnapshotRunRow, SeoSnapshotView } from "@/lib/platform/seo/seo-data";

const OPERATIONS: Array<{ id: string; label: string }> = [
  { id: "domain_overview", label: "Domain overview" },
  { id: "ranked_keywords", label: "Ranked keywords" },
  { id: "backlink_summary", label: "Backlink summary" },
];

const OPERATION_LABELS: Record<string, string> = Object.fromEntries(OPERATIONS.map((operation) => [operation.id, operation.label]));

const METRIC_LABELS: Record<string, string> = {
  organic_keywords: "Organic keywords",
  organic_traffic_estimate: "Estimated organic traffic",
  organic_positions_top1: "Keywords ranked #1",
  ranked_keywords_total: "Ranked keywords (total)",
  ranked_keywords_returned: "Ranked keywords (returned)",
  backlinks: "Backlinks",
  referring_domains: "Referring domains",
  backlink_rank: "Backlink rank",
};

const STATUS_TONE: Record<string, string> = { completed: "#1f8a5b", failed: "#b4462f", running: "#9a6a12" };

export function SeoSnapshots({ user, sites, selectedSiteId, initial }: { user: QualityUser; sites: SeoSiteOption[]; selectedSiteId: string; initial: SeoSnapshotView }) {
  const [siteId, setSiteId] = useState(selectedSiteId);
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const isAdmin = user.role === "administrator";
  const site = sites.find((candidate) => candidate.siteId === siteId);
  const metricsByRun = groupMetrics(view.metrics);

  async function refresh(nextSiteId: string) {
    const response = await fetch(`/api/seo/snapshots?siteId=${encodeURIComponent(nextSiteId)}`, { cache: "no-store" });
    const payload = (await response.json()) as { data?: SeoSnapshotView };
    if (response.ok && payload.data) setView(payload.data);
  }

  async function changeSite(nextSiteId: string) {
    setSiteId(nextSiteId);
    setNotice(null);
    await refresh(nextSiteId);
  }

  async function trigger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/seo/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId,
          targetId: form.get("targetId"),
          operation: form.get("operation"),
          dimensions: { country: form.get("country"), language: form.get("language"), device: form.get("device") },
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; idempotent?: boolean; hasUsableData?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "The SEO request could not be completed.");
      setNotice({
        kind: "ok",
        text: payload.idempotent
          ? "An identical snapshot already exists today, so no new request was made."
          : payload.hasUsableData
            ? "Snapshot captured."
            : "Request completed, but the provider returned no usable data.",
      });
      await refresh(siteId);
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "The SEO request could not be completed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="staff-shell">
      <header className="staff-header">
        <Link className="staff-brand" href="/">
          <span className="brand-mark" aria-hidden="true"><i /><b /></span>
          <span><strong>SITESCOUT</strong><small>SEO SNAPSHOTS</small></span>
        </Link>
        <nav><Link href="/">Control room</Link><Link className="active" href="/seo">SEO snapshots</Link></nav>
        <div><strong>{user.displayName}</strong><small>{user.role.replaceAll("_", " ")}</small></div>
      </header>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 20px 40px", display: "grid", gap: 18 }}>
        <section className="panel" style={{ padding: 20 }}>
          <p className="kicker">EXTERNAL SEO INTELLIGENCE</p>
          <h2 style={{ margin: "6px 0 0", fontSize: 19, letterSpacing: "-.025em" }}>Read-only SEO snapshots</h2>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
            Snapshots are external SEO intelligence captured from a registered target. They are not audit results.
            <strong> No finding, finding state or baseline is created or changed by anything on this page.</strong>
          </p>
          <SiteAndBudget sites={sites} siteId={siteId} onChangeSite={changeSite} budget={view.budget} />
        </section>

        {isAdmin ? (
          <section className="panel" style={{ padding: 20 }}>
            <div className="panel-heading"><div><p className="kicker">ADMINISTRATOR</p><h2>Capture a snapshot</h2></div></div>
            {site && site.targets.length ? (
              <form onSubmit={trigger} style={{ display: "grid", gap: 12, marginTop: 14 }}>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
                  <label style={fieldStyle}><span style={labelStyle}>Target</span>
                    <select name="targetId" required defaultValue="">
                      <option value="" disabled>Select a registered target…</option>
                      {site.targets.map((target) => <option key={target.targetId} value={target.targetId}>{target.targetName} · {target.environment}</option>)}
                    </select>
                  </label>
                  <label style={fieldStyle}><span style={labelStyle}>Operation</span>
                    <select name="operation" defaultValue="domain_overview">
                      {OPERATIONS.map((operation) => <option key={operation.id} value={operation.id}>{operation.label}</option>)}
                    </select>
                  </label>
                  <label style={fieldStyle}><span style={labelStyle}>Country</span><input name="country" defaultValue="gb" maxLength={2} required pattern="[A-Za-z]{2}" /></label>
                  <label style={fieldStyle}><span style={labelStyle}>Language</span><input name="language" defaultValue="en" maxLength={2} required pattern="[A-Za-z]{2}" /></label>
                  <label style={fieldStyle}><span style={labelStyle}>Device</span>
                    <select name="device" defaultValue="desktop"><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select>
                  </label>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button className="primary small" disabled={busy} type="submit">{busy ? "Requesting…" : "Capture snapshot"}</button>
                  <small style={{ color: "var(--muted)", fontSize: 11 }}>Manual, administrator-only. A registered target is used — never a typed URL.</small>
                </div>
              </form>
            ) : (
              <div className="empty">This site has no active targets to snapshot.</div>
            )}
          </section>
        ) : null}

        {notice ? <div className={`notice ${notice.kind}`} role="status"><span>{notice.kind === "ok" ? "✓" : "!"}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div> : null}

        <section className="panel" style={{ padding: 20 }}>
          <div className="panel-heading"><div><p className="kicker">CAPTURED SNAPSHOTS</p><h2>{view.snapshots.length} on record</h2></div></div>
          {view.snapshots.length ? (
            <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
              {view.snapshots.map((run) => <SnapshotCard key={run.id} run={run} metrics={metricsByRun.get(run.id) ?? []} />)}
            </div>
          ) : (
            <div className="empty">No snapshots captured for this site yet.</div>
          )}
        </section>
      </div>
    </main>
  );
}

function SiteAndBudget({ sites, siteId, onChangeSite, budget }: { sites: SeoSiteOption[]; siteId: string; onChangeSite: (value: string) => void; budget: SeoBudget }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", marginTop: 16 }}>
      <label style={fieldStyle}><span style={labelStyle}>Website</span>
        <select value={siteId} onChange={(event) => onChangeSite(event.target.value)} aria-label="Website">
          {sites.length ? sites.map((site) => <option key={site.siteId} value={site.siteId}>{site.siteName}</option>) : <option value="">No sites</option>}
        </select>
      </label>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        <span style={labelStyle}>Spend this month</span>
        <div style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink, inherit)", fontSize: 14, marginTop: 4 }}>
          {money(budget.monthlySpentUsd)} <span style={{ color: "var(--muted)" }}>/ {money(budget.monthlyCapUsd)} cap · {money(budget.perOperationCapUsd)} per request</span>
        </div>
      </div>
    </div>
  );
}

function SnapshotCard({ run, metrics }: { run: SeoSnapshotRunRow; metrics: SeoMetricRow[] }) {
  const dimensions = parseDimensions(run.dimensionsJson);
  const limitations = parseStringArray(run.limitationsJson);
  const cost = typeof run.costActual === "number" ? run.costActual : run.costEstimate;
  return (
    <article className="panel" style={{ padding: 16, boxShadow: "none" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <strong style={{ fontSize: 15 }}>{OPERATION_LABELS[run.operation] ?? run.operation}</strong>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: STATUS_TONE[run.status] ?? "var(--muted)" }}>{run.status}</span>
        </div>
        <small style={{ color: "var(--muted)", fontSize: 11 }}>{formatDate(run.requestedAt)}</small>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
        {dimensions.country.toUpperCase()} · {dimensions.language.toUpperCase()} · {dimensions.device} · source {run.source} · {money(cost)}
      </div>

      {metrics.length ? (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 12 }}>
          {metrics.map((metric, index) => (
            <div key={`${metric.metricKey}-${index}`} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#747c93" }}>{METRIC_LABELS[metric.metricKey] ?? metric.metricKey}</div>
              <div style={{ marginTop: 4, fontSize: 20, letterSpacing: "-.03em", fontVariantNumeric: "tabular-nums" }}>{formatValue(metric.valueJson)}</div>
            </div>
          ))}
        </div>
      ) : null}

      {limitations.length ? (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(180,70,47,.06)", border: "1px solid rgba(180,70,47,.2)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#b4462f" }}>Limitations</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--muted)" }}>{limitations.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </div>
      ) : null}

      <div style={{ marginTop: 12, fontSize: 10, color: "#8c93a5", textTransform: "uppercase", letterSpacing: ".06em" }}>
        External SEO intelligence · no finding or baseline changed{run.artifactSha256 ? ` · raw sha256 ${run.artifactSha256.slice(0, 12)}…` : ""}
      </div>
    </article>
  );
}

const fieldStyle = { display: "grid", gap: 4 } as const;
const labelStyle = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "#747c93" } as const;

function groupMetrics(metrics: SeoMetricRow[]) {
  const map = new Map<string, SeoMetricRow[]>();
  for (const metric of metrics) {
    const list = map.get(metric.snapshotRunId);
    if (list) list.push(metric);
    else map.set(metric.snapshotRunId, [metric]);
  }
  return map;
}

function parseDimensions(value: string): { country: string; language: string; device: string } {
  try {
    const parsed = JSON.parse(value) as { country?: string; language?: string; device?: string };
    return { country: parsed.country ?? "", language: parsed.language ?? "", device: parsed.device ?? "" };
  } catch {
    return { country: "", language: "", device: "" };
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function formatValue(value: string): string {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "number") return parsed.toLocaleString("en-GB");
    return String(parsed);
  } catch {
    return value;
  }
}

function money(value: number): string {
  return `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
