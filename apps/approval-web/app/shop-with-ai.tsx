"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@payl/ui";
import { ShoppingBriefCard, ShoppingDetails, type ShoppingBrief, type ChatDetails } from "./shopping-cards";
import ChatMessageView from "./chat-message";
import ChatOfferCard, { type Offer } from "./chat-offer-card";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  offers: Offer[];
  action: ChatAction | null;
  details?: ChatDetails;
};

type ChatPurchaseAction = {
  kind: "purchase";
  purchaseId: string;
  status: "ready" | "pending_approval" | "confirmed" | "needs_funding" | "expired" | "declined";
  offer: Offer;
  signedQuote: SignedQuote;
  paymentId?: string;
  approvalUrl?: string;
  orderId?: string;
};

type ChatAction = ChatPurchaseAction | { kind: "order_operation"; actionId: string; operation: "cancel" | "refund" | "submit_details"; orderId: string; offerName: string; details?: string; status: "ready" | "completed" | "failed" };
type SendOptions = { purchaseId?: string; actionId?: string; quoteHash?: string };

type SignedQuote = {
  payload: {
    merchantId: string;
    quoteId: string;
    items: Array<{ offerId: string; description: string; quantity: number; lineTotalMinor: string }>;
    totalMinor: string;
    currency: string;
    fulfillmentMethod: "digital_download" | "digital_service";
    refundPolicy?: { refundable: boolean; refundWindowMinutes: number | null };
    expiresAt: string;
  };
  jws: string;
  hash: string;
};

type QuoteReview = { signedQuote: SignedQuote; offer: Offer; confirmKey: string };
type PendingCheckout = { signedQuote: SignedQuote; offer: Offer; paymentId: string; approvalUrl: string | undefined; completionKey: string };
type CompletedOrder = { orderId?: string; id?: string; status?: string };

type ChatReply = { conversationId: string; message: ChatMessage; offers: Offer[]; brief?: ShoppingBrief };
type ChatHistory = { conversationId: string; messages: ChatMessage[]; brief: ShoppingBrief };
type QuoteReply = { signedQuote: SignedQuote; offer: Offer };
type CheckoutReply =
  | { status: "pending_approval"; approvalUrl?: string; paymentId: string }
  | { status: "confirmed"; order: CompletedOrder };

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

function money(amountMinor: string, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amountMinor) / 100);
}

function refundTerms(refundable: boolean, minutes: number | null): string {
  if (!refundable || !minutes) return "Non-refundable";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day refund window`;
  return `${minutes / 60}-hour refund window`;
}

function approvalHref(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json() as T & { error?: { code?: string; message?: string } };
  if (!response.ok) throw new ApiError(data.error?.message ?? "The request could not be completed", response.status, data.error?.code);
  return data;
}

async function streamChat(body: unknown, onProgress: (step: string) => void): Promise<ChatReply> {
  const response = await fetch("/api/consumer/chat", { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify(body) });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json() as ChatReply & { error?: { code?: string; message?: string } };
    if (!response.ok) throw new ApiError(data.error?.message ?? "Chat could not be completed", response.status, data.error?.code);
    return data;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Chat connection was interrupted. Send the same message to recover.");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { type: string; message?: string; reply?: ChatReply; error?: { code?: string; message?: string } };
        if (event.type === "progress" && event.message) onProgress(event.message);
        if (event.type === "result" && event.reply) return event.reply;
        if (event.type === "error") throw new ApiError(event.error?.message ?? "Chat could not finish", 503, event.error?.code);
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
  throw new Error("Chat connection was interrupted. Send the same message to recover the result.");
}

function PurchaseActionCard({ action, disabled, onConfirm, onResume, onFunding, onFreshQuote }: {
  action: ChatPurchaseAction;
  disabled: boolean;
  onConfirm: () => void;
  onResume: () => void;
  onFunding: () => void;
  onFreshQuote: () => void;
}) {
  const quote = action.signedQuote.payload;
  const approval = approvalHref(action.approvalUrl);
  return <div className="chat-purchase-action">
    <div className="chat-purchase-heading"><strong>{action.offer.name}</strong><span>{money(quote.totalMinor, quote.currency)}</span></div>
    <p>{action.offer.merchantName} · {quote.fulfillmentMethod === "digital_download" ? "Digital download" : "Digital service"} · {refundTerms(action.offer.refundable, action.offer.refundWindowMinutes)}</p>
    {action.status === "ready" && <><small>Signed quote expires {new Date(quote.expiresAt).toLocaleString("en-US")}</small><button className="primary-button" type="button" disabled={disabled} onClick={onConfirm}>Confirm purchase</button></>}
    {action.status === "pending_approval" && <><small>Antspace approval required before the order can finish.</small>{approval && <a className="primary-button" href={approval} target="_blank" rel="noopener noreferrer">Open approval</a>}<button className="secondary-button" type="button" disabled={disabled} onClick={onResume}>I approved — finish order</button></>}
    {action.status === "confirmed" && <small>Order confirmed · {action.orderId}</small>}
    {action.status === "needs_funding" && <><small>Your selection is saved. Add funds, then resume here.</small><button className="primary-button" type="button" disabled={disabled} onClick={onFunding}>Add funds</button><button className="secondary-button" type="button" disabled={disabled} onClick={onFreshQuote}>Resume purchase</button></>}
    {(action.status === "expired" || action.status === "declined") && <button className="secondary-button" type="button" disabled={disabled} onClick={onFreshQuote}>Resume purchase</button>}
  </div>;
}

const suggestions: Array<{ title: string; description: string; prompt: string; icon: IconName }> = [
  { title: "Find my next purchase", description: "Discover something within budget", prompt: "Find a refundable digital download under $50", icon: "search" },
  { title: "Check my spending power", description: "See my wallet and spending limits", prompt: "How much can I spend?", icon: "wallet" },
  { title: "Pick up where I left off", description: "Find my orders and downloads", prompt: "Show my orders and downloads", icon: "box" },
];

export default function ShopWithAi({ consumerRef, offline, onAddFunds }: { consumerRef: string; offline: boolean; onAddFunds: () => void }) {
  const router = useRouter();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const followLatestRef = useRef(true);
  const lastMessageId = useRef<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const conversationKey = `payl-chat:${consumerRef}`;
  const chatSendKey = `payl-chat-send:${consumerRef}`;
  const pendingKey = `payl-checkout:${consumerRef}`;
  const fundingKey = `payl-funding:${consumerRef}`;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [brief, setBrief] = useState<ShoppingBrief | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [busy, setBusy] = useState<"chat" | "quote" | "confirm" | "complete" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<QuoteReview | null>(null);
  const [pending, setPending] = useState<PendingCheckout | null>(null);
  const [completed, setCompleted] = useState<CompletedOrder | null>(null);
  const [needsFunding, setNeedsFunding] = useState<Offer | null>(null);

  useEffect(() => {
    let active = true;
    const savedConversationId = window.localStorage.getItem(conversationKey);
    const savedPending = window.sessionStorage.getItem(pendingKey);
    const savedFunding = window.sessionStorage.getItem(fundingKey);
    try {
      const unfinishedSend = JSON.parse(window.sessionStorage.getItem(chatSendKey) ?? "null") as { message?: string } | null;
      if (unfinishedSend?.message) setDraft(unfinishedSend.message);
    } catch { window.sessionStorage.removeItem(chatSendKey); }
    if (savedFunding) {
      try {
        const offer = JSON.parse(savedFunding) as Offer;
        if (offer.offerId && offer.merchantId) setNeedsFunding(offer);
      } catch { window.sessionStorage.removeItem(fundingKey); }
    }
    if (savedPending) {
      try {
        const candidate = JSON.parse(savedPending) as PendingCheckout;
        if (candidate.paymentId && candidate.signedQuote?.hash && candidate.completionKey) setPending(candidate);
      } catch {
        window.sessionStorage.removeItem(pendingKey);
      }
    }
    if (!savedConversationId || offline) {
      setLoadingHistory(false);
      return;
    }
    void fetch(`/api/consumer/chat?conversationId=${encodeURIComponent(savedConversationId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as ChatHistory & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? "Conversation could not be loaded");
        return body;
      })
      .then((body) => {
        if (!active) return;
        setConversationId(body.conversationId);
        setMessages(body.messages);
        setBrief(body.brief);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Conversation could not be loaded");
      })
      .finally(() => { if (active) setLoadingHistory(false); });
    return () => { active = false; };
  }, [conversationKey, pendingKey, fundingKey, chatSendKey, offline]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const latest = messages.at(-1);
    const isNewReply = latest?.role === "assistant" && latest.id !== lastMessageId.current;
    lastMessageId.current = latest?.id ?? null;
    if (followLatestRef.current) {
      // Start long replies at their first line instead of jumping past the answer.
      transcript.scrollTop = isNewReply && latestMessageRef.current
        ? Math.max(0, latestMessageRef.current.offsetTop - 24)
        : messages.length || busy ? transcript.scrollHeight : 0;
    }
    const away = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight > 100;
    followLatestRef.current = !away;
    setShowLatest(away);
  }, [messages, busy, progress, loadingHistory]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 160)}px`;
  }, [draft]);

  function trackTranscriptScroll() {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const away = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight > 100;
    followLatestRef.current = !away;
    setShowLatest(away);
  }

  function jumpToLatest() {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    followLatestRef.current = true;
    transcript.scrollTop = transcript.scrollHeight;
    setShowLatest(false);
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>, prompt?: string, options: SendOptions = {}) {
    event?.preventDefault();
    const message = (prompt ?? draft).trim();
    if (!message || busy || offline || loadingHistory) return;
    followLatestRef.current = true;
    const pendingSend = (() => {
      try { return JSON.parse(window.sessionStorage.getItem(chatSendKey) ?? "null") as { message?: string; options?: SendOptions; requestId?: string } | null; }
      catch { return null; }
    })();
    if (!prompt && pendingSend?.message === message && pendingSend.options) options = pendingSend.options;
    const requestId = pendingSend?.message === message && JSON.stringify(pendingSend?.options ?? {}) === JSON.stringify(options) && pendingSend.requestId
      ? pendingSend.requestId : crypto.randomUUID();
    window.sessionStorage.setItem(chatSendKey, JSON.stringify({ message, options, requestId }));
    const optimistic: ChatMessage = { id: `local-${crypto.randomUUID()}`, role: "user", content: message, createdAt: new Date().toISOString(), offers: [], action: null };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setError(null);
    setBusy("chat");
    setProgress(["Connecting to Antspace…"]);
    try {
      const reply = await streamChat({ conversationId: conversationId ?? undefined, message, requestId, ...options }, (step) => {
        setProgress((current) => current.at(-1) === step ? current : [...current.slice(-6), step]);
      });
      if (reply.brief) setBrief(reply.brief);
      window.sessionStorage.removeItem(chatSendKey);
      window.localStorage.setItem(conversationKey, reply.conversationId);
      setConversationId(reply.conversationId);
      setMessages((current) => [...current, { ...reply.message, offers: reply.message.offers ?? reply.offers ?? [] }]);
      if (reply.message.action?.status === "confirmed" || reply.message.details?.orders?.length || /Order confirmed:/.test(reply.message.content)) router.refresh();
      try {
        const response = await fetch(`/api/consumer/chat?conversationId=${encodeURIComponent(reply.conversationId)}`, { cache: "no-store" });
        if (response.ok) {
          const history = await response.json() as ChatHistory;
          setMessages(history.messages);
          setBrief(history.brief);
        }
      } catch { /* The successful send remains visible if history refresh fails. */ }
    } catch (reason) {
      setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      setDraft(message);
      setError(reason instanceof Error ? reason.message : "Message could not be sent");
    } finally {
      setBusy(null);
    }
  }

  async function reviewOffer(offer: Offer) {
    if (busy || offline) return;
    setReview(null);
    setCompleted(null);
    setError(null);
    setBusy("quote");
    try {
      const reply = await postJson<QuoteReply>("/api/consumer/checkout/quote", { merchantId: offer.merchantId, offerId: offer.offerId, quantity: 1 });
      setReview({ signedQuote: reply.signedQuote, offer: reply.offer, confirmKey: crypto.randomUUID() });
      setNeedsFunding(null);
      window.sessionStorage.removeItem(fundingKey);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Quote could not be loaded");
    } finally {
      setBusy(null);
    }
  }

  async function confirmPurchase() {
    if (!review || busy) return;
    setError(null);
    setBusy("confirm");
    try {
      const reply = await postJson<CheckoutReply>("/api/consumer/checkout/confirm", { signedQuote: review.signedQuote, idempotencyKey: review.confirmKey });
      if (reply.status === "pending_approval") {
        const next: PendingCheckout = { signedQuote: review.signedQuote, offer: review.offer, paymentId: reply.paymentId, approvalUrl: reply.approvalUrl, completionKey: crypto.randomUUID() };
        window.sessionStorage.setItem(pendingKey, JSON.stringify(next));
        setPending(next);
      } else {
        setCompleted(reply.order);
        router.refresh();
      }
      setReview(null);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "INSUFFICIENT_FUNDS") {
        window.sessionStorage.setItem(fundingKey, JSON.stringify(review.offer));
        setNeedsFunding(review.offer);
        setReview(null);
        setError("Add funds to your Antspace wallet, then request a fresh quote to continue.");
      } else {
        setError(reason instanceof Error ? reason.message : "Checkout could not be completed");
      }
    } finally {
      setBusy(null);
    }
  }

  async function completePurchase() {
    if (!pending || busy) return;
    setError(null);
    setBusy("complete");
    try {
      const reply = await postJson<CheckoutReply>("/api/consumer/checkout/complete", { paymentId: pending.paymentId, signedQuote: pending.signedQuote, idempotencyKey: pending.completionKey });
      if (reply.status === "confirmed") {
        window.sessionStorage.removeItem(pendingKey);
        setCompleted(reply.order);
        setPending(null);
        router.refresh();
      } else {
        const next = { ...pending, approvalUrl: reply.approvalUrl ?? pending.approvalUrl };
        window.sessionStorage.setItem(pendingKey, JSON.stringify(next));
        setPending(next);
        setError("Approval is still pending. Complete the approval, then try again.");
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "PAYMENT_NOT_READY") {
        window.sessionStorage.removeItem(pendingKey);
        setPending(null);
      }
      setError(reason instanceof Error ? reason.message : "Checkout could not be resumed");
    } finally {
      setBusy(null);
    }
  }

  async function cancelCheckout() {
    if (!pending || busy) return;
    setError(null);
    setBusy("cancel");
    try {
      await postJson(`/api/consumer/checkout/${encodeURIComponent(pending.paymentId)}/cancel`, {
        idempotencyKey: `cancel-${pending.completionKey}`,
        reason: "Consumer cancelled in-app checkout",
      });
      window.sessionStorage.removeItem(pendingKey);
      setPending(null);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "PAYMENT_NOT_CANCELLABLE") {
        if (/\b(declined|expired|cancelled)\b/i.test(reason.message)) {
          window.sessionStorage.removeItem(pendingKey);
          setPending(null);
          setError("This approval is no longer active. Select an offer to start a new checkout.");
        } else {
          setError("This payment can no longer be cancelled. Try finishing checkout or check your wallet activity.");
        }
      } else {
        setError(reason instanceof Error ? reason.message : "Checkout could not be cancelled");
      }
    } finally {
      setBusy(null);
    }
  }

  function newConversation() {
    if (busy) return;
    window.localStorage.removeItem(conversationKey);
    window.sessionStorage.removeItem(chatSendKey);
    setConversationId(null);
    setBrief(null);
    setMessages([]);
    setDraft("");
    setError(null);
    setNeedsFunding(null);
    followLatestRef.current = true;
    lastMessageId.current = null;
    setShowLatest(false);
    composerRef.current?.focus();
    window.sessionStorage.removeItem(fundingKey);
  }

  async function submitServiceDetails(orderId: string, details: string) {
    await postJson(`/api/consumer/orders/${encodeURIComponent(orderId)}/details`, { details });
    if (conversationId) {
      const response = await fetch(`/api/consumer/chat?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
      if (response.ok) setMessages((await response.json() as ChatHistory).messages);
    }
    router.refresh();
  }

  function actionCard(action: ChatAction) {
    if (action.kind === "purchase") return <PurchaseActionCard action={action} disabled={!!busy || offline}
      onConfirm={() => void sendMessage(undefined, "Confirm purchase", { purchaseId: action.purchaseId, quoteHash: action.signedQuote.hash })}
      onResume={() => void sendMessage(undefined, "I approved", { purchaseId: action.purchaseId })}
      onFunding={onAddFunds} onFreshQuote={() => void sendMessage(undefined, "Resume purchase", { purchaseId: action.purchaseId })} />;
    return <div className="chat-purchase-action"><strong>{action.operation === "submit_details" ? "Submit service requirements" : action.operation === "refund" ? "Refund order" : "Cancel order"}: {action.offerName}</strong>
      <small>{action.orderId}</small>{action.details && <p className="service-details-text">{action.details}</p>}
      {action.status === "ready" ? <button className="primary-button" disabled={!!busy || offline} onClick={() => void sendMessage(undefined, "Confirm action", { actionId: action.actionId })}>Confirm {action.operation === "submit_details" ? "submission" : action.operation}</button>
        : <small>{action.status === "completed" ? "Action completed" : "Action could not be completed. Check the latest order status."}</small>}
    </div>;
  }

  const href = approvalHref(pending?.approvalUrl);
  const showManualCheckout = !!review || !!pending || !!completed || !!needsFunding || busy === "quote";

  return <section className={`shop-layout${showManualCheckout ? "" : " chat-only"}`} aria-label="Shop with AI">
    <div className="dashboard-panel shop-chat-panel">
      <div className="shop-panel-header"><div className="chat-identity"><span><Icon name="sparkles" size={20} /></span><div><h2>Antspace AI</h2><p>Your personal shopping companion</p></div></div><div className="chat-header-actions"><a className="chat-downloads-link" href="#downloads"><Icon name="download" size={17} /><span>My downloads</span></a><button className="secondary-button" type="button" disabled={!!busy || loadingHistory} onClick={newConversation}><Icon name="plus" size={16} /> New chat</button></div></div>
      <p className="shop-intro"><Icon name="shield" size={14} /> Your budget. Your rules. Every purchase.</p>
      <ShoppingBriefCard brief={brief} disabled={!!busy || offline} onReset={() => void sendMessage(undefined, "Clear shopping brief")} />
      <div className="chat-transcript-wrap">
      <div className="shop-transcript" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversation" ref={transcriptRef} onScroll={trackTranscriptScroll}>
        {loadingHistory ? <div className="chat-history-loading" role="status"><Icon name="sparkles" size={24} /><strong>Opening your conversation…</strong><span>Picking up where you left off.</span></div> : messages.length === 0 ? <div className="shop-empty"><span className="shop-spark"><Icon name="sparkles" size={30} /></span><span className="overline">A little inspiration goes a long way</span><h3>What’s on your mind?</h3><p>A tool for your next project? A service to get you unstuck? Tell me what you need, and we’ll find your fit.</p><div className="shop-suggestions">{suggestions.map((suggestion) => <button key={suggestion.title} type="button" disabled={!!busy || offline} onClick={() => void sendMessage(undefined, suggestion.prompt)}><Icon name={suggestion.icon} size={19} /><strong>{suggestion.title}</strong><span>{suggestion.description}</span><Icon name="arrow" size={14} /></button>)}</div></div> : messages.map((message, index) => <ChatMessageView key={message.id} role={message.role} content={message.content} createdAt={message.createdAt} ref={index === messages.length - 1 ? latestMessageRef : undefined}>
          {message.role === "assistant" && message.action && actionCard(message.action)}
          {message.role === "assistant" && <ShoppingDetails details={message.details} disabled={!!busy || offline} onMessage={(prompt) => void sendMessage(undefined, prompt)} onDetails={submitServiceDetails} />}
          {message.role === "assistant" && !message.action && message.offers?.length > 0 && <section className="chat-offer-list" aria-label="Offers from this search"><div className="chat-offer-list-heading"><strong>{message.offers.length} {message.offers.length === 1 ? "offer" : "offers"} to explore</strong><span>Checked <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></span></div><div className="chat-offers-grid">{message.offers.map((offer) => <ChatOfferCard key={`${message.id}:${offer.merchantId}:${offer.offerId}`} offer={offer} onReview={(selected) => void reviewOffer(selected)} disabled={!!busy || offline || !!pending} />)}</div></section>}
        </ChatMessageView>)}
        {busy === "chat" && <div className="chat-working"><span className="chat-message-avatar" aria-hidden="true"><Icon name="sparkles" size={17} /></span><div><div className="chat-working-current"><span className="chat-working-dots" aria-hidden="true"><i /><i /><i /></span><span>{progress.at(-1) ?? "Working on your request…"}</span></div>{progress.length > 1 && <details className="chat-work-details"><summary>View steps</summary><ol className="chat-progress" aria-label="Current activity">{progress.map((step, index) => <li key={`${index}:${step}`} className={index === progress.length - 1 ? "active" : "done"}>{step}</li>)}</ol></details>}</div></div>}
      </div>
      {showLatest && <button className="chat-jump-latest" type="button" onClick={jumpToLatest}><Icon name="down" size={15} />Jump to latest</button>}
      </div>
      {offline && <p className="form-notice error" role="alert">The Antspace API is unavailable. Chat will be ready when the wallet reconnects.</p>}
      {error && <p className="form-notice error" role="alert">{error}</p>}
      <form className="shop-composer" onSubmit={(event) => void sendMessage(event)}>
        <label htmlFor="shop-prompt">Message Antspace AI</label>
        <div className="chat-composer-field"><textarea id="shop-prompt" ref={composerRef} rows={2} maxLength={2000} placeholder="Describe what you need, or ask about an order…" value={draft} disabled={offline || loadingHistory || !!busy} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia("(pointer: coarse)").matches) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button className="primary-button chat-send-button" type="submit" disabled={offline || loadingHistory || !!busy || !draft.trim()} aria-label={busy === "chat" ? "Message is being sent" : "Send message"}><Icon name="send" size={18} /><span>{busy === "chat" ? "Working…" : "Send"}</span></button></div>
        <div className="chat-composer-hints"><span>Enter to send <b>·</b> Shift+Enter for a new line</span>{draft.length > 1600 ? <span className="chat-character-count">{draft.length}/2000</span> : <span>Your spending limits always apply.</span>}</div>
      </form>
    </div>

    {showManualCheckout && <aside className="dashboard-panel shop-checkout-panel" aria-label="Checkout">
      <p className="section-label">Checkout</p>
      {busy === "quote" && <><h2>Preparing quote</h2><p>Checking the current price and terms…</p></>}
      {review && <><h2>Review your quote</h2><p className="shop-checkout-merchant">{review.offer.merchantName}</p><h3>{review.offer.name}</h3><div className="shop-checkout-amount">{money(review.signedQuote.payload.totalMinor, review.signedQuote.payload.currency)}</div><dl className="shop-quote-details"><div><dt>Quantity</dt><dd>{review.signedQuote.payload.items[0]?.quantity ?? 1}</dd></div><div><dt>Fulfillment</dt><dd>{review.signedQuote.payload.fulfillmentMethod === "digital_download" ? "Digital download" : "Digital service"}</dd></div><div><dt>Refunds</dt><dd>{refundTerms(review.signedQuote.payload.refundPolicy?.refundable ?? review.offer.refundable, review.signedQuote.payload.refundPolicy?.refundWindowMinutes ?? review.offer.refundWindowMinutes)}</dd></div><div><dt>Quote expires</dt><dd>{new Date(review.signedQuote.payload.expiresAt).toLocaleString("en-US")}</dd></div></dl><p className="shop-checkout-note">Antspace checks your spending policy. A payment above your auto-approval limit will require your separate approval.</p><div className="shop-checkout-actions"><button className="primary-button" type="button" disabled={!!busy || offline} onClick={() => void confirmPurchase()}>{busy === "confirm" ? "Confirming…" : `Buy for ${money(review.signedQuote.payload.totalMinor, review.signedQuote.payload.currency)}`}</button><button className="secondary-button" type="button" disabled={!!busy} onClick={() => setReview(null)}>Cancel</button></div></>}
      {pending && <><h2>Approval required</h2><p>Review the exact amount and merchant in Antspace&apos;s approval screen. Then return here to finish checkout.</p><div className="shop-pending-summary"><strong>{pending.offer.name}</strong><span>{money(pending.signedQuote.payload.totalMinor, pending.signedQuote.payload.currency)} · {pending.offer.merchantName}</span></div>{href && <a className="primary-button shop-approval-link" href={href} target="_blank" rel="noopener noreferrer">Open approval</a>}<button className="secondary-button shop-resume-button" type="button" disabled={!!busy || offline} onClick={() => void completePurchase()}>{busy === "complete" ? "Checking approval…" : "I approved — finish checkout"}</button><button className="text-button shop-cancel-button" type="button" disabled={!!busy || offline} onClick={() => void cancelCheckout()}>{busy === "cancel" ? "Cancelling…" : "Cancel checkout"}</button></>}
      {completed && <><span className="shop-success-icon" aria-hidden="true">✓</span><h2>Order confirmed</h2><p>Your purchase is recorded in Antspace. Delivered files are ready in My downloads.</p>{(completed.orderId || completed.id) && <p className="shop-order-id">Order {completed.orderId ?? completed.id}</p>}<div className="shop-checkout-actions"><a className="primary-button" href="#downloads"><Icon name="download" size={16} />My downloads</a><a className="secondary-button" href="#activity">View order status</a></div><button className="text-button shop-resume-button" type="button" onClick={() => setCompleted(null)}>Close</button></>}
      {needsFunding && !review && !pending && !completed && busy !== "quote" && <><h2>Add funds to continue</h2><p>{needsFunding.name} needs more available Antspace funds. Fund your wallet with PayPal Sandbox, then request an updated signed quote.</p><div className="shop-checkout-actions"><button className="primary-button" type="button" onClick={onAddFunds}>Add funds</button><button className="secondary-button" type="button" disabled={!!busy || offline} onClick={() => void reviewOffer(needsFunding)}>Get fresh quote</button></div></>}
    </aside>}
  </section>;
}
