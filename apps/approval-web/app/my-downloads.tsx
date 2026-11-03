"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@payl/ui";

type PurchasedFile = {
  orderId: string; offerName: string; merchantName: string;
  purchasedAt: string; fulfilledAt: string | null; fileName: string; sizeBytes: number;
};
type DownloadPage = { downloads: PurchasedFile[]; nextCursor: string | null };

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MyDownloads() {
  const [page, setPage] = useState<DownloadPage | null>(null);
  const [loading, setLoading] = useState<"refresh" | "more" | null>("refresh");
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(cursor ? "more" : "refresh");
    setError(null);
    try {
      const response = await fetch(`/api/consumer/downloads${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`, {
        cache: "no-store", signal: controller.signal,
      });
      const body = await response.json() as DownloadPage & { error?: { message?: string } };
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setError({ message: body.error?.message ?? "Your downloads could not be loaded. Please try again.", signIn: response.status === 401 });
        return;
      }
      if (!Array.isArray(body.downloads)) throw new Error("Invalid download response");
      setPage((current) => ({
        downloads: cursor && current ? [...current.downloads, ...body.downloads.filter((file) => !current.downloads.some((saved) => saved.orderId === file.orderId))] : body.downloads,
        nextCursor: body.nextCursor,
      }));
    } catch {
      if (!controller.signal.aborted) setError({ message: "Your downloads are temporarily unavailable. Please try again.", signIn: false });
    } finally {
      if (!controller.signal.aborted) setLoading(null);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => activeRequest.current?.abort();
  }, [load]);

  return <section className="downloads-library section-panel" aria-labelledby="downloads-heading" aria-busy={!!loading}>
    <div className="dashboard-panel downloads-intro">
      <div className="panel-title"><div><p className="section-label">Yours to keep creating with</p><h2 id="downloads-heading">Your purchased files</h2></div>
        <button className="secondary-button" type="button" disabled={!!loading} onClick={() => void load()}>{loading === "refresh" ? "Refreshing…" : "Refresh downloads"}</button>
      </div>
      <p>Download files from your completed purchases here, anytime. Waiting for a delivery? <a href="#activity">Check Orders &amp; activity</a>.</p>
      <p className="downloads-count" role="status">{loading && !page ? "Loading your downloads…" : page ? `${page.downloads.length} ${page.downloads.length === 1 ? "file" : "files"}${page.nextCursor ? " shown · More available below" : " available"}` : ""}</p>
      {error && <div className="form-notice error" role="alert">{error.message} {error.signIn ? <a href="/login">Sign in again</a> : <button className="text-button" type="button" disabled={!!loading} onClick={() => void load()}>Try again</button>}</div>}
      {page?.downloads.length === 0 && !error && <div className="empty-illustration"><Icon name="download" /><h3>Your files will live here</h3><p>Once a purchase is delivered, its download will appear here. You can also find ready files directly in your order history.</p><a className="primary-button" href="#shop">Find something with AI <Icon name="arrow" size={16} /></a></div>}
    </div>
    {!!page?.downloads.length && <div className="downloads-grid">{page.downloads.map((file) => <article className="dashboard-panel download-card" key={file.orderId}>
      <div className="download-card-top"><span className="download-file-icon"><Icon name="download" size={22} /></span><span className="state-badge success">Ready to download</span></div>
      <div className="download-product"><p className="section-label">{file.merchantName}</p><h3>{file.offerName}</h3><p>Purchased <time dateTime={file.purchasedAt}>{new Date(file.purchasedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time></p></div>
      <div className="download-file"><strong>{file.fileName}</strong><span>{file.fileName.split(".").at(-1)?.toUpperCase()} · {fileSize(file.sizeBytes)}</span></div>
      <a className="primary-button" href={`/api/consumer/orders/${encodeURIComponent(file.orderId)}/download`} download={file.fileName} aria-label={`Download ${file.offerName} (${file.fileName})`}><Icon name="download" size={16} />Download file</a>
    </article>)}</div>}
    {page?.nextCursor && <div className="downloads-more"><button className="secondary-button" type="button" disabled={!!loading} onClick={() => void load(page.nextCursor)}>{loading === "more" ? "Loading more…" : "Load older downloads"}</button></div>}
  </section>;
}
