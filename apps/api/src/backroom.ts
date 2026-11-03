import type pg from "pg";
import type { Config } from "./config.js";
import { inTransaction } from "./db.js";
import { DomainError } from "./errors.js";

type Column = { key: string; label: string; format?: "money" | "date" | "status" };
type Listing = { from: string; fields: string; search: string[]; status: string; date: string; id: string; columns: Column[] };
const column = (key: string, label: string, format?: Column["format"]): Column => ({ key, label, ...(format ? { format } : {}) });
const common = [column("status", "Status", "status"), column("created_at", "Created", "date")];
const listings: Record<string, Listing> = {
  orders: {
    from: "orders o JOIN merchants m ON m.id=o.merchant_id JOIN payment_intents p ON p.id=o.payment_id JOIN consumers c ON c.id=p.consumer_id",
    fields: "o.id, m.name AS merchant, c.display_name AS consumer, o.status, o.captured_amount_minor::text AS amount_minor, o.currency, o.payment_id, o.created_at",
    search: ["o.id", "m.name", "c.display_name", "o.payment_id"], status: "o.status", date: "o.created_at", id: "o.id",
    columns: [column("id", "Order"), column("consumer", "Shopper"), column("merchant", "Merchant"), column("amount_minor", "Order value", "money"), ...common, column("payment_id", "Payment reference")],
  },
  topups: {
    from: "wallet_topups t JOIN consumers c ON c.id=t.consumer_id",
    fields: "t.id, c.display_name AS consumer, t.status, t.amount_minor::text, t.currency, t.provider_fee_minor::text, t.reversed_amount_minor::text, t.paypal_order_id, t.paypal_capture_id, t.created_at",
    search: ["t.id", "c.display_name", "t.paypal_order_id", "t.paypal_capture_id"], status: "t.status", date: "t.created_at", id: "t.id",
    columns: [column("id", "Top-up"), column("consumer", "Shopper"), column("amount_minor", "Amount", "money"), ...common, column("provider_fee_minor", "Provider fee", "money"), column("reversed_amount_minor", "Reversed", "money"), column("paypal_order_id", "PayPal order"), column("paypal_capture_id", "PayPal capture")],
  },
  payouts: {
    from: "payout_batches p JOIN merchants m ON m.id=p.merchant_id",
    fields: "p.id, m.name AS merchant, p.status, p.paid_amount_minor::text AS amount_minor, p.reserve_held_minor::text, p.provider_fee_minor::text, p.currency, p.paypal_recipient_email, p.paypal_batch_id, p.paypal_item_id, p.created_at",
    search: ["p.id", "m.name", "p.paypal_recipient_email", "p.paypal_batch_id", "p.paypal_item_id"], status: "p.status", date: "p.created_at", id: "p.id",
    columns: [column("id", "Withdrawal"), column("merchant", "Merchant"), column("amount_minor", "Requested payout", "money"), ...common, column("reserve_held_minor", "Reserve at request", "money"), column("provider_fee_minor", "Provider fee", "money"), column("paypal_recipient_email", "Recipient"), column("paypal_batch_id", "PayPal batch"), column("paypal_item_id", "PayPal item")],
  },
  consumers: {
    from: "consumers c LEFT JOIN auth_users u ON u.consumer_id=c.id LEFT JOIN spending_policies s ON s.consumer_id=c.id",
    fields: `c.id, c.display_name AS name, u.email, c.status, s.currency, c.created_at,
      COALESCE((SELECT sum(l.amount_minor) FROM ledger_accounts a JOIN journal_lines l ON l.account_id=a.id WHERE a.owner_type='consumer' AND a.owner_id=c.id AND a.account_type='available' AND a.currency=s.currency),0)::text AS amount_minor`,
    search: ["c.id", "c.display_name", "u.email"], status: "c.status", date: "c.created_at", id: "c.id",
    columns: [column("id", "Consumer"), column("name", "Name"), column("email", "Email"), column("amount_minor", "Available balance", "money"), ...common],
  },
  merchants: {
    from: "merchants m LEFT JOIN auth_users u ON u.merchant_id=m.id",
    fields: `m.id, m.name, u.email, m.status, m.currency, m.created_at,
      COALESCE((SELECT sum(l.amount_minor) FROM ledger_accounts a JOIN journal_lines l ON l.account_id=a.id WHERE a.owner_type='merchant' AND a.owner_id=m.id AND a.account_type='payable' AND a.currency=m.currency),0)::text AS amount_minor,
      (SELECT count(*) FROM offers f WHERE f.merchant_id=m.id AND f.active)::text AS published_offers`,
    search: ["m.id", "m.name", "u.email"], status: "m.status", date: "m.created_at", id: "m.id",
    columns: [column("id", "Merchant"), column("name", "Business"), column("email", "Administrator"), column("published_offers", "Live products"), column("amount_minor", "Payable", "money"), ...common],
  },
  events: {
    from: "audit_events e",
    fields: "e.id::text, e.event_type AS status, e.actor_type, e.actor_id, e.object_type, e.object_id, e.correlation_id, e.created_at",
    search: ["e.event_type", "e.actor_id", "e.object_id", "e.correlation_id"], status: "e.event_type", date: "e.created_at", id: "e.id",
    columns: [column("status", "Event"), column("actor_type", "Actor type"), column("actor_id", "Actor"), column("object_type", "Object type"), column("object_id", "Object"), column("correlation_id", "Correlation"), column("created_at", "Recorded", "date")],
  },
  ledger: {
    from: `(SELECT e.id, e.event_type, e.reference_type, e.reference_id, e.created_at, a.currency,
      count(l.id)::text AS line_count, COALESCE(sum(l.amount_minor),0)::text AS amount_minor,
      CASE WHEN count(l.id)=0 OR sum(l.amount_minor)<>0 THEN 'unbalanced' ELSE 'balanced' END AS status
      FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id=e.id LEFT JOIN ledger_accounts a ON a.id=l.account_id
      GROUP BY e.id, a.currency) j`,
    fields: "j.*", search: ["j.id", "j.event_type", "j.reference_id"], status: "j.status", date: "j.created_at", id: "(j.id || COALESCE(j.currency,''))",
    columns: [column("id", "Journal entry"), column("event_type", "Event"), column("reference_id", "Reference"), column("amount_minor", "Net balance", "money"), ...common, column("line_count", "Journal lines"), column("reference_type", "Reference type")],
  },
  webhooks: {
    from: "outbox_events e JOIN merchants m ON m.id=e.merchant_id",
    fields: "e.id, m.name AS merchant, e.event_type, e.status, e.attempts::text, e.aggregate_id, e.available_at, e.delivered_at, e.created_at",
    search: ["e.id", "m.name", "e.event_type", "e.aggregate_id"], status: "e.status", date: "e.created_at", id: "e.id",
    columns: [column("id", "Delivery"), column("merchant", "Merchant"), column("event_type", "Event"), ...common, column("attempts", "Attempts"), column("available_at", "Scheduled", "date"), column("delivered_at", "Delivered", "date"), column("aggregate_id", "Related record")],
  },
  paypal_events: {
    from: "paypal_webhook_events e",
    fields: "e.id, e.event_type AS status, e.resource_id, e.received_at AS created_at",
    search: ["e.id", "e.event_type", "e.resource_id"], status: "e.event_type", date: "e.received_at", id: "e.id",
    columns: [column("id", "PayPal event"), column("status", "Event type"), column("resource_id", "PayPal resource"), column("created_at", "Received", "date")],
  },
};

function integer(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new DomainError("INVALID_FILTER", "Choose a valid page and date range");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new DomainError("INVALID_FILTER", "Page or date range is out of bounds");
  return parsed;
}

export class BackroomService {
  constructor(private readonly pool: pg.Pool, private readonly config: Config) {}

  async overview(daysInput: unknown) {
    const days = integer(daysInput, 7, 90);
    return inTransaction(this.pool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const counts = (await client.query<Record<string, string>>(`SELECT
        (SELECT count(*) FROM consumers)::text AS consumers,
        (SELECT count(*) FROM merchants)::text AS merchants,
        (SELECT count(*) FROM offers WHERE active)::text AS products,
        (SELECT count(*) FROM orders WHERE created_at >= now() - make_interval(days => $1))::text AS orders,
        (SELECT count(*) FROM consumers WHERE created_at >= now() - make_interval(days => $1))::text AS new_consumers,
        (SELECT count(*) FROM consumer_chat_conversations WHERE updated_at >= now() - make_interval(days => $1))::text AS conversations,
        (SELECT count(*) FROM consumer_chat_messages WHERE role='user' AND created_at >= now() - make_interval(days => $1))::text AS chat_messages,
        (SELECT count(*) FROM orders WHERE status='confirmed')::text AS awaiting_delivery,
        (SELECT count(*) FROM orders WHERE status='confirmed' AND fulfillment_deadline < now())::text AS overdue_orders,
        (SELECT count(*) FROM payout_batches WHERE status='pending')::text AS pending_payouts,
        (SELECT count(*) FROM payout_batches WHERE status='pending' AND created_at < now() - interval '30 minutes')::text AS stale_payouts,
        (SELECT count(*) FROM payout_batches WHERE status='failed' AND updated_at >= now() - make_interval(days => $1))::text AS failed_payouts,
        (SELECT count(*) FROM wallet_topups WHERE status IN ('creating','pending') AND created_at < now() - interval '30 minutes')::text AS stale_topups,
        (SELECT count(*) FROM outbox_events WHERE status='dead')::text AS dead_webhooks,
        (SELECT count(*) FROM outbox_events WHERE status IN ('pending','processing'))::text AS pending_webhooks,
        (SELECT count(*) FROM (SELECT e.id, a.currency FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id=e.id
          LEFT JOIN ledger_accounts a ON a.id=l.account_id GROUP BY e.id, a.currency HAVING count(l.id)=0 OR sum(l.amount_minor) <> 0) broken)::text AS unbalanced_journals`, [days])).rows[0]!;
      const balances = (await client.query(`SELECT a.currency,
        COALESCE(sum(l.amount_minor) FILTER (WHERE a.owner_type='consumer' AND a.account_type='available'),0)::text AS consumer_available,
        COALESCE(sum(l.amount_minor) FILTER (WHERE a.owner_type='consumer' AND a.account_type='reserved'),0)::text AS consumer_reserved,
        COALESCE(sum(l.amount_minor) FILTER (WHERE a.account_type='pending_payable'),0)::text AS merchant_pending,
        COALESCE(sum(l.amount_minor) FILTER (WHERE a.account_type='payable'),0)::text AS merchant_payable,
        COALESCE(sum(l.amount_minor) FILTER (WHERE a.account_type='reserve'),0)::text AS merchant_reserve,
        COALESCE(sum(l.amount_minor) FILTER (WHERE a.account_type='payout_pending'),0)::text AS payout_pending,
        COALESCE(sum(l.amount_minor) FILTER (WHERE a.account_type='fee_revenue'),0)::text AS fee_revenue,
        COALESCE(sum(l.amount_minor) FILTER (WHERE a.account_type='provider_fee_expense'),0)::text AS provider_fees
        FROM ledger_accounts a LEFT JOIN journal_lines l ON l.account_id=a.id GROUP BY a.currency ORDER BY a.currency`)).rows;
      const daily = (await client.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM orders o WHERE (o.created_at AT TIME ZONE 'UTC')::date=day::date)::integer AS orders,
        (SELECT count(*) FROM consumers c WHERE (c.created_at AT TIME ZONE 'UTC')::date=day::date)::integer AS signups
        FROM generate_series((now() AT TIME ZONE 'UTC')::date - ($1::int - 1), (now() AT TIME ZONE 'UTC')::date, interval '1 day') day ORDER BY day`, [days])).rows;
      const worker = (await client.query("SELECT last_attempt_at, last_success_at, status FROM operations_heartbeats WHERE name='lifecycle'")).rows[0] ?? null;
      return { generatedAt: new Date().toISOString(), days, counts, balances, daily,
        health: { database: "ready", paypal: this.config.paypal ? "configured" : "not_configured", ai: this.config.deepseekApiKey ? "configured" : "not_configured", worker } };
    });
  }

  async records(input: Record<string, unknown>) {
    if (input.kind !== undefined && typeof input.kind !== "string") throw new DomainError("INVALID_FILTER", "Choose a supported record type");
    const kind = typeof input.kind === "string" ? input.kind : "orders";
    const listing = Object.hasOwn(listings, kind) ? listings[kind] : undefined;
    if (!listing) throw new DomainError("INVALID_FILTER", "Choose a supported record type");
    const page = integer(input.page, 1, 10000);
    const days = integer(input.days, 30, 3650);
    if (input.q !== undefined && (typeof input.q !== "string" || input.q.length > 120)) throw new DomainError("INVALID_FILTER", "Search must be at most 120 characters");
    if (input.status !== undefined && (typeof input.status !== "string" || input.status.length > 80)) throw new DomainError("INVALID_FILTER", "Status is invalid");
    const query = typeof input.q === "string" ? input.q.trim() : "";
    const status = typeof input.status === "string" ? input.status : "";
    const attentionFilters: Record<string, { kind: string; condition: string }> = {
      overdue_orders: { kind: "orders", condition: "o.status='confirmed' AND o.fulfillment_deadline < now()" },
      stale_payouts: { kind: "payouts", condition: "p.status='pending' AND p.created_at < now() - interval '30 minutes'" },
      failed_payouts: { kind: "payouts", condition: "p.status='failed' AND p.updated_at >= now() - make_interval(days => $6)" },
      stale_topups: { kind: "topups", condition: "t.status IN ('creating','pending') AND t.created_at < now() - interval '30 minutes'" },
    };
    const attention = typeof input.attention === "string" && Object.hasOwn(attentionFilters, input.attention) ? attentionFilters[input.attention] : undefined;
    if (input.attention && (!attention || attention.kind !== kind)) throw new DomainError("INVALID_FILTER", "Attention filter is invalid");
    const attentionDays = integer(input.attentionDays, 7, 90);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const result = await this.pool.query(`SELECT ${listing.fields} FROM ${listing.from}
      WHERE ${listing.date} >= now() - make_interval(days => $1)
        AND ($2 = '' OR ${listing.status} = $2)
        AND ($3 = '' OR ${listing.search.map((field) => `${field} ILIKE $4`).join(" OR ")})
        ${attention ? `AND (${attention.condition})` : ""}
        AND $6::int > 0
      ORDER BY ${listing.date} DESC, ${listing.id} DESC LIMIT 51 OFFSET $5`, [days, status, query, pattern, (page - 1) * 50, attentionDays]);
    return { kind, columns: listing.columns, rows: result.rows.slice(0, 50), page, hasMore: result.rows.length > 50 };
  }
}
