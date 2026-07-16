const RENDER_BROWSER_ORIGIN = 'https://swebudd.com';
const LEGACY_RENDER_LOCAL_ORIGIN = 'https://localhost';

type MutableEnvironment = Record<string, string | undefined>;

export function normalizeLegacyRenderBrowserOrigins(
  env: MutableEnvironment = process.env,
) {
  if (env.NODE_ENV !== 'production') return false;

  let changed = false;
  if (env.FRONTEND_ORIGIN?.trim() === LEGACY_RENDER_LOCAL_ORIGIN) {
    console.warn(
      `Replacing legacy Render FRONTEND_ORIGIN=${LEGACY_RENDER_LOCAL_ORIGIN} with ${RENDER_BROWSER_ORIGIN}.`,
    );
    env.FRONTEND_ORIGIN = RENDER_BROWSER_ORIGIN;
    changed = true;
  }
  if (env.ADMIN_ORIGIN?.trim() === LEGACY_RENDER_LOCAL_ORIGIN) {
    console.warn('Clearing legacy Render ADMIN_ORIGIN because no public admin deployment exists.');
    env.ADMIN_ORIGIN = '';
    changed = true;
  }

  return changed;
}

// This module is intentionally the first import in main.ts. Render services can
// override Docker CMD, so the compatibility migration must run before AppModule
// and ConfigModule read the process environment.
normalizeLegacyRenderBrowserOrigins();
