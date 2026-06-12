import { OrderStatus } from '@prisma/client';
import { OtpService } from './otp.service';

const notifications = {
  create: jest.fn(),
};

const liveEvents = {
  emitAdminOrderUpdated: jest.fn(),
  emitCustomerOrderStatus: jest.fn(),
};

describe('OtpService', () => {
  const previousOtpSecret = process.env.OTP_SECRET;
  const previousJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    notifications.create.mockClear();
    liveEvents.emitAdminOrderUpdated.mockClear();
    liveEvents.emitCustomerOrderStatus.mockClear();
    process.env.OTP_SECRET = 'test-otp-secret';
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  afterEach(() => {
    process.env.OTP_SECRET = previousOtpSecret;
    process.env.JWT_SECRET = previousJwtSecret;
  });

  it('does not expose an OTP before an order is ready', async () => {
    const prisma = {
      orderOtp: {
        findUnique: jest.fn(),
      },
    };
    const service = new OtpService(
      prisma as never,
      liveEvents as never,
      notifications as never,
    );

    await expect(
      service.getDisplayOtpForOrder({
        id: 'order-1',
        status: OrderStatus.PLACED,
      }),
    ).resolves.toBeNull();
    expect(prisma.orderOtp.findUnique).not.toHaveBeenCalled();
  });

  it('returns a six digit OTP for ready orders without storing the raw code', async () => {
    const prisma = {
      orderOtp: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            ...create,
            attemptCount: 0,
          }),
        ),
      },
    };
    const service = new OtpService(
      prisma as never,
      liveEvents as never,
      notifications as never,
    );
    const otp = await service.getDisplayOtpForOrder({
      id: 'order-1',
      status: OrderStatus.READY_FOR_PICKUP,
    });

    expect(otp?.code).toMatch(/^\d{6}$/);
    expect(prisma.orderOtp.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          otpHash: expect.not.stringMatching(otp?.code ?? ''),
        }),
      }),
    );
  });

  it('stores OTP hashes as deterministic HMAC digests, not raw OTPs', async () => {
    const storedHashes: string[] = [];
    const prisma = {
      orderOtp: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) => {
          storedHashes.push(create.otpHash);
          return Promise.resolve({
            ...create,
            attemptCount: 0,
          });
        }),
      },
    };
    const service = new OtpService(
      prisma as never,
      liveEvents as never,
      notifications as never,
    );
    const firstOtp = await service.getDisplayOtpForOrder({
      id: 'order-1',
      status: OrderStatus.READY_FOR_PICKUP,
    });
    const secondOtp = await service.getDisplayOtpForOrder({
      id: 'order-2',
      status: OrderStatus.READY_FOR_PICKUP,
    });

    expect(storedHashes).toHaveLength(2);
    expect(storedHashes[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(storedHashes[0]).not.toBe(firstOtp?.code);
    expect(storedHashes[1]).not.toBe(secondOtp?.code);
    expect(storedHashes[0]).not.toBe(storedHashes[1]);
  });

  it('force refreshes an active OTP even when it has not expired', async () => {
    const future = new Date(Date.now() + 60_000);
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          userId: 'user-1',
          status: OrderStatus.READY_FOR_PICKUP,
        }),
      },
      orderOtp: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'otp-1',
          orderId: 'order-1',
          otpHash: 'active-hash',
          expiresAt: future,
          verifiedAt: null,
          attemptCount: 0,
        }),
        upsert: jest.fn().mockImplementation(({ update }) =>
          Promise.resolve({
            id: 'otp-1',
            ...update,
          }),
        ),
      },
    };
    const service = new OtpService(
      prisma as never,
      liveEvents as never,
      notifications as never,
    );

    const otp = await service.generateForOrderNumber('CS-1', {
      forceRefresh: true,
    });

    expect(otp?.code).toMatch(/^\d{6}$/);
    expect(prisma.orderOtp.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          verifiedAt: null,
          attemptCount: 0,
        }),
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        title: 'Pickup OTP generated',
      }),
    );
    expect(liveEvents.emitCustomerOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: 'CS-1',
        status: OrderStatus.READY_FOR_PICKUP,
        userId: 'user-1',
      }),
    );
  });

  it('verifies a valid OTP and completes the order', async () => {
    let storedOtp: Record<string, unknown> | null = null;
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          userId: 'user-1',
          status: OrderStatus.READY_FOR_PICKUP,
        }),
        update: jest.fn(),
      },
      orderOtp: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(storedOtp)),
        upsert: jest.fn().mockImplementation(({ create }) => {
          storedOtp = {
            id: 'otp-1',
            ...create,
            attemptCount: 0,
            verifiedAt: null,
          };

          return Promise.resolve(storedOtp);
        }),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const service = new OtpService(
      prisma as never,
      liveEvents as never,
      notifications as never,
    );
    const otp = await service.generateForOrderNumber('CS-1');
    const result = await service.verifyForOrderNumber('CS-1', otp?.code ?? '');

    expect(result).toMatchObject({
      verified: true,
      status: OrderStatus.COMPLETED,
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(liveEvents.emitCustomerOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: 'CS-1',
        status: OrderStatus.COMPLETED,
        userId: 'user-1',
      }),
    );
    expect(liveEvents.emitAdminOrderUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: 'CS-1',
        status: OrderStatus.COMPLETED,
      }),
    );
  });

  it('rejects an otherwise valid OTP when the OTP secret changes', async () => {
    let storedOtp: Record<string, unknown> | null = null;
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          userId: 'user-1',
          status: OrderStatus.READY_FOR_PICKUP,
        }),
      },
      orderOtp: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(storedOtp)),
        upsert: jest.fn().mockImplementation(({ create }) => {
          storedOtp = {
            id: 'otp-1',
            ...create,
            attemptCount: 0,
            verifiedAt: null,
          };

          return Promise.resolve(storedOtp);
        }),
        update: jest.fn().mockResolvedValue({ attemptCount: 1 }),
      },
    };
    const service = new OtpService(
      prisma as never,
      liveEvents as never,
      notifications as never,
    );
    const otp = await service.generateForOrderNumber('CS-1');

    process.env.OTP_SECRET = 'rotated-secret';

    await expect(
      service.verifyForOrderNumber('CS-1', otp?.code ?? ''),
    ).rejects.toThrow('Invalid OTP');
    expect(prisma.orderOtp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { attemptCount: { increment: 1 } },
      }),
    );
  });

  it('increments attempt count for invalid OTPs', async () => {
    const future = new Date(Date.now() + 60_000);
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          userId: 'user-1',
          status: OrderStatus.READY_FOR_PICKUP,
        }),
      },
      orderOtp: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'otp-1',
          orderId: 'order-1',
          otpHash: 'not-the-right-hash',
          expiresAt: future,
          verifiedAt: null,
          attemptCount: 0,
        }),
        update: jest.fn().mockResolvedValue({ attemptCount: 1 }),
      },
    };
    const service = new OtpService(
      prisma as never,
      liveEvents as never,
      notifications as never,
    );

    await expect(
      service.verifyForOrderNumber('CS-1', '123456'),
    ).rejects.toThrow('Invalid OTP');
    expect(prisma.orderOtp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { attemptCount: { increment: 1 } },
      }),
    );
  });

  it('generates a fresh OTP when verification sees an expired code', async () => {
    const past = new Date(Date.now() - 60_000);
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          userId: 'user-1',
          status: OrderStatus.READY_FOR_PICKUP,
        }),
      },
      orderOtp: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'otp-1',
          orderId: 'order-1',
          otpHash: 'expired-hash',
          expiresAt: past,
          verifiedAt: null,
          attemptCount: 0,
        }),
        upsert: jest.fn().mockImplementation(({ update }) =>
          Promise.resolve({
            id: 'otp-1',
            ...update,
            attemptCount: 0,
          }),
        ),
      },
    };
    const service = new OtpService(
      prisma as never,
      liveEvents as never,
      notifications as never,
    );

    await expect(
      service.verifyForOrderNumber('CS-1', '123456'),
    ).rejects.toThrow('new pickup OTP has been generated');
    expect(prisma.orderOtp.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          verifiedAt: null,
          attemptCount: 0,
        }),
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        title: 'Pickup OTP generated',
      }),
    );
    expect(liveEvents.emitCustomerOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: 'CS-1',
        status: OrderStatus.READY_FOR_PICKUP,
        userId: 'user-1',
      }),
    );
  });
});
