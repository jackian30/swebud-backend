import { ActivityPersona } from '@prisma/client';

type ExposedActivityPersona = ActivityPersona | { persona: ActivityPersona };

export const activityPersonaLinkSelect = {
  orderBy: { sortOrder: 'asc' as const },
  select: { persona: true },
} as const;

export function normalizeActivityPersonas(personas?: ActivityPersona[] | null) {
  return [...new Set(personas ?? [])];
}

export function createActivityPersonaLinks(personas?: ActivityPersona[] | null) {
  return normalizeActivityPersonas(personas).map((persona, sortOrder) => ({ persona, sortOrder }));
}

export function replaceActivityPersonaLinks(personas?: ActivityPersona[] | null) {
  return {
    deleteMany: {},
    create: createActivityPersonaLinks(personas),
  };
}

export function exposeActivityPersonas<T extends { activityPersonas?: ExposedActivityPersona[] | null }>(entity: T) {
  const { activityPersonas: links, ...rest } = entity as T & { activityPersonas?: ExposedActivityPersona[] | null };
  const personas = Array.isArray(links)
    ? links.map((item: ExposedActivityPersona) => typeof item === 'string' ? item : item.persona).filter(Boolean)
    : [];
  return {
    ...rest,
    activityPersona: personas[0] ?? null,
    activityPersonas: personas,
  };
}
