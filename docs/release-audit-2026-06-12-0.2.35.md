# SweBudd Backend Release Audit - 0.2.35-beta

Date: 2026-06-12
Release candidate: `0.2.35-beta`
Frontend pair: `0.2.49-beta`

## Scope

- Added ffmpeg-backed optimization for uploaded videos.
- Added ffmpeg-backed optimization for uploaded audio.
- Kept existing Sharp WebP image optimization and collection-specific resizing.
- Added runtime ffmpeg installation to production Docker and local dev compose.
- Kept original media when an optimized ffmpeg output would be larger than the upload.

## Media Optimization Logic

- Images: auto-rotated with Sharp, resized by collection, converted to WebP quality 82.
- GIFs: stored as GIF to preserve animation.
- Videos: transcode target is MP4/H.264/AAC, max 1280x1280, `crf 28`, `veryfast`, `yuv420p`, `faststart`.
- Audio: transcode target is M4A/AAC at 96kbps with `faststart`.
- Upload content is still checked by MIME kind, file size, and magic bytes before processing.

## Verification

- `npm run prisma:generate`: passed.
- `npx prisma validate`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test -- --runInBand`: 22 suites passed, 157 tests passed.
- `npm audit --audit-level=high`: passed with 0 vulnerabilities.
- Running backend container has `/usr/bin/ffmpeg`.
- Live nginx route `https://192.168.18.50:9443/api/health/ready`: passed.

## Security Audit

- Secret scan found only documented placeholders, example environment variables, test passwords, and source identifiers.
- No real keystore, private key, signing password, or production secret is tracked in this repo.

## Release Notes

- Optimizes video uploads server-side for smaller, Android/browser-friendly MP4 playback.
- Optimizes audio uploads server-side for compact M4A/AAC playback.
- Keeps current image optimization behavior unchanged.
- Adds ffmpeg to Docker runtime paths used by production and local dev deployment.

## Residual Risks

- Video transcoding is synchronous in the upload request path; very large uploads may take noticeably longer.
- No thumbnail generation is included in this release.
- Production deployment still needs the normal server rollout after tag push.
