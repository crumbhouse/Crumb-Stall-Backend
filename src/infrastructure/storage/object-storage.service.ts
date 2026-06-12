import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { logError } from '../logging/structured-logger';

type UploadInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

type StoredObject = {
  body: NodeJS.ReadableStream;
  contentType: string;
};

type R2Config = {
  bucket: string;
  client: S3Client;
};

@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly config = getR2Config();

  isConfigured() {
    return Boolean(this.config);
  }

  async upload(input: UploadInput) {
    if (!this.config) {
      throw new Error('Cloudflare R2 is not configured.');
    }

    try {
      await this.config.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    } catch (error) {
      throw toStorageException(error, 'upload');
    }

    return input.key;
  }

  async get(key: string): Promise<StoredObject | null> {
    if (!this.config) {
      throw new Error('Cloudflare R2 is not configured.');
    }

    let object;

    try {
      object = await this.config.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      throw toStorageException(error, 'read');
    }

    if (!object.Body) {
      return null;
    }

    return {
      body: object.Body as NodeJS.ReadableStream,
      contentType: object.ContentType ?? 'application/octet-stream',
    };
  }
}

function getR2Config(): R2Config | null {
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const endpoint = getR2Endpoint();

  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) {
    return null;
  }

  return {
    bucket,
    client: new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
  };
}

function getR2Endpoint() {
  if (process.env.R2_ENDPOINT) {
    return process.env.R2_ENDPOINT.trim();
  }

  const accountId = process.env.R2_ACCOUNT_ID?.trim();

  if (!accountId) {
    return null;
  }

  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function toStorageException(error: unknown, operation: 'upload' | 'read') {
  const details = getStorageErrorDetails(error);
  logError(`Cloudflare R2 ${operation} error`, {
    storageProvider: 'cloudflare-r2',
    storageOperation: operation,
    storageErrorCode: details.code,
    storageStatusCode: details.statusCode,
  });
  const message =
    details.statusCode === 401 || details.code === 'Unauthorized'
      ? 'Cloudflare R2 rejected the configured credentials. Check R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET, and token permissions.'
      : `Cloudflare R2 ${operation} failed. ${details.code}`;

  return new BadGatewayException(message);
}

function getStorageErrorDetails(error: unknown) {
  const candidate = error as {
    Code?: string;
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };

  return {
    code: candidate.Code ?? candidate.name ?? 'Unknown storage error',
    statusCode: candidate.$metadata?.httpStatusCode,
  };
}
