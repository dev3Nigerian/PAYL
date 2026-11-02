import { randomUUID } from "node:crypto";
import type pg from "pg";
import { DomainError } from "./errors.js";

export async function postJournal(client: pg.PoolClient, input: {
  eventType: string;
  idempotencyKey: string;
  referenceType: string;
  referenceId: string;
  lines: Array<{ accountId: string; amountMinor: bigint }>;
}): Promise<string> {
  if (input.lines.length < 2) throw new DomainError("INVALID_JOURNAL", "Journal entry needs at least two lines", 500);
  const balance = input.lines.reduce((sum, line) => sum + line.amountMinor, 0n);
  if (balance !== 0n) throw new DomainError("UNBALANCED_JOURNAL", "Journal entry must balance to zero", 500);
  const existing = (await client.query<{ id: string }>("SELECT id FROM journal_entries WHERE idempotency_key = $1", [input.idempotencyKey])).rows[0];
  if (existing) return existing.id;
  const entryId = `journal_${randomUUID()}`;
  await client.query(
    `INSERT INTO journal_entries(id, event_type, idempotency_key, reference_type, reference_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [entryId, input.eventType, input.idempotencyKey, input.referenceType, input.referenceId],
  );
  for (const line of input.lines) {
    await client.query(
      "INSERT INTO journal_lines(entry_id, account_id, amount_minor) VALUES ($1, $2, $3)",
      [entryId, line.accountId, line.amountMinor.toString()],
    );
  }
  return entryId;
}
