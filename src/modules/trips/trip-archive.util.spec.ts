import {
  ARCHIVABLE_TRIP_STATUSES,
  DEFAULT_TRIP_ARCHIVE_AFTER_MONTHS,
  DEFAULT_TRIP_ARCHIVE_BATCH_SIZE,
  MAX_TRIP_ARCHIVE_BATCH_SIZE,
  MIN_TRIP_ARCHIVE_AFTER_MONTHS,
  SNAPSHOT_EVENT_LIMIT,
  TRIP_SNAPSHOT_VERSION,
  archiveAfterMonthsFromEnv,
  archiveBatchSizeFromEnv,
  archiveCutoff,
  buildTripSnapshot,
  isArchivable,
  tripEndDate,
} from "./trip-archive.util";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function candidate(
  overrides: Partial<Parameters<typeof isArchivable>[0]> = {},
) {
  return {
    id: "trip-1",
    status: "COMPLETED",
    settlementStatus: "POSTED",
    completedAt: new Date("2024-01-01T00:00:00.000Z"),
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  };
}

describe("archive configuration", () => {
  it("falls back to the default retention window", () => {
    expect(archiveAfterMonthsFromEnv(undefined)).toBe(
      DEFAULT_TRIP_ARCHIVE_AFTER_MONTHS,
    );
    expect(archiveAfterMonthsFromEnv("abc")).toBe(
      DEFAULT_TRIP_ARCHIVE_AFTER_MONTHS,
    );
  });

  it("never allows a retention window below the safety floor", () => {
    expect(archiveAfterMonthsFromEnv("1")).toBe(MIN_TRIP_ARCHIVE_AFTER_MONTHS);
  });

  it("accepts a valid retention window", () => {
    expect(archiveAfterMonthsFromEnv("24")).toBe(24);
  });

  it("clamps the batch size to the maximum", () => {
    expect(archiveBatchSizeFromEnv("999999")).toBe(MAX_TRIP_ARCHIVE_BATCH_SIZE);
    expect(archiveBatchSizeFromEnv("0")).toBe(DEFAULT_TRIP_ARCHIVE_BATCH_SIZE);
    expect(archiveBatchSizeFromEnv("50")).toBe(50);
  });
});

describe("archiveCutoff", () => {
  it("subtracts the retention window in months", () => {
    expect(archiveCutoff(NOW, 12).toISOString()).toBe(
      "2025-07-27T12:00:00.000Z",
    );
  });

  it("applies the safety floor to the cutoff too", () => {
    expect(archiveCutoff(NOW, 1).toISOString()).toBe(
      archiveCutoff(NOW, MIN_TRIP_ARCHIVE_AFTER_MONTHS).toISOString(),
    );
  });
});

describe("isArchivable", () => {
  const cutoff = archiveCutoff(NOW, 12);

  it("accepts an old settled completed trip", () => {
    expect(isArchivable(candidate(), cutoff)).toBe(true);
  });

  it("accepts cancelled trips using createdAt when completedAt is null", () => {
    expect(
      isArchivable(
        candidate({ status: "CANCELLED", completedAt: null }),
        cutoff,
      ),
    ).toBe(true);
  });

  it("refuses a live trip status", () => {
    expect(isArchivable(candidate({ status: "IN_PROGRESS" }), cutoff)).toBe(
      false,
    );
    expect(ARCHIVABLE_TRIP_STATUSES).not.toContain("IN_PROGRESS");
  });

  it("refuses a trip whose money has not settled", () => {
    expect(
      isArchivable(candidate({ settlementStatus: "FAILED" }), cutoff),
    ).toBe(false);
    expect(
      isArchivable(candidate({ settlementStatus: "PENDING" }), cutoff),
    ).toBe(false);
  });

  it("refuses a recent trip", () => {
    expect(
      isArchivable(
        candidate({ completedAt: new Date("2026-07-01T00:00:00.000Z") }),
        cutoff,
      ),
    ).toBe(false);
  });

  it("refuses an already archived trip so reruns are idempotent", () => {
    expect(isArchivable(candidate({ archivedAt: NOW }), cutoff)).toBe(false);
  });

  it("refuses trips with an open lost item or complaint", () => {
    expect(isArchivable(candidate({ openLostItems: 1 }), cutoff)).toBe(false);
    expect(isArchivable(candidate({ openComplaints: 2 }), cutoff)).toBe(false);
  });

  it("prefers completedAt over createdAt for the trip end date", () => {
    const trip = candidate({
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      completedAt: new Date("2024-01-02T00:00:00.000Z"),
    });
    expect(tripEndDate(trip).toISOString()).toBe("2024-01-02T00:00:00.000Z");
  });
});

describe("buildTripSnapshot", () => {
  const baseInput = {
    trip: { id: "trip-1", currency: "DZD" },
    events: [
      {
        type: "TRIP_COMPLETED",
        actor: "SYSTEM",
        createdAt: new Date("2024-01-02T00:00:00.000Z"),
        meta: { fare: 700 },
      },
    ],
    messages: [
      {
        senderId: "user-1",
        body: "anaa hna",
        createdAt: new Date("2024-01-02T00:01:00.000Z"),
      },
    ],
    trackingCount: 412,
  };

  it("stamps the schema version so future readers can migrate", () => {
    expect(buildTripSnapshot(baseInput).version).toBe(TRIP_SNAPSHOT_VERSION);
  });

  it("serialises dates to ISO strings because JSONB has no date type", () => {
    const snapshot = buildTripSnapshot(baseInput);
    expect(snapshot.events[0].at).toBe("2024-01-02T00:00:00.000Z");
    expect(snapshot.messages[0].at).toBe("2024-01-02T00:01:00.000Z");
  });

  it("keeps event meta and the tracking count for later audits", () => {
    const snapshot = buildTripSnapshot(baseInput);
    expect(snapshot.events[0].meta).toEqual({ fare: 700 });
    expect(snapshot.counts.tracking).toBe(412);
  });

  it("omits meta entirely when it is null", () => {
    const snapshot = buildTripSnapshot({
      ...baseInput,
      events: [
        {
          type: "TRIP_ACCEPTED",
          actor: "DRIVER",
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
          meta: null,
        },
      ],
    });
    expect(snapshot.events[0]).not.toHaveProperty("meta");
  });

  it("reports truncation instead of pretending the snapshot is complete", () => {
    const many = Array.from({ length: SNAPSHOT_EVENT_LIMIT + 5 }, () => ({
      type: "LOCATION",
      actor: "SYSTEM",
      createdAt: new Date("2024-01-02T00:00:00.000Z"),
    }));
    const snapshot = buildTripSnapshot({ ...baseInput, events: many });
    expect(snapshot.events).toHaveLength(SNAPSHOT_EVENT_LIMIT);
    expect(snapshot.counts.events).toBe(SNAPSHOT_EVENT_LIMIT + 5);
    expect(snapshot.counts.eventsTruncated).toBe(true);
    expect(snapshot.counts.messagesTruncated).toBe(false);
  });
});
