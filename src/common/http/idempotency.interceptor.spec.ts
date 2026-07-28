import { Controller, Get, INestApplication, Post } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { RequireIdempotency } from "./require-idempotency.decorator";

let counter = 0;

@Controller("t")
class DummyController {
  @Post("pay")
  pay(): { id: number } {
    counter += 1;
    return { id: counter };
  }

  @Post("charge")
  @RequireIdempotency()
  charge(): { id: number } {
    counter += 1;
    return { id: counter };
  }

  @Get("ping")
  ping(): { id: number } {
    counter += 1;
    return { id: counter };
  }
}

describe("IdempotencyInterceptor (e2e via supertest)", () => {
  let app: INestApplication;

  beforeEach(async () => {
    counter = 0;
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    delete process.env.IDEMPOTENCY_ENFORCE;
    await app.close();
  });

  it("replays the same response for a repeated Idempotency-Key on POST", async () => {
    const first = await request(app.getHttpServer())
      .post("/t/pay")
      .set("Idempotency-Key", "k1");
    expect(first.body).toEqual({ id: 1 });

    const second = await request(app.getHttpServer())
      .post("/t/pay")
      .set("Idempotency-Key", "k1");
    expect(second.body).toEqual({ id: 1 });
    expect(counter).toBe(1);
  });

  it("executes every time when no Idempotency-Key is present", async () => {
    await request(app.getHttpServer()).post("/t/pay");
    await request(app.getHttpServer()).post("/t/pay");
    expect(counter).toBe(2);
  });

  it("does not dedup requests carrying different keys", async () => {
    await request(app.getHttpServer())
      .post("/t/pay")
      .set("Idempotency-Key", "a");
    await request(app.getHttpServer())
      .post("/t/pay")
      .set("Idempotency-Key", "a");
    await request(app.getHttpServer())
      .post("/t/pay")
      .set("Idempotency-Key", "b");
    expect(counter).toBe(2);
  });

  it("bypasses GET requests entirely", async () => {
    await request(app.getHttpServer())
      .get("/t/ping")
      .set("Idempotency-Key", "g");
    await request(app.getHttpServer())
      .get("/t/ping")
      .set("Idempotency-Key", "g");
    expect(counter).toBe(2);
  });

  it("allows a @RequireIdempotency route without key when enforcement is off (default)", async () => {
    const res = await request(app.getHttpServer()).post("/t/charge");
    expect(res.status).toBeLessThan(400);
    expect(counter).toBe(1);
  });

  it("rejects a @RequireIdempotency route with 400 when enforcing and no key", async () => {
    process.env.IDEMPOTENCY_ENFORCE = "true";
    const res = await request(app.getHttpServer()).post("/t/charge");
    expect(res.status).toBe(400);
    expect(counter).toBe(0);
  });

  it("still dedupes a @RequireIdempotency route with a key while enforcing", async () => {
    process.env.IDEMPOTENCY_ENFORCE = "true";
    await request(app.getHttpServer())
      .post("/t/charge")
      .set("Idempotency-Key", "m1");
    await request(app.getHttpServer())
      .post("/t/charge")
      .set("Idempotency-Key", "m1");
    expect(counter).toBe(1);
  });
});
