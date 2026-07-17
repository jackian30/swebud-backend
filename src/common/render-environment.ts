import { isCanonicalSweBuddRenderService } from './render-identity';

const RENDER_BROWSER_ORIGIN = 'https://swebudd.com';
const LEGACY_RENDER_LOCAL_ORIGIN = 'https://localhost';
const RENDER_NATIVE_AUTH_EMERGENCY_DISABLED = 'SWEBUDD_NATIVE_AUTH_EMERGENCY_DISABLED';

type MutableEnvironment = Record<string, string | undefined>;

export function normalizeLegacyRenderBrowserOrigins(
  env: MutableEnvironment = process.env,
) {
  const isCanonicalRenderService = isCanonicalSweBuddRenderService(env);
  const usesBrowserOriginCompatibility = env.SWEBUDD_RENDER_ORIGIN_COMPAT === 'true'
    || isCanonicalRenderService;
  if (env.NODE_ENV !== 'production' || !usesBrowserOriginCompatibility) return false;

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

  if (isCanonicalRenderService) {
    const emergencySetting = env[RENDER_NATIVE_AUTH_EMERGENCY_DISABLED]?.trim();
    if (emergencySetting && !['true', 'false'].includes(emergencySetting)) {
      throw new Error(`${RENDER_NATIVE_AUTH_EMERGENCY_DISABLED} must be "true" or "false" when set.`);
    }
    const nativeAuthEnabled = emergencySetting === 'true' ? 'false' : 'true';
    const pinnedValues = {
      ALLOW_LOCAL_ORIGINS: 'false',
      NATIVE_AUTH_ENABLED: nativeAuthEnabled,
      NATIVE_APP_ORIGIN: LEGACY_RENDER_LOCAL_ORIGIN,
    };
    for (const [key, value] of Object.entries(pinnedValues)) {
      if (env[key]?.trim() === value) continue;
      console.warn(`Correcting ${key} for the canonical SweBudd Render service.`);
      env[key] = value;
      changed = true;
    }
  }

  return changed;
}

// This module is intentionally the first import in main.ts. Render services can
// override Docker CMD, so the compatibility migration must run before AppModule
// and ConfigModule read the process environment.
normalizeLegacyRenderBrowserOrigins();
