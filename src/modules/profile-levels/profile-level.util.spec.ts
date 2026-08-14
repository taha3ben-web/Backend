import {
  PROFILE_LEVELS,
  PROFILE_LEVEL_THRESHOLDS,
  describeProfileLevel,
  getProfileLevel,
  nextProfileLevel,
  profileFrameObjectKey,
} from "./profile-level.util";

describe("profile levels", () => {
  it("maps every boundary exactly as specified", () => {
    const cases: Array<[number, string]> = [
      [0, "BRONZE"],
      [1, "BRONZE"],
      [9, "BRONZE"],
      [10, "SILVER"],
      [11, "SILVER"],
      [49, "SILVER"],
      [50, "GOLD"],
      [51, "GOLD"],
      [99, "GOLD"],
      [100, "DIAMOND"],
      [101, "DIAMOND"],
      [499, "DIAMOND"],
      [500, "LEGENDARY"],
      [1000, "LEGENDARY"],
    ];
    for (const [count, level] of cases) {
      expect(getProfileLevel(count)).toBe(level);
    }
  });

  it("starts every account at BRONZE and never returns a level for negative or invalid input", () => {
    expect(getProfileLevel(0)).toBe("BRONZE");
    expect(getProfileLevel(-5)).toBe("BRONZE");
    expect(getProfileLevel(Number.NaN)).toBe("BRONZE");
    expect(getProfileLevel(9.9)).toBe("BRONZE");
  });

  it("derives frame object keys without any host or full URL", () => {
    expect(profileFrameObjectKey("BRONZE")).toBe("profile-frames/bronze.svg");
    expect(profileFrameObjectKey("SILVER")).toBe("profile-frames/silver.svg");
    expect(profileFrameObjectKey("GOLD")).toBe("profile-frames/gold.svg");
    expect(profileFrameObjectKey("DIAMOND")).toBe("profile-frames/diamond.svg");
    expect(profileFrameObjectKey("LEGENDARY")).toBe(
      "profile-frames/legendary.svg",
    );
    for (const level of PROFILE_LEVELS) {
      expect(profileFrameObjectKey(level)).not.toMatch(/^https?:\/\//);
    }
  });

  it("walks the level ladder in order and stops at the top", () => {
    expect(nextProfileLevel("BRONZE")).toBe("SILVER");
    expect(nextProfileLevel("SILVER")).toBe("GOLD");
    expect(nextProfileLevel("GOLD")).toBe("DIAMOND");
    expect(nextProfileLevel("DIAMOND")).toBe("LEGENDARY");
    expect(nextProfileLevel("LEGENDARY")).toBeNull();
  });

  it("describes progress towards the next level", () => {
    expect(describeProfileLevel(27)).toEqual({
      completedTripsCount: 27,
      profileLevel: "SILVER",
      profileFrameKey: "profile-frames/silver.svg",
      nextLevel: "GOLD",
      nextLevelAt: 50,
      tripsToNextLevel: 23,
    });
    expect(describeProfileLevel(900)).toEqual({
      completedTripsCount: 900,
      profileLevel: "LEGENDARY",
      profileFrameKey: "profile-frames/legendary.svg",
      nextLevel: null,
      nextLevelAt: null,
      tripsToNextLevel: null,
    });
  });

  it("keeps thresholds strictly increasing in ladder order", () => {
    const values = PROFILE_LEVELS.map((l) => PROFILE_LEVEL_THRESHOLDS[l]);
    expect(values).toEqual([0, 10, 50, 100, 500]);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });
});
