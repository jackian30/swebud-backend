import { normalizeLegacyRenderBrowserOrigins } from './render-environment';

describe('Render environment compatibility migration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('leaves non-production environments unchanged', () => {
    const env = {
      NODE_ENV: 'development',
      FRONTEND_ORIGIN: 'https://localhost',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(false);
    expect(env.FRONTEND_ORIGIN).toBe('https://localhost');
  });

  it('leaves valid production browser origins unchanged', () => {
    const env = {
      NODE_ENV: 'production',
      RENDER: 'true',
      FRONTEND_ORIGIN: 'https://preview.swebudd.com',
      ADMIN_ORIGIN: 'https://admin.swebudd.com',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(false);
    expect(env).toEqual({
      NODE_ENV: 'production',
      RENDER: 'true',
      FRONTEND_ORIGIN: 'https://preview.swebudd.com',
      ADMIN_ORIGIN: 'https://admin.swebudd.com',
    });
  });

  it('migrates only the known legacy Render localhost browser origins in production', () => {
    jest.spyOn(console, 'warn').mockImplementation();
    const env = {
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebudd-backend',
      RENDER_SERVICE_TYPE: 'web',
      FRONTEND_ORIGIN: 'https://localhost',
      ADMIN_ORIGIN: 'https://localhost',
      NATIVE_APP_ORIGIN: 'https://localhost',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(true);
    expect(env).toEqual({
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebudd-backend',
      RENDER_SERVICE_TYPE: 'web',
      FRONTEND_ORIGIN: 'https://swebudd.com',
      ADMIN_ORIGIN: '',
      ALLOW_LOCAL_ORIGINS: 'false',
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://localhost',
    });
  });

  it('repairs native auth values missing from an existing dashboard-managed service', () => {
    jest.spyOn(console, 'warn').mockImplementation();
    const env = {
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebudd-backend',
      RENDER_SERVICE_TYPE: 'web',
      FRONTEND_ORIGIN: 'https://swebudd.com',
      ADMIN_ORIGIN: '',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(true);
    expect(env).toEqual({
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebudd-backend',
      RENDER_SERVICE_TYPE: 'web',
      FRONTEND_ORIGIN: 'https://swebudd.com',
      ADMIN_ORIGIN: '',
      ALLOW_LOCAL_ORIGINS: 'false',
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://localhost',
    });
  });

  it('overrides stale dashboard values that would break the Android release', () => {
    jest.spyOn(console, 'warn').mockImplementation();
    const env = {
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebudd-backend',
      RENDER_SERVICE_TYPE: 'web',
      FRONTEND_ORIGIN: 'https://swebudd.com',
      NATIVE_AUTH_ENABLED: 'false',
      NATIVE_APP_ORIGIN: 'capacitor://localhost',
      ALLOW_LOCAL_ORIGINS: 'true',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(true);
    expect(env).toMatchObject({
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://localhost',
      ALLOW_LOCAL_ORIGINS: 'false',
    });
  });

  it('supports a separate explicit native-auth emergency shutdown', () => {
    jest.spyOn(console, 'warn').mockImplementation();
    const env = {
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebudd-backend',
      RENDER_SERVICE_TYPE: 'web',
      FRONTEND_ORIGIN: 'https://swebudd.com',
      SWEBUDD_NATIVE_AUTH_EMERGENCY_DISABLED: 'true',
      NATIVE_AUTH_ENABLED: 'true',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(true);
    expect(env).toEqual({
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebudd-backend',
      RENDER_SERVICE_TYPE: 'web',
      FRONTEND_ORIGIN: 'https://swebudd.com',
      SWEBUDD_NATIVE_AUTH_EMERGENCY_DISABLED: 'true',
      NATIVE_AUTH_ENABLED: 'false',
      NATIVE_APP_ORIGIN: 'https://localhost',
      ALLOW_LOCAL_ORIGINS: 'false',
    });
  });

  it('rejects a malformed native-auth emergency setting', () => {
    const env = {
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebudd-backend',
      RENDER_SERVICE_TYPE: 'web',
      FRONTEND_ORIGIN: 'https://swebudd.com',
      SWEBUDD_NATIVE_AUTH_EMERGENCY_DISABLED: 'yes',
    };

    expect(() => normalizeLegacyRenderBrowserOrigins(env)).toThrow(
      'SWEBUDD_NATIVE_AUTH_EMERGENCY_DISABLED must be "true" or "false" when set.',
    );
  });

  it('repairs the production repo deploy when the dashboard service name differs', () => {
    jest.spyOn(console, 'warn').mockImplementation();
    const env = {
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebud-api-production',
      RENDER_SERVICE_TYPE: 'web',
      RENDER_GIT_REPO_SLUG: 'jackian30/swebud-backend',
      RENDER_GIT_BRANCH: 'master',
      IS_PULL_REQUEST: 'false',
      FRONTEND_ORIGIN: 'https://swebudd.com',
      NATIVE_AUTH_ENABLED: 'false',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(true);
    expect(env).toMatchObject({
      NATIVE_AUTH_ENABLED: 'true',
      NATIVE_APP_ORIGIN: 'https://localhost',
      ALLOW_LOCAL_ORIGINS: 'false',
    });
  });

  it('does not pin native auth for previews, feature branches, workers, or other repositories', () => {
    const base = {
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebud-noncanonical',
      RENDER_SERVICE_TYPE: 'web',
      RENDER_GIT_REPO_SLUG: 'jackian30/swebud-backend',
      RENDER_GIT_BRANCH: 'master',
      IS_PULL_REQUEST: 'false',
      FRONTEND_ORIGIN: 'https://preview.swebudd.com',
      NATIVE_AUTH_ENABLED: 'false',
    };
    const variants = [
      { RENDER_GIT_BRANCH: 'feature/native-auth' },
      { IS_PULL_REQUEST: 'true' },
      { IS_PULL_REQUEST: undefined },
      { RENDER_SERVICE_TYPE: 'worker' },
      { RENDER_GIT_REPO_SLUG: 'someone/other-backend' },
    ];

    for (const variant of variants) {
      const env = { ...base, ...variant };
      expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(false);
      expect(env.NATIVE_AUTH_ENABLED).toBe('false');
      expect(env).not.toHaveProperty('NATIVE_APP_ORIGIN');
    }
  });

  it('does not weaken validation for any other invalid browser origin', () => {
    const env = {
      NODE_ENV: 'production',
      SWEBUDD_RENDER_ORIGIN_COMPAT: 'true',
      FRONTEND_ORIGIN: 'http://localhost',
      ADMIN_ORIGIN: 'https://127.0.0.1',
      NATIVE_AUTH_ENABLED: 'false',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(false);
    expect(env.FRONTEND_ORIGIN).toBe('http://localhost');
    expect(env.ADMIN_ORIGIN).toBe('https://127.0.0.1');
    expect(env.NATIVE_AUTH_ENABLED).toBe('false');
    expect(env).not.toHaveProperty('NATIVE_APP_ORIGIN');
  });

  it('does not rewrite self-hosted or staging production environments', () => {
    const env = {
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: 'https://localhost',
      ADMIN_ORIGIN: 'https://localhost',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(false);
    expect(env.FRONTEND_ORIGIN).toBe('https://localhost');
    expect(env.ADMIN_ORIGIN).toBe('https://localhost');
  });

  it('does not rewrite a Render preview service that happens to use the legacy value', () => {
    const env = {
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'swebudd-preview',
      FRONTEND_ORIGIN: 'https://localhost',
      ADMIN_ORIGIN: 'https://localhost',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(false);
    expect(env.FRONTEND_ORIGIN).toBe('https://localhost');
    expect(env.ADMIN_ORIGIN).toBe('https://localhost');
  });

  it('does not trust the production service name outside Render without the explicit flag', () => {
    const env = {
      NODE_ENV: 'production',
      RENDER_SERVICE_NAME: 'swebudd-backend',
      FRONTEND_ORIGIN: 'https://localhost',
      ADMIN_ORIGIN: 'https://localhost',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(false);
    expect(env.FRONTEND_ORIGIN).toBe('https://localhost');
    expect(env.ADMIN_ORIGIN).toBe('https://localhost');
  });
});
