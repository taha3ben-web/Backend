import { MatchingEngineService } from "./matching-engine.service";
import {
  DriverCandidate,
  MatchingContext,
  MatchingStrategy,
} from "./matching-strategy";
import { PrismaService } from "../../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import * as runtimeMetrics from "../../../common/observability/runtime-metrics";

/**
 * يثبّت أن مقاييس المطابقة لا تغيّر اختيار المرشّحين: نفس القائمة
 * تصل إلى الاستراتيجية، ونفس المُخرَج يُعاد، والأخطاء تُعاد رفعها كما هي.
 */

const ctx: MatchingContext = {
  pickupLat: 36.75,
  pickupLng: 3.06,
  radiusKm: 5,
  rideClass: "ECONOMY" as unknown as MatchingContext["rideClass"],
};

function passthroughStrategy(): {
  strategy: MatchingStrategy;
  seen: DriverCandidate[][];
} {
  const seen: DriverCandidate[][] = [];
  const strategy: MatchingStrategy = {
    name: "TEST_PASSTHROUGH",
    rank: (candidates) => {
      seen.push(candidates.map((c) => ({ ...c })));
      return candidates;
    },
  };
  return { strategy, seen };
}

function buildRedis(nearby: Array<{ driverId: string; lat: number; lng: number }>) {
  const pipeline = {
    get: jest.fn(),
    exec: jest.fn(async () => nearby.map(() => [null, null])),
  };
  return {
    nearbyDriversWithCoords: jest.fn(async () => nearby),
    getKeys: jest.fn(async (keys: string[]) => keys.map(() => null)),
    client: { pipeline: jest.fn(() => pipeline) },
  };
}

function buildEngine(
  nearby: Array<{ driverId: string; lat: number; lng: number }>,
  eligible: Array<{ userId: string; rating: number | null }>,
) {
  const redis = buildRedis(nearby);
  const prisma = {
    driver: { findMany: jest.fn(async () => eligible) },
  };
  const engine = new MatchingEngineService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );
  return { engine, redis, prisma };
}

describe("matching engine instrumentation", () => {
  beforeEach(() => {
    runtimeMetrics.resetRuntimeMetrics();
    jest.restoreAllMocks();
  });

  it("\u064a\u0639\u064a\u062f \u0646\u0641\u0633 \u0627\u0644\u0645\u0631\u0634\u0651\u062d\u064a\u0646 \u0648\u064a\u0633\u062c\u0651\u0644 \u0646\u062c\u0627\u062d\u064b\u0627 \u0648\u0645\u062f\u0629 \u0648\u062d\u062c\u0645 \u0628\u0631\u0643\u0629", async () => {
    const { engine } = buildEngine(
      [
        { driverId: "u1", lat: 36.75, lng: 3.06 },
        { driverId: "u2", lat: 36.76, lng: 3.07 },
      ],
      [
        { userId: "u1", rating: 5 },
        { userId: "u2", rating: 4 },
      ],
    );
    const { strategy, seen } = passthroughStrategy();
    engine.setStrategy(strategy);

    const result = await engine.selectCandidates(ctx, new Set<string>(), 5);

    expect(result).toEqual(["u1", "u2"]);
    // القائمة التي رأتها الاستراتيجية هي نفسها برتب القرب الأصلية.
    expect(seen).toHaveLength(1);
    expect(seen[0].map((c) => c.userId)).toEqual(["u1", "u2"]);
    expect(seen[0].map((c) => c.proximityRank)).toEqual([0, 1]);

    expect(runtimeMetrics.counterValue("matching_requests_total")).toBe(1);
    expect(runtimeMetrics.counterValue("matching_success_total")).toBe(1);
    expect(runtimeMetrics.counterValue("matching_no_driver_total")).toBe(0);
    expect(runtimeMetrics.counterValue("matching_error_total")).toBe(0);
    expect(runtimeMetrics.histogramState("matching_duration_ms")?.count).toBe(1);
    const pool = runtimeMetrics.histogramState("matching_candidate_count");
    expect(pool?.count).toBe(1);
    expect(pool?.sum).toBe(2);
  });

  it("\u064a\u0639\u062f\u0651 \u062d\u0627\u0644\u0629 \u0644\u0627 \u0633\u0627\u0626\u0642 \u0645\u062a\u0627\u062d", async () => {
    const { engine } = buildEngine([], []);
    const result = await engine.selectCandidates(ctx, new Set<string>(), 5);
    expect(result).toEqual([]);
    expect(runtimeMetrics.counterValue("matching_no_driver_total")).toBe(1);
    expect(runtimeMetrics.counterValue("matching_success_total")).toBe(0);
  });

  it("\u064a\u0639\u062f\u0651 \u0627\u0644\u062e\u0637\u0623 \u0648\u064a\u0639\u064a\u062f \u0631\u0641\u0639\u0647 \u0643\u0645\u0627 \u0647\u0648", async () => {
    const { engine, redis } = buildEngine([], []);
    redis.nearbyDriversWithCoords.mockRejectedValueOnce(
      new Error("redis is down"),
    );

    await expect(
      engine.selectCandidates(ctx, new Set<string>(), 5),
    ).rejects.toThrow("redis is down");
    expect(runtimeMetrics.counterValue("matching_error_total")).toBe(1);
    expect(runtimeMetrics.counterValue("matching_success_total")).toBe(0);
  });

  it("\u062e\u0644\u0644 \u0627\u0644\u0645\u0642\u0627\u064a\u064a\u0633 \u0644\u0627 \u064a\u063a\u064a\u0651\u0631 \u0627\u0644\u0627\u062e\u062a\u064a\u0627\u0631", async () => {
    jest.spyOn(runtimeMetrics, "bumpCounter").mockImplementation(() => {
      throw new Error("metrics store exploded");
    });
    jest.spyOn(runtimeMetrics, "observeHistogram").mockImplementation(() => {
      throw new Error("metrics store exploded");
    });

    const { engine } = buildEngine(
      [{ driverId: "u1", lat: 36.75, lng: 3.06 }],
      [{ userId: "u1", rating: 5 }],
    );
    const { strategy } = passthroughStrategy();
    engine.setStrategy(strategy);

    const result = await engine.selectCandidates(ctx, new Set<string>(), 5);
    expect(result).toEqual(["u1"]);
  });

  it("\u064a\u062d\u062a\u0631\u0645 exclude \u0648 max \u0643\u0645\u0627 \u0643\u0627\u0646", async () => {
    const { engine } = buildEngine(
      [
        { driverId: "u1", lat: 36.75, lng: 3.06 },
        { driverId: "u2", lat: 36.76, lng: 3.07 },
        { driverId: "u3", lat: 36.77, lng: 3.08 },
      ],
      [
        { userId: "u1", rating: 5 },
        { userId: "u2", rating: 4 },
        { userId: "u3", rating: 3 },
      ],
    );
    const { strategy } = passthroughStrategy();
    engine.setStrategy(strategy);

    const result = await engine.selectCandidates(ctx, new Set(["u1"]), 1);
    expect(result).toEqual(["u2"]);
  });
});
