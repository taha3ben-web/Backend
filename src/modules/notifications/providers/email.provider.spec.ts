import {
  RESEND_API_URL,
  SENDGRID_API_URL,
  buildEmailRequest,
  parseEmailAddress,
  resolveEmailProviderName,
} from "./email.provider";

describe("email provider resolution", () => {
  it("recognises the supported providers case insensitively", () => {
    expect(resolveEmailProviderName("Resend")).toBe("resend");
    expect(resolveEmailProviderName(" SENDGRID ")).toBe("sendgrid");
  });

  it("falls back to the generic http provider", () => {
    expect(resolveEmailProviderName(undefined)).toBe("generic");
    expect(resolveEmailProviderName("mailgun")).toBe("generic");
  });
});

describe("from address parsing", () => {
  it("splits a display name from the address", () => {
    expect(parseEmailAddress("flaminGO <no-reply@example.test>")).toEqual({
      name: "flaminGO",
      email: "no-reply@example.test",
    });
  });

  it("handles a bare address", () => {
    expect(parseEmailAddress(" no-reply@example.test ")).toEqual({
      email: "no-reply@example.test",
    });
  });

  it("strips surrounding quotes from the display name", () => {
    expect(parseEmailAddress('"flaminGO DZ" <a@b.test>')).toEqual({
      name: "flaminGO DZ",
      email: "a@b.test",
    });
  });
});

describe("provider payload shaping", () => {
  const base = {
    apiKey: "key_1",
    from: "flaminGO <no-reply@example.test>",
    to: "rider@example.test",
    subject: "Subject",
    html: "<p>Hello</p>",
    text: "Hello",
  };

  it("builds a resend request with an array recipient", () => {
    const request = buildEmailRequest({ ...base, provider: "resend" });
    expect(request.url).toBe(RESEND_API_URL);
    expect(request.headers.Authorization).toBe("Bearer key_1");
    expect(request.body.to).toEqual(["rider@example.test"]);
    expect(request.body.from).toBe(base.from);
  });

  it("builds a sendgrid request with personalizations and split from", () => {
    const request = buildEmailRequest({ ...base, provider: "sendgrid" });
    expect(request.url).toBe(SENDGRID_API_URL);
    expect(request.body.personalizations).toEqual([
      { to: [{ email: "rider@example.test" }] },
    ]);
    expect(request.body.from).toEqual({
      email: "no-reply@example.test",
      name: "flaminGO",
    });
    expect(request.body.content).toEqual([
      { type: "text/plain", value: "Hello" },
      { type: "text/html", value: "<p>Hello</p>" },
    ]);
  });

  it("puts html last for sendgrid so clients prefer it", () => {
    const request = buildEmailRequest({ ...base, provider: "sendgrid" });
    const content = request.body.content as Array<{ type: string }>;
    expect(content[content.length - 1].type).toBe("text/html");
  });

  it("uses the configured url for the generic provider", () => {
    const request = buildEmailRequest({
      ...base,
      provider: "generic",
      apiUrl: "https://mail.example.test/send",
    });
    expect(request.url).toBe("https://mail.example.test/send");
    expect(request.body.to).toBe("rider@example.test");
  });

  it("returns an empty url when the generic provider is unconfigured", () => {
    const request = buildEmailRequest({ ...base, provider: "generic" });
    expect(request.url).toBe("");
  });

  it("lets an explicit api url override a known provider endpoint", () => {
    const request = buildEmailRequest({
      ...base,
      provider: "resend",
      apiUrl: "https://proxy.example.test/emails",
    });
    expect(request.url).toBe("https://proxy.example.test/emails");
  });

  it("omits optional fields instead of sending empty values", () => {
    const request = buildEmailRequest({
      provider: "resend",
      apiKey: "key",
      from: "a@b.test",
      to: "c@d.test",
      subject: "s",
      html: "<p>h</p>",
    });
    expect(request.body).not.toHaveProperty("text");
    expect(request.body).not.toHaveProperty("reply_to");
  });

  it("maps reply-to per provider shape", () => {
    const resend = buildEmailRequest({
      ...base,
      provider: "resend",
      replyTo: "support@example.test",
    });
    const sendgrid = buildEmailRequest({
      ...base,
      provider: "sendgrid",
      replyTo: "flaminGO Support <support@example.test>",
    });
    expect(resend.body.reply_to).toBe("support@example.test");
    expect(sendgrid.body.reply_to).toEqual({ email: "support@example.test" });
  });
});
