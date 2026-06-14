# SweBudd Backend Release Audit - 0.2.37-beta

Date: 2026-06-14
Release candidate: `0.2.37-beta`
Frontend pair: `0.2.51-beta`

## Scope

- Keeps Turnstile enforced for production web register/login when captcha is configured.
- Allows trusted localhost/native app origins to use beta auth without a web captcha widget.
- Adds Turnstile service unit coverage for production enforcement and local/native bypass behavior.
- Preserves existing beta badge, buddy invite, and local deployment hardening behavior.

## Verification

- `npm run prisma:generate`: passed.
- `npx prisma validate`: passed.
- `npx prisma migrate status`: passed, database schema is up to date with 67 migrations.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test -- --runInBand`: passed, 23 suites / 159 tests.
- `npm audit --audit-level=high`: passed, 0 vulnerabilities.

## Security Notes

- Production web origins still require a valid Turnstile token when `CLOUDFLARE_TURNSTILE_SECRET_KEY` is configured.
- Localhost, private-network, and native app origins are treated as trusted local/native contexts for beta auth only.
- No backend dependency vulnerabilities were reported at high severity or above.
