import { KlipyService } from './klipy.service';

describe('KlipyService response contract', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the exact unconfigured response without phantom fields', async () => {
    const service = new KlipyService({ get: jest.fn().mockReturnValue(undefined) } as any);

    await expect(service.search()).resolves.toEqual({ configured: false, next: null, results: [] });
  });

  it('normalizes upstream string dimensions into nullable integers', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          page: 1,
          last_page: 1,
          data: [{
            id: 'gif-1',
            title: 'Run',
            width: '480.9',
            height: 'not-a-number',
            gif_url: 'https://cdn.example/run.gif',
          }],
        },
      }),
    } as any);
    const service = new KlipyService({
      get: jest.fn((key: string) => key === 'KLIPY_API_KEY' ? 'public-test-key' : undefined),
    } as any);

    const response = await service.search('run', 'gifs');

    expect(response).toEqual({
      configured: true,
      next: null,
      results: [{
        id: 'gif-1',
        title: 'Run',
        url: 'https://cdn.example/run.gif',
        previewUrl: 'https://cdn.example/run.gif',
        width: 480,
        height: null,
        source: 'klipy',
        kind: 'gifs',
      }],
    });
  });

  it('uses the default page size when a non-finite limit bypasses controller validation', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: [] }),
    } as any);
    const service = new KlipyService({
      get: jest.fn((key: string) => key === 'KLIPY_API_KEY' ? 'public-test-key' : undefined),
    } as any);

    await service.search('', 'gifs', Number.NaN);

    const url = (global.fetch as jest.Mock).mock.calls[0][0] as URL;
    expect(url.searchParams.get('per_page')).toBe('24');
  });
});
