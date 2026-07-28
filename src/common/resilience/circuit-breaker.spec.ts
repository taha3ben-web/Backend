import {
  CircuitBreaker,
  CircuitOpenError,
  TimeoutError,
  withTimeout,
} from "./circuit-breaker";

describe("withTimeout", () => {
  it("resolves when the promise beats the timeout", async () => {
    await expect(withTimeout(Promise.resolve(42), 50, "x")).resolves.toBe(42);
  });

  it("rejects with TimeoutError when it exceeds the timeout", async () => {
    const slow = new Promise<number>((r) => setTimeout(() => r(1), 60));
    await expect(withTimeout(slow, 5, "slow")).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it("passes through with no timeout when timeoutMs <= 0", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 0)).resolves.toBe("ok");
  });
});

describe("CircuitBreaker", () => {
  it("opens after the failure threshold and then rejects fast", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    const boom = () => Promise.reject(new Error("boom"));
    await expect(cb.execute(boom)).rejects.toThrow("boom");
    await expect(cb.execute(boom)).rejects.toThrow("boom");
    expect(cb.getState()).toBe("open");
    await expect(cb.execute(() => Promise.resolve(1))).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
  });

  it("moves to half_open after resetTimeout and closes on success", async () => {
    let t = 1000;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 100,
      now: () => t,
    });
    await expect(cb.execute(() => Promise.reject(new Error("x")))).rejects.toThrow(
      "x",
    );
    expect(cb.getState()).toBe("open");
    t += 150;
    expect(cb.getState()).toBe("half_open");
    await expect(cb.execute(() => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(cb.getState()).toBe("closed");
  });

  it("re-opens if the half_open trial fails", async () => {
    let t = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 100,
      now: () => t,
    });
    await expect(cb.execute(() => Promise.reject(new Error("x")))).rejects.toThrow(
      "x",
    );
    t += 150;
    expect(cb.getState()).toBe("half_open");
    await expect(cb.execute(() => Promise.reject(new Error("y")))).rejects.toThrow(
      "y",
    );
    expect(cb.getState()).toBe("open");
  });
});
