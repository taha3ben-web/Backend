import { OutboxService } from "./outbox.service";
import { DistributedLockService } from "./distributed-lock.service";
import { EventBusService } from "./event-bus.service";
import { PrismaService } from "../../prisma/prisma.service";
import * as runtimeMetrics from "../observability/runtime-metrics";

/**
 * يثبّت أمرين معًا:
 *  1) مقاييس الـ Outbox تُسجّل بشكل صحيح.
 *  2) دلالات التسليم (DELIVERED/FAILED/DEAD + إعادة الجدولة) لم تتغير،
 *     وأن خلل المقاييس لا يُسقط التسليم.
 */

interface OutboxRow {
  id: string;
  name: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

interface UpdateCall {
  where: { id: string };
  data: Record<string, unknown>;
}

function buildService(rows: OutboxRow[], emit: () => void) {
  const updates: UpdateCall[] = [];
  const prisma = {
    outboxEvent: {
      findMany: jest.fn(async () => rows),
      update: jest.fn(async (args: UpdateCall) => {
        updates.push(args);
        return args;
      }),
    },
  };
  const events = { emit: jest.fn(emit) };
  const lock = { runExclusive: jest.fn() };
  const service = new OutboxService(
    lock as unknown as DistributedLockService,
    prisma as unknown as PrismaService,
    events as unknown as EventBusService,
  );
  return { service, prisma, events, updates };
}

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: "evt-1",
  name: "trip.settled",
  payload: { tripId: "t1" },
  attempts: 0,
  maxAttempts: 10,
  ...over,
});

describe("outbox instrumentation", () => {
  beforeEach(() => {
    runtimeMetrics.resetRuntimeMetrics();
    jest.restoreAllMocks();
  });

  it("\u064a\u0633\u062c\u0651\u0644 \u062f\u0648\u0631\u0629 \u0648\u062d\u062c\u0645 \u0627\u0644\u062f\u0641\u0639\u0629 \u0648\u062a\u0633\u0644\u064a\u0645\u064b\u0627 \u0646\u0627\u062c\u062d\u064b\u0627 \u062f\u0648\u0646 \u062a\u063a\u064a\u064a\u0631 \u0627\u0644\u062f\u0644\u0627\u0644\u0627\u062a", async () => {
    const { service, events, updates } = buildService([row()], () => undefined);

    await service.relayDueEventsTask();

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe("DELIVERED");
    expect(updates[0].data.attempts).toBe(1);
    expect(updates[0].data.lastError).toBeNull();

    expect(runtimeMetrics.counterValue("outbox_relay_cycles_total")).toBe(1);
    expect(runtimeMetrics.gaugeValue("outbox_last_batch_size")).toBe(1);
    expect(runtimeMetrics.counterValue("outbox_dispatch_attempted_total")).toBe(1);
    expect(runtimeMetrics.counterValue("outbox_delivered_total")).toBe(1);
    expect(runtimeMetrics.counterValue("outbox_failed_total")).toBe(0);
    expect(runtimeMetrics.counterValue("outbox_dead_total")).toBe(0);
    expect(
      runtimeMetrics.histogramState("outbox_dispatch_duration_ms")?.count,
    ).toBe(1);
  });

  it("\u064a\u0639\u062f\u0651 \u0627\u0644\u0641\u0634\u0644 \u0648\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0645\u0639 \u0627\u0644\u062d\u0641\u0627\u0637 \u0639\u0644\u0649 \u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0627\u0644\u0623\u0633\u0651\u064a", async () => {
    const before = Date.now();
    const { service, updates } = buildService([row()], () => {
      throw new Error("consumer exploded");
    });

    await service.relayDueEventsTask();

    expect(updates[0].data.status).toBe("FAILED");
    expect(updates[0].data.attempts).toBe(1);
    expect(updates[0].data.deliveredAt).toBeNull();
    expect((updates[0].data.availableAt as Date).getTime()).toBeGreaterThan(before);

    expect(runtimeMetrics.counterValue("outbox_failed_total")).toBe(1);
    expect(runtimeMetrics.counterValue("outbox_retry_total")).toBe(1);
    expect(runtimeMetrics.counterValue("outbox_delivered_total")).toBe(0);
  });

  it("\u064a\u0639\u062f\u0651 \u0627\u0644\u0627\u0646\u062a\u0642\u0627\u0644 \u0625\u0644\u0649 DLQ \u0628\u0644\u0627 \u062a\u063a\u064a\u064a\u0631 \u0627\u0644\u0633\u0642\u0641", async () => {
    const { service, updates } = buildService(
      [row({ attempts: 9, maxAttempts: 10 })],
      () => {
        throw new Error("still failing");
      },
    );

    await service.relayDueEventsTask();

    expect(updates[0].data.status).toBe("DEAD");
    expect(updates[0].data.attempts).toBe(10);
    expect(runtimeMetrics.counterValue("outbox_dead_total")).toBe(1);
    expect(runtimeMetrics.counterValue("outbox_retry_total")).toBe(0);
  });

  it("\u062e\u0644\u0644 \u0627\u0644\u0645\u0642\u0627\u064a\u064a\u0633 \u0644\u0627 \u064a\u0645\u0646\u0639 \u0627\u0644\u062a\u0633\u0644\u064a\u0645 (business operation MUST continue)", async () => {
    jest.spyOn(runtimeMetrics, "bumpCounter").mockImplementation(() => {
      throw new Error("metrics store exploded");
    });
    jest.spyOn(runtimeMetrics, "observeHistogram").mockImplementation(() => {
      throw new Error("metrics store exploded");
    });
    jest.spyOn(runtimeMetrics, "setGauge").mockImplementation(() => {
      throw new Error("metrics store exploded");
    });

    const { service, events, updates } = buildService([row()], () => undefined);

    await expect(service.relayDueEventsTask()).resolves.toBeUndefined();
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe("DELIVERED");
  });
});
