export interface PostingLine { accountId: string; direction: "DEBIT" | "CREDIT"; amount: number; }
export interface FinancialCommand {
  command: string; idempotencyKey: string; currency: string; referenceType?: string; referenceId?: string; reversalOfId?: string; lines: PostingLine[];
}
