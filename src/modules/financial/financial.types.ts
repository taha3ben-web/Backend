export type CurrencyCode = string;

export interface PostingLine {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: number;
}

export interface FinancialCommand {
  command: string;
  idempotencyKey: string;
  currency: CurrencyCode;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  lines: PostingLine[];
}
