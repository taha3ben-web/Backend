import * as bcrypt from "bcryptjs";
import { AppException } from "../../common/api/app.exception";
import { PasswordService } from "./password.service";

function createPrismaMock() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    session: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };
  return prisma;
}

describe("PasswordService", () => {
  afterEach(() => jest.restoreAllMocks());

  it("changes the password and revokes every other session by default", async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      passwordHash: "old-hash",
      status: "ACTIVE",
    });
    jest
      .spyOn(bcrypt, "compare")
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(false as never);
    jest.spyOn(bcrypt, "hash").mockResolvedValue("new-hash" as never);
    const service = new PasswordService(prisma as never);

    await expect(
      service.changePassword("user-1", "session-current", {
        currentPassword: "OldPassword1",
        newPassword: "NewPassword2",
      }),
    ).resolves.toEqual({ ok: true, otherSessionsRevoked: true });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "new-hash" },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        revoked: false,
        OR: [
          { sessionId: null },
          { sessionId: { not: "session-current" } },
        ],
      },
      data: { revoked: true },
    });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", id: { not: "session-current" } },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "USER_PASSWORD_CHANGED" }),
      }),
    );
  });

  it("rejects an incorrect current password without writing", async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      passwordHash: "old-hash",
      status: "ACTIVE",
    });
    jest.spyOn(bcrypt, "compare").mockResolvedValue(false as never);
    const service = new PasswordService(prisma as never);

    await expect(
      service.changePassword("user-1", "session-current", {
        currentPassword: "wrong",
        newPassword: "NewPassword2",
      }),
    ).rejects.toBeInstanceOf(AppException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
