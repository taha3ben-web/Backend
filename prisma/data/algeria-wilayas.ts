/**
 * الولايات الجزائرية الـ69 — مصدر الحقيقة للبيانات المرجعية.
 * ==========================================================
 *
 * المصادر (تم التحقق منها، ولم تُخترع أي بيانات):
 *  - القانون رقم 26-06 المؤرخ في 4 أفريل 2026، الجريدة الرسمية عدد 25 الصادرة
 *    في 5 أفريل 2026: يرسم التقسيم الإقليمي الجديد للبلاد بـ 69 ولاية و1541 بلدية.
 *  - المرسوم الرئاسي المنشور في الجريدة الرسمية عدد 40 (جوان 2026): يحدد أسماء
 *    ومقار الولايات الـ11 المستحدثة، وهي تحمل الأرقام من 59 إلى 69.
 *  - الولايات 1..58 وفق التقسيمين السابقين (قانون 84-09 لعدد 48 ولاية،
 *    ثم قانون 19-12 الذي رفعها إلى 58 سنة 2019).
 *
 * ملاحظة صريحة حول الإحداثيات:
 *   centerLat/centerLng هي إحداثيات تقريبية لمقر الولاية (المدينة الإدارية)،
 *   بدقة تكفي لتوسيط الخريطة واختيار الافتراضات فقط. هي ليست حدودًا إدارية
 *   ولا centroid هندسي دقيق للإقليم. النظام لا يستخدمها إطلاقًا لحساب المسافة
 *   أو المدة أو المسار — تلك مسؤولية Google Routes حصرًا. يمكن للإدارة تصحيح أي
 *   إحداثية من لوحة التحكم دون ترحيل جديد.
 *
 * قاعدة التعديل المستقبلي:
 *   إذا تغيّر التقسيم الإداري مجددًا، يُعدَّل هذا الملف فقط ثم يُعاد تشغيل الـseed.
 *   لا يلزم تعديل PassengerApp ولا DriverApp، لأنهما لا يحملان أي قائمة ولايات.
 */

export type WilayaSeed = {
  /** الرقم الرسمي 1..69 */
  number: number;
  /** ISO 3166-2 مثل DZ-16 */
  code: string;
  nameAr: string;
  nameFr: string;
  nameEn: string;
  /** مقر الولاية كما ورد في النص الرسمي */
  seatAr: string;
  seatFr: string;
  /** إحداثيات تقريبية لمقر الولاية (ليست للحساب الجغرافي) */
  lat: number;
  lng: number;
};

const w = (
  number: number,
  nameAr: string,
  nameFr: string,
  nameEn: string,
  lat: number,
  lng: number,
  seatAr?: string,
  seatFr?: string,
): WilayaSeed => ({
  number,
  code: `DZ-${String(number).padStart(2, "0")}`,
  nameAr,
  nameFr,
  nameEn,
  // في الجزائر اسم الولاية هو دائمًا اسم مقرها، إلا حين ينص المرسوم على خلاف ذلك.
  seatAr: seatAr ?? nameAr,
  seatFr: seatFr ?? nameFr,
  lat,
  lng,
});

export const ALGERIA_WILAYAS: WilayaSeed[] = [
  // ---- 1..48 : تقسيم 1984 ----
  w(1, "أدرار", "Adrar", "Adrar", 27.8743, -0.2939),
  w(2, "الشلف", "Chlef", "Chlef", 36.1654, 1.3345),
  w(3, "الأغواط", "Laghouat", "Laghouat", 33.8, 2.865),
  w(4, "أم البواقي", "Oum El Bouaghi", "Oum El Bouaghi", 35.8753, 7.1135),
  w(5, "باتنة", "Batna", "Batna", 35.556, 6.1741),
  w(6, "بجاية", "Béjaïa", "Bejaia", 36.7509, 5.0567),
  w(7, "بسكرة", "Biskra", "Biskra", 34.85, 5.728),
  w(8, "بشار", "Béchar", "Bechar", 31.6167, -2.2167),
  w(9, "البليدة", "Blida", "Blida", 36.47, 2.83),
  w(10, "البويرة", "Bouira", "Bouira", 36.375, 3.902),
  w(11, "تمنراست", "Tamanrasset", "Tamanrasset", 22.785, 5.5228),
  w(12, "تبسة", "Tébessa", "Tebessa", 35.4042, 8.1242),
  w(13, "تلمسان", "Tlemcen", "Tlemcen", 34.8783, -1.315),
  w(14, "تيارت", "Tiaret", "Tiaret", 35.3711, 1.317),
  w(15, "تيزي وزو", "Tizi Ouzou", "Tizi Ouzou", 36.7169, 4.0497),
  w(16, "الجزائر", "Alger", "Algiers", 36.7538, 3.0588),
  w(17, "الجلفة", "Djelfa", "Djelfa", 34.6703, 3.263),
  w(18, "جيجل", "Jijel", "Jijel", 36.819, 5.7667),
  w(19, "سطيف", "Sétif", "Setif", 36.19, 5.41),
  w(20, "سعيدة", "Saïda", "Saida", 34.8303, 0.1517),
  w(21, "سكيكدة", "Skikda", "Skikda", 36.879, 6.9067),
  w(22, "سيدي بلعباس", "Sidi Bel Abbès", "Sidi Bel Abbes", 35.1878, -0.6308),
  w(23, "عنابة", "Annaba", "Annaba", 36.9, 7.7667),
  w(24, "قالمة", "Guelma", "Guelma", 36.462, 7.426),
  w(25, "قسنطينة", "Constantine", "Constantine", 36.365, 6.6147),
  w(26, "المدية", "Médéa", "Medea", 36.2675, 2.7539),
  w(27, "مستغانم", "Mostaganem", "Mostaganem", 35.9315, 0.0892),
  w(28, "المسيلة", "M'Sila", "M'Sila", 35.705, 4.542),
  w(29, "معسكر", "Mascara", "Mascara", 35.3968, 0.14),
  w(30, "ورقلة", "Ouargla", "Ouargla", 31.949, 5.325),
  w(31, "وهران", "Oran", "Oran", 35.6969, -0.6331),
  w(32, "البيض", "El Bayadh", "El Bayadh", 33.68, 1.02),
  w(33, "إليزي", "Illizi", "Illizi", 26.4833, 8.4667),
  w(
    34,
    "برج بوعريريج",
    "Bordj Bou Arréridj",
    "Bordj Bou Arreridj",
    36.0731,
    4.7608,
  ),
  w(35, "بومرداس", "Boumerdès", "Boumerdes", 36.7667, 3.4772),
  w(36, "الطارف", "El Tarf", "El Tarf", 36.7672, 8.3136),
  w(37, "تندوف", "Tindouf", "Tindouf", 27.6742, -8.1478),
  w(38, "تيسمسيلت", "Tissemsilt", "Tissemsilt", 35.6072, 1.8106),
  w(39, "الوادي", "El Oued", "El Oued", 33.3683, 6.8674),
  w(40, "خنشلة", "Khenchela", "Khenchela", 35.4358, 7.1436),
  w(41, "سوق أهراس", "Souk Ahras", "Souk Ahras", 36.2864, 7.9511),
  w(42, "تيبازة", "Tipaza", "Tipaza", 36.5892, 2.4483),
  w(43, "ميلة", "Mila", "Mila", 36.4503, 6.2644),
  w(44, "عين الدفلى", "Aïn Defla", "Ain Defla", 36.2639, 1.9678),
  w(45, "النعامة", "Naâma", "Naama", 33.2667, -0.3167),
  w(46, "عين تموشنت", "Aïn Témouchent", "Ain Temouchent", 35.2978, -1.14),
  w(47, "غرداية", "Ghardaïa", "Ghardaia", 32.49, 3.67),
  w(48, "غليزان", "Relizane", "Relizane", 35.7372, 0.5558),

  // ---- 49..58 : الولايات العشر المستحدثة سنة 2019 (قانون 19-12) ----
  w(49, "تيميمون", "Timimoun", "Timimoun", 29.2639, 0.2306),
  w(
    50,
    "برج باجي مختار",
    "Bordj Badji Mokhtar",
    "Bordj Badji Mokhtar",
    21.3287,
    0.9556,
  ),
  w(51, "أولاد جلال", "Ouled Djellal", "Ouled Djellal", 34.4167, 5.0667),
  w(52, "بني عباس", "Béni Abbès", "Beni Abbes", 30.13, -2.17),
  w(53, "عين صالح", "In Salah", "In Salah", 27.1937, 2.46),
  w(54, "عين قزام", "In Guezzam", "In Guezzam", 19.5686, 5.7722),
  w(55, "تقرت", "Touggourt", "Touggourt", 33.1, 6.0667),
  w(56, "جانت", "Djanet", "Djanet", 24.554, 9.4843),
  w(57, "المغير", "El M'Ghair", "El M'Ghair", 33.95, 5.9167),
  w(58, "المنيعة", "El Menia", "El Menia", 30.5833, 2.8833),

  // ---- 59..69 : الولايات الـ11 المستحدثة بموجب القانون 26-06 ----
  // الأرقام والمقار وفق المرسوم الرئاسي (الجريدة الرسمية عدد 40).
  w(59, "آفلو", "Aflou", "Aflou", 34.1108, 2.1017),
  w(60, "بريكة", "Barika", "Barika", 35.3897, 5.3672),
  w(61, "القنطرة", "El Kantara", "El Kantara", 35.22, 5.7),
  w(62, "بئر العاتر", "Bir El Ater", "Bir El Ater", 34.7439, 8.0603),
  w(63, "العريشة", "El Aricha", "El Aricha", 34.2167, -1.2667),
  w(64, "قصر الشلالة", "Ksar Chellala", "Ksar Chellala", 35.2117, 2.3183),
  w(65, "عين وسارة", "Aïn Oussera", "Ain Oussera", 35.4506, 2.9061),
  w(66, "مسعد", "Messaad", "Messaad", 34.155, 3.5033),
  w(
    67,
    "قصر البخاري",
    "Ksar El Boukhari",
    "Ksar El Boukhari",
    35.8878,
    2.7581,
  ),
  w(68, "بوسعادة", "Bou Saâda", "Bou Saada", 35.2124, 4.1819),
  w(
    69,
    "الأبيض سيدي الشيخ",
    "El Abiodh Sidi Cheikh",
    "El Abiodh Sidi Cheikh",
    32.9,
    0.55,
  ),
];

/** حارس بسيط: يمنع أي تعديل مستقبلي يكسر التسلسل أو يكرر رقمًا. */
export function assertWilayaDatasetIntegrity(
  list: WilayaSeed[] = ALGERIA_WILAYAS,
): void {
  const numbers = list.map((x) => x.number);
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) {
    throw new Error("ALGERIA_WILAYAS: يوجد رقم ولاية مكرر");
  }
  for (let i = 1; i <= list.length; i++) {
    if (!unique.has(i)) {
      throw new Error(`ALGERIA_WILAYAS: الرقم ${i} مفقود من التسلسل`);
    }
  }
}
