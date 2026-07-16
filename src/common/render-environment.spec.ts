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
      FRONTEND_ORIGIN: 'https://preview.swebudd.com',
      ADMIN_ORIGIN: 'https://admin.swebudd.com',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(false);
    expect(env).toEqual({
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: 'https://preview.swebudd.com',
      ADMIN_ORIGIN: 'https://admin.swebudd.com',
    });
  });

  it('migrates only the known legacy Render localhost browser origins in production', () => {
    jest.spyOn(console, 'warn').mockImplementation();
    const env = {
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: 'https://localhost',
      ADMIN_ORIGIN: 'https://localhost',
      NATIVE_APP_ORIGIN: 'https://localhost',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(true);
    expect(env).toEqual({
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: 'https://swebudd.com',
      ADMIN_ORIGIN: '',
      NATIVE_APP_ORIGIN: 'https://localhost',
    });
  });

  it('does not weaken validation for any other invalid browser origin', () => {
    const env = {
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: 'http://localhost',
      ADMIN_ORIGIN: 'https://127.0.0.1',
    };

    expect(normalizeLegacyRenderBrowserOrigins(env)).toBe(false);
    expect(env.FRONTEND_ORIGIN).toBe('http://localhost');
    expect(env.ADMIN_ORIGIN).toBe('https://127.0.0.1');
  });
});
