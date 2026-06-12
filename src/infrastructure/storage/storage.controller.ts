import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthenticatedUserGuard } from '../../common/auth/authenticated-user.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { ObjectStorageService } from './object-storage.service';

type UploadedFileValue =
  | {
      buffer: Buffer;
      mimetype: string;
    }
  | undefined;

const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const maxFileSize = 5 * 1024 * 1024;
const allowedScopes = new Set(['foods', 'reviews', 'invoices']);

@Controller('storage')
export class StorageController {
  constructor(private readonly objectStorageService: ObjectStorageService) {}

  @Post('admin/food-image')
  @UseGuards(AuthenticatedUserGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxFileSize } }))
  uploadFoodImage(@UploadedFile() file: UploadedFileValue) {
    return this.uploadImage(file, 'foods');
  }

  @Post('review-image')
  @UseGuards(AuthenticatedUserGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxFileSize } }))
  uploadReviewImage(@UploadedFile() file: UploadedFileValue) {
    return this.uploadImage(file, 'reviews');
  }

  @Get('objects/:scope/*path')
  async getObject(
    @Param('scope') scope: string,
    @Param('path') path: string | string[] | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const objectPath = normalizeObjectPath(path, request.path, scope);

    if (!allowedScopes.has(scope) || !isSafeObjectPath(objectPath)) {
      throw new NotFoundException('File not found.');
    }

    const object = await this.objectStorageService.get(`${scope}/${objectPath}`);

    if (!object) {
      throw new NotFoundException('File not found.');
    }

    response.setHeader('Content-Type', object.contentType);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    object.body.pipe(response);
  }

  private async uploadImage(file: UploadedFileValue, scope: 'foods' | 'reviews') {
    if (!file) {
      throw new BadRequestException('Image file is required.');
    }

    const extension = allowedTypes.get(file.mimetype);

    if (!extension) {
      throw new BadRequestException('Only JPG, PNG, and WebP images are supported.');
    }

    const fileName = `${Date.now()}-${randomUUID()}.${extension}`;
    const key = `${scope}/${dateFolder()}/${fileName}`;
    await this.objectStorageService.upload({
      key,
      body: file.buffer,
      contentType: file.mimetype,
    });

    return {
      imageUrl: `/api/uploads/objects/${key}`,
    };
  }
}

function isSafeFileName(fileName: string) {
  return /^[a-zA-Z0-9._-]+$/.test(fileName);
}

function isSafeObjectPath(path: string) {
  return path.split('/').every((segment) => segment.length > 0 && isSafeFileName(segment));
}

function normalizeObjectPath(
  path: string | string[] | undefined,
  requestPath: string,
  scope: string,
) {
  if (Array.isArray(path)) {
    return path.join('/');
  }

  if (typeof path === 'string' && path.length > 0) {
    return path;
  }

  const marker = `/storage/objects/${scope}/`;
  const markerIndex = requestPath.indexOf(marker);

  if (markerIndex === -1) {
    return '';
  }

  return decodeURIComponent(requestPath.slice(markerIndex + marker.length));
}

function dateFolder(date = new Date()) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  return `${year}/${month}`;
}
