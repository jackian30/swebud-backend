import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TenorService {
  constructor(private config: ConfigService) {}

  async search(q = '', type: 'gifs' | 'stickers' = 'gifs', limit = 24) {
    const key = this.config.get<string>('TENOR_API_KEY')?.trim();
    if (!key) return { results: [], next: null, configured: false };
    const endpoint = q.trim() ? 'search' : 'featured';
    const url = new URL(`https://tenor.googleapis.com/v2/${endpoint}`);
    url.searchParams.set('key', key);
    url.searchParams.set('client_key', this.config.get<string>('TENOR_CLIENT_KEY') || 'swebud');
    url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 50)));
    url.searchParams.set('media_filter', 'gif,tinygif,nanogif');
    url.searchParams.set('contentfilter', 'medium');
    if (q.trim()) url.searchParams.set('q', q.trim());
    if (type === 'stickers') url.searchParams.set('searchfilter', 'sticker');
    const response = await fetch(url).catch(() => null);
    if (!response?.ok) return { results: [], next: null, configured: true };
    const body = await response.json() as { next?: string; results?: any[] };
    return {
      configured: true,
      next: body.next ?? null,
      results: (body.results ?? []).map((item) => ({
        id: item.id,
        title: item.title || item.content_description || 'Tenor GIF',
        url: item.media_formats?.gif?.url ?? item.media_formats?.tinygif?.url,
        previewUrl: item.media_formats?.tinygif?.url ?? item.media_formats?.nanogif?.url ?? item.media_formats?.gif?.url,
        width: item.media_formats?.gif?.dims?.[0] ?? null,
        height: item.media_formats?.gif?.dims?.[1] ?? null,
        source: 'tenor',
      })).filter((item) => item.url),
    };
  }
}
