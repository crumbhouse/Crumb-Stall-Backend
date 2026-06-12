import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminApprovalStatus, UserRole } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedUser } from './authenticated-user';

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};

@Injectable()
export class AuthenticatedUserGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const syncSecret = getHeaderValue(request, 'x-auth-sync-secret');
    const customerEmail = getHeaderValue(request, 'x-customer-email');

    this.assertValidSyncSecret(syncSecret);

    if (!customerEmail) {
      throw new UnauthorizedException('Customer session is required.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: customerEmail },
      select: {
        id: true,
        email: true,
        name: true,
        imageUrl: true,
        role: true,
        adminApprovalStatus: true,
        isSuspended: true,
      },
    });

    if (!user || user.isSuspended) {
      throw new UnauthorizedException('Customer session is invalid.');
    }

    if (
      user.role === UserRole.ADMIN &&
      user.adminApprovalStatus !== AdminApprovalStatus.APPROVED
    ) {
      throw new ForbiddenException('Admin access is pending approval.');
    }

    request.user = user;

    return true;
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
}

function getHeaderValue(request: Request, key: string) {
  const value = request.headers[key];

  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}
