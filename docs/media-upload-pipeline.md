# Secure media upload pipeline

## Overview

New clients use authenticated `/uploads/v2` multipart uploads. File bytes travel
directly from the client to a private quarantine bucket; API responses never
contain storage credentials. An upload remains private until a leased worker
downloads it to an owner-only disk file, scans and validates it, transcodes it
to a controlled format, publishes the safe output, and deletes the quarantine
object.

The old multipart proxy routes are retained only for local compatibility.
They use disk-backed quarantine files, never Multer memory storage. Production
configuration rejects `MEDIA_LEGACY_PROXY_UPLOADS_ENABLED=true`.

## Client flow

All endpoints require a bearer token and a verified account.

1. `POST /uploads/v2/sessions`

   Send `collection`, `mimeType`, `size`, optional whole-object base64 SHA-256,
   and an optional 8–128 character `idempotencyKey`. Reusing the same key with
   the same declaration replays the existing session; a different declaration
   returns `409`.

2. Split the file using the returned `partSize` (8 MiB by default). Compute a
   base64 SHA-256 for each part before requesting its URL.

3. `POST /uploads/v2/sessions/{id}/parts`

   Send one consecutive range of `{partNumber, checksumSha256}` records. The
   response contains short-lived `PUT` URLs and the exact required
   `x-amz-checksum-sha256` and signed `content-length` values. At most 20 URLs
   are minted per request. Requests may be repeated for resume.

4. `PUT` each part directly to its URL. Send the checksum header and a body of
   exactly the returned byte length. Browsers add `Content-Length`
   automatically and JavaScript must not try to set that forbidden header
   manually. Preserve the response `ETag` exactly and the part checksum. The
   browser must be able to read these headers via bucket CORS.

5. `GET /uploads/v2/sessions/{id}/parts`

   Use this to resume from authoritative storage state. It returns uploaded
   bytes, ETags, checksums, and missing part numbers.

6. `POST /uploads/v2/sessions/{id}/complete`

   Send every part exactly once, consecutively from part number 1:
   `{partNumber, etag, checksumSha256}`. Completion is idempotent. The API
   verifies the storage part list, exact per-part byte bounds, completed object
   size, MIME, private metadata, and checksum presence using `HeadObject`.

7. `GET /uploads/v2/sessions/{id}`

   Poll until `ready`, `rejected`, `failed`, `cancelled`, or `expired`.
   `ready` includes the safe public asset URL. `error` is either `null` or
   `{code, message, retryable}`.

8. `DELETE /uploads/v2/sessions/{id}`

   Cancels an owned non-ready upload. Cancellation claims database state before
   aborting/deleting storage, so it cannot race a worker into publishing an
   asset. Repeated cancellation is idempotent.

The session URL TTL applies only while creating/uploading. Once a fenced
completion starts, it is reconciled from `HeadObject`/`ListParts` and is never
expired underneath an in-flight `CompleteMultipartUpload`. `queued` and
`processing` sessions likewise do not expire because their signing TTL elapsed.

## Multipart and checksum rules

- Non-final S3 multipart parts are exactly `MEDIA_UPLOAD_PART_BYTES` and at
  least 5 MiB. The final part has the exact declared remainder.
- Completion part numbers are unique and consecutive beginning with 1. This is
  required when S3 additional checksums are used.
- Part ETags and base64 SHA-256 checksums are recorded in
  `media_upload_parts`.
- An ETag is opaque and is **not** treated as a full-object MD5.
- S3 SHA-256 for multipart objects is commonly a composite checksum. The API
  records it and verifies its presence/type, but does not misrepresent it as a
  linear whole-file SHA-256.
- When the client declares a whole-file SHA-256, the worker computes SHA-256
  while streaming the quarantine file and compares it before decoding.
- Every initiated multipart upload is completed or aborted by explicit
  completion, cancellation, expiry maintenance, or the bucket lifecycle rule.
- Each session persists its quarantine bucket, and every later S3 operation
  uses that persisted value. Bucket rotation therefore does not redirect
  in-flight sessions or strand their cleanup in the previous bucket.
- Cleanup is marked complete only after S3 confirms abort (or a classified
  `NoSuchUpload`) and a subsequent Head/delete check handles a concurrent
  completion. A transient abort error remains pending even when HeadObject is
  absent, because incomplete multipart uploads are not visible to HeadObject.

## Deterministic states and errors

Session states are:

`creating → uploading → completing → queued → processing → ready`

Terminal alternatives are `rejected`, `failed`, `cancelled`, and `expired`.
Validation/malware failures are non-retryable and become `rejected`. Temporary
scanner/storage/processor failures use exponential backoff and become `failed`
after the configured maximum attempts. A processing job records its lease,
attempt count, next availability, and terminal error.

Each `completing` transition carries a unique database fencing token. Verified
part records are persisted before `CompleteMultipartUpload`. Pre-completion
errors conditionally restore `uploading`; ambiguous post-completion errors stay
`completing` with a reconciliation marker. A retry or status poll uses
HeadObject to finalize the already-completed object, or restores the multipart
upload only when ListParts proves it still exists. Old recovery callers cannot
reset a newer completion claim.

Uploads v2 errors always use:

```json
{
  "code": "UPLOAD_INVALID_PARTS",
  "message": "Completion must include every declared part exactly once.",
  "retryable": false
}
```

Notable codes include `UPLOAD_NOT_FOUND`, `UPLOAD_EXPIRED`,
`UPLOAD_QUOTA_EXCEEDED`, `UPLOAD_CONCURRENCY_EXCEEDED`,
`UPLOAD_INVALID_DECLARATION`, `UPLOAD_INVALID_PARTS`,
`UPLOAD_INTEGRITY_FAILED`, `UPLOAD_STORAGE_UNAVAILABLE`,
`MALWARE_DETECTED`, `MALWARE_SCANNER_UNAVAILABLE`,
`ARCHIVE_OR_POLYGLOT_REJECTED`, `FULL_OBJECT_CHECKSUM_MISMATCH`,
and `WORKER_RETRIES_EXHAUSTED`.

## Worker safety

- Jobs are claimed with `FOR UPDATE SKIP LOCKED`, bounded by local worker
  concurrency, attempt limit, availability, and an atomic lease.
- Long scans/transcodes renew their leases. Ownership and non-cancelled
  `processing` state are fenced immediately before public publish and during
  finalization.
- Every lease attempt gets a unique public key. The key is recorded in
  `media_publish_attempts` and staged in the asset row before publish. The
  winning finalization transaction marks exactly one attempt as `winner`; a
  stale/overlapping worker can delete only its own key and therefore cannot
  delete the winner. Maintenance retries tracked `staged`, `published`, and
  `cleanup_pending` orphan deletion after crashes.
- Public PUTs are abortable and time-bounded. A failed or ambiguous PUT is
  retained as `cleanup_pending`; maintenance waits beyond both the lease and
  PUT timeout, deletes, retains a tombstone, and deletes a second time before
  marking it clean. Cleanup atomically claims `published` attempts so it cannot
  delete an attempt that concurrently became the winner.
- Retry/dead-letter mutations occur only when the same worker still owns the
  lease. Expired leases at maximum attempts are dead-lettered rather than
  reclaimed forever. Bounded terminal maintenance continues quarantine cleanup
  for `failed` and `rejected` sessions when the immediate delete failed.
- Downloads use unpredictable `worker-*` directories and mode `0700`; input
  and output files use mode `0600`. The configured base path must be a real,
  non-symlink directory owned by the application user.
- Startup/maintenance removes at most
  `MEDIA_PROCESSING_STALE_CLEANUP_LIMIT` owner-matching, non-symlink
  `worker-*` directories or server-generated output files older than
  `MEDIA_PROCESSING_STALE_TEMP_SECONDS`. Other names are never removed.
- ClamAV scanning happens before decoders. Production fails closed if the
  scanner is unavailable or times out.
- Direct clamd TCP uses the length-framed `zINSTREAM\0` protocol: a 4-byte
  network-order length before every chunk and a zero-length terminator.
  clamd TCP is unencrypted and unauthenticated; it is permitted only with
  `MEDIA_CLAMD_TRUSTED_NETWORK=true` on a trusted private network. Never expose
  port 3310 publicly.
- `clamdscan --stream --no-summary -` is the preferred local-sidecar mode; the
  explicit `-` makes stdin the scan target.
- clamd `StreamMaxLength` must exceed the application maximum upload size of
  100 MiB; configure at least 128 MiB so valid maximum-size uploads do not fail
  closed at the scanner boundary.
- Magic bytes must match the declared MIME. Archives, documents, executables,
  unsupported streams, and detectable image/archive polyglots are rejected.
- Sharp/libvips concurrency is fixed at 2. Images are bounded by pixels,
  dimensions, and frame/page count, decoded fail-closed, and emitted as WebP.
- ffprobe requires finite duration and valid nonzero frame-rate/sample-rate/
  channel metadata. Video allows exactly one video and at most one audio
  stream; audio allows exactly one audio stream and no cover-video/data/
  attachment stream. Dimensions, duration, frames, rate, sample rate, and
  channels are bounded.
- ffmpeg/ffprobe allow only local `file,pipe` protocols. Encoder threads and
  filter threads are explicitly capped. Video is emitted as H.264/AAC MP4 and
  audio as AAC M4A. ffmpeg receives an output byte cap and every image/audio/
  video output is stat-checked against the collection limit before publish.
  Oversized partial outputs are deleted. No whole-video `Buffer` is created.
- Returned dimensions come from the resized/transcoded output.

## Required production storage policy

`MEDIA_QUARANTINE_S3_BUCKET` must be separate from `MEDIA_S3_BUCKET`. Enforce
bucket-owner-only access and block all public access on quarantine storage.
Only the API/worker identity may create/list/complete/abort/read/delete under
`quarantine/v2/`. The browser receives permission only through individual
short-lived signed `UploadPart` URLs.

Configure a quarantine lifecycle rule equivalent to:

```json
{
  "ID": "expire-abandoned-media-quarantine",
  "Status": "Enabled",
  "Filter": { "Prefix": "quarantine/v2/" },
  "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 },
  "Expiration": { "Days": 2 }
}
```

The lifecycle rule is a backstop, not a replacement for application abort and
delete maintenance.

Browser CORS on the quarantine bucket must allow only deployed application
origins, `PUT`, and these request headers (or a provider-equivalent explicit
set):

```json
{
  "AllowedMethods": ["PUT"],
  "AllowedHeaders": [
    "content-type",
    "x-amz-checksum-sha256",
    "x-amz-content-sha256",
    "x-amz-date",
    "x-amz-security-token"
  ],
  "ExposeHeaders": [
    "ETag",
    "x-amz-checksum-sha256",
    "x-amz-checksum-type",
    "x-amz-request-id"
  ],
  "MaxAgeSeconds": 300
}
```

Do not use `AllowedOrigins: ["*"]`. The public media bucket/CDN must serve
generated outputs, not quarantine keys.

## Disk capacity and mounts

Production must mount `MEDIA_PROCESSING_TEMP_DIR` on a dedicated disk-backed
volume. Do not place it on the 128 MiB `/tmp` tmpfs, the public `uploads`
volume, or a volume included in public-media backups. The container image must
create and chown the mountpoint for the non-root runtime user before startup.

Capacity must cover, at minimum:

`worker concurrency × (maximum input + maximum output + decoder/transcoder overhead)`

With 100 MiB inputs and concurrency 2, provision substantially more than
400 MiB and alert on free space/inodes. Stale cleanup is deliberately
conservative and bounded; it is not a substitute for disk monitoring.

## Environment variables

Required in production:

- `MEDIA_STORAGE_DRIVER=s3`
- `AWS_REGION`
- `MEDIA_S3_BUCKET`
- `MEDIA_S3_PREFIX` (optional; relative and ending in `/` when nonempty)
- `MEDIA_PUBLIC_BASE_URL` (HTTPS CDN/media base)
- `MEDIA_QUARANTINE_S3_BUCKET` (different from the public media bucket)
- `MEDIA_PROCESSING_TEMP_DIR` (absolute dedicated disk-backed mount)
- `MEDIA_UPLOAD_WORKER_ENABLED=true`
- `MEDIA_LEGACY_PROXY_UPLOADS_ENABLED=false`
- `MEDIA_MALWARE_SCANNER=clamdscan` or `clamd-tcp`
- Credentials through the provider workload identity/default AWS credential
  chain, or secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`;
  `AWS_SESSION_TOKEN` when temporary credentials are used.

S3-compatible provider options:

- `AWS_S3_ENDPOINT` (HTTPS)
- `AWS_S3_FORCE_PATH_STYLE=true|false`

Public object keys include `MEDIA_S3_PREFIX`; the persisted asset key, cleanup,
backup inventory, and public URL therefore all identify the same object. Treat
the prefix as storage identity: drain or explicitly migrate persisted assets
before changing it.

The application intentionally does not send an
`x-amz-server-side-encryption` request header. Some supported S3-compatible
providers reject that AWS-specific header, while AWS S3 encrypts new objects by
default. Enforce reviewed encryption at rest with the provider or bucket
policy; do not rely on a per-request header.

Upload/session controls and defaults:

- `MEDIA_UPLOAD_MAX_ACTIVE_PER_USER=3` (1–20)
- `MEDIA_UPLOAD_ROLLING_QUOTA_BYTES=524288000` (1–2147483647)
- `MEDIA_UPLOAD_ROLLING_QUOTA_HOURS=24` (1–168)
- `MEDIA_UPLOAD_PART_BYTES=8388608` (5242880–104857600)
- `MEDIA_UPLOAD_SESSION_TTL_SECONDS=1800` (300–86400)
- `MEDIA_UPLOAD_URL_TTL_SECONDS=300` (60–900)
- `MEDIA_UPLOAD_WORKER_CONCURRENCY=2` (1–8)
- `MEDIA_UPLOAD_JOB_MAX_ATTEMPTS=5` (1–10)
- `MEDIA_UPLOAD_JOB_LEASE_SECONDS=300` (30–1800)
- `MEDIA_UPLOAD_WORKER_POLL_MS=2000` (250–60000)
- `MEDIA_S3_REQUEST_TIMEOUT_MS=30000` (1000–120000; create/list/head/abort/delete)
- `MEDIA_S3_DOWNLOAD_TIMEOUT_MS=180000` (10000–900000; includes response body)
- `MEDIA_MULTIPART_COMPLETE_TIMEOUT_MS=120000` (10000–900000)
- `MEDIA_UPLOAD_COMPLETION_STALE_SECONDS=300` (60–3600; must exceed multipart
  completion timeout)
- `MEDIA_QUARANTINE_CLEANUP_TOMBSTONE_SECONDS=1800` (300–86400; must exceed URL
  TTL, completion-stale, multipart-complete, and general S3 request timeouts)
- `MEDIA_PUBLISH_TIMEOUT_MS=120000` (10000–900000)
- `MEDIA_PUBLISH_CLEANUP_GRACE_SECONDS=1800` (300–86400; must exceed both worker
  lease and publish timeout)
- `MEDIA_PUBLISH_CLEANUP_TOMBSTONE_SECONDS=300` (60–3600)

Temp and legacy proxy controls:

- `MEDIA_PROCESSING_CONCURRENCY=2` (1–8)
- `MEDIA_PROCESSING_MAX_QUEUE=16` (0–100; excess receives fail-fast `503`)
- `MEDIA_PROCESSING_STALE_TEMP_SECONDS=21600` (3600–604800)
- `MEDIA_PROCESSING_STALE_CLEANUP_LIMIT=100` (1–500)
- `MEDIA_LEGACY_QUARANTINE_DIR` (local-only real owner-controlled directory)

ClamAV controls:

- `MEDIA_MALWARE_SCAN_TIMEOUT_MS=60000` (1000–300000)
- `MEDIA_CLAMDSCAN_PATH=clamdscan`
- With `clamd-tcp`: `MEDIA_CLAMD_TCP_HOST`,
  `MEDIA_CLAMD_TCP_PORT=3310`, and
  `MEDIA_CLAMD_TRUSTED_NETWORK=true`

All cloud credentials are server-side secrets. They must never appear in API
responses, browser bundles, logs, or generated OpenAPI examples.
