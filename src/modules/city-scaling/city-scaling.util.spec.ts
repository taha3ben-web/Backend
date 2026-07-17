import {
  canAcceptTrip,
  isRideClassEnabled,
  effectiveSurgeMultiplier,
  driverUtilization,
  canChangeLaunchStatus,
  CityScalingControl,
} from "./city-scaling.util";

const base: CityScalingControl = {
  launchStatus: "LIVE",
  maxActiveDrivers: 100,
  maxDailyTrips: 1000,
  enabledRideClasses: ["ECONOMY", "COMFORT"],
  surgeCap: 2.5,
};

describe("city-scaling.util", () => {
  describe("canAcceptTrip", () => {
    it("accepts within caps", () => {
      expect(
        canAcceptTrip(base, { activeDrivers: 10, dailyTrips: 10 }, "ECONOMY")
          .accept,
      ).toBe(true);
    });
    it("blocks when paused", () => {
      expect(
        canAcceptTrip(
          { ...base, launchStatus: "PAUSED" },
          { activeDrivers: 0, dailyTrips: 0 },
          "ECONOMY",
        ).reason,
      ).toBe("CITY_PAUSED");
    });
    it("blocks when not launched", () => {
      expect(
        canAcceptTrip(
          { ...base, launchStatus: "PLANNED" },
          { activeDrivers: 0, dailyTrips: 0 },
          "ECONOMY",
        ).reason,
      ).toBe("NOT_LAUNCHED");
    });
    it("blocks disabled ride class", () => {
      expect(
        canAcceptTrip(base, { activeDrivers: 0, dailyTrips: 0 }, "LUXURY")
          .reason,
      ).toBe("RIDE_CLASS_DISABLED");
    });
    it("enforces daily trip cap", () => {
      expect(
        canAcceptTrip(base, { activeDrivers: 0, dailyTrips: 1000 }, "ECONOMY")
          .reason,
      ).toBe("DAILY_TRIP_CAP");
    });
    it("enforces driver cap", () => {
      expect(
        canAcceptTrip(base, { activeDrivers: 100, dailyTrips: 0 }, "ECONOMY")
          .reason,
      ).toBe("DRIVER_CAP");
    });
  });

  it("treats empty ride-class list as all-enabled", () => {
    expect(
      isRideClassEnabled({ ...base, enabledRideClasses: [] }, "ANYTHING"),
    ).toBe(true);
  });

  it("caps surge multiplier", () => {
    expect(effectiveSurgeMultiplier(base, 3.0)).toBe(2.5);
    expect(effectiveSurgeMultiplier(base, 1.2)).toBe(1.2);
    expect(effectiveSurgeMultiplier({ ...base, surgeCap: null }, 5)).toBe(5);
    expect(effectiveSurgeMultiplier(base, 0.5)).toBe(1);
  });

  it("computes driver utilization", () => {
    expect(driverUtilization(base, { activeDrivers: 50, dailyTrips: 0 })).toBe(
      0.5,
    );
    expect(
      driverUtilization(
        { ...base, maxActiveDrivers: null },
        { activeDrivers: 50, dailyTrips: 0 },
      ),
    ).toBe(0);
  });

  it("guards launch-status transitions", () => {
    expect(canChangeLaunchStatus("PLANNED", "PILOT")).toBe(true);
    expect(canChangeLaunchStatus("LIVE", "PAUSED")).toBe(true);
    expect(canChangeLaunchStatus("PAUSED", "LIVE")).toBe(true);
    expect(canChangeLaunchStatus("LIVE", "PLANNED")).toBe(false);
    expect(canChangeLaunchStatus("LIVE", "LIVE")).toBe(true);
  });
});
