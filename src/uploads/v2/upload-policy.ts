import { ConfigService } from '@nestjs/config';

export const S3_MIN_PART_BYTES = 5 * 1024 * 1024;
export const S3_MAX_PARTS = 10_000;
export const DEFAULT_PART_BYTES = 8 * 1024 * 1024;

function integerConfig(
  config: ConfigService,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = config.get<string | number>(key);
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function uploadPolicy(config: ConfigService) {
  const policy = {
    activeUploadsPerUser: integerConfig(config, 'MEDIA_UPLOAD_MAX_ACTIVE_PER_USER', 3, 1, 20),
    rollingQuotaBytes: integerConfig(config, 'MEDIA_UPLOAD_ROLLING_QUOTA_BYTES', 500 * 1024 * 1024, 1, 2_147_483_647),
    rollingQuotaHours: integerConfig(config, 'MEDIA_UPLOAD_ROLLING_QUOTA_HOURS', 24, 1, 168),
    partBytes: integerConfig(config, 'MEDIA_UPLOAD_PART_BYTES', DEFAULT_PART_BYTES, S3_MIN_PART_BYTES, 100 * 1024 * 1024),
    sessionTtlSeconds: integerConfig(config, 'MEDIA_UPLOAD_SESSION_TTL_SECONDS', 30 * 60, 5 * 60, 24 * 60 * 60),
    urlTtlSeconds: integerConfig(config, 'MEDIA_UPLOAD_URL_TTL_SECONDS', 5 * 60, 60, 15 * 60),
    workerConcurrency: integerConfig(config, 'MEDIA_UPLOAD_WORKER_CONCURRENCY', 2, 1, 8),
    jobMaxAttempts: integerConfig(config, 'MEDIA_UPLOAD_JOB_MAX_ATTEMPTS', 5, 1, 10),
    jobLeaseSeconds: integerConfig(config, 'MEDIA_UPLOAD_JOB_LEASE_SECONDS', 5 * 60, 30, 30 * 60),
    workerPollMs: integerConfig(config, 'MEDIA_UPLOAD_WORKER_POLL_MS', 2_000, 250, 60_000),
    legacyProcessingConcurrency: integerConfig(config, 'MEDIA_PROCESSING_CONCURRENCY', 2, 1, 8),
    legacyProcessingMaxQueue: integerConfig(config, 'MEDIA_PROCESSING_MAX_QUEUE', 16, 0, 100),
    staleTempSeconds: integerConfig(config, 'MEDIA_PROCESSING_STALE_TEMP_SECONDS', 6 * 60 * 60, 60 * 60, 7 * 24 * 60 * 60),
    staleCleanupLimit: integerConfig(config, 'MEDIA_PROCESSING_STALE_CLEANUP_LIMIT', 100, 1, 500),
    malwareScanTimeoutMs: integerConfig(config, 'MEDIA_MALWARE_SCAN_TIMEOUT_MS', 60_000, 1_000, 5 * 60_000),
    s3RequestTimeoutMs: integerConfig(
      config,
      'MEDIA_S3_REQUEST_TIMEOUT_MS',
      30_000,
      1_000,
      2 * 60_000,
    ),
    s3DownloadTimeoutMs: integerConfig(
      config,
      'MEDIA_S3_DOWNLOAD_TIMEOUT_MS',
      3 * 60_000,
      10_000,
      15 * 60_000,
    ),
    publishTimeoutMs: integerConfig(config, 'MEDIA_PUBLISH_TIMEOUT_MS', 120_000, 10_000, 15 * 60_000),
    multipartCompleteTimeoutMs: integerConfig(
      config,
      'MEDIA_MULTIPART_COMPLETE_TIMEOUT_MS',
      120_000,
      10_000,
      15 * 60_000,
    ),
    completionStaleSeconds: integerConfig(
      config,
      'MEDIA_UPLOAD_COMPLETION_STALE_SECONDS',
      5 * 60,
      60,
      60 * 60,
    ),
    quarantineCleanupTombstoneSeconds: integerConfig(
      config,
      'MEDIA_QUARANTINE_CLEANUP_TOMBSTONE_SECONDS',
      30 * 60,
      5 * 60,
      24 * 60 * 60,
    ),
    publishCleanupGraceSeconds: integerConfig(
      config,
      'MEDIA_PUBLISH_CLEANUP_GRACE_SECONDS',
      30 * 60,
      5 * 60,
      24 * 60 * 60,
    ),
    publishCleanupTombstoneSeconds: integerConfig(
      config,
      'MEDIA_PUBLISH_CLEANUP_TOMBSTONE_SECONDS',
      5 * 60,
      60,
      60 * 60,
    ),
  };
  if (
    policy.publishCleanupGraceSeconds <= policy.jobLeaseSeconds ||
    policy.publishCleanupGraceSeconds * 1000 <= policy.publishTimeoutMs
  ) {
    throw new Error(
      'MEDIA_PUBLISH_CLEANUP_GRACE_SECONDS must exceed both the worker lease and public publish timeout.',
    );
  }
  if (policy.completionStaleSeconds * 1000 <= policy.multipartCompleteTimeoutMs) {
    throw new Error(
      'MEDIA_UPLOAD_COMPLETION_STALE_SECONDS must exceed MEDIA_MULTIPART_COMPLETE_TIMEOUT_MS.',
    );
  }
  if (
    policy.quarantineCleanupTombstoneSeconds <= policy.urlTtlSeconds ||
    policy.quarantineCleanupTombstoneSeconds <= policy.completionStaleSeconds ||
    policy.quarantineCleanupTombstoneSeconds * 1000 <= policy.multipartCompleteTimeoutMs ||
    policy.quarantineCleanupTombstoneSeconds * 1000 <= policy.s3RequestTimeoutMs
  ) {
    throw new Error(
      'MEDIA_QUARANTINE_CLEANUP_TOMBSTONE_SECONDS must exceed URL, completion-stale, multipart-complete, and S3 request timeouts.',
    );
  }
  return policy;
}

export function assertUploadPolicyConfig(config: ConfigService) {
  uploadPolicy(config);
}
