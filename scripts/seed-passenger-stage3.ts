import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const vehicleAssetKeys = {
  ECONOMY: "vehicle.category.economy",
  COMFORT: "vehicle.category.comfort",
  VAN: "vehicle.category.family",
  XL: "vehicle.category.family",
  BIKE: "vehicle.category.bike",
};
const messages: Record<string, Record<string, string>> = {
  ar: {
    "home.pickup": "نقطة الانطلاق",
    "home.currentLocation": "موقعي الحالي",
    "home.destinationHint": "ابحث عن عنوان أو مكان",
    "home.chooseDestination": "اختر وجهتك",
    "home.searching": "جارٍ البحث عن سائق قريب",
    "home.searchingHint": "سنخبرك فور قبول أحد السائقين",
    "home.driverArriving": "السائق في الطريق إليك",
    "home.driverArrived": "وصل السائق",
    "home.tripInProgress": "الرحلة جارية",
    "home.tripCompleted": "اكتملت الرحلة",
    "home.eta": "دقيقة",
    "home.capacity": "مقاعد",
    "home.payment": "طريقة الدفع",
    "home.close": "إغلاق",
    "home.negotiationTitle": "اختر السعر المناسب لك",
    "home.negotiationHint": "سيتم إرسال عرضك للسائقين القريبين",
    "home.noOffers": "بانتظار عروض السائقين",
    "home.driver": "السائق",
    "home.vehicle": "المركبة",
    "home.plate": "رقم اللوحة",
    "home.rating": "التقييم",
    "home.from": "من",
    "home.to": "إلى",
    "home.cancelRide": "إلغاء الرحلة",
  },
  fr: {
    "home.pickup": "Point de départ",
    "home.currentLocation": "Ma position",
    "home.destinationHint": "Rechercher une adresse ou un lieu",
    "home.chooseDestination": "Choisissez votre destination",
    "home.searching": "Recherche d’un chauffeur proche",
    "home.searchingHint": "Nous vous préviendrons dès qu’un chauffeur accepte",
    "home.driverArriving": "Le chauffeur arrive",
    "home.driverArrived": "Le chauffeur est arrivé",
    "home.tripInProgress": "Trajet en cours",
    "home.tripCompleted": "Trajet terminé",
    "home.eta": "min",
    "home.capacity": "places",
    "home.payment": "Paiement",
    "home.close": "Fermer",
    "home.negotiationTitle": "Choisissez votre prix",
    "home.negotiationHint": "Votre offre sera envoyée aux chauffeurs proches",
    "home.noOffers": "En attente des offres",
    "home.driver": "Chauffeur",
    "home.vehicle": "Véhicule",
    "home.plate": "Immatriculation",
    "home.rating": "Note",
    "home.from": "De",
    "home.to": "À",
    "home.cancelRide": "Annuler le trajet",
  },
  en: {
    "home.pickup": "Pickup",
    "home.currentLocation": "Current location",
    "home.destinationHint": "Search for an address or place",
    "home.chooseDestination": "Choose your destination",
    "home.searching": "Finding a nearby driver",
    "home.searchingHint": "We’ll notify you as soon as a driver accepts",
    "home.driverArriving": "Your driver is on the way",
    "home.driverArrived": "Your driver has arrived",
    "home.tripInProgress": "Trip in progress",
    "home.tripCompleted": "Trip completed",
    "home.eta": "min",
    "home.capacity": "seats",
    "home.payment": "Payment",
    "home.close": "Close",
    "home.negotiationTitle": "Choose your price",
    "home.negotiationHint": "Your offer will be sent to nearby drivers",
    "home.noOffers": "Waiting for driver offers",
    "home.driver": "Driver",
    "home.vehicle": "Vehicle",
    "home.plate": "Plate",
    "home.rating": "Rating",
    "home.from": "From",
    "home.to": "To",
    "home.cancelRide": "Cancel ride",
  },
};
async function main() {
  const value = vehicleAssetKeys as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: "passenger.vehicleAssetKeys" },
    create: {
      key: "passenger.vehicleAssetKeys",
      group: "passenger",
      value,
      publishedValue: value,
      isPublic: true,
      isSensitive: false,
      publicationStatus: "PUBLISHED",
      publishedVersion: 1,
      publishedAt: new Date(),
    },
    update: {
      value,
      publishedValue: value,
      isPublic: true,
      isSensitive: false,
      publicationStatus: "PUBLISHED",
      publishedVersion: { increment: 1 },
      publishedAt: new Date(),
    },
  });
  for (const [locale, additions] of Object.entries(messages)) {
    const row = await prisma.translationBundle.findUnique({
      where: { locale },
    });
    const current = (row?.messages ?? {}) as Record<string, string>;
    await prisma.translationBundle.upsert({
      where: { locale },
      create: { locale, messages: additions, isActive: true },
      update: {
        messages: { ...current, ...additions },
        isActive: true,
        version: { increment: 1 },
      },
    });
  }
}
main().finally(() => prisma.$disconnect());
