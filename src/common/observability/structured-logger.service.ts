import { Injectable, LoggerService } from "@nestjs/common";
import {
  buildLogRecord,
  getRequestContext,
  type LogLevel,
} from "./request-context";

/**
 * Logger مُهيكل (JSON) يضخّ حقول الربط (requestId/traceId/actorId) من سياق
 * الطلب تلقائيًا مع كل سطر، فتصبح السجلات قابلة للتتبّع والربط عبر الطلب
 * الواحد. في التطوير (NODE_ENV=development) يبقى الإخراج نصيًا مقروءًا.
 */
@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly pretty = process.env.NODE_ENV === "development";

  log(message: unknown, context?: string): void {
    this.write("log", message, context);
  }

  // توقيع NestJS: error(message, stack?, context?)
  error(message: unknown, stack?: string, context?: string): void {
    this.write("error", message, context, stack);
  }

  warn(message: unknown, context?: string): void {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write("verbose", message, context);
  }

  private write(
    level: LogLevel,
    message: unknown,
    context?: string,
    stack?: string,
  ): void {
    const record = buildLogRecord({
      level,
      message: this.stringify(message),
      context,
      stack,
      requestContext: getRequestContext(),
    });

    const line = this.pretty
      ? this.formatPretty(record.time, level, record, message)
      : JSON.stringify(record);

    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }

  private formatPretty(
    time: string,
    level: LogLevel,
    record: { context?: string; requestId?: string; stack?: string },
    message: unknown,
  ): string {
    const ctx = record.context ? ` (${record.context})` : "";
    const req = record.requestId ? ` [req:${record.requestId}]` : "";
    const tail = record.stack ? `\n${record.stack}` : "";
    return `${time} [${level.toUpperCase()}]${ctx}${req} ${this.stringify(message)}${tail}`;
  }

  private stringify(message: unknown): string {
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}
