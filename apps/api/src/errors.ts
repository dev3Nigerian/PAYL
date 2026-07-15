export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function requireValue<T>(value: T | null | undefined, code: string, message: string): T {
  if (value === null || value === undefined) throw new DomainError(code, message, 404);
  return value;
}
