"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import type { QualityUser } from "@/app/auth";
import type { MyReportsData } from "@/lib/platform/staff-data";

const statusLabels: Record<string, string> = { submitted: "Submitted", ai_triaged: "Assisted draft", needs_info: "Needs information", reproduced: "Reproduced", accepted: "Accepted", supporting_evidence: "Supporting evidence", assigned: "Assigned", fixed: "Fixed · awaiting re-test", retested: "Retested", closed: "Closed", rejected: "Not accepted" };

export function MyReports({ user, initialData }: { user: QualityUser; initialData: MyReportsData }) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/my-reports", { cache: "no-store" });
    const payload = await response.json() as { data?: MyReportsData };
    if (response.ok && payload.data) setData(payload.data);
  }

  async function markRead() {
    setBusy(true);
    await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await refresh();
    setBusy(false);
  }

  async function reply(event: FormEvent<HTMLFormElement>, reportId: string) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/my-reports/${reportId}/reply`, { method: "POST", body: new FormData(event.currentTarget) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The response could not be sent.");
      setReplyingId(null);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The response could not be sent."); }
    finally { setBusy(false); }
  }

  return (
    <main className="staff-shell reports-shell">
      <header className="staff-header">
        <Link className="staff-brand" href="/report"><span className="brand-mark" aria-hidden="true"><i /><b /></span><span><strong>SITESCOUT</strong><small>STAFF REPORTING</small></span></Link>
        <nav><Link href="/report">Report an issue</Link><Link className="active" href="/my-reports">My Reports</Link>{user.role !== "reporter" ? <Link href="/">Control room</Link> : null}</nav>
        <div><strong>{user.displayName}</strong><small>{user.role.replaceAll("_", " ")}</small></div>
      </header>
      <section className="reports-hero"><div><p className="eyebrow">YOUR CONTRIBUTIONS</p><h1>Every report stays traceable.</h1><p>See what was accepted, what supports an existing finding and what has moved through fix and re-test.</p></div><div><strong>{data.reports.length}</strong><span>reports</span><strong>{data.unreadNotifications}</strong><span>new updates</span></div></section>
      <div className="reports-layout">
        <section className="panel report-list-panel">
          <div className="panel-heading"><div><p className="kicker">MY REPORTS</p><h2>Latest activity</h2></div><button onClick={refresh}>Refresh</button></div>
          {data.reports.length ? data.reports.map((report) => <article className="my-report-card" key={report.id}>
            <div><span className={`workflow-chip ${report.workflowStatus}`}>{statusLabels[report.workflowStatus] ?? report.workflowStatus}</span><small>{new Date(report.createdAt).toLocaleDateString("en-GB")}</small></div>
            {report.privacyClassification === "restricted_security" ? <span className="security-restricted-chip">Restricted security report</span> : null}
            <h3>{report.title}</h3><p>{report.description}</p>
            <a href={report.url} target="_blank" rel="noreferrer">Open reported page &#8599;</a>
            {report.findingId ? <b>Canonical finding · {report.findingId}</b> : null}{report.assignedTo ? <small>Assigned to {report.assignedTo}</small> : null}
            <div className="report-evidence-links">{report.evidence.map((asset, index) => <a className="evidence-link" href={`/api/evidence/${asset.id}`} target="_blank" rel="noreferrer" key={asset.id}>Private screenshot {index + 1}</a>)}</div>
            {report.messages.length ? <div className="report-thread"><p className="kicker">CONVERSATION</p>{report.messages.map((message) => <article className={message.messageType === "information_request" ? "validator-message" : "reporter-message"} key={message.id}><div><strong>{message.messageType === "information_request" ? "Validator" : "You"}</strong><small>{new Date(message.createdAt).toLocaleString("en-GB")}</small></div><p>{message.body}</p>{message.evidenceAssetId ? <a href={`/api/evidence/${message.evidenceAssetId}`} target="_blank" rel="noreferrer">View attached evidence</a> : null}</article>)}</div> : null}
            {report.workflowStatus === "needs_info" ? replyingId === report.id ? <form className="report-reply-form" onSubmit={(event) => reply(event, report.id)}>
              <label>Your response<textarea name="message" required rows={4} maxLength={4000} placeholder="Answer the validator's question and add any reproduction detail." /></label>
              <label className="reply-upload">Optional additional screenshot (PNG)<input name="screenshot" type="file" accept="image/png" /></label>
              <label className="privacy-check"><input name="privacyConfirmed" type="checkbox" value="true" /><span>If attaching a screenshot, I confirm it contains only approved public website content.</span></label>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <div><button type="button" onClick={() => setReplyingId(null)}>Cancel</button><button disabled={busy}>Send response</button></div>
            </form> : <button className="reply-open" onClick={() => { setError(""); setReplyingId(report.id); }}>Respond with more information</button> : null}
          </article>) : <div className="empty positive">No reports yet. Your first contribution will appear here.</div>}
        </section>
        <aside className="panel notification-panel">
          <div className="panel-heading"><div><p className="kicker">STATUS UPDATES</p><h2>Notifications</h2></div>{data.unreadNotifications ? <button disabled={busy} onClick={markRead}>Mark read</button> : null}</div>
          {data.notifications.length ? data.notifications.map((notification) => <article className={notification.readAt ? "" : "unread"} key={notification.id}><span>{notification.readAt ? "✓" : "•"}</span><div><strong>{notification.title}</strong><p>{notification.body}</p><small>{new Date(notification.createdAt).toLocaleString("en-GB")}</small></div></article>) : <div className="empty">No status updates yet.</div>}
          <div className="ticket-gate"><p className="kicker">DEVELOPER HANDOFF</p><strong>Deliberately gated</strong><p>Reports enter the canonical audit first. External tickets will be enabled only after the pilot workflow is stable.</p></div>
        </aside>
      </div>
    </main>
  );
}
