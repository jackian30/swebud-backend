import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type SeedMediaKind = 'avatar' | 'group' | 'post' | 'cover' | 'story';

const seedMedia = {
  avatar: {
    width: 512,
    height: 512,
    labels: ['Runner', 'Lifter', 'Cyclist', 'Coach', 'Buddy', 'Sweat', 'Pacer', 'Mover'],
  },
  group: {
    width: 512,
    height: 512,
    labels: ['Run Club', 'Lift Crew', 'Ride Team', 'Mobility', 'Boxing', 'Zone 2', 'Meal Prep', 'Weekend'],
  },
  post: {
    width: 900,
    height: 700,
    labels: ['Run Club', 'Strength', 'Mobility', 'Ride Crew', 'Leg Day', 'Recovery', 'Swim Set', 'Zone 2'],
  },
  cover: {
    width: 1200,
    height: 420,
    labels: ['Weekend Crew', 'Sweat Check', 'Metro Miles', 'Lift Lab'],
  },
  story: {
    width: 900,
    height: 1600,
    labels: ['ActSnap', 'Post Run', 'Gym Flow'],
  },
} as const;

const palettes = [
  ['#0f172a', '#2563eb', '#f8fafc', '#93c5fd'],
  ['#111827', '#16a34a', '#f9fafb', '#86efac'],
  ['#18181b', '#e11d48', '#fff1f2', '#fda4af'],
  ['#0c0a09', '#f59e0b', '#fffbeb', '#fde68a'],
  ['#082f49', '#06b6d4', '#ecfeff', '#67e8f9'],
  ['#1f2937', '#8b5cf6', '#f5f3ff', '#c4b5fd'],
  ['#052e16', '#22c55e', '#f0fdf4', '#bbf7d0'],
  ['#312e81', '#f97316', '#fff7ed', '#fdba74'],
];

export function seedPostImageUrl(seed: string, width = 900, height = 700) {
  return seedLocalImageUrl('post', seed, width, height);
}

export function seedAvatarImageUrl(seed: string, width = 512, height = 512) {
  return seedLocalImageUrl('avatar', seed, width, height);
}

export function seedGroupImageUrl(seed: string, width = 512, height = 512) {
  return seedLocalImageUrl('group', seed, width, height);
}

export function seedCoverImageUrl(seed: string, width = 1200, height = 420) {
  return seedLocalImageUrl('cover', seed, width, height);
}

export function seedStoryImageUrl(seed: string, width = 900, height = 1600) {
  return seedLocalImageUrl('story', seed, width, height);
}

export async function ensureSeedMediaAssets(rootDir = process.cwd()) {
  const mediaDir = join(rootDir, 'uploads', 'seed-media');
  await mkdir(mediaDir, { recursive: true });

  await Promise.all((Object.keys(seedMedia) as SeedMediaKind[]).flatMap((kind) => {
    const config = seedMedia[kind];
    return config.labels.map((label, index) => writeFile(
      join(mediaDir, `${kind}-${index}.svg`),
      seedSvg({
        kind,
        label,
        index,
        width: config.width,
        height: config.height,
      }),
      'utf8',
    ));
  }));
}

function seedLocalImageUrl(kind: SeedMediaKind, seed: string, width: number, height: number) {
  const config = seedMedia[kind];
  const index = Math.abs(hashSeed(`${kind}:${seed}:${width}x${height}`)) % config.labels.length;
  return `/uploads/seed-media/${kind}-${index}.svg`;
}

function hashSeed(seed: string) {
  return [...seed].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

function seedSvg(input: { kind: SeedMediaKind; label: string; index: number; width: number; height: number }) {
  const [bg, accent, text, soft] = palettes[input.index % palettes.length] ?? palettes[0];
  const centerY = input.height / 2;
  const titleSize = Math.round(input.width * (input.kind === 'story' ? 0.095 : 0.07));
  const subtitleSize = Math.round(input.width * (input.kind === 'story' ? 0.034 : 0.026));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" role="img" aria-label="${input.label}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg}"/>
      <stop offset="1" stop-color="${accent}"/>
    </linearGradient>
    <radialGradient id="glow" cx="72%" cy="22%" r="70%">
      <stop offset="0" stop-color="${soft}" stop-opacity="0.58"/>
      <stop offset="1" stop-color="${soft}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <circle cx="${Math.round(input.width * 0.18)}" cy="${Math.round(input.height * 0.24)}" r="${Math.round(input.width * 0.16)}" fill="${soft}" opacity="0.16"/>
  <circle cx="${Math.round(input.width * 0.86)}" cy="${Math.round(input.height * 0.78)}" r="${Math.round(input.width * 0.24)}" fill="${bg}" opacity="0.22"/>
  <path d="M ${Math.round(input.width * 0.12)} ${Math.round(centerY + input.height * 0.19)} C ${Math.round(input.width * 0.32)} ${Math.round(centerY + input.height * 0.05)}, ${Math.round(input.width * 0.58)} ${Math.round(centerY + input.height * 0.32)}, ${Math.round(input.width * 0.88)} ${Math.round(centerY + input.height * 0.12)}" fill="none" stroke="${soft}" stroke-width="${Math.max(8, Math.round(input.width * 0.018))}" stroke-linecap="round" opacity="0.55"/>
  <text x="50%" y="${Math.round(centerY - titleSize * 0.1)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="800" fill="${text}">${input.label}</text>
  <text x="50%" y="${Math.round(centerY + titleSize * 0.72)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${subtitleSize}" font-weight="700" letter-spacing="3" fill="${soft}">SWEBUDD SAMPLE MEDIA</text>
</svg>
`;
}
