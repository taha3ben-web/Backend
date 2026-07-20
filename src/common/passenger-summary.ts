import { PrismaService } from "../prisma/prisma.service";

export interface PublicPassengerSummary {
  id: string;
  name: string;
  avatarUrl: string | null;
  completedTrips: number;
  rating: number | null;
  ratingCount: number;
}

/** ملخص عام آمن: لا هاتف ولا بريد، واستعلامات مجمعة بدل N+1. */
export async function loadPassengerSummaries(
  prisma: PrismaService,
  passengerIds: string[],
): Promise<Map<string, PublicPassengerSummary>> {
  const ids = [...new Set(passengerIds.filter(Boolean))];
  if (!ids.length) return new Map();

  const [users, completed, ratings] = await prisma.$transaction([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, avatarUrl: true },
    }),
    prisma.trip.groupBy({
      by: ["passengerId"],
      where: { passengerId: { in: ids }, status: "COMPLETED" },
      orderBy: { passengerId: "asc" },
      _count: { _all: true },
    }),
    prisma.rating.groupBy({
      by: ["targetId"],
      where: { targetId: { in: ids } },
      orderBy: { targetId: "asc" },
      _avg: { stars: true },
      _count: { _all: true },
    }),
  ]);

  // Prisma widens groupBy aggregate types (`_count`/`_avg`) to `true | {...}`
  // when the calls are batched inside `$transaction([...])`, so we assert the
  // concrete result shapes that Prisma actually returns at runtime.
  const completedRows = completed as unknown as Array<{
    passengerId: string;
    _count: { _all: number };
  }>;
  const ratingRows = ratings as unknown as Array<{
    targetId: string;
    _avg: { stars: number | null };
    _count: { _all: number };
  }>;

  const completedById = new Map(
    completedRows.map((row) => [row.passengerId, row._count._all]),
  );
  const ratingById = new Map(ratingRows.map((row) => [row.targetId, row]));

  return new Map(
    users.map((user) => {
      const rating = ratingById.get(user.id);
      const average = rating?._avg.stars ?? null;
      return [
        user.id,
        {
          id: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl,
          completedTrips: completedById.get(user.id) ?? 0,
          rating: average == null ? null : Math.round(average * 10) / 10,
          ratingCount: rating?._count._all ?? 0,
        },
      ];
    }),
  );
}

export async function loadPassengerSummary(
  prisma: PrismaService,
  passengerId: string,
): Promise<PublicPassengerSummary | null> {
  const summaries = await loadPassengerSummaries(prisma, [passengerId]);
  return summaries.get(passengerId) ?? null;
}
