# Backend deployment and disaster recovery

These workflows target a Linux Docker host. `deploy.sh`, `backup.sh`,
`restore-drill.sh`, `rollback-image.sh`, and `audit.sh` require Bash; the
database-role container intentionally uses POSIX `/bin/sh`. GNU/Linux tools
(`stat`, `find`, `sha256sum`, and GNU-compatible Docker/Compose) are assumed.
Media-reference validation also requires `jq`; S3 export additionally requires
AWS CLI v2 and `base64`.

## Deployment profiles

`docker-compose-dev.yml` starts Postgres, MailHog, and the watch-mode API. Host
ports bind to loopback by default. The development image installs system
packages at build time and runs npm/the watcher with the host UID/GID.

`docker-compose.yml` is the self-hosted production profile. Postgres has no
host port, MailHog is absent, and only the API binds to host loopback for a
same-host reverse proxy. Production jobs and the API use read-only root
filesystems, dropped capabilities, bounded PID counts, and narrowly scoped
writable mounts. The ClamAV daemon has no published port and shares only a
dedicated `internal: true` Docker network with the backend.

Production Compose pins upload-v2 on, disables the legacy byte-proxy routes,
uses separate public/quarantine buckets, and streams candidate files to clamd
over that private network. `CLAMD_CONF_StreamMaxLength=128M` matches the
application's maximum accepted upload. The reviewed ClamAV image digest
contains a signature database; because the scanner network intentionally has
no egress, FreshClam is disabled. Treat updating and rescanning the immutable
ClamAV image digest as a frequent security patch operation and alert on clamd
health/signature age. Do not publish TCP 3310: clamd TCP has no transport
authentication or encryption.

The backend also mounts `swebud_media_processing_temp` at
`/app/media-processing-tmp`. This is a dedicated disk-backed transient volume
for async upload inputs and transcoded outputs. It is deliberately separate
from the memory-backed `/tmp` filesystem and from the public `swebud_uploads`
volume, so it is neither constrained by the 128 MiB scratch tmpfs nor included
in public-media backups. The image creates and owns the mountpoint as the
non-root runtime user.

Provision at least 256 MiB of free space per
`MEDIA_UPLOAD_WORKER_CONCURRENCY` slot (512 MiB at the default of two), plus
filesystem metadata headroom. Apply a host/storage quota where available and
alert before free bytes or inodes fall below one full concurrency window.
Bounded startup cleanup removes only validated stale worker paths according to
`MEDIA_PROCESSING_STALE_TEMP_SECONDS` and
`MEDIA_PROCESSING_STALE_CLEANUP_LIMIT`; it is not a substitute for disk
monitoring.

The checked-in PostgreSQL, Alpine helper, and ClamAV defaults use immutable
digests verified from their registries/local image metadata. Do not replace
them with tags in production. Re-resolve and review a new digest deliberately
when patching an image. The application image is uniquely tagged for each
deployment and its immutable Docker image ID is recorded under ignored
`deployment/.deployment-state/`.

Start development:

```bash
./deployment/deploy.sh
```

For the first production deployment, only when the Compose project has no
backend container or database volume:

```bash
SWEBUD_MODE=prod SWEBUD_INITIAL_DEPLOY=true ./deployment/deploy.sh
```

Every later production deployment must omit the initial-deploy override:

```bash
SWEBUD_MODE=prod ./deployment/deploy.sh
```

The production sequence is fail-closed:

1. Validate origins, mail TLS, all distinct secrets/roles/URLs, both media
   buckets, upload timeout invariants, pinned helper/scanner images, backup
   policy, and the alert hook before Docker changes.
2. Reconcile database roles transactionally.
3. Create a complete encrypted pre-migration database-and-media checkpoint.
4. Build one uniquely tagged backend image and record its immutable image ID.
5. Stop the old API, run Prisma migrations through the owner URL secret, then
   start the exact built image.
6. Verify health and record the Compose hash plus post-migration state.

`SWEBUD_INITIAL_DEPLOY=true` is the sole checkpoint exception, and is rejected
as soon as prior database/backend state exists.

Do not expose Postgres or a development mail catcher in a production override.
Terminate public TLS at a reverse proxy and forward to
`127.0.0.1:BACKEND_PORT`.

## Database identities and secrets

`deploy.sh` creates three application roles in addition to the migration/object
owner:

| Role | Intended use | Effective public-schema access |
| --- | --- | --- |
| runtime | Running API | table read/write and sequence use |
| admin read-only | Approved operational inspection | table read only |
| backup | `pg_dump` only | table and sequence read only |

Role reconciliation uses a transaction-scoped advisory lock. It resets role
configuration, rejects any role membership or object ownership, removes
database/schema/object access inherited through `PUBLIC`, revokes public-schema
routine execution, converges current/default ACLs, and audits the exact result
before commit. The read-only and backup roles default every transaction to
read-only. All three roles are `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`,
`NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`.

The migration owner must own the database and all Prisma-managed public-schema
objects and must be allowed to create/alter roles. Managed providers that do not
grant those capabilities need provider-native role provisioning; the supplied
workflow will fail rather than silently weaken its guarantees.

Production `db-roles` and `migrate` jobs receive the owner URL and role
passwords from ignored mode-0600 files under `deployment/.secrets/`. Secret
values do not appear in their Docker argv or persistent Compose environment,
and `docker compose run --rm` removes each job. The long-running backend still
receives its runtime database/JWT/SMTP/provider secrets through environment
variables because the application does not currently implement `*_FILE`
loading.

`ADMIN_JWT_SECRET` is generated as a third strong JWT secret and must differ
from both user-token secrets. `ADMIN_JWT_ISSUER` and `ADMIN_JWT_AUDIENCE` are
validated URI-safe identifiers and must differ. Use the same values in the
trusted admin token issuer; do not share the secret with browser code.

The ignored `.env` must remain mode 0600. Never commit `.env`, `.secrets/`,
`.deployment-state/`, an age identity, or a backup set.

## Encrypted backups

Required production configuration includes:

```dotenv
DATABASE_BACKUP_URL=postgresql://swebud_backup:...@postgres:5432/swebud?schema=public
BACKUP_OUTPUT_DIR=/var/backups/swebudd
BACKUP_AGE_RECIPIENT=age1...
BACKUP_SIGNING_PRIVATE_KEY_FILE=/absolute/private/path/backup-signing-private.pem
BACKUP_S3_URI=s3://approved-offsite-bucket/swebudd
BACKUP_OFFSITE_RETENTION_CONFIRMED=true
BACKUP_RETENTION_DAYS=30
BACKUP_RPO_HOURS=24
BACKUP_RTO_HOURS=4
FAILURE_ALERT_HOOK=/opt/swebudd/bin/alert-failure
```

Run a manual backup:

```bash
SWEBUD_MODE=prod BACKUP_PURPOSE=manual ./deployment/backup.sh
```

The output root must be absolute, owned by the invoking account, non-symlinked,
and mode 0700. A backup is built in a unique hidden `.partial` directory,
cleaned on failure, then atomically renamed. The script:

- quiesces a running backend and guarantees a readiness-checked restart;
- dumps through `DATABASE_BACKUP_URL`, never `DIRECT_URL`;
- captures exact migration/user/post/group counts and database identity;
- archives either the local uploads volume or an actual S3 media export;
- records the exact media file count and content/path inventory hash;
- for S3, independently exports the public and private quarantine buckets and
  records one canonical inventory/metadata sidecar for each;
- snapshots quiesced upload-v2 database references and proves every durable
  quarantine/public key is present in the matching exported inventory;
- age-encrypts the database, media, and manifest;
- binds ciphertext hashes, identity, counts, inventory, helper images, RPO,
  RTO, purpose, and retention in that encrypted manifest;
- signs `COMPLETE` with an owner-only Ed25519 private key, thereby binding the
  creator identity to the encrypted manifest hash;
- uploads the encrypted artifacts and detached `COMPLETE.sig` first and
  `COMPLETE` last;
- byte-verifies both remote marker and detached signature; and
- prunes only complete, recognized local sets older than
  `BACKUP_RETENTION_DAYS`.

Production requires offsite upload unless
`BACKUP_ALLOW_LOCAL_ONLY=true` is explicitly accepted. That override should be
used only for a documented emergency because one-host storage is not disaster
recovery. `BACKUP_OFFSITE_RETENTION_CONFIRMED=true` is an operational assertion:
configure and independently verify bucket lifecycle/object-lock/immutability
before setting it. The script enforces local retention but cannot create a
provider-independent immutable bucket policy.

For `MEDIA_STORAGE_DRIVER=s3`, credentials must permit list, get, head, and
get-object-tagging operations for both `MEDIA_S3_BUCKET`/`MEDIA_S3_PREFIX` and
the entire dedicated `MEDIA_QUARANTINE_S3_BUCKET`. The two buckets must differ.
A nonempty public prefix must end in `/`; this makes prefix boundaries
unambiguous. Application publishing prepends this exact prefix and persists the
resulting full key, so backup, cleanup, and delivery cannot silently disagree.
A text notice is never accepted as media backup. Current object bytes and
replayable metadata from both stores are exported into the encrypted backup
set, so restore does not depend on either live media bucket.

The S3 archive uses this fixed layout:

```text
media-database-references.json
stores/public/objects/
stores/public/s3-object-metadata.json
stores/quarantine/objects/
stores/quarantine/s3-object-metadata.json
```

Each sidecar preserves its bucket/prefix, every key and directory marker,
`Content-Type`, `Cache-Control`, `Content-Disposition`, `Content-Encoding`,
`Content-Language`, `Expires`, website redirect location, user metadata, and
tags. Public and quarantine counts, byte/path inventory hashes, sidecar hashes,
and the database-reference snapshot hash are separately authenticated in the
manifest. A production rebuild must iterate each sidecar's already sorted
`objects` array, upload the matching `objects/<relativePath>` bytes (or an empty
body for a directory marker) with those exact headers and user metadata, then
apply the exact tag set. Verify both source locations, both inventories,
sidecars, object counts, and database references before the first destination
write. Destination-controlled values such as `VersionId`, `LastModified`, ETag,
storage class, checksums, and server-side encryption are regenerated by the
destination bucket policy and are deliberately not claimed to be portable
metadata.

Upload-v2 persists the bucket and key used by every session, asset, and publish
attempt. While the backend is quiesced, backup fails closed if a durable
database reference is absent from the exported objects, if a public key falls
outside the configured `MEDIA_S3_PREFIX`, or if any referenced bucket differs
from the configured public/quarantine bucket. Drain or explicitly migrate all
affected sessions, assets, and publish attempts before rotating a bucket or
prefix; never change only the environment variables.

Creating/uploading multipart parts are not visible to S3 `ListObjectsV2` and
are intentionally not copied into the backup archive. Their database rows and
counts are authenticated, and their persisted quarantine bucket must still
match the current configuration. Treat them as retry/cancel/cleanup state after
recovery and re-initiate uploads whose provider-side multipart state is no
longer available. In contrast, completing, queued, and processing source
objects—and ready/staged public objects—must be list-visible and present in the
authenticated inventories or backup fails.

Schedule `backup.sh` with a service manager or cron at a frequency stricter
than `BACKUP_RPO_HOURS`. The scheduler must treat a nonzero exit as failure.
The configured alert hook is also called automatically.

### Failure alert hook

`FAILURE_ALERT_HOOK` must be an absolute executable regular file, not a
symlink. It receives no secret arguments. Instead, the scripts set a small set
of `SWEBUDD_ALERT_*` environment variables, including the event, project,
exit code, and backup/image identifier where relevant. The hook must deliver
to the approved pager/monitoring service and return nonzero if delivery fails.
Test that external delivery separately before production use.

## Restore drill

Copy one complete backup set from offsite storage into a private mode-0700
directory. Then run:

```bash
SWEBUD_MODE=prod \
BACKUP_AGE_IDENTITY_FILE=/absolute/private/path/backup-identity.txt \
BACKUP_SIGNING_PUBLIC_KEY_FILE=/absolute/pinned/path/backup-signing-public.pem \
./deployment/restore-drill.sh /absolute/private/path/to/backup-set
```

The identity must be an absolute, owner-only, non-symlink regular file. The
drill accepts exactly five files: `COMPLETE`, `COMPLETE.sig`, `manifest.age`,
`database.dump.age`, and `media.tar.gz.age`. Before any decryption, it verifies
the detached signature with the pinned Ed25519 public key. It then verifies the
marker and encrypted-manifest hash, exact manifest key allowlist, artifact
hashes, expected project/database identity, RPO, RTO, helper-image digests,
database counts, media inventory, and—for S3—both metadata sidecars' hashes,
counts, strict schemas, source locations, exact content paths, and all
authenticated database bucket/key references.

The age recipient is public and therefore does not authenticate the backup
creator. Keep the signing private key only on the backup host and distribute
only its reviewed public key to restore/drill hosts. Generate a key pair with:

```bash
umask 077
openssl genpkey -algorithm ED25519 -out /absolute/private/path/backup-signing-private.pem
openssl pkey -in /absolute/private/path/backup-signing-private.pem \
  -pubout -out /absolute/pinned/path/backup-signing-public.pem
chmod 0600 /absolute/private/path/backup-signing-private.pem
chmod 0644 /absolute/pinned/path/backup-signing-public.pem
```

Pin and review the public-key fingerprint out of band. Rotate keys only with an
explicit overlap plan for retained backups. The drill also never executes a
helper image selected by backup data: only the operator-configured immutable
`POSTGRES_HELPER_IMAGE` and `MEDIA_HELPER_IMAGE` digests may execute, and the
signed manifest must match those pins exactly.

The database decryption stream feeds `pg_restore` directly; no plaintext dump
is ever stored on the host or copied into a container. Database and media use
separate 128-bit-random, preflighted, labelled volumes. Restore containers have
no network. Media paths/types are validated before extraction, and extraction
occurs in a read-only container whose only writable mount is the unique drill
volume. Archived uid/gid ownership is deliberately ignored, so extraction does
not need `CHOWN` and cannot recreate attacker-selected host ownership. Cleanup
removes only resources created by that run and only after their labels match.

The drill never connects to or modifies production state. Run it on a schedule
and retain its successful duration as RTO evidence.

## Explicit image rollback

The deploy stores `current.env` and `previous.env` under
`deployment/.deployment-state/`. A rollback is deliberately two-factor: supply
the exact recorded previous image ID and acknowledge that all already-applied
migrations are backward compatible.

```bash
SWEBUD_MODE=prod \
ROLLBACK_SCHEMA_COMPATIBILITY_ACK=I_HAVE_VERIFIED_BACKWARD_COMPATIBILITY \
./deployment/rollback-image.sh sha256:<full-previous-image-id>
```

The script verifies state, local image identity, current running image, and the
new container's readiness. If the previous image fails readiness it attempts to
restore the pre-rollback image and emits an alert. It never runs reverse SQL,
Prisma rollback, or any database downgrade. Keep deployed image IDs available
in an immutable registry or protected local cache; rollback fails closed if the
recorded image is unavailable.

## Audit

Run the non-mutating deployment audit after any change:

```bash
./deployment/audit.sh
```

The audit renders both Compose profiles with synthetic secret files, checks
role/backup/restore/rollback invariants, verifies script syntax and modes, and
runs existing non-mutating migration/startup tests. It also extracts a synthetic
non-root-owned media entry into its temporary directory with all container
capabilities removed. It does not provision roles, create backups, restore a
backup set, deploy, or roll back.

## Remaining production operational gates

Code cannot supply or exercise external custody/infrastructure. Before launch,
an operator must:

- provision the age recipient and separately protected restore identity;
- provision an Ed25519 backup-signing private key and pin its public key
  independently on restore/drill hosts;
- provide dedicated runtime/read-only/backup/owner credentials accepted by the
  production PostgreSQL provider;
- configure offsite credentials, encryption, lifecycle/object lock, and test a
  remote download;
- grant S3 media-export access when S3 media is enabled;
- configure public-bucket CORS for the exact multipart client origins, block
  all public access to the quarantine bucket, and abort incomplete multipart
  uploads with a reviewed lifecycle policy;
- monitor free bytes/inodes on the processing volume and clamd health/signature
  age, and deliberately refresh the pinned ClamAV digest;
- install and test the external alert-delivery hook end to end;
- schedule backups and restore drills and capture RPO/RTO evidence;
- retain immutable backend images for the rollback window; and
- on Render, provision a separately managed private-network ClamAV service
  with `StreamMaxLength` at least 128 MiB and enough memory, then set
  `MEDIA_CLAMD_TCP_HOST`; the free web-service blueprint has no sidecar and is
  not production-ready without that service; and
- configure equivalent dashboard-managed secrets on Render (no live Render
  changes are made by these scripts).
