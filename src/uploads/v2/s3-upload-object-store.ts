import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  PublishedObject,
  StoredUploadPart,
  UploadObjectHead,
  UploadObjectStore,
} from './upload-object-store';
import { uploadPolicy } from './upload-policy';
import {
  mediaS3Prefix,
  publicMediaObjectKey,
} from '../media-library/s3-object-key';

@Injectable()
export class S3UploadObjectStore implements UploadObjectStore {
  private readonly client: S3Client;

  constructor(private readonly config: ConfigService) {
    mediaS3Prefix(this.config);
    this.client = new S3Client({
      region: this.region(),
      endpoint: this.config.get<string>('AWS_S3_ENDPOINT') || undefined,
      forcePathStyle: this.config.get<string>('AWS_S3_FORCE_PATH_STYLE') === 'true',
    });
  }

  quarantineBucket() {
    return this.required('MEDIA_QUARANTINE_S3_BUCKET');
  }

  publicBucket() {
    return this.required('MEDIA_S3_BUCKET');
  }

  async createMultipart(input: {
    bucket: string;
    key: string;
    contentType: string;
    metadata: Record<string, string>;
  }) {
    const output = await this.withRequestTimeout((abortSignal) => this.client.send(new CreateMultipartUploadCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: input.contentType,
      Metadata: input.metadata,
      ChecksumAlgorithm: 'SHA256',
    }), { abortSignal }));
    if (!output.UploadId) throw new Error('S3 did not return a multipart upload ID.');
    return { uploadId: output.UploadId };
  }

  presignPart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    checksumSha256: string;
    contentLength: number;
    expiresInSeconds: number;
  }) {
    return getSignedUrl(this.client, new UploadPartCommand({
      Bucket: input.bucket,
      Key: input.key,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
      ChecksumSHA256: input.checksumSha256,
      ContentLength: input.contentLength,
    }), { expiresIn: input.expiresInSeconds });
  }

  async listParts(input: { bucket: string; key: string; uploadId: string }) {
    const parts: StoredUploadPart[] = [];
    let marker: string | undefined;
    do {
      const output = await this.withRequestTimeout((abortSignal) => this.client.send(new ListPartsCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        PartNumberMarker: marker,
      }), { abortSignal }));
      for (const part of output.Parts ?? []) {
        if (!part.PartNumber || !part.ETag || !part.ChecksumSHA256 || part.Size == null) continue;
        parts.push({
          partNumber: part.PartNumber,
          etag: part.ETag,
          checksumSha256: part.ChecksumSHA256,
          size: part.Size,
        });
      }
      marker = output.IsTruncated ? output.NextPartNumberMarker : undefined;
    } while (marker);
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: StoredUploadPart[];
  }) {
    const abortController = new AbortController();
    const timer = setTimeout(
      () => abortController.abort(),
      uploadPolicy(this.config).multipartCompleteTimeoutMs,
    );
    timer.unref();
    let output;
    try {
      output = await this.client.send(new CompleteMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
            ChecksumSHA256: part.checksumSha256,
          })),
        },
      }), { abortSignal: abortController.signal });
    } finally {
      clearTimeout(timer);
    }
    return { etag: output.ETag, checksumSha256: output.ChecksumSHA256 };
  }

  async headQuarantine(input: {
    bucket: string;
    key: string;
  }): Promise<UploadObjectHead | null> {
    try {
      const output = await this.withRequestTimeout((abortSignal) => this.client.send(new HeadObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ChecksumMode: 'ENABLED',
      }), { abortSignal }));
      return {
        size: output.ContentLength ?? -1,
        contentType: output.ContentType,
        etag: output.ETag,
        checksumSha256: output.ChecksumSHA256,
        checksumType: output.ChecksumType,
        metadata: output.Metadata ?? {},
      };
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  async abortMultipart(input: { bucket: string; key: string; uploadId: string }) {
    try {
      await this.withRequestTimeout((abortSignal) => this.client.send(new AbortMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
      }), { abortSignal }));
      return { outcome: 'aborted' as const };
    } catch (error) {
      if (this.isNoSuchUpload(error)) return { outcome: 'not_found' as const };
      throw error;
    }
  }

  async deleteQuarantine(input: { bucket: string; key: string }) {
    await this.withRequestTimeout((abortSignal) => this.client.send(new DeleteObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    }), { abortSignal }));
  }

  async deletePublished(bucket: string, key: string) {
    await this.withRequestTimeout((abortSignal) => this.client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal },
    ));
  }

  async downloadQuarantineToFile(input: {
    bucket: string;
    key: string;
    destinationPath: string;
  }) {
    await this.withRequestTimeout(async (abortSignal) => {
      const output = await this.client.send(new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      }), { abortSignal });
      if (!output.Body) throw new Error('S3 object body was empty.');
      const body = output.Body instanceof Readable
        ? output.Body
        : Readable.fromWeb(output.Body.transformToWebStream() as never);
      await pipeline(
        body,
        createWriteStream(input.destinationPath, { flags: 'wx', mode: 0o600 }),
        { signal: abortSignal },
      );
    }, uploadPolicy(this.config).s3DownloadTimeoutMs);
  }

  async publishFromFile(input: {
    key: string;
    path: string;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<PublishedObject> {
    const bucket = this.publicBucket();
    const key = publicMediaObjectKey(this.config, input.key);
    const abortController = new AbortController();
    const timer = setTimeout(
      () => abortController.abort(),
      uploadPolicy(this.config).publishTimeoutMs,
    );
    timer.unref();
    const upload = new Upload({
      client: this.client,
      abortController,
      leavePartsOnError: false,
      params: {
        Bucket: bucket,
        Key: key,
        Body: createReadStream(input.path),
        ContentType: input.contentType,
        Metadata: input.metadata,
      },
    });
    let output;
    try {
      output = await upload.done();
    } finally {
      clearTimeout(timer);
    }
    return {
      bucket,
      key,
      url: this.publicUrl(key),
      etag: output.ETag,
    };
  }

  private publicUrl(key: string) {
    const base = this.required('MEDIA_PUBLIC_BASE_URL');
    return new URL(key, base.endsWith('/') ? base : `${base}/`).toString();
  }

  private async withRequestTimeout<T>(
    operation: (abortSignal: AbortSignal) => Promise<T>,
    timeoutMs = uploadPolicy(this.config).s3RequestTimeoutMs,
  ) {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    timer.unref();
    try {
      return await operation(abortController.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private region() {
    return this.config.get<string>('AWS_REGION') || 'us-east-1';
  }

  private required(key: string) {
    const value = this.config.get<string>(key)?.trim();
    if (!value) throw new Error(`${key} is required for uploads v2.`);
    return value;
  }

  private isNotFound(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return candidate.name === 'NotFound' || candidate.name === 'NoSuchKey' || candidate.$metadata?.httpStatusCode === 404;
  }

  private isNoSuchUpload(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
      name?: string;
      Code?: string;
      code?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      candidate.name === 'NoSuchUpload' ||
      candidate.Code === 'NoSuchUpload' ||
      candidate.code === 'NoSuchUpload' ||
      candidate.$metadata?.httpStatusCode === 404
    );
  }
}
