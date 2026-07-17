/**
 * طبقة نقية لتوحيد أكواد الأخطاء ورسائلها المترجمة (Mobile-Ready APIs).
 * بلا اعتماد على NestJS أو DB — قابلة لاختبارات الوحدة.
 *
 * الهدف: كل خطأ يُرجع بـ (code ثابت يقرأه تطبيق الموبايل برمجيًا) +
 * رسالة مترجمة حسب `Accept-Language`، بدل الاعتماد على نص الرسالة.
 */

export type Locale = "ar" | "en" | "fr";

export const SUPPORTED_LOCALES: Locale[] = ["ar", "en", "fr"];
export const DEFAULT_LOCALE: Locale = "ar";

export interface ErrorCodeDef {
  httpStatus: number;
  messages: Record<Locale, string>;
}

/** سجلّ أكواد الأخطاء الموحّد (مصدر الحقيقة للموبايل والويب). */
export const API_ERROR_CODES = {
  VALIDATION_ERROR: {
    httpStatus: 400,
    messages: {
      ar: "بيانات الطلب غير صالحة.",
      en: "The request data is invalid.",
      fr: "Les données de la requête sont invalides.",
    },
  },
  UNAUTHORIZED: {
    httpStatus: 401,
    messages: {
      ar: "يلزم تسجيل الدخول.",
      en: "Authentication is required.",
      fr: "Authentification requise.",
    },
  },
  FORBIDDEN: {
    httpStatus: 403,
    messages: {
      ar: "لا تملك صلاحية لهذا الإجراء.",
      en: "You do not have permission for this action.",
      fr: "Vous n'avez pas la permission pour cette action.",
    },
  },
  NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "العنصر المطلوب غير موجود.",
      en: "The requested resource was not found.",
      fr: "La ressource demandée est introuvable.",
    },
  },
  CONFLICT: {
    httpStatus: 409,
    messages: {
      ar: "تعارض مع الحالة الحالية.",
      en: "Conflict with the current state.",
      fr: "Conflit avec l'état actuel.",
    },
  },
  DUPLICATE_REQUEST: {
    httpStatus: 409,
    messages: {
      ar: "تمّ استلام هذا الطلب مسبقًا.",
      en: "This request was already received.",
      fr: "Cette requête a déjà été reçue.",
    },
  },
  INSUFFICIENT_BALANCE: {
    httpStatus: 402,
    messages: {
      ar: "الرصيد غير كافٍ.",
      en: "Insufficient balance.",
      fr: "Solde insuffisant.",
    },
  },
  RISK_BLOCKED: {
    httpStatus: 403,
    messages: {
      ar: "تم حجب العملية لأسباب أمنية.",
      en: "The operation was blocked for security reasons.",
      fr: "L'opération a été bloquée pour des raisons de sécurité.",
    },
  },
  RISK_REVIEW: {
    httpStatus: 202,
    messages: {
      ar: "العملية قيد المراجعة.",
      en: "The operation is under review.",
      fr: "L'opération est en cours d'examen.",
    },
  },
  INVALID_PHONE_NUMBER: {
    httpStatus: 400,
    messages: {
      ar: "رقم الهاتف غير صالح.",
      en: "The phone number is invalid.",
      fr: "Le numéro de téléphone est invalide.",
    },
  },
  RISK_REVIEW_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "طلب المراجعة غير موجود.",
      en: "The risk review was not found.",
      fr: "La révision de risque est introuvable.",
    },
  },
  RISK_HOLD_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "الحجز غير موجود.",
      en: "The risk hold was not found.",
      fr: "La retenue de risque est introuvable.",
    },
  },
  BLACKLIST_ENTRY_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "المدخل غير موجود في قائمة الحظر.",
      en: "The blacklist entry was not found.",
      fr: "L'entrée de liste noire est introuvable.",
    },
  },
  PHONE_ALREADY_REGISTERED: {
    httpStatus: 409,
    messages: {
      ar: "رقم الهاتف مسجل مسبقًا.",
      en: "The phone number is already registered.",
      fr: "Le numéro de téléphone est déjà enregistré.",
    },
  },
  INVALID_CREDENTIALS: {
    httpStatus: 401,
    messages: {
      ar: "بيانات الدخول غير صحيحة.",
      en: "The login credentials are invalid.",
      fr: "Les identifiants de connexion sont invalides.",
    },
  },
  ACCOUNT_INACTIVE: {
    httpStatus: 403,
    messages: {
      ar: "الحساب غير نشط.",
      en: "The account is not active.",
      fr: "Le compte n'est pas actif.",
    },
  },
  ACTIVE_TRIP_EXISTS: {
    httpStatus: 409,
    messages: {
      ar: "لديك رحلة نشطة بالفعل.",
      en: "You already have an active trip.",
      fr: "Vous avez déjà une course active.",
    },
  },
  CITY_CAPACITY_REJECTED: {
    httpStatus: 503,
    messages: {
      ar: "الخدمة غير متاحة مؤقتًا في هذه المدينة.",
      en: "The service is temporarily unavailable in this city.",
      fr: "Le service est temporairement indisponible dans cette ville.",
    },
  },
  TRIP_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "الرحلة غير موجودة.",
      en: "The trip was not found.",
      fr: "La course est introuvable.",
    },
  },
  TRIP_FARE_UNAVAILABLE: {
    httpStatus: 409,
    messages: {
      ar: "تكلفة الرحلة غير متاحة بعد.",
      en: "The trip fare is not available yet.",
      fr: "Le tarif de la course n'est pas encore disponible.",
    },
  },
  DRIVER_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "السائق غير موجود.",
      en: "The driver was not found.",
      fr: "Le chauffeur est introuvable.",
    },
  },
  WITHDRAWAL_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "طلب السحب غير موجود.",
      en: "The withdrawal request was not found.",
      fr: "La demande de retrait est introuvable.",
    },
  },
  SETTLEMENT_NOT_ELIGIBLE: {
    httpStatus: 409,
    messages: {
      ar: "الرحلة غير مؤهلة للتسوية.",
      en: "The trip is not eligible for settlement.",
      fr: "La course n'est pas éligible au règlement.",
    },
  },
  CURRENCY_COUNTRY_MISMATCH: {
    httpStatus: 409,
    messages: {
      ar: "عملة الرحلة لا تطابق إعدادات البلد.",
      en: "The trip currency does not match the country configuration.",
      fr: "La devise de la course ne correspond pas à la configuration du pays.",
    },
  },
  INVALID_WITHDRAWAL_TRANSITION: {
    httpStatus: 409,
    messages: {
      ar: "انتقال حالة طلب السحب غير مسموح.",
      en: "The withdrawal status transition is not allowed.",
      fr: "La transition d'état du retrait n'est pas autorisée.",
    },
  },
  PAYMENT_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "الدفعة غير موجودة.",
      en: "The payment was not found.",
      fr: "Le paiement est introuvable.",
    },
  },
  INVALID_PAYMENT_TRANSITION: {
    httpStatus: 409,
    messages: {
      ar: "انتقال حالة الدفعة غير مسموح.",
      en: "The payment status transition is not allowed.",
      fr: "La transition d'état du paiement n'est pas autorisée.",
    },
  },
  RATE_LIMITED: {
    httpStatus: 429,
    messages: {
      ar: "طلبات كثيرة جدًا، حاول لاحقًا.",
      en: "Too many requests, please try again later.",
      fr: "Trop de requêtes, réessayez plus tard.",
    },
  },
  OTP_INVALID: {
    httpStatus: 400,
    messages: {
      ar: "رمز التحقق غير صحيح أو منتهي الصلاحية.",
      en: "The verification code is invalid or has expired.",
      fr: "Le code de vérification est invalide ou a expiré.",
    },
  },
  PROMO_CODE_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "الرمز الترويجي غير موجود.",
      en: "The promo code was not found.",
      fr: "Le code promotionnel est introuvable.",
    },
  },
  PROMO_CODE_INVALID: {
    httpStatus: 400,
    messages: {
      ar: "الرمز الترويجي غير صالح أو منتهي الصلاحية.",
      en: "The promo code is invalid or has expired.",
      fr: "Le code promotionnel est invalide ou a expiré.",
    },
  },
  PROMO_CODE_EXHAUSTED: {
    httpStatus: 409,
    messages: {
      ar: "استُنفد الرمز الترويجي عدد الاستخدامات.",
      en: "The promo code has reached its redemption limit.",
      fr: "Le code promotionnel a atteint sa limite d'utilisation.",
    },
  },
  PROMO_CODE_ALREADY_REDEEMED: {
    httpStatus: 409,
    messages: {
      ar: "لقد استبدلت هذا الرمز الترويجي مسبقًا.",
      en: "You have already redeemed this promo code.",
      fr: "Vous avez déjà utilisé ce code promotionnel.",
    },
  },
  REFERRAL_DISABLED: {
    httpStatus: 400,
    messages: {
      ar: "نظام الإحالة غير مفعّل حاليًا.",
      en: "The referral program is currently disabled.",
      fr: "Le programme de parrainage est actuellement désactivé.",
    },
  },
  REFERRAL_CODE_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "رمز الإحالة غير موجود.",
      en: "The referral code was not found.",
      fr: "Le code de parrainage est introuvable.",
    },
  },
  REFERRAL_SELF: {
    httpStatus: 400,
    messages: {
      ar: "لا يمكنك إحالة نفسك.",
      en: "You cannot refer yourself.",
      fr: "Vous ne pouvez pas vous parrainer vous-même.",
    },
  },
  REFERRAL_ALREADY_APPLIED: {
    httpStatus: 409,
    messages: {
      ar: "تمّ استخدام رمز إحالة لهذا الحساب مسبقًا.",
      en: "A referral code has already been applied to this account.",
      fr: "Un code de parrainage a déjà été appliqué à ce compte.",
    },
  },
  LOYALTY_DISABLED: {
    httpStatus: 400,
    messages: {
      ar: "نظام الولاء غير مفعّل حاليًا.",
      en: "The loyalty program is currently disabled.",
      fr: "Le programme de fidélité est actuellement désactivé.",
    },
  },
  LOYALTY_INSUFFICIENT_POINTS: {
    httpStatus: 400,
    messages: {
      ar: "رصيد النقاط غير كافٍ.",
      en: "Insufficient loyalty points.",
      fr: "Points de fidélité insuffisants.",
    },
  },
  LOYALTY_MIN_REDEEM: {
    httpStatus: 400,
    messages: {
      ar: "عدد النقاط أقل من الحد الأدنى للاستبدال.",
      en: "Points are below the minimum redemption threshold.",
      fr: "Les points sont inférieurs au seuil minimal d'échange.",
    },
  },
  SUBSCRIPTION_PLAN_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "خطة الاشتراك غير موجودة.",
      en: "The subscription plan was not found.",
      fr: "Le forfait d'abonnement est introuvable.",
    },
  },
  SUBSCRIPTION_PLAN_CODE_TAKEN: {
    httpStatus: 409,
    messages: {
      ar: "رمز خطة الاشتراك مستخدم بالفعل.",
      en: "The subscription plan code is already in use.",
      fr: "Le code du forfait d'abonnement est déjà utilisé.",
    },
  },
  SUBSCRIPTION_PLAN_INACTIVE: {
    httpStatus: 400,
    messages: {
      ar: "خطة الاشتراك غير مفعّلة.",
      en: "The subscription plan is inactive.",
      fr: "Le forfait d'abonnement est inactif.",
    },
  },
  SUBSCRIPTION_ALREADY_ACTIVE: {
    httpStatus: 409,
    messages: {
      ar: "لديك اشتراك فعّال بالفعل.",
      en: "You already have an active subscription.",
      fr: "Vous avez déjà un abonnement actif.",
    },
  },
  SUBSCRIPTION_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "الاشتراك غير موجود.",
      en: "The subscription was not found.",
      fr: "L'abonnement est introuvable.",
    },
  },
  SUBSCRIPTION_NOT_ACTIVE: {
    httpStatus: 400,
    messages: {
      ar: "الاشتراك غير فعّال.",
      en: "The subscription is not active.",
      fr: "L'abonnement n'est pas actif.",
    },
  },
  SUBSCRIPTION_INSUFFICIENT_BALANCE: {
    httpStatus: 400,
    messages: {
      ar: "رصيد المحفظة غير كافٍ لدفع رسوم الاشتراك.",
      en: "Insufficient wallet balance for the subscription fee.",
      fr: "Solde du portefeuille insuffisant pour les frais d'abonnement.",
    },
  },
  SAVED_PLACE_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "المكان المحفوظ غير موجود.",
      en: "The saved place was not found.",
      fr: "Le lieu enregistré est introuvable.",
    },
  },
  GEO_INPUT_INVALID: {
    httpStatus: 400,
    messages: {
      ar: "إحداثيات أو مدخلات الموقع غير صالحة.",
      en: "The location coordinates or input are invalid.",
      fr: "Les coordonnées ou les données de localisation sont invalides.",
    },
  },
  GEO_PROVIDER_ERROR: {
    httpStatus: 502,
    messages: {
      ar: "تعذّر الاتصال بمزوّد الخرائط، حاول لاحقًا.",
      en: "Could not reach the maps provider, please try again later.",
      fr: "Impossible de joindre le fournisseur de cartes, réessayez plus tard.",
    },
  },
  FARE_QUOTE_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "عرض السعر غير موجود.",
      en: "The fare quote was not found.",
      fr: "Le devis de prix est introuvable.",
    },
  },
  FARE_QUOTE_EXPIRED: {
    httpStatus: 409,
    messages: {
      ar: "��نتهت صلاحية عرض السعر، اطلب عرضًا جديدًا.",
      en: "The fare quote has expired, please request a new one.",
      fr: "Le devis de prix a expiré, veuillez en demander un nouveau.",
    },
  },
  FARE_QUOTE_INVALID_STATE: {
    httpStatus: 409,
    messages: {
      ar: "لا يمكن تنفيذ الإجراء على عرض السعر في حالته الحالية.",
      en: "This action is not allowed for the fare quote in its current state.",
      fr: "Cette action n'est pas autorisée pour le devis dans son état actuel.",
    },
  },
  FARE_OFFER_OUT_OF_RANGE: {
    httpStatus: 400,
    messages: {
      ar: "السعر المقترَح خارج النطاق المسموح للتفاوض.",
      en: "The proposed fare is outside the allowed negotiation range.",
      fr: "Le prix proposé est en dehors de la plage de négociation autorisée.",
    },
  },
  FARE_OFFER_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "عرض السائق غير موجود.",
      en: "The driver offer was not found.",
      fr: "L'offre du chauffeur est introuvable.",
    },
  },
  FARE_OFFER_INVALID_STATE: {
    httpStatus: 409,
    messages: {
      ar: "لا يمكن تنفيذ الإجراء على عرض السائق في حالته الحالية.",
      en: "This action is not allowed for the driver offer in its current state.",
      fr: "Cette action n'est pas autorisée pour l'offre du chauffeur dans son état actuel.",
    },
  },
  FARE_OFFER_DRIVER_UNAVAILABLE: {
    httpStatus: 409,
    messages: {
      ar: "السائق لم يعد متاحًا لقبول الرحلة.",
      en: "The driver is no longer available to take the trip.",
      fr: "Le chauffeur n'est plus disponible pour prendre la course.",
    },
  },
  FARE_OFFER_EXPIRED: {
    httpStatus: 409,
    messages: {
      ar: "انتهت صلاحية عرض السائق.",
      en: "The driver offer has expired.",
      fr: "L'offre du chauffeur a expiré.",
    },
  },
  INTERNAL: {
    httpStatus: 500,
    messages: {
      ar: "حدث خطأ غير متوقّع، حاول لاحقًا.",
      en: "An unexpected error occurred, please try again later.",
      fr: "Une erreur inattendue s'est produite, réessayez plus tard.",
    },
  },
  KYC_ALREADY_PENDING: {
    httpStatus: 409,
    messages: {
      ar: "لديك طلب تحقق هوية قيد المراجعة بالفعل.",
      en: "You already have an identity verification request under review.",
      fr: "Vous avez déjà une demande de vérification d'identité en cours d'examen.",
    },
  },
  KYC_ALREADY_VERIFIED: {
    httpStatus: 409,
    messages: {
      ar: "هويتك موثّقة بالفعل وسارية المفعول.",
      en: "Your identity is already verified and valid.",
      fr: "Votre identité est déjà vérifiée et valide.",
    },
  },
  KYC_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "طلب تحقق الهوية غير موجود.",
      en: "The identity verification request was not found.",
      fr: "La demande de vérification d'identité est introuvable.",
    },
  },
  KYC_INVALID_STATUS: {
    httpStatus: 400,
    messages: {
      ar: "لا يمكن تنفيذ هذا الإجراء على حالة الطلب الحالية.",
      en: "This action cannot be performed on the request's current status.",
      fr: "Cette action ne peut pas être effectuée sur le statut actuel de la demande.",
    },
  },
  VEHICLE_NOT_FOUND: {
    httpStatus: 404,
    messages: {
      ar: "المركبة غير موجودة.",
      en: "The vehicle was not found.",
      fr: "Le véhicule est introuvable.",
    },
  },
  VEHICLE_INVALID_STATUS: {
    httpStatus: 400,
    messages: {
      ar: "لا يمكن تنفيذ هذا الإجراء على حالة المركبة الحالية.",
      en: "This action cannot be performed on the vehicle's current status.",
      fr: "Cette action ne peut pas être effectuée sur le statut actuel du véhicule.",
    },
  },
} as const satisfies Record<string, ErrorCodeDef>;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

/** يحدّد اللغة من ترويسة `Accept-Language` (يختار أول مدعومة). */
export function resolveLocale(acceptLanguage?: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const tags = acceptLanguage
    .split(",")
    .map((part) => part.split(";")[0].trim().toLowerCase())
    .filter(Boolean);
  for (const tag of tags) {
    const base = tag.split("-")[0] as Locale;
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** الحالة HTTP المرتبطة بالكود. */
export function httpStatusForCode(code: ApiErrorCode): number {
  return API_ERROR_CODES[code].httpStatus;
}

/** يترجم كودًا إلى رسالة باللغة المطلوبة (مع رجوع للافتراضي). */
export function translateCode(code: ApiErrorCode, locale: Locale): string {
  const def = API_ERROR_CODES[code];
  return def.messages[locale] ?? def.messages[DEFAULT_LOCALE];
}

/** يربط حالة HTTP عامّة بأقرب كود موحّد (لاستثناءات قديمة بلا كود). */
export function codeForHttpStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHORIZED";
    case 402:
      return "INSUFFICIENT_BALANCE";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL" : "VALIDATION_ERROR";
  }
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
  statusCode: number;
  path?: string;
  requestId?: string;
  traceId?: string;
  timestamp: string;
}

/**
 * يبني مغلّف خطأ موحّدًا. إن مُرّرت رسالة صريحة (override) تُستخدم،
 * وإلّا تُترجم رسالة الكود حسب اللغة.
 */
export function buildErrorEnvelope(args: {
  code: ApiErrorCode;
  locale: Locale;
  messageOverride?: string;
  details?: unknown;
  path?: string;
  requestId?: string;
  traceId?: string;
  now?: Date;
}): ErrorEnvelope {
  const statusCode = httpStatusForCode(args.code);
  return {
    success: false,
    error: {
      code: args.code,
      message: args.messageOverride ?? translateCode(args.code, args.locale),
      ...(args.details !== undefined ? { details: args.details } : {}),
    },
    statusCode,
    path: args.path,
    requestId: args.requestId,
    traceId: args.traceId,
    timestamp: (args.now ?? new Date()).toISOString(),
  };
}
