# Media upload pipeline

SweBudd currently uses a synchronous, server-proxied upload pipeline backed by
one public media bucket. The resumable multipart quarantine pipeline is not
active in this release.

## Request flow

1. An authenticated, email-verified user sends multipart form data to an
   `/uploads/*` endpoint.
2. Multer streams the request into an unpredictable, extensionless `0600` file
   under an owner-only `0700` temporary directory. Uploads are never buffered
   entirely in process memory.
3. The API verifies the declared media kind, magic bytes, file size, and media
   structure.
4. Images are decoded and converted to WebP. Video and audio are probed and
   transcoded into controlled output formats with bounded subprocesses.
5. Only the processed output is written to `MEDIA_S3_BUCKET`.
6. Input and processed temporary files are removed in `finally` blocks.
   Bounded startup cleanup also removes abandoned storage-owned input files
   older than six hours.

Raw client bytes are never written directly to the public bucket.

## Endpoints and limits

All upload routes require `JwtAuthGuard` and `VerifiedAccountGuard`.

| Route type | Maximum |
| --- | ---: |
| Image | 15 MiB |
| Video | 100 MiB |
| Audio | 25 MiB |
| Batch | 6 files / 120 MiB total / 20 MiB each |

Multer also rejects extra fields, excessive parts, oversized field names, and
large header-pair counts. The global upload rate limit is 60 requests per
minute per IP.

Processing is bounded by:

```dotenv
MEDIA_PROCESSING_CONCURRENCY=2
MEDIA_PROCESSING_MAX_QUEUE=16
```

When the queue is full, the API returns `503` with
`UPLOAD_PROCESSING_BUSY`.

## Media validation

The processor enforces:

- an allowlist of supported image, video, and audio MIME types;
- matching magic bytes before a decoder is invoked;
- image pixel and frame limits;
- one expected video stream, at most one audio stream, and no extra streams;
- maximum dimensions, frame rate, frame count, and ten-minute duration;
- bounded FFmpeg execution with a restricted protocol allowlist;
- controlled WebP, H.264/AAC MP4, and AAC/M4A output; and
- maximum output size before publication.

This is not antivirus scanning. Keep Sharp/libvips, FFmpeg, Node, and the
runtime image patched, and do not permit anonymous writes to the public bucket.

## Storage configuration

Production requires:

```dotenv
MEDIA_STORAGE_DRIVER=s3
MEDIA_S3_BUCKET=<existing-public-bucket>
MEDIA_S3_PREFIX=
MEDIA_PUBLIC_BASE_URL=https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/
AWS_REGION=<Supabase S3 region>
AWS_S3_ENDPOINT=https://<project-ref>.storage.supabase.co/storage/v1/s3
AWS_S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=<server-only S3 access key>
AWS_SECRET_ACCESS_KEY=<server-only S3 secret>
MEDIA_PROCESSING_TEMP_DIR=/app/media-processing-tmp
```

`MEDIA_UPLOAD_TEMP_DIR` is optional. When omitted, incoming files use the
`incoming/` child of `MEDIA_PROCESSING_TEMP_DIR`.

The S3 credentials belong only on the backend. Browser clients upload through
the authenticated API and never receive storage credentials or presigned
write URLs.

## Deferred resumable-upload schema

The database migration history still contains the unused v2 upload tables.
They are intentionally left dormant because failed Render deploys may already
have applied those migrations. Dropping them is a separate destructive cleanup
that requires checking production rows first.

The synchronous path does not provide resumability, persistent per-user rolling
byte quotas, asynchronous retry/status polling, or malware scanning. Revisit a
private quarantine pipeline when traffic and operational maturity justify the
additional bucket, worker, and scanner infrastructure.
