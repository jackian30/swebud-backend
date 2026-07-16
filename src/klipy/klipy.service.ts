import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type KlipyType = 'gifs' | 'stickers';

@Injectable()
export class KlipyService {
  constructor(private config: ConfigService) {}

  async search(q = '', type: KlipyType = 'gifs', limit = 24) {
    const key = this.config.get<string>('KLIPY_API_KEY')?.trim();
    if (!key) return { results: [], next: null, configured: false };

    const kind = type === 'stickers' ? 'stickers' : 'gifs';
    const endpoint = q.trim() ? 'search' : 'trending';
    const safeLimit = Number.isFinite(limit) ? Math.trunc(limit) : 24;
    const url = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/${kind}/${endpoint}`);
    url.searchParams.set('page', '1');
    url.searchParams.set('per_page', String(Math.min(Math.max(safeLimit, 1), 50)));
    url.searchParams.set('customer_id', this.config.get<string>('KLIPY_CLIENT_KEY') || 'swebud');
    url.searchParams.set('locale', 'en');
    url.searchParams.set('content_filter', 'medium');
    url.searchParams.set('format_filter', 'gif');
    if (q.trim()) url.searchParams.set('q', q.trim());

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!response?.ok) return { results: [], next: null, configured: true };
    const body = await response.json() as any;
    const items = Array.isArray(body?.data?.data) ? body.data.data : Array.isArray(body?.data) ? body.data : Array.isArray(body?.results) ? body.results : [];
    const page = body?.data?.page ?? body?.page;
    const lastPage = body?.data?.last_page ?? body?.last_page;

    return {
      configured: true,
      next: page && lastPage && page < lastPage ? String(page + 1) : null,
      results: items.map((item: any) => this.toMedia(item, kind)).filter((item: any) => item.url),
    };
  }

  private toMedia(item: any, kind: KlipyType) {
    const file = item?.file ?? item?.files ?? {};
    const original = this.pickFormat(file, ['md', 'hd', 'sm', 'xs']);
    const preview = this.pickFormat(file, ['sm', 'xs', 'md', 'hd']);
    const url = original?.gif?.url ?? original?.webp?.url ?? item?.gif ?? item?.gif_url ?? item?.url_gif ?? item?.media?.gif?.url ?? item?.images?.fixed_height?.url ?? item?.images?.original?.url;
    const previewUrl = preview?.webp?.url ?? preview?.gif?.url ?? preview?.jpg?.url ?? item?.preview ?? item?.thumbnail ?? item?.media?.tinygif?.url ?? url;
    const width = this.dimension(original?.gif?.width ?? original?.webp?.width ?? item?.width ?? item?.w ?? item?.dimensions?.width ?? item?.media?.gif?.dims?.[0]);
    const height = this.dimension(original?.gif?.height ?? original?.webp?.height ?? item?.height ?? item?.h ?? item?.dimensions?.height ?? item?.media?.gif?.dims?.[1]);
    return {
      id: String(item?.id ?? item?.slug ?? url ?? Math.random()),
      title: item?.title || item?.name || item?.content_description || 'KLIPY GIF',
      url,
      previewUrl,
      width,
      height,
      source: 'klipy',
      kind,
    };
  }

  private pickFormat(file: any, sizes: string[]) {
    for (const size of sizes) if (file?.[size]) return file[size];
    return file?.gif || file?.webp ? file : null;
  }

  private dimension(value: unknown) {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
  }
}
