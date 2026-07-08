import { Injectable } from "@nestjs/common";

export type WsRole = "PASSENGER" | "DRIVER" | "STAFF" | "UNKNOWN";

export interface WsSnapshot {
  total: number;
  byRole: Record<WsRole, number>;
}

/**
 * عدّادات رصد خفيفة داخل الذاكرة (بلا اعتماديات خارجية).
 * تتبّع اتصالات WebSocket النشطة حسب الدور، وإجماليات تراكمية.
 */
@Injectable()
export class MetricsService {
  private ws: Record<WsRole, number> = {
    PASSENGER: 0,
    DRIVER: 0,
    STAFF: 0,
    UNKNOWN: 0,
  };
  private wsConnectedTotal = 0;
  private wsDisconnectedTotal = 0;

  /** تسجيل اتصال WebSocket جديد */
  incrWs(role: WsRole): void {
    this.ws[role] = (this.ws[role] ?? 0) + 1;
    this.wsConnectedTotal += 1;
  }

  /** تسجيل انقطاع اتصال WebSocket */
  decrWs(role: WsRole): void {
    this.ws[role] = Math.max(0, (this.ws[role] ?? 0) - 1);
    this.wsDisconnectedTotal += 1;
  }

  /** لقطة الاتصالات النشطة الحالية */
  wsSnapshot(): WsSnapshot {
    const total =
      this.ws.PASSENGER + this.ws.DRIVER + this.ws.STAFF + this.ws.UNKNOWN;
    return { total, byRole: { ...this.ws } };
  }

  /** العدّادات التراكمية (counters) */
  counters(): { wsConnectedTotal: number; wsDisconnectedTotal: number } {
    return {
      wsConnectedTotal: this.wsConnectedTotal,
      wsDisconnectedTotal: this.wsDisconnectedTotal,
    };
  }
}
