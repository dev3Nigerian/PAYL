"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Offer = {
  offerId: string;
  merchantId: string;
  merchantName: string;
  name: string;
  description: string;
  priceMinor: string;
  currency: string;
  fulfillmentMethod: "digital_download" | "digital_service";
  refundable: boolean;
  refundWindowMinutes: number | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  offers: Offer[];
};

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

type ChatReply = { conversationId: string; message: ChatMessage; offers: Offer[] };
type ChatHistory = { conversationId: string; messages: ChatMessage[] };
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

function OfferCard({ offer, onReview, disabled }: { offer: Offer; onReview: (offer: Offer) => void; disabled: boolean }) {
  return <article className="chat-offer-card">
    <div className="chat-offer-source"><span>Catalog snapshot</span><span>{offer.merchantName}</span></div>
    <div className="chat-offer-heading"><div><h3>{offer.name}</h3><p>{offer.description}</p></div><strong>{money(offer.priceMinor, offer.currency)}</strong></div>
    <div className="chat-offer-footer"><span>{offer.fulfillmentMethod === "digital_download" ? "Digital download" : "Digital service"} · {refundTerms(offer.refundable, offer.refundWindowMinutes)}</span><button type="button" className="secondary-button" disabled={disabled} onClick={() => onReview(offer)}>Review checkout</button></div>
  </article>;
}

const suggestions = ["What can I buy for under $100?", "Show refundable digital services", "Compare available downloads"];

export default function ShopWithAi({ consumerRef, offline, onAddFunds }: { consumerRef: string; offline: boolean; onAddFunds: () => void }) {
  const router = useRouter();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const conversationKey = `payl-chat:${consumerRef}`;
  const pendingKey = `payl-checkout:${consumerRef}`;
  const fundingKey = `payl-funding:${consumerRef}`;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
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
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Conversation could not be loaded");
      })
      .finally(() => { if (active) setLoadingHistory(false); });
    return () => { active = false; };
  }, [conversationKey, pendingKey, fundingKey, offline]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messages.length, busy]);

  async function sendMessage(event?: FormEvent<HTMLFormElement>, prompt?: string) {
    event?.preventDefault();
    const message = (prompt ?? draft).trim();
    if (!message || busy || offline || loadingHistory) return;
    const optimistic: ChatMessage = { id: `local-${crypto.randomUUID()}`, role: "user", content: message, createdAt: new Date().toISOString(), offers: [] };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setError(null);
    setBusy("chat");
    try {
      const reply = await postJson<ChatReply>("/api/consumer/chat", { conversationId: conversationId ?? undefined, message });
      window.localStorage.setItem(conversationKey, reply.conversationId);
      setConversationId(reply.conversationId);
      setMessages((current) => [...current, { ...reply.message, offers: reply.message.offers ?? reply.offers ?? [] }]);
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
        setError("Add funds to your PAYL wallet, then request a fresh quote to continue.");
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
    setConversationId(null);
    setMessages([]);
    setDraft("");
    setError(null);
    setNeedsFunding(null);
    window.sessionStorage.removeItem(fundingKey);
  }

  const href = approvalHref(pending?.approvalUrl);

  return <section className="shop-layout" aria-label="Shop with AI">
    <div className="dashboard-panel shop-chat-panel">
      <div className="shop-panel-header"><div><p className="section-label">PAYL commerce</p><h2>Ask about live offers</h2></div><button className="text-button" type="button" disabled={!!busy} onClick={newConversation}>New chat</button></div>
      <p className="shop-intro">Explore the merchant catalog in plain language. Offer cards preserve the catalog results from each reply; checkout checks the current price and terms again.</p>
      <div className="shop-transcript" role="log" aria-live="polite" aria-label="Conversation" ref={transcriptRef}>
        {loadingHistory ? <p className="empty-state">Loading your conversation…</p> : messages.length === 0 ? <div className="shop-empty"><span className="shop-spark">✦</span><h3>What are you looking for?</h3><p>Ask for a product, budget, or refund terms. You can review an exact quote before buying.</p><div className="shop-suggestions">{suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={!!busy || offline} onClick={() => void sendMessage(undefined, suggestion)}>{suggestion}</button>)}</div></div> : messages.map((message) => <div key={message.id} className={`shop-message ${message.role}`}>
          <div className="shop-message-label">{message.role === "user" ? "You" : "PAYL AI"}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time></div>
          <p>{message.content}</p>
          {message.role === "assistant" && message.offers?.length > 0 && <div className="chat-offer-list"><strong className="chat-offer-list-heading">Retrieved offers at {new Date(message.createdAt).toLocaleString("en-US")}</strong>{message.offers.map((offer) => <OfferCard key={`${message.id}:${offer.merchantId}:${offer.offerId}`} offer={offer} onReview={(selected) => void reviewOffer(selected)} disabled={!!busy || offline || !!pending} />)}</div>}
        </div>)}
        {busy === "chat" && <div className="shop-message assistant"><div className="shop-message-label">PAYL AI</div><p>Searching the live catalog…</p></div>}
      </div>
      {offline && <p className="form-notice error" role="alert">The PAYL API is unavailable. Chat will be ready when the wallet reconnects.</p>}
      {error && <p className="form-notice error" role="alert">{error}</p>}
      <form className="shop-composer" onSubmit={(event) => void sendMessage(event)}>
        <label htmlFor="shop-prompt">Message PAYL AI</label>
        <textarea id="shop-prompt" rows={2} maxLength={2000} placeholder="Ask about merchants, prices, or refund terms…" value={draft} disabled={offline || loadingHistory || !!busy} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div><span>Enter to send · Shift+Enter for a new line</span><button className="primary-button" type="submit" disabled={offline || loadingHistory || !!busy || !draft.trim()}>{busy === "chat" ? "Searching…" : "Send"}</button></div>
      </form>
    </div>

    <aside className="dashboard-panel shop-checkout-panel" aria-label="Checkout">
      <p className="section-label">Checkout</p>
      {busy === "quote" && <><h2>Preparing quote</h2><p>Checking the current price and terms…</p></>}
      {review && <><h2>Review your quote</h2><p className="shop-checkout-merchant">{review.offer.merchantName}</p><h3>{review.offer.name}</h3><div className="shop-checkout-amount">{money(review.signedQuote.payload.totalMinor, review.signedQuote.payload.currency)}</div><dl className="shop-quote-details"><div><dt>Quantity</dt><dd>{review.signedQuote.payload.items[0]?.quantity ?? 1}</dd></div><div><dt>Fulfillment</dt><dd>{review.signedQuote.payload.fulfillmentMethod === "digital_download" ? "Digital download" : "Digital service"}</dd></div><div><dt>Refunds</dt><dd>{refundTerms(review.signedQuote.payload.refundPolicy?.refundable ?? review.offer.refundable, review.signedQuote.payload.refundPolicy?.refundWindowMinutes ?? review.offer.refundWindowMinutes)}</dd></div><div><dt>Quote expires</dt><dd>{new Date(review.signedQuote.payload.expiresAt).toLocaleString("en-US")}</dd></div></dl><p className="shop-checkout-note">PAYL checks your spending policy. A payment above your auto-approval limit will require your separate approval.</p><div className="shop-checkout-actions"><button className="primary-button" type="button" disabled={!!busy || offline} onClick={() => void confirmPurchase()}>{busy === "confirm" ? "Confirming…" : `Buy for ${money(review.signedQuote.payload.totalMinor, review.signedQuote.payload.currency)}`}</button><button className="secondary-button" type="button" disabled={!!busy} onClick={() => setReview(null)}>Cancel</button></div></>}
      {pending && <><h2>Approval required</h2><p>Review the exact amount and merchant in PAYL&apos;s approval screen. Then return here to finish checkout.</p><div className="shop-pending-summary"><strong>{pending.offer.name}</strong><span>{money(pending.signedQuote.payload.totalMinor, pending.signedQuote.payload.currency)} · {pending.offer.merchantName}</span></div>{href && <a className="primary-button shop-approval-link" href={href} target="_blank" rel="noopener noreferrer">Open approval</a>}<button className="secondary-button shop-resume-button" type="button" disabled={!!busy || offline} onClick={() => void completePurchase()}>{busy === "complete" ? "Checking approval…" : "I approved — finish checkout"}</button><button className="text-button shop-cancel-button" type="button" disabled={!!busy || offline} onClick={() => void cancelCheckout()}>{busy === "cancel" ? "Cancelling…" : "Cancel checkout"}</button></>}
      {completed && <><span className="shop-success-icon" aria-hidden="true">✓</span><h2>Order confirmed</h2><p>Your purchase is recorded in PAYL.</p>{(completed.orderId || completed.id) && <p className="shop-order-id">Order {completed.orderId ?? completed.id}</p>}<button className="secondary-button shop-resume-button" type="button" onClick={() => setCompleted(null)}>Close</button></>}
      {needsFunding && !review && !pending && !completed && busy !== "quote" && <><h2>Add funds to continue</h2><p>{needsFunding.name} needs more available PAYL funds. Fund your wallet with PayPal Sandbox, then request an updated signed quote.</p><div className="shop-checkout-actions"><button className="primary-button" type="button" onClick={onAddFunds}>Add funds</button><button className="secondary-button" type="button" disabled={!!busy || offline} onClick={() => void reviewOffer(needsFunding)}>Get fresh quote</button></div></>}
      {!review && !pending && !completed && !needsFunding && busy !== "quote" && <><h2>Review before you pay</h2><p>Select a catalog result to see its current signed price, fulfillment, and refund terms. You decide when to buy.</p><div className="shop-checkout-placeholder"><span>1</span> Choose an offer <span>2</span> Review its quote <span>3</span> Confirm purchase</div></>}
    </aside>
  </section>;
}
