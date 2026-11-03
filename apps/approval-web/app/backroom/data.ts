export type Column = { key: string; label: string; format?: "money" | "date" | "status" };
export type RecordRow = Record<string, string | null>;
export type RecordsResponse = { kind: string; columns: Column[]; rows: RecordRow[]; page: number; hasMore: boolean };
export type Overview = {
  generatedAt: string; days: number; counts: Record<string, string>;
  balances: Array<Record<string, string> & { currency: string }>;
  daily: Array<{ day: string; orders: number; signups: number }>;
  health: { database: string; paypal: string; ai: string; worker: null | { last_attempt_at: string; last_success_at: string | null; status: string } };
};

// Ledger amounts are integer minor units. Avoid rounding large balances through Number.
export function money(value: string | null | undefined, currency = "USD"): string {
  if (value == null || !/^-?\d+$/.test(value)) return "—";
  const amount = BigInt(value), absolute = amount < 0n ? -amount : amount;
  let digits: number;
  try { digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits!; }
  catch { return "—"; }
  const unit = 10n ** BigInt(digits);
  return `${amount < 0n ? "−" : ""}${currency} ${(absolute / unit).toLocaleString("en-US")}${digits ? `.${(absolute % unit).toString().padStart(digits, "0")}` : ""}`;
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date) + " UTC";
}

export function workerState(worker: Overview["health"]["worker"], now = Date.now()) {
  if (!worker) return { label: "No heartbeat yet", tone: "warning" };
  if (now - new Date(worker.last_attempt_at).valueOf() > 90_000) return { label: "Heartbeat overdue", tone: "warning" };
  if (worker.status !== "ok") return { label: "Last cycle failed", tone: "danger" };
  return { label: "Running", tone: "success" };
}
