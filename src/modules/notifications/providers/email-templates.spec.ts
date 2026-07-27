import {
  DEFAULT_EMAIL_BRAND,
  EMAIL_TEMPLATE_VARS,
  escapeHtml,
  isRtlLocale,
  readEmailBrand,
  renderEmailLayout,
  renderEmailTemplate,
  resolveEmailLocale,
} from "./email-templates";

describe("email locale resolution", () => {
  it("falls back to arabic for unknown or empty values", () => {
    expect(resolveEmailLocale(undefined)).toBe("ar");
    expect(resolveEmailLocale("")).toBe("ar");
    expect(resolveEmailLocale("de")).toBe("ar");
  });

  it("accepts region suffixes and mixed case", () => {
    expect(resolveEmailLocale("FR-DZ")).toBe("fr");
    expect(resolveEmailLocale(" en_US ")).toBe("en");
  });

  it("marks only arabic as rtl", () => {
    expect(isRtlLocale("ar")).toBe(true);
    expect(isRtlLocale("fr")).toBe(false);
    expect(isRtlLocale("en")).toBe(false);
  });
});

describe("email brand", () => {
  it("uses flaminGO gold defaults", () => {
    const brand = readEmailBrand({} as NodeJS.ProcessEnv);
    expect(brand.name).toBe("flaminGO");
    expect(brand.primaryColor).toBe("#D4AF37");
    expect(brand.backgroundColor).toBe("#111111");
  });

  it("lets the environment override every field", () => {
    const brand = readEmailBrand({
      EMAIL_BRAND_NAME: "flaminGO DZ",
      EMAIL_BRAND_COLOR: "#FFCC00",
      EMAIL_SUPPORT_ADDRESS: "help@example.test",
      EMAIL_APP_URL: "https://app.example.test",
    } as NodeJS.ProcessEnv);
    expect(brand.name).toBe("flaminGO DZ");
    expect(brand.primaryColor).toBe("#FFCC00");
    expect(brand.supportEmail).toBe("help@example.test");
    expect(brand.appUrl).toBe("https://app.example.test");
  });
});

describe("email layout", () => {
  it("renders rtl direction for arabic", () => {
    const html = renderEmailLayout({
      locale: "ar",
      heading: "heading",
      bodyHtml: "<p>body</p>",
      brand: DEFAULT_EMAIL_BRAND,
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain(DEFAULT_EMAIL_BRAND.primaryColor);
  });

  it("renders ltr direction for latin locales", () => {
    const html = renderEmailLayout({
      locale: "fr",
      heading: "heading",
      bodyHtml: "<p>body</p>",
      brand: DEFAULT_EMAIL_BRAND,
    });
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain('dir="rtl"');
  });

  it("uses tables and inline styles only, never flex or style tags", () => {
    const html = renderEmailLayout({
      locale: "en",
      heading: "heading",
      bodyHtml: "<p>body</p>",
      brand: DEFAULT_EMAIL_BRAND,
    });
    expect(html).toContain("<table");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("display:flex");
  });
});

describe("email escaping", () => {
  it("escapes every html metacharacter", () => {
    expect(escapeHtml("<b>&\"'</b>")).toBe(
      "&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;",
    );
  });

  it("escapes user supplied variables inside the rendered html", () => {
    const rendered = renderEmailTemplate({
      template: "welcome",
      locale: "en",
      vars: { name: "<script>alert(1)</script>" },
    });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });
});

describe("email template rendering", () => {
  it("declares required variables for every template", () => {
    for (const vars of Object.values(EMAIL_TEMPLATE_VARS)) {
      expect(vars.length).toBeGreaterThan(0);
    }
  });

  it("throws a precise error when a required variable is missing", () => {
    expect(() =>
      renderEmailTemplate({
        template: "trip_receipt",
        locale: "en",
        vars: { name: "Sami", tripId: "t1", amount: "500", currency: "DZD" },
      }),
    ).toThrow("EMAIL_TEMPLATE_VAR_MISSING_DATE");
  });

  it("treats a blank variable as missing", () => {
    expect(() =>
      renderEmailTemplate({
        template: "welcome",
        locale: "en",
        vars: { name: "   " },
      }),
    ).toThrow("EMAIL_TEMPLATE_VAR_MISSING_NAME");
  });

  it("fills the subject from variables", () => {
    const rendered = renderEmailTemplate({
      template: "trip_receipt",
      locale: "en",
      vars: {
        name: "Sami",
        tripId: "t1",
        amount: "500",
        currency: "DZD",
        date: "2026-07-27",
      },
    });
    expect(rendered.subject).toBe("Your receipt \u2014 500 DZD");
    expect(rendered.text).toContain("Trip ID: t1");
    expect(rendered.html).toContain("500 DZD");
  });

  it("renders a localized subject per locale", () => {
    const vars = {
      name: "Sami",
      tripId: "t1",
      amount: "500",
      currency: "DZD",
      date: "2026-07-27",
    };
    const fr = renderEmailTemplate({
      template: "trip_receipt",
      locale: "fr",
      vars,
    });
    const ar = renderEmailTemplate({
      template: "trip_receipt",
      locale: "ar",
      vars,
    });
    expect(fr.subject).toContain("re\u00e7u");
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.subject).not.toBe(fr.subject);
  });

  it("adds the cta button only when its url is provided", () => {
    const base = {
      name: "Sami",
      invoiceNumber: "FG-202607-000123",
      amount: "500",
      currency: "DZD",
    };
    const without = renderEmailTemplate({
      template: "invoice_ready",
      locale: "en",
      vars: base,
    });
    const withCta = renderEmailTemplate({
      template: "invoice_ready",
      locale: "en",
      vars: { ...base, invoiceUrl: "https://files.example.test/a.pdf" },
    });
    expect(without.html).not.toContain("<a href");
    expect(withCta.html).toContain("https://files.example.test/a.pdf");
    expect(withCta.text).toContain("https://files.example.test/a.pdf");
  });

  it("rejects an unknown template id", () => {
    expect(() =>
      renderEmailTemplate({
        template: "nope" as never,
        vars: {},
      }),
    ).toThrow("EMAIL_TEMPLATE_UNKNOWN_nope");
  });
});
