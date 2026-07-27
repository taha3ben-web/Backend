import { createHmac } from "node:crypto";
import {
  ChatOnlyCallMaskingAdapter,
  DirectCallMaskingAdapter,
  TwilioCallMaskingAdapter,
  buildDialTwiml,
  buildRejectTwiml,
  escapeXml,
  maskPhone,
  normalizePhone,
  parseDirectCallRoles,
  resolveProviderName,
  samePhone,
  verifyTwilioSignature,
} from "./call-masking.adapter";

describe("call masking pure helpers", () => {
  it("يحجب الرقم ويبقي آخر خانتين فقط", () => {
    const masked = maskPhone("+213661234547");
    expect(masked).toContain("47");
    expect(masked).not.toContain("123");
    expect(maskPhone(null)).toBeNull();
  });

  it("يطبّع الأرقام ويوازن بين المقدمات المختلفة", () => {
    expect(normalizePhone(" +213 661 23 45 47 ")).toBe("+213661234547");
    expect(samePhone("+213661234547", "0661234547")).toBe(true);
    expect(samePhone("+213661234547", "+213661234548")).toBe(false);
    expect(samePhone("", "0661234547")).toBe(false);
  });

  it("يقرأ المزوّد من البيئة مع افتراض أمين", () => {
    expect(resolveProviderName("TWILIO")).toBe("twilio");
    expect(resolveProviderName(undefined)).toBe("chat_only");
    expect(resolveProviderName("vonage")).toBe("chat_only");
  });

  it("يهرّب محارف XML فلا يمكن حقن TwiML", () => {
    expect(escapeXml("<Dial>\"&'")).toBe("&lt;Dial&gt;&quot;&amp;&apos;");
    const twiml = buildDialTwiml({
      target: '+213661234547"/><Hangup/>',
      callerId: "+213770000000",
    });
    expect(twiml).not.toContain('"/><Hangup/>');
    expect(twiml).toContain("&quot;");
  });

  it("يبني TwiML تحويل بمدّة محصورة وتسجيل اختياري", () => {
    const fast = buildDialTwiml({
      target: "+213661234547",
      callerId: "+213770000000",
      timeoutSec: 1,
    });
    expect(fast).toContain('timeout="10"');
    const slow = buildDialTwiml({
      target: "+213661234547",
      callerId: "+213770000000",
      timeoutSec: 999,
    });
    expect(slow).toContain('timeout="60"');
    expect(fast).not.toContain("record");
    expect(
      buildDialTwiml({
        target: "+213661234547",
        callerId: "+213770000000",
        recordingEnabled: true,
      }),
    ).toContain('record="record-from-answer"');
  });

  it("يبني رفضًا ينتهي بإغلاق المكالمة", () => {
    const twiml = buildRejectTwiml("غير متاح");
    expect(twiml).toContain("<Hangup/>");
    expect(twiml).toContain("<Say");
  });
});

describe("verifyTwilioSignature", () => {
  const authToken = "test-token";
  const url = "https://api.flamingo.app/api/calls/twilio/voice";
  const params = { To: "+213770000000", From: "+213661234547", CallSid: "CA1" };
  const sign = (u: string, p: Record<string, string>) => {
    let data = u;
    for (const key of Object.keys(p).sort()) data += key + p[key];
    return createHmac("sha1", authToken)
      .update(Buffer.from(data, "utf8"))
      .digest("base64");
  };

  it("يقبل التوقيع الصحيح", () => {
    expect(
      verifyTwilioSignature({
        authToken,
        url,
        params,
        signature: sign(url, params),
      }),
    ).toBe(true);
  });

  it("يرفض توقيعًا محسوبًا على رابط مختلف", () => {
    expect(
      verifyTwilioSignature({
        authToken,
        url,
        params,
        signature: sign(url + "?x=1", params),
      }),
    ).toBe(false);
  });

  it("يرفض حمولة مُتلاعبًا بها (رقم وجهة مغيّر)", () => {
    const signature = sign(url, params);
    expect(
      verifyTwilioSignature({
        authToken,
        url,
        params: { ...params, From: "+213999999999" },
        signature,
      }),
    ).toBe(false);
  });

  it("يرفض عند غياب التوقيع أو المفتاح", () => {
    expect(verifyTwilioSignature({ authToken, url, params })).toBe(false);
    expect(
      verifyTwilioSignature({
        authToken: "",
        url,
        params,
        signature: sign(url, params),
      }),
    ).toBe(false);
  });
});

describe("adapters", () => {
  it("محول الدردشة لا يُرجع أي رقم وسيط", async () => {
    const res = await new ChatOnlyCallMaskingAdapter().connect({
      tripId: "t1",
      callerRole: "PASSENGER",
      callerPhone: "+213661234547",
      calleePhone: "+213661234548",
      ttlMinutes: 60,
    });
    expect(res.mode).toBe("CHAT_ONLY");
    expect(res.proxyNumber).toBeUndefined();
  });

  it("محول Twilio غير جاهز بلا مفاتيح أو أرقام أو مخزّن", () => {
    expect(new TwilioCallMaskingAdapter().isConfigured()).toBe(false);
    expect(
      new TwilioCallMaskingAdapter("sid", "token", [
        "+213770000000",
      ]).isConfigured(),
    ).toBe(false);
  });

  it("محول Twilio يحجز رقمًا ويُرجع وضع الرقم الوسيط", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const adapter = new TwilioCallMaskingAdapter(
      "sid",
      "token",
      ["+213770000000"],
      {
        allocate: async () => ({ proxyNumber: "+213770000000", expiresAt }),
      },
    );
    expect(adapter.isConfigured()).toBe(true);
    const res = await adapter.connect({
      tripId: "t1",
      callerRole: "DRIVER",
      callerPhone: "+213661234547",
      calleePhone: "+213661234548",
      ttlMinutes: 60,
    });
    expect(res.mode).toBe("MASKED_NUMBER");
    expect(res.proxyNumber).toBe("+213770000000");
    expect(JSON.stringify(res)).not.toContain("661234548");
  });
});

describe("direct call mode", () => {
  it("يقرأ سياسة الكشف من البيئة", () => {
    expect(parseDirectCallRoles(undefined)).toEqual(["PASSENGER", "DRIVER"]);
    expect(parseDirectCallRoles("both")).toEqual(["PASSENGER", "DRIVER"]);
    expect(parseDirectCallRoles("passenger")).toEqual(["PASSENGER"]);
    expect(parseDirectCallRoles("DRIVER")).toEqual(["DRIVER"]);
    expect(parseDirectCallRoles("none")).toEqual([]);
  });

  it("يعرف المزوّد المباشر", () => {
    expect(resolveProviderName("direct")).toBe("direct");
    expect(resolveProviderName(" PLAIN ")).toBe("direct");
  });

  it("يُرجع الرقم الحقيقي للدور المسموح", async () => {
    const res = await new DirectCallMaskingAdapter(["PASSENGER"]).connect({
      tripId: "t1",
      callerRole: "PASSENGER",
      callerPhone: "+213661234547",
      calleePhone: "+213661234548",
      ttlMinutes: 60,
    });
    expect(res.mode).toBe("DIRECT_NUMBER");
    expect(res.phoneNumber).toBe("+213661234548");
  });

  it("يرجع للدردشة للدور غير المسموح بلا أي رقم", async () => {
    const res = await new DirectCallMaskingAdapter(["PASSENGER"]).connect({
      tripId: "t1",
      callerRole: "DRIVER",
      callerPhone: "+213661234548",
      calleePhone: "+213661234547",
      ttlMinutes: 60,
    });
    expect(res.mode).toBe("CHAT_ONLY");
    expect(res.phoneNumber).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain("661234547");
  });

  it("معطّل تمامًا عند none", () => {
    expect(new DirectCallMaskingAdapter([]).isConfigured()).toBe(false);
  });
});
