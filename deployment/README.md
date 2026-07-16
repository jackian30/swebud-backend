# Backend deployment profiles

`docker-compose-dev.yml` is the local-development profile. It starts Postgres,
MailHog, and the watch-mode API, and publishes every port on `127.0.0.1` only.
The development image installs system packages at build time, then runs npm and
the watcher with the host UID/GID so bind-mounted build output is not root-owned.

`docker-compose.yml` is the production profile. Postgres has no host port,
MailHog is absent, and only the API is bound to host loopback for a same-host
reverse proxy. The API and migration jobs run non-root with a read-only root
filesystem, dropped capabilities, and writable storage limited to `/tmp` and
the uploads volume.

Start local development:

```bash
./deployment/deploy.sh
```

The script generates missing database/JWT secrets in the ignored
`deployment/.env`. Production mode validates every configured CORS origin as a
public HTTPS origin, requires distinct JWT secrets of at least 32 characters,
requires a strong backend Turnstile secret, and checks TLS SMTP plus a verified
sender before Compose is invoked:

```bash
SWEBUD_MODE=prod ./deployment/deploy.sh
```

Do not expose Postgres or a development mail catcher in a production override.
Terminate public TLS at a reverse proxy and forward to `127.0.0.1:BACKEND_PORT`.

Run the non-mutating Compose/defaults audit after deployment changes:

```bash
./deployment/audit.sh
```
