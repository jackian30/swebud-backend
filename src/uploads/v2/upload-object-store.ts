export const UPLOAD_OBJECT_STORE = Symbol('UPLOAD_OBJECT_STORE');

export type StoredUploadPart = {
  partNumber: number;
  etag: string;
  checksumSha256: string;
  size: number;
};

export type UploadObjectHead = {
  size: number;
  contentType?: string;
  etag?: string;
  checksumSha256?: string;
  checksumType?: string;
  metadata: Record<string, string>;
};

export type PublishedObject = {
  bucket: string;
  key: string;
  url: string;
  etag?: string;
};

export type AbortMultipartResult = {
  outcome: 'aborted' | 'not_found';
};

export interface UploadObjectStore {
  quarantineBucket(): string;
  publicBucket(): string;
  createMultipart(input: {
    bucket: string;
    key: string;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<{ uploadId: string }>;
  presignPart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    checksumSha256: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<string>;
  listParts(input: { bucket: string; key: string; uploadId: string }): Promise<StoredUploadPart[]>;
  completeMultipart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: StoredUploadPart[];
  }): Promise<{ etag?: string; checksumSha256?: string }>;
  headQuarantine(input: { bucket: string; key: string }): Promise<UploadObjectHead | null>;
  abortMultipart(input: {
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<AbortMultipartResult>;
  deleteQuarantine(input: { bucket: string; key: string }): Promise<void>;
  deletePublished(bucket: string, key: string): Promise<void>;
  downloadQuarantineToFile(input: {
    bucket: string;
    key: string;
    destinationPath: string;
  }): Promise<void>;
  publishFromFile(input: {
    key: string;
    path: string;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<PublishedObject>;
}
