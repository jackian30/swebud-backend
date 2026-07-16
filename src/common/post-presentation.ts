const PUBLIC_ACTIVITY_KEYS = [
  'id',
  'source',
  'type',
  'title',
  'startedAt',
  'durationSeconds',
  'distanceMeters',
  'elevationGainMeters',
  'calories',
  'averageHeartRate',
  'maxHeartRate',
  'averagePaceSecondsKm',
  'averageSpeedMetersSec',
] as const;

export const publicActivitySelect = Object.fromEntries(
  PUBLIC_ACTIVITY_KEYS.map((key) => [key, true]),
) as Record<(typeof PUBLIC_ACTIVITY_KEYS)[number], true>;

export const publicBuddySessionRecapSelect = {
  id: true,
  roomName: true,
  scope: true,
  groupId: true,
  groupName: true,
  groupSlug: true,
  activity: true,
  subActivity: true,
  title: true,
  caption: true,
  participantCount: true,
  participantPreview: true,
  areaLabel: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
  includeParticipants: true,
  includeBroadArea: true,
  visibility: true,
  sharedPostId: true,
  sharedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PresentPostOptions = {
  viewerId?: string | null;
};

export function presentPublicPost(post: any, options: PresentPostOptions = {}) {
  if (!post) return post;

  const { _count, ...safePost } = { ...post };
  delete safePost.latitude;
  delete safePost.longitude;
  delete safePost.viewerView;
  delete safePost.latestActivityAt;
  delete safePost.staleViewed;
  delete safePost.baseRelevanceScore;

  if (Array.isArray(safePost.images)) {
    safePost.images = safePost.images.map((item: Record<string, unknown>) => ({
      ...item,
      type: item.type ?? item.mediaType ?? 'image',
    }));
  }

  if (safePost.author) {
    safePost.author = { ...safePost.author };
    delete safePost.author.latitude;
    delete safePost.author.longitude;
  }

  if (safePost.activity) safePost.activity = publicActivity(safePost.activity);
  if (safePost.buddySessionRecap) safePost.buddySessionRecap = presentPublicBuddySessionRecap(safePost.buddySessionRecap);

  safePost.repostCount = _count?.reposts ?? safePost.repostCount ?? 0;
  if (!safePost.isAnonymous) return safePost;

  const viewerCanManage = Boolean(options.viewerId && safePost.authorId === options.viewerId);
  delete safePost.authorId;
  safePost.author = null;
  safePost.anonymous = true;
  safePost.viewerCanManage = viewerCanManage;
  return safePost;
}

function publicActivity(activity: Record<string, unknown>) {
  return Object.fromEntries(
    PUBLIC_ACTIVITY_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(activity, key))
      .map((key) => [key, activity[key]]),
  );
}

export function presentPublicBuddySessionRecap(recap: Record<string, any>) {
  const safeRecap = Object.fromEntries(
    Object.keys(publicBuddySessionRecapSelect)
      .filter((key) => Object.prototype.hasOwnProperty.call(recap, key))
      .map((key) => [key, recap[key]]),
  );
  safeRecap.participantPreview = safeRecap.includeParticipants
    ? (Array.isArray(safeRecap.participantPreview) ? safeRecap.participantPreview : [])
    : [];
  safeRecap.participantCount = safeRecap.includeParticipants
    ? (typeof safeRecap.participantCount === 'number' ? safeRecap.participantCount : 0)
    : 0;
  safeRecap.areaLabel = safeRecap.includeBroadArea ? (safeRecap.areaLabel ?? null) : null;
  return safeRecap;
}
