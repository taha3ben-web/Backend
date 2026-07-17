// حدود معدّل خاصّة بنقاط المصادقة الحسّاسة (دفاع بالطبقات فوق الخنق العام).
//
// الوحدة: `ttl` بالمِلّي ثانية (متوافق مع ThrottlerModule.forRoot في app.module).
// كل حدّ أدنى من الحدّ العام (120/60ث) لأنّ هذه النقاط عرضة للإساءة (قوّة غاشمة،
// إنشاء حسابات، قصف SMS). هذه القيم تُمرّر إلى المُزيّن @Throttle لكل مسار.
//
// ملاحظة: هذا تقنين نقل (لكل IP) مكمّل لحماية طبقة الخدمة (قفل الدخول لكل هوية
// وتقييد طلب OTP)؛ لا يستبدلها.

export type RateLimitRule = { limit: number; ttl: number };

/** شكل متوافق مع @Throttle في @nestjs/throttler v5. */
export type ThrottleConfig = { default: RateLimitRule };

const WINDOW_MS = 60_000;

function rule(limit: number): ThrottleConfig {
  return { default: { limit, ttl: WINDOW_MS } };
}

/** الحدّ العامّ المضبوط في app.module (للمقارنة في الاختبارات). */
export const GLOBAL_RATE_LIMIT: RateLimitRule = { limit: 120, ttl: WINDOW_MS };

export const AUTH_RATE_LIMITS = {
  register: rule(10),
  login: rule(15),
  firebase: rule(15),
  refresh: rule(30),
  otpRequest: rule(5),
  otpVerify: rule(10),
};
