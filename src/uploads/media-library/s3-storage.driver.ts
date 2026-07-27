import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream } from 'fs';
import { StorageDriver } from './storage-driver';
import { MediaCollection, ProcessedMedia } from './types';
import { mediaS3Prefix, publicMediaObjectKey } from './s3-object-key';

@Injectable()
export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('MEDIA_S3_BUCKET') || this.config.get<string>('AWS_S3_BUCKET') || '';
    this.publicBaseUrl = this.config.get<string>('MEDIA_PUBLIC_BASE_URL') || this.config.get<string>('AWS_S3_PUBLIC_BASE_URL');
    if (!this.bucket) throw new Error('MEDIA_S3_BUCKET or AWS_S3_BUCKET is required when MEDIA_STORAGE_DRIVER=s3.');
    mediaS3Prefix(this.config);
    this.client = new S3Client({
      region: this.region(),
      endpoint: this.config.get<string>('AWS_S3_ENDPOINT') || undefined,
      forcePathStyle: this.config.get<string>('AWS_S3_FORCE_PATH_STYLE') === 'true',
    });
  }

  async put(collection: MediaCollection, media: ProcessedMedia) {
    const key = publicMediaObjectKey(
      this.config,
      `${collection.folder}/${media.filename}`,
    );
    await new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(media.path),
        ContentType: media.mimeType,
      },
    }).done();
    return { key, url: this.urlFor(key) };
  }

  private urlFor(key: string) {
    if (this.publicBaseUrl) return new URL(key, this.publicBaseUrl.endsWith('/') ? this.publicBaseUrl : `${this.publicBaseUrl}/`).toString();
    return `https://${this.bucket}.s3.${this.region()}.amazonaws.com/${key}`;
  }

  private region() {
    return this.config.get<string>('AWS_REGION') || 'us-east-1';
  }
}
