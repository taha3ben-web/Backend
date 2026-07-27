import {
  isTrackingPartition,
  partitionMonthStart,
  partitionsToDrop,
  retentionMonthsFromEnv,
  shiftMonth,
  trackingPartitionName,
} from "./tracking-retention.util";

describe("tracking-retention.util", () => {
  it("builds monthly partition names", () => {
    expect(trackingPartitionName(new Date(Date.UTC(2026, 6, 27)))).toBe(
      "TripTracking_202607",
    );
    expect(trackingPartitionName(new Date(Date.UTC(2026, 0, 1)))).toBe(
      "TripTracking_202601",
    );
  });

  it("only accepts real tracking partitions", () => {
    expect(isTrackingPartition("TripTracking_202607")).toBe(true);
    expect(isTrackingPartition("TripTracking_default")).toBe(false);
    expect(isTrackingPartition("Trip")).toBe(false);
    expect(isTrackingPartition('User"; DROP TABLE "Trip')).toBe(false);
  });

  it("parses the month start back from a name", () => {
    expect(partitionMonthStart("TripTracking_202607")?.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(partitionMonthStart("TripTracking_202613")).toBeNull();
    expect(partitionMonthStart("nope")).toBeNull();
  });

  it("shifts months across year boundaries", () => {
    const jan = new Date(Date.UTC(2026, 0, 15));
    expect(shiftMonth(jan, -1).toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(shiftMonth(jan, 2).toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("drops only partitions older than the retention window", () => {
    const now = new Date(Date.UTC(2026, 6, 27));
    const existing = [
      "TripTracking_202601",
      "TripTracking_202603",
      "TripTracking_202605",
      "TripTracking_202606",
      "TripTracking_202607",
      "TripTracking_default",
    ];
    expect(partitionsToDrop(existing, now, 3)).toEqual([
      "TripTracking_202601",
      "TripTracking_202603",
    ]);
  });

  it("never drops the default partition", () => {
    const now = new Date(Date.UTC(2030, 0, 1));
    expect(partitionsToDrop(["TripTracking_default"], now, 1)).toEqual([]);
  });

  it("clamps retention months from env", () => {
    expect(retentionMonthsFromEnv(undefined)).toBe(3);
    expect(retentionMonthsFromEnv("abc")).toBe(3);
    expect(retentionMonthsFromEnv("0")).toBe(1);
    expect(retentionMonthsFromEnv("999")).toBe(60);
    expect(retentionMonthsFromEnv("6")).toBe(6);
  });
});
