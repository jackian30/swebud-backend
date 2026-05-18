import { BadRequestException } from '@nestjs/common';
import { MediaCollection, MediaCollectionName, MediaKind } from './types';

const maxImageBytes = 15 * 1024 * 1024;
const maxVideoBytes = 100 * 1024 * 1024;
const maxAudioBytes = 25 * 1024 * 1024;

export const allowedImageTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

export const allowedVideoTypes = new Map([
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
]);

export const allowedAudioTypes = new Map([
  ['audio/aac', '.aac'],
  ['audio/mpeg', '.mp3'],
  ['audio/mp4', '.m4a'],
  ['audio/ogg', '.ogg'],
  ['audio/wav', '.wav'],
  ['audio/webm', '.webm'],
]);

export const mediaCollections: Record<MediaCollectionName, MediaCollection> = {
  'profile-photo': { name: 'profile-photo', folder: 'profile-photos', accepts: 'image', maxBytes: maxImageBytes, conversion: { width: 512, height: 512, fit: 'cover' } },
  'cover-photo': { name: 'cover-photo', folder: 'cover-photos', accepts: 'image', maxBytes: maxImageBytes, conversion: { width: 1600, height: 533, fit: 'cover' } },
  'group-photo': { name: 'group-photo', folder: 'group-photos', accepts: 'image', maxBytes: maxImageBytes, conversion: { width: 512, height: 512, fit: 'cover' } },
  'chat-photo': { name: 'chat-photo', folder: 'chat-photos', accepts: 'image', maxBytes: maxImageBytes, conversion: { width: 512, height: 512, fit: 'cover' } },
  'actsnap-media': { name: 'actsnap-media', folder: 'actsnaps', accepts: 'media', maxBytes: maxVideoBytes, conversion: { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true } },
  'post-media': { name: 'post-media', folder: 'posts', accepts: 'media', maxBytes: maxVideoBytes, conversion: { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true } },
  'comment-media': { name: 'comment-media', folder: 'comments', accepts: 'image', maxBytes: maxImageBytes, conversion: { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true } },
  'generic-image': { name: 'generic-image', folder: 'images', accepts: 'image', maxBytes: maxImageBytes, conversion: { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true } },
  'generic-video': { name: 'generic-video', folder: 'videos', accepts: 'video', maxBytes: maxVideoBytes },
  'generic-audio': { name: 'generic-audio', folder: 'audio', accepts: 'audio', maxBytes: maxAudioBytes },
  'generic-media': { name: 'generic-media', folder: 'media', accepts: 'media', maxBytes: maxVideoBytes, conversion: { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true } },
};

export function collectionFor(name: MediaCollectionName) {
  return mediaCollections[name];
}

export function kindForMime(mimeType: string): MediaKind | null {
  if (allowedImageTypes.has(mimeType)) return 'image';
  if (allowedVideoTypes.has(mimeType)) return 'video';
  if (allowedAudioTypes.has(mimeType)) return 'audio';
  return null;
}

export function extensionForMime(mimeType: string): string {
  const extension = allowedImageTypes.get(mimeType) ?? allowedVideoTypes.get(mimeType) ?? allowedAudioTypes.get(mimeType);
  if (!extension) throw new BadRequestException(`Unsupported media type: ${mimeType || 'unknown'}`);
  return extension;
}

export function assertCollectionAccepts(collection: MediaCollection, kind: MediaKind, mimeType: string) {
  if (collection.accepts === 'media' || collection.accepts === kind) return;
  throw new BadRequestException(`Unsupported ${collection.accepts} upload type: ${mimeType || 'unknown'}`);
}
