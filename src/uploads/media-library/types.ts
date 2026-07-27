export type MediaKind = 'image' | 'video' | 'audio';

export type MediaCollectionName =
  | 'profile-photo'
  | 'cover-photo'
  | 'group-photo'
  | 'chat-photo'
  | 'actsnap-media'
  | 'post-media'
  | 'comment-media'
  | 'generic-image'
  | 'generic-video'
  | 'generic-audio'
  | 'generic-media';

export type MediaConversion = {
  width: number;
  height?: number;
  fit: 'cover' | 'inside';
  withoutEnlargement?: boolean;
};

export type MediaCollection = {
  name: MediaCollectionName;
  folder: string;
  accepts: 'image' | 'video' | 'audio' | 'media';
  maxBytes: number;
  conversion?: MediaConversion;
};

export type ProcessedMedia = {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  type: MediaKind;
  temporary: boolean;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type StoredMedia = {
  key: string;
  url: string;
  path?: string;
};

export type UploadResponse = StoredMedia & {
  collection: MediaCollectionName;
  filename: string;
  originalName?: string;
  mimeType: string;
  size: number;
  type: MediaKind;
  width?: number;
  height?: number;
};
