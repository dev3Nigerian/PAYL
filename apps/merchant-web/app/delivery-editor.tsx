"use client";

import { useState, type FormEvent } from "react";

export function DeliveryUpload({ target, id, fileName, onSaved }: { target: "offers" | "orders"; id: string; fileName?: string | null; onSaved: (fileName: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError(null);
    try {
      if (file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 5 MB");
      const response = await fetch(`/api/merchant/${target}/${encodeURIComponent(id)}/delivery?fileName=${encodeURIComponent(file.name)}`, {
        method: "POST", headers: { "content-type": "application/octet-stream" }, body: file,
      });
      const data = await response.json() as { fileName: string; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Upload failed");
      onSaved(data.fileName); setFile(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed"); }
    finally { setBusy(false); }
  }
  return <form className="delivery-editor" onSubmit={(event) => void upload(event)}>
    <strong>{fileName ? `Attached: ${fileName}` : target === "offers" ? "Add the purchased download" : "Attach the completed deliverable"}</strong>
    <label><span>Delivery file · up to 5 MB</span><input type="file" accept=".pdf,.txt,.md,.csv,.zip,.png,.jpg,.jpeg" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
    <small>{target === "offers" ? "New quotes use this file. Existing orders keep their purchased version." : "Only this buyer can download the result after you fulfill the order."}</small>
    <button className="secondary-button" disabled={busy || !file}>{busy ? "Uploading…" : fileName ? "Replace file" : "Upload file"}</button>
    {error && <p className="form-notice error" role="alert">{error}</p>}
  </form>;
}

export function ServiceIntakeEditor({ offerId, prompt, onSaved }: { offerId: string; prompt?: string | null; onSaved: (prompt: string | null) => void }) {
  const [draft, setDraft] = useState(prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/merchant/offers/${encodeURIComponent(offerId)}/intake`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: draft }),
      });
      const data = await response.json() as { serviceIntakePrompt: string | null; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Could not save requirements");
      onSaved(data.serviceIntakePrompt); setNotice("Saved for future orders.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not save requirements"); }
    finally { setBusy(false); }
  }
  return <form className="delivery-editor" onSubmit={(event) => void save(event)}>
    <label><span>What must the buyer provide?</span><textarea maxLength={1000} rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="e.g. Your brand URL, target audience, and the questions you want the review to answer" /></label>
    <small>Buyers submit these requirements in chat after purchase. Leave blank if no information is needed.</small>
    <button className="secondary-button" disabled={busy}>{busy ? "Saving…" : "Save requirements"}</button>
    {notice && <p role="status">{notice}</p>}
  </form>;
}
