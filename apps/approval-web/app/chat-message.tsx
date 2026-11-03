"use client";

import { useEffect, useState, type ReactNode, type Ref } from "react";
import { Icon } from "@payl/ui";
import ChatMarkdown from "./chat-markdown";

export default function ChatMessageView({ role, content, createdAt, children, ref }: {
  role: "user" | "assistant"; content: string; createdAt: string; children?: ReactNode; ref?: Ref<HTMLDivElement> | undefined;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copy() {
    try { await navigator.clipboard.writeText(content); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  }

  return <div className={`shop-message ${role}`} ref={ref}>
    {role === "assistant" && <span className="chat-message-avatar" aria-hidden="true"><Icon name="sparkles" size={17} /></span>}
    <div className="chat-message-content">
      <div className="shop-message-label"><div className="chat-message-meta"><strong>{role === "user" ? "You" : "Antspace AI"}</strong><time dateTime={createdAt}>{new Date(createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time></div>
        {role === "assistant" && !!content && <button className="chat-copy-button" type="button" onClick={() => void copy()} aria-label={copyState === "copied" ? "Response copied" : "Copy response"}><Icon name={copyState === "copied" ? "check" : "copy"} size={14} /><span>{copyState === "copied" ? "Copied" : "Copy"}</span></button>}
      </div>
      {role === "assistant" ? <ChatMarkdown content={content} /> : <p className="chat-user-text">{content}</p>}
      <div className="chat-message-extras">{children}</div>
      {copyState === "failed" && <small className="chat-copy-notice" role="status">Couldn’t copy. Select the response text to copy it.</small>}
      {copyState === "copied" && <span className="chat-sr-only" role="status">Response copied to clipboard.</span>}
    </div>
  </div>;
}
