import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdminApprovalStatus,
  AuthProvider,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminRegisterDto } from './dto/admin-register.dto';
import { SyncGoogleUserDto } from './dto/sync-google-user.dto';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async syncGoogleUser(input: SyncGoogleUserDto, syncSecret?: string) {
    this.assertValidSyncSecret(syncSecret);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { role: true },
    });

    if (existingUser && existingUser.role !== UserRole.CUSTOMER) {
      throw new UnauthorizedException(
        'Use the admin sign-in flow for this account.',
      );
    }

    const user = await this.prisma.user.upsert({
      where: { email: input.email },
      update: {
        name: input.name,
        imageUrl: input.imageUrl,
        provider: AuthProvider.GOOGLE,
        providerId: input.providerId,
        lastActivity: new Date(),
      },
      create: {
        email: input.email,
        name: input.name,
        imageUrl: input.imageUrl,
        provider: AuthProvider.GOOGLE,
        providerId: input.providerId,
        role: UserRole.CUSTOMER,
        adminApprovalStatus: AdminApprovalStatus.APPROVED,
        lastActivity: new Date(),
      },
      select: sessionUserSelect,
    });

    await this.prisma.cart.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    return { user };
  }

  async registerAdmin(input: AdminRegisterDto) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        role: true,
        adminApprovalStatus: true,
      },
    });

    if (existingUser) {
      if (
        existingUser.role === UserRole.ADMIN &&
        existingUser.adminApprovalStatus === AdminApprovalStatus.PENDING
      ) {
        return {
          status: AdminApprovalStatus.PENDING,
          message: 'Your admin access request is already pending approval.',
        };
      }

      throw new ConflictException('An account already exists for this email.');
    }

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        name: input.name.trim(),
        role: UserRole.ADMIN,
        provider: AuthProvider.CREDENTIALS,
        passwordHash: hashPassword(input.password),
        adminApprovalStatus: AdminApprovalStatus.PENDING,
        adminRequestedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        adminApprovalStatus: true,
        adminRequestedAt: true,
      },
    });

    await this.notifySuperAdminForApproval(user);

    return {
      status: user.adminApprovalStatus,
      message: 'Admin access request submitted for super admin approval.',
    };
  }

  async loginAdmin(input: AdminLoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      select: {
        ...sessionUserSelect,
        passwordHash: true,
        adminApprovalStatus: true,
      },
    });

    if (!user || user.role === UserRole.CUSTOMER || !user.passwordHash) {
      throw new UnauthorizedException('Invalid admin credentials.');
    }

    if (user.isSuspended) {
      throw new UnauthorizedException('This admin account is suspended.');
    }

    if (
      user.role === UserRole.ADMIN &&
      user.adminApprovalStatus !== AdminApprovalStatus.APPROVED
    ) {
      throw new UnauthorizedException(
        'Admin access is pending super admin approval.',
      );
    }

    if (!verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid admin credentials.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActivity: new Date() },
    });

    return {
      user: serializeSessionUser(user),
    };
  }

  async listPendingAdminRequests() {
    const requests = await this.prisma.user.findMany({
      where: {
        role: UserRole.ADMIN,
        adminApprovalStatus: AdminApprovalStatus.PENDING,
      },
      orderBy: { adminRequestedAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        adminRequestedAt: true,
      },
    });

    return { data: requests };
  }

  async approveAdminRequest(userId: string, approverEmail: string) {
    const request = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        adminApprovalStatus: true,
      },
    });

    if (!request || request.role !== UserRole.ADMIN) {
      throw new BadRequestException('Admin request was not found.');
    }

    if (request.adminApprovalStatus !== AdminApprovalStatus.PENDING) {
      throw new BadRequestException('Admin request is not pending approval.');
    }

    const user = await this.prisma.user.update({
      where: { id: request.id },
      data: {
        adminApprovalStatus: AdminApprovalStatus.APPROVED,
        adminApprovedAt: new Date(),
        adminApprovedByEmail: approverEmail,
      },
      select: sessionUserSelect,
    });

    return { user };
  }

  async findSessionUser(email: string | undefined, syncSecret?: string) {
    this.assertValidSyncSecret(syncSecret);

    if (!email) {
      throw new UnauthorizedException('Customer session is required.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        ...sessionUserSelect,
        adminApprovalStatus: true,
      },
    });

    if (!user || user.isSuspended) {
      throw new UnauthorizedException('Customer session is invalid.');
    }

    if (
      user.role === UserRole.ADMIN &&
      user.adminApprovalStatus !== AdminApprovalStatus.APPROVED
    ) {
      throw new UnauthorizedException('Admin session is pending approval.');
    }

    return { user: serializeSessionUser(user) };
  }

  private assertValidSyncSecret(syncSecret?: string) {
    const expectedSecret = process.env.AUTH_SYNC_SECRET;

    if (!expectedSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new InternalServerErrorException(
          'AUTH_SYNC_SECRET is not configured.',
        );
      }

      return;
    }

    if (!syncSecret || !safeEqual(syncSecret, expectedSecret)) {
      throw new UnauthorizedException('Invalid auth sync secret.');
    }
  }

  private async notifySuperAdminForApproval(user: {
    id: string;
    email: string;
    name: string | null;
    adminRequestedAt: Date | null;
  }) {
    const approvalEmail =
      process.env.ADMIN_APPROVAL_EMAIL ?? 'crumbhouse2026@gmail.com';

    // Replace this with an SMTP/provider integration once email credentials are configured.
    // For local development, the request is visible in server logs and the super-admin UI.
    console.info(
      `Admin approval requested for ${user.email}. Notify ${approvalEmail}. Request id: ${user.id}.`,
    );
  }
}

const sessionUserSelect = {
  id: true,
  email: true,
  name: true,
  imageUrl: true,
  role: true,
  isSuspended: true,
} satisfies Prisma.UserSelect;

function serializeSessionUser(user: {
  id: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  role: UserRole;
  isSuspended: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    imageUrl: user.imageUrl,
    role: user.role,
    isSuspended: user.isSuspended,
  };
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');

  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [method, salt, expectedHash] = storedHash.split('$');

  if (method !== 'scrypt' || !salt || !expectedHash) {
    return false;
  }

  const hashBuffer = Buffer.from(
    scryptSync(password, salt, 64).toString('hex'),
  );
  const expectedBuffer = Buffer.from(expectedHash);

  if (hashBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(hashBuffer, expectedBuffer);
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}
