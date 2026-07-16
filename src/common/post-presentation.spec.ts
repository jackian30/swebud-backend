import { presentPublicPost, publicActivitySelect, publicBuddySessionRecapSelect } from './post-presentation';

describe('public post presentation', () => {
  it('removes exact coordinates and non-public activity fields', () => {
    const post = presentPublicPost({
      id: 'post-1',
      latitude: 14.5995,
      longitude: 120.9842,
      activity: {
        id: 'activity-1',
        userId: 'author-1',
        title: 'Morning run',
        distanceMeters: 5000,
        raw: { route: [[14.5995, 120.9842]] },
        createdAt: new Date(),
      },
    });

    expect(post).not.toHaveProperty('latitude');
    expect(post).not.toHaveProperty('longitude');
    expect(post.activity).toEqual({ id: 'activity-1', title: 'Morning run', distanceMeters: 5000 });
    expect(post.activity).not.toHaveProperty('userId');
    expect(post.activity).not.toHaveProperty('raw');
    expect(publicActivitySelect).not.toHaveProperty('raw');
    expect(publicActivitySelect).not.toHaveProperty('userId');
  });

  it('does not reveal an anonymous post author id while preserving viewer ownership', () => {
    const post = presentPublicPost({
      id: 'post-1',
      authorId: 'author-1',
      author: { id: 'author-1', username: 'secret-author' },
      isAnonymous: true,
    }, { viewerId: 'author-1' });

    expect(post).not.toHaveProperty('authorId');
    expect(post.author).toBeNull();
    expect(post).toEqual(expect.objectContaining({ anonymous: true, viewerCanManage: true }));
  });

  it('redacts recap fields disabled by their privacy controls', () => {
    const post = presentPublicPost({
      id: 'post-1',
      buddySessionRecap: {
        id: 'recap-1',
        ownerId: 'author-1',
        roomId: 'private-room-id',
        owner: { id: 'author-1', email: 'private@example.com' },
        privateFutureField: 'must not leak',
        includeParticipants: false,
        participantCount: 4,
        participantPreview: [{ userId: 'participant-1', username: 'private-buddy' }],
        includeBroadArea: false,
        areaLabel: 'Makati',
      },
    });

    expect(post.buddySessionRecap).toEqual(expect.objectContaining({
      participantCount: 0,
      participantPreview: [],
      areaLabel: null,
    }));
    expect(post.buddySessionRecap).not.toHaveProperty('ownerId');
    expect(post.buddySessionRecap).not.toHaveProperty('roomId');
    expect(post.buddySessionRecap).not.toHaveProperty('owner');
    expect(post.buddySessionRecap).not.toHaveProperty('privateFutureField');
    expect(publicBuddySessionRecapSelect).not.toHaveProperty('ownerId');
    expect(publicBuddySessionRecapSelect).not.toHaveProperty('roomId');
  });

  it('normalizes public media type and drops internal feed-ranking fields', () => {
    const post = presentPublicPost({
      id: 'post-1',
      viewerView: { count: 2 },
      latestActivityAt: new Date(),
      staleViewed: false,
      baseRelevanceScore: 42,
      images: [{ id: 'image-1', url: '/media/image.webp', mediaType: 'image' }],
    });

    expect(post.images[0]).toEqual(expect.objectContaining({ type: 'image', mediaType: 'image' }));
    expect(post).not.toHaveProperty('viewerView');
    expect(post).not.toHaveProperty('latestActivityAt');
    expect(post).not.toHaveProperty('staleViewed');
    expect(post).not.toHaveProperty('baseRelevanceScore');
  });
});
