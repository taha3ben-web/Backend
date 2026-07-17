export interface PostingLine {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: number;
  /** الدور المحاسبي للطرف في هذا القيد (اختياري) مثل: USER, PLATFORM_CASH, RESERVE. */
  role?: string;
}

export interface FinancialCommand {
  command: string;
  idempotencyKey: string;
  currency: string;
  referenceType?: string;
  referenceId?: string;
  reversalOfId?: string;
  /** هوية المنفّذ (userId للموظف/المستخدم أو "SYSTEM" للعمليات الخلفية). */
  createdBy?: string;
  /** سبب/وصف قابل للتدقيق للمعاملة. */
  reason?: string;
  lines: PostingLine[];
}
