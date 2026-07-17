type RenderEnvironment = Record<string, string | undefined>;

const CANONICAL_SERVICE_NAME = 'swebudd-backend';
const CANONICAL_REPOSITORY = 'jackian30/swebud-backend';

export function isCanonicalSweBuddRenderService(env: RenderEnvironment) {
  if (env.RENDER !== 'true' || env.RENDER_SERVICE_TYPE !== 'web') return false;
  if (env.RENDER_SERVICE_NAME === CANONICAL_SERVICE_NAME) return true;
  return env.RENDER_GIT_REPO_SLUG?.toLowerCase() === CANONICAL_REPOSITORY
    && env.RENDER_GIT_BRANCH === 'master'
    && env.IS_PULL_REQUEST === 'false';
}
