"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import type { QualityUser } from "@/app/auth";
import type { StaffReportingData } from "@/lib/platform/staff-data";

type Selection = { x: number; y: number; width: number; height: number };
type Duplicate = { id: string; title: string; category: string; score: number; reason: string };
type TriageDraft = {
  title: string; observed: string; expected: string; reproductionSteps: string[]; provisionalSeverity: string; hypotheses: string[];
  suggestedFindingId: string | null; duplicateCandidates: Duplicate[]; method: string; externalProcessing: boolean; warning: string | null;
};
export function StaffReporter({ user, initialData }: { user: QualityUser; initialData: StaffReportingData }) {
  const initialTarget = initialData.targets.find((target) => target.environment === "production") ?? initialData.targets[0];
  const formRef = useRef<HTMLFormElement>(null);
  const startedAtRef = useRef<number | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const editedRef = useRef<HTMLCanvasElement | null>(null);
  const originalRef = useRef<HTMLCanvasElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [targetId, setTargetId] = useState(initialTarget?.id ?? "");
  const [pageUrl, setPageUrl] = useState(initialTarget?.baseUrl ?? "");
  const [imageName, setImageName] = useState("");
  const [draft, setDraft] = useState<TriageDraft | null>(null);
  const [suggestedFindingId, setSuggestedFindingId] = useState("");
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState("");
  const [submittedId, setSubmittedId] = useState("");

  const drawPreview = useCallback((nextSelection: Selection | null) => {
    const preview = previewRef.current;
    const edited = editedRef.current;
    if (!preview || !edited) return;
    preview.width = edited.width;
    preview.height = edited.height;
    const context = preview.getContext("2d");
    if (!context) return;
    context.drawImage(edited, 0, 0);
    if (nextSelection) {
      context.save();
      context.strokeStyle = "#e62b74";
      context.fillStyle = "rgba(230, 43, 116, .12)";
      context.lineWidth = Math.max(2, edited.width / 700);
      context.setLineDash([12, 8]);
      context.fillRect(nextSelection.x, nextSelection.y, nextSelection.width, nextSelection.height);
      context.strokeRect(nextSelection.x, nextSelection.y, nextSelection.width, nextSelection.height);
      context.restore();
    }
  }, []);

  const loadImage = useCallback(async (file: File) => {
    setError("");
    if (!file.type.startsWith("image/")) return setError("Choose or paste an image file.");
    const url = URL.createObjectURL(file);
    try {
      const image = await loadBrowserImage(url);
      const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d", { alpha: false })?.drawImage(image, 0, 0, canvas.width, canvas.height);
      editedRef.current = canvas;
      originalRef.current = cloneCanvas(canvas);
      setHasImage(true);
      setImageName(file.name || "pasted-screenshot");
      setSelection(null);
      requestAnimationFrame(() => drawPreview(null));
    } finally { URL.revokeObjectURL(url); }
  }, [drawPreview]);

  useEffect(() => {
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((candidate) => candidate.type.startsWith("image/"));
      if (file) { event.preventDefault(); void loadImage(file); }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [loadImage]);

  useEffect(() => { drawPreview(selection); }, [drawPreview, selection]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = previewRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * (canvas.width / bounds.width), y: (event.clientY - bounds.top) * (canvas.height / bounds.height) };
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!editedRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = point(event);
    setSelection(null);
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const start = dragStartRef.current;
    if (!start) return;
    const current = point(event);
    setSelection(normalizeSelection(start, current));
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragStartRef.current = null;
  }

  function applyCrop() {
    const edited = editedRef.current;
    if (!edited || !selection || selection.width < 5 || selection.height < 5) return;
    const next = document.createElement("canvas");
    next.width = Math.round(selection.width);
    next.height = Math.round(selection.height);
    next.getContext("2d", { alpha: false })?.drawImage(edited, selection.x, selection.y, selection.width, selection.height, 0, 0, next.width, next.height);
    editedRef.current = next;
    setSelection(null);
    requestAnimationFrame(() => drawPreview(null));
  }

  function applyRedaction() {
    const edited = editedRef.current;
    if (!edited || !selection) return;
    const context = edited.getContext("2d");
    if (!context) return;
    context.fillStyle = "#111628";
    context.fillRect(selection.x, selection.y, selection.width, selection.height);
    setSelection(null);
    requestAnimationFrame(() => drawPreview(null));
  }

  function applyBlur() {
    const edited = editedRef.current;
    if (!edited || !selection) return;
    const temporary = document.createElement("canvas");
    temporary.width = Math.max(1, Math.round(selection.width));
    temporary.height = Math.max(1, Math.round(selection.height));
    temporary.getContext("2d")?.drawImage(edited, selection.x, selection.y, selection.width, selection.height, 0, 0, temporary.width, temporary.height);
    const context = edited.getContext("2d");
    if (!context) return;
    context.save();
    context.filter = "blur(14px)";
    context.drawImage(temporary, selection.x, selection.y, selection.width, selection.height);
    context.restore();
    setSelection(null);
    requestAnimationFrame(() => drawPreview(null));
  }

  function resetImage() {
    if (!originalRef.current) return;
    editedRef.current = cloneCanvas(originalRef.current);
    setSelection(null);
    requestAnimationFrame(() => drawPreview(null));
  }

  async function prepareDraft() {
    const form = formRef.current;
    if (!form) return;
    const values = new FormData(form);
    setBusy("draft");
    setError("");
    try {
      const response = await fetch("/api/triage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId: values.get("targetId"), url: values.get("url"), description: values.get("description"), title: draft?.title, expected: draft?.expected, actual: draft?.observed }) });
      const payload = await response.json() as { ok?: boolean; draft?: TriageDraft; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error ?? "Could not prepare the draft.");
      setDraft(payload.draft);
      setSuggestedFindingId(payload.draft.suggestedFindingId ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare the draft."); }
    finally { setBusy(null); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const canvas = editedRef.current;
    if (!canvas) return setError("Paste or upload a screenshot first.");
    setBusy("submit");
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const screenshot = await privacySafePng(canvas, imageName || "screenshot");
      form.set("screenshot", screenshot);
      form.set("reportingVersion", "site-scout-v1");
      form.set("submissionDurationMs", String(startedAtRef.current === null ? 0 : Math.max(0, Date.now() - startedAtRef.current)));
      if (draft) {
        form.set("title", draft.title);
        form.set("expected", draft.expected);
        form.set("actual", draft.observed);
      }
      if (suggestedFindingId) form.set("suggestedFindingId", suggestedFindingId); else form.delete("suggestedFindingId");
      const response = await fetch("/api/observations", { method: "POST", body: form });
      const payload = await response.json() as { ok?: boolean; observationId?: string; error?: string };
      if (!response.ok || !payload.observationId) throw new Error(payload.error ?? "The report could not be submitted.");
      setSubmittedId(payload.observationId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The report could not be submitted."); }
    finally { setBusy(null); }
  }

  if (submittedId) return (
    <main className="staff-shell success-shell">
      <section className="staff-success">
        <span>✓</span><p className="eyebrow">REPORT RECEIVED</p><h1>Thank you. A validator will review it.</h1>
        <p>Reference <strong>{submittedId}</strong>. The original submission and every later decision remain in the audit trail.</p>
        <div><Link className="primary-link" href="/my-reports">View My Reports</Link><button onClick={() => window.location.reload()}>Report another issue</button></div>
      </section>
    </main>
  );

  return (
    <main className="staff-shell">
      <header className="staff-header">
        <Link className="staff-brand" href="/report"><span className="brand-mark" aria-hidden="true"><i /><b /></span><span><strong>SITESCOUT</strong><small>STAFF REPORTING</small></span></Link>
        <nav><Link className="active" href="/report">Report an issue</Link><Link href="/my-reports">My Reports</Link>{user.role !== "reporter" ? <Link href="/">Control room</Link> : null}</nav>
        <div><strong>{user.displayName}</strong><small>{user.role.replaceAll("_", " ")}</small></div>
      </header>
      <section className="report-intro"><div><p className="eyebrow">PRIVATE STAFF PILOT</p><h1>Show us what went wrong.</h1><p>Paste a screenshot, add one sentence, and send it to the quality team. Your screenshot stays private and every decision is human-reviewed.</p></div><aside><b>Under 20 seconds</b><span>Only three things are required</span></aside></section>
      <form ref={formRef} className="report-workspace" onSubmit={submit}>
        <section className="report-details panel">
          <div className="step-title"><span>1</span><div><p className="kicker">WHERE AND WHAT</p><h2>Describe the issue</h2></div></div>
          <label>Website and environment<select name="targetId" value={targetId} onChange={(event) => { const next = initialData.targets.find((target) => target.id === event.target.value); setTargetId(event.target.value); if (next && (!pageUrl || initialData.targets.some((target) => target.baseUrl === pageUrl))) setPageUrl(next.baseUrl); }}>{initialData.targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
          <label>Page URL<input name="url" type="url" required value={pageUrl} onChange={(event) => setPageUrl(event.target.value)} /></label>
          <label>What happened?<textarea name="description" required rows={5} maxLength={4000} placeholder="For example: the carousel next button does nothing on mobile." /></label>
          <label className="security-classification"><input name="securitySensitive" type="checkbox" value="true" /><span><b>Potential security concern</b> Restrict this report to the reporter, Validators and Administrators until it is deliberately assigned. Never include passwords, tokens or customer data.</span></label>
          <button className="assist-button" type="button" disabled={Boolean(busy)} onClick={prepareDraft}><span>✦</span>{busy === "draft" ? "Preparing draft…" : "Prepare report draft"}<small>{initialData.assistance.mode === "openai-text-assist" ? "Text-only AI; screenshot excluded" : "Private local assistance"}</small></button>
          {draft ? <div className="draft-card"><div className="draft-fields"><p className="kicker">ASSISTED DRAFT · EDIT BEFORE SUBMITTING</p><label>Short title<input value={draft.title} maxLength={240} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>Observed<textarea rows={3} value={draft.observed} onChange={(event) => setDraft({ ...draft, observed: event.target.value })} /></label><label>Expected<textarea rows={3} value={draft.expected} onChange={(event) => setDraft({ ...draft, expected: event.target.value })} /></label></div>{draft.warning ? <em>{draft.warning}</em> : null}{draft.duplicateCandidates.length ? <fieldset><legend>Possible existing finding</legend><label><input type="radio" checked={!suggestedFindingId} onChange={() => setSuggestedFindingId("")} />Treat as new</label>{draft.duplicateCandidates.map((candidate) => <label key={candidate.id}><input type="radio" checked={suggestedFindingId === candidate.id} onChange={() => setSuggestedFindingId(candidate.id)} /><span><b>{candidate.id} · {candidate.title}</b><small>{candidate.score}% wording match · validator decides</small></span></label>)}</fieldset> : null}</div> : null}
        </section>
        <section className="screenshot-editor panel">
          <div className="step-title"><span>2</span><div><p className="kicker">SCREENSHOT EVIDENCE</p><h2>Paste, crop and protect</h2></div></div>
          {!hasImage ? <label className="staff-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void loadImage(file); }}><span>⇧</span><strong>Paste or upload a screenshot</strong><small>Ctrl+V anywhere, drag it here, or choose a PNG, JPEG or WebP</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadImage(file); }} /></label> : <div className="canvas-wrap"><canvas ref={previewRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label="Screenshot editor. Drag to select an area." /><small>Drag over an area, then crop, blur or redact it.</small></div>}
          {hasImage ? <div className="editor-tools"><button type="button" disabled={!selection} onClick={applyCrop}>Crop</button><button type="button" disabled={!selection} onClick={applyBlur}>Blur</button><button type="button" disabled={!selection} onClick={applyRedaction}>Redact</button><button type="button" onClick={resetImage}>Reset</button><label>Replace<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadImage(file); }} /></label></div> : null}
          <label className="privacy-check staff-privacy"><input name="privacyConfirmed" type="checkbox" value="true" required /><span>I confirm the edited screenshot contains only approved public website content—no staff, customer, personal or confidential information.</span></label>
          <button className="staff-submit" disabled={Boolean(busy) || !hasImage}>{busy === "submit" ? "Sending securely…" : "Submit for human review"}</button>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <p className="privacy-note">The browser creates a new PNG from your edited image before upload. Screenshots are never sent to the optional AI service.</p>
        </section>
      </form>
      <footer className="staff-footer"><span>Named staff allowlist · private evidence · attributable decisions</span><span>Privacy policy: {initialData.privacy.mode} · developer tickets: {initialData.ticketing.status}</span></footer>
    </main>
  );
}

function normalizeSelection(start: { x: number; y: number }, end: { x: number; y: number }): Selection {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

function cloneCanvas(source: HTMLCanvasElement) {
  const clone = document.createElement("canvas");
  clone.width = source.width;
  clone.height = source.height;
  clone.getContext("2d", { alpha: false })?.drawImage(source, 0, 0);
  return clone;
}

function loadBrowserImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The screenshot could not be opened."));
    image.src = url;
  });
}

async function privacySafePng(source: HTMLCanvasElement, originalName: string) {
  let output = cloneCanvas(source);
  let blob = await canvasBlob(output);
  while (blob.size > 5 * 1024 * 1024 && output.width > 640 && output.height > 360) {
    const reduced = document.createElement("canvas");
    reduced.width = Math.round(output.width * 0.82);
    reduced.height = Math.round(output.height * 0.82);
    reduced.getContext("2d", { alpha: false })?.drawImage(output, 0, 0, reduced.width, reduced.height);
    output = reduced;
    blob = await canvasBlob(output);
  }
  if (blob.size > 5 * 1024 * 1024) throw new Error("The edited screenshot is still larger than 5 MB. Crop it and try again.");
  return new File([blob], `${originalName.replace(/\.[^.]+$/, "").slice(0, 120) || "screenshot"}-redacted.png`, { type: "image/png" });
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The edited screenshot could not be encoded.")), "image/png"));
}
