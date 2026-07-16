export type ContractHttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type FrontendOperationContract = {
  path: string;
  method: ContractHttpMethod;
  responseSchema: string | null;
  request?: {
    schema: string;
    mediaType?: 'application/json' | 'multipart/form-data';
    required?: boolean;
  };
};

function operations(responseSchema: string | null, keys: readonly string[]): FrontendOperationContract[] {
  return keys.map((key) => {
    const separator = key.indexOf(' ');
    const method = key.slice(0, separator).toLowerCase() as ContractHttpMethod;
    const path = key.slice(separator + 1);
    return { path, method, responseSchema };
  });
}

const uploads = [
  '/uploads/profile-photo',
  '/uploads/cover-photo',
  '/uploads/group-photo',
  '/uploads/chat-photo',
  '/uploads/actsnap-media',
  '/uploads/post-media',
  '/uploads/comment-media',
  '/uploads/images',
  '/uploads/videos',
  '/uploads/audio',
] as const;

/**
 * The backend-owned inventory of operations invoked by the maintained web and
 * mobile adapters. The frontend gate independently derives its inventory from
 * adapter source and requires an exact subset match against this document.
 */
export const FRONTEND_OPERATION_CONTRACTS: readonly FrontendOperationContract[] = [
  ...operations('AuthTokensResponse', [
    'POST /auth/register',
    'POST /auth/login',
    'POST /auth/google',
    'POST /auth/onboarding/complete',
    'POST /auth/refresh',
  ]),
  ...operations('OkResponse', [
    'POST /auth/forgot-password',
    'POST /auth/reset-password',
  ]),
  ...operations(null, ['POST /auth/logout']),

  ...operations('BuddyActivityOptionListResponse', ['GET /buddy/activities']),
  ...operations('NullableBuddySessionResponse', ['GET /buddy/session/me']),
  ...operations('BuddySessionResponse', [
    'PUT /buddy/session',
    'POST /buddy/rooms/join',
  ]),
  ...operations('BuddySessionListResponse', [
    'GET /buddy/nearby',
    'GET /buddy/discoverable',
  ]),
  ...operations('BuddyStopResponse', [
    'DELETE /buddy/session',
    'DELETE /buddy/rooms/{id}',
  ]),
  ...operations('OkResponse', [
    'DELETE /buddy/session/presence',
    'DELETE /buddy/rooms/{id}/messages/{messageId}',
    'DELETE /buddy/rooms/{id}/participants/{userId}',
  ]),
  ...operations('BuddyRecapListResponse', ['GET /buddy/recaps']),
  ...operations('BuddySessionRecapResponse', [
    'GET /buddy/recaps/{id}',
    'PATCH /buddy/recaps/{id}',
    'POST /buddy/rooms/{id}/recap',
  ]),
  ...operations('BuddyRecapShareResponse', ['POST /buddy/recaps/{id}/share']),
  ...operations('BuddyRoomListResponse', ['GET /buddy/rooms']),
  ...operations('BuddyRoomResponse', [
    'GET /buddy/rooms/{id}',
    'POST /buddy/rooms',
    'PATCH /buddy/rooms/{id}',
    'PATCH /buddy/rooms/{id}/pinned-location',
    'DELETE /buddy/rooms/{id}/pinned-location',
    'PATCH /buddy/rooms/{id}/personal-pin',
    'DELETE /buddy/rooms/{id}/personal-pin',
    'PATCH /buddy/rooms/{id}/participants/{userId}/role',
  ]),
  ...operations('PublicUserListResponse', ['GET /buddy/rooms/{id}/invite-candidates']),
  ...operations('InviteUsersResponse', ['POST /buddy/rooms/{id}/invites']),
  ...operations('BuddySessionMessageListResponse', ['GET /buddy/rooms/{id}/messages']),
  ...operations('BuddySessionMessageResponse', [
    'POST /buddy/rooms/{id}/messages',
    'POST /buddy/rooms/{id}/messages/{messageId}/reactions',
    'DELETE /buddy/rooms/{id}/messages/{messageId}/reactions',
    'POST /buddy/rooms/{id}/messages/{messageId}/unsend',
  ]),
  ...operations('BuddyRoomReadResponse', ['POST /buddy/rooms/{id}/messages/read']),

  ...operations('BuddyProfileResponse', ['GET /chat/profiles/buddy/{peerId}']),
  ...operations('ChatProfileOverrideResponse', ['PATCH /chat/profiles/buddy/{peerId}']),
  ...operations('MessageRequestListResponse', ['GET /chat/requests']),
  ...operations('MessageRequestResponse', [
    'PATCH /chat/requests/{id}/accept',
    'PATCH /chat/requests/{id}/decline',
  ]),
  ...operations('ChatRequestResultResponse', ['POST /chat/requests']),
  ...operations('ChatMessageResponse', [
    'POST /chat/messages',
    'POST /chat/messages/{id}/reactions',
    'DELETE /chat/messages/{id}/reactions',
    'POST /chat/messages/{id}/unsend',
    'POST /chat/buddy-groups/{id}/messages',
  ]),
  ...operations('ChatMessageListResponse', [
    'GET /chat/conversations/{peerId}',
    'GET /chat/buddy-groups/{id}/messages',
  ]),
  ...operations('ChatConversationListResponse', ['GET /chat/conversations']),
  ...operations('ChatSearchResultListResponse', ['GET /chat/search/messages']),
  ...operations('DirectMuteResponse', ['PATCH /chat/conversations/{peerId}/mute']),
  ...operations('DirectPinResponse', ['PATCH /chat/conversations/{peerId}/pin']),
  ...operations('BuddyGroupChatListResponse', ['GET /chat/buddy-groups']),
  ...operations('BuddyGroupChatResponse', [
    'GET /chat/buddy-groups/{id}',
    'POST /chat/buddy-groups',
    'POST /chat/buddy-groups/{id}/participants',
  ]),
  ...operations('BuddyGroupReadResponse', ['PATCH /chat/buddy-groups/{id}/read']),
  ...operations('BuddyGroupMuteResponse', ['PATCH /chat/buddy-groups/{id}/mute']),
  ...operations('BuddyGroupPinResponse', ['PATCH /chat/buddy-groups/{id}/pin']),
  ...operations('CountResponse', ['GET /chat/unread-count']),
  ...operations('DirectReadResponse', ['PATCH /chat/conversations/{peerId}/read']),
  ...operations('OkResponse', [
    'DELETE /chat/messages/{id}',
    'POST /chat/messages/{id}/report',
  ]),
  ...operations('MessageInfoResponse', ['GET /chat/messages/{id}/info']),
  ...operations('MessagePinResponse', ['PATCH /chat/messages/{id}/pin']),

  ...operations('FeedResponse', ['GET /feed']),
  ...operations('CountResponse', ['POST /feed/viewed']),
  ...operations('HashtagListResponse', [
    'GET /feed/hashtags',
    'GET /feed/trending-hashtags',
  ]),
  ...operations('SuggestedUserListResponse', ['GET /feed/suggested-users']),
  ...operations('SuggestedGroupListResponse', ['GET /feed/suggested-groups']),

  ...operations('GroupListResponse', [
    'GET /groups',
    'GET /groups/mine',
  ]),
  ...operations('GroupResponse', [
    'POST /groups',
    'PATCH /groups/{id}/settings',
    'PATCH /groups/{id}/members/{memberId}/role',
    'POST /groups/invites/{inviteId}/accept',
    'GET /groups/{slug}',
    'POST /groups/{id}/join',
    'POST /groups/invite/accept',
  ]),
  ...operations('OkResponse', [
    'POST /groups/{id}/report',
    'POST /groups/invites/{inviteId}/decline',
  ]),
  ...operations('GroupInviteListResponse', ['GET /groups/invites']),
  ...operations('PublicUserListResponse', ['GET /groups/{id}/invite-candidates']),
  ...operations('InviteUsersResponse', ['POST /groups/{id}/invites']),
  ...operations('FeedResponse', ['GET /groups/{id}/posts']),
  ...operations('FeedPostResponse', ['POST /groups/{id}/posts']),
  ...operations(null, ['DELETE /groups/{id}/posts/{postId}']),
  ...operations('GroupChannelListResponse', ['GET /groups/{id}/channels']),
  ...operations('GroupChannelResponse', ['POST /groups/{id}/channels']),
  ...operations('GroupMuteResponse', ['PATCH /groups/{id}/mute']),
  ...operations('GroupPinResponse', ['PATCH /groups/{id}/pin']),
  ...operations('GroupMessageListResponse', [
    'GET /groups/{id}/channels/{channelId}/messages',
    'GET /groups/{id}/messages',
  ]),
  ...operations('GroupMessageResponse', [
    'POST /groups/{id}/channels/{channelId}/messages',
    'POST /groups/{id}/messages',
  ]),
  ...operations('GroupChannelReadResponse', ['PATCH /groups/{id}/channels/{channelId}/read']),
  ...operations('GroupChannelMuteResponse', ['PATCH /groups/{id}/channels/{channelId}/mute']),
  ...operations('GroupChannelPinResponse', ['PATCH /groups/{id}/channels/{channelId}/pin']),

  ...operations('KlipyResponse', ['GET /klipy/search']),

  ...operations('NotificationListResponse', ['GET /notifications']),
  ...operations('CountResponse', ['GET /notifications/unread-count']),
  ...operations('OkResponse', [
    'PATCH /notifications/{id}/read',
    'POST /notifications/read-all',
  ]),

  ...operations('FeedPostResponse', [
    'POST /posts',
    'PATCH /posts/{id}',
    'GET /posts/{id}',
    'POST /posts/{id}/pin',
    'DELETE /posts/{id}/pin',
  ]),
  ...operations('LikeStateResponse', [
    'POST /posts/{id}/like',
    'DELETE /posts/{id}/like',
    'POST /posts/reposts/{repostId}/like',
    'DELETE /posts/reposts/{repostId}/like',
    'POST /posts/{postId}/comments/{commentId}/like',
    'DELETE /posts/{postId}/comments/{commentId}/like',
  ]),
  ...operations('SaveStateResponse', [
    'POST /posts/{id}/save',
    'DELETE /posts/{id}/save',
  ]),
  ...operations('RepostResponse', ['POST /posts/{id}/repost']),
  ...operations('HiddenStateResponse', ['POST /posts/{id}/hide']),
  ...operations('OkResponse', ['POST /posts/{id}/report']),
  ...operations('PostHistoryListResponse', ['GET /posts/{id}/history']),
  ...operations('CommentPageResponse', ['GET /posts/{id}/comments']),
  ...operations('CommentResponse', [
    'POST /posts/{id}/comments',
    'PATCH /posts/{postId}/comments/{commentId}',
  ]),
  ...operations('CommentHistoryListResponse', ['GET /posts/{postId}/comments/{commentId}/history']),
  ...operations(null, [
    'DELETE /posts/{id}',
    'DELETE /posts/{postId}/comments/{commentId}',
  ]),

  ...operations('StoryGroupListResponse', ['GET /actsnaps']),
  ...operations('ActiveStoryAuthorListResponse', ['GET /actsnaps/active-authors']),
  ...operations('StoryResponse', ['POST /actsnaps']),
  ...operations('ViewedStateResponse', ['POST /actsnaps/{id}/view']),
  ...operations('StoryViewListResponse', ['GET /actsnaps/{id}/views']),
  ...operations('StoryReactionResponse', ['POST /actsnaps/{id}/reactions']),
  ...operations('StoryReplyResponse', ['POST /actsnaps/{id}/replies']),
  ...operations('OkResponse', ['DELETE /actsnaps/{id}/reactions']),
  ...operations(null, ['DELETE /actsnaps/{id}']),

  ...uploads.map((path) => ({
    path,
    method: 'post' as const,
    responseSchema: 'UploadResponse',
    request: { schema: 'MultipartFileDto', mediaType: 'multipart/form-data' as const },
  })),

  ...operations('MeResponse', [
    'GET /users/me',
    'PATCH /users/me',
    'PATCH /users/me/onboarding',
    'PATCH /users/me/account',
  ]),
  ...operations('ProfileResponse', ['GET /users/{id}']),
  ...operations('OkResponse', [
    'PATCH /users/me/password',
    'DELETE /users/me',
    'DELETE /users/me/sessions/{id}',
    'DELETE /users/me/search-history/{id}',
    'DELETE /users/me/search-history',
    'POST /users/{id}/report',
    'DELETE /users/{id}/follow',
  ]),
  ...operations('AccountSessionListResponse', ['GET /users/me/sessions']),
  ...operations('PublicUserListResponse', [
    'GET /users/me/blocked',
    'GET /users',
    'GET /users/{id}/followers',
    'GET /users/me/followers',
    'GET /users/{id}/following',
    'GET /users/me/following',
    'GET /users/me/mutual',
    'GET /users/me/close-buddies',
  ]),
  ...operations('SearchHistoryListResponse', ['GET /users/me/search-history']),
  ...operations('SearchHistoryResponse', ['POST /users/me/search-history']),
  ...operations('FollowActionResponse', ['POST /users/{id}/follow']),
  ...operations('FollowRequestListResponse', ['GET /users/me/follow-requests']),
  ...operations('FollowRequestStatusResponse', [
    'POST /users/me/follow-requests/{id}/accept',
    'POST /users/me/follow-requests/{id}/decline',
  ]),
  ...operations('BlockStateResponse', [
    'POST /users/{id}/block',
    'DELETE /users/{id}/block',
  ]),
  ...operations('CloseBuddyStateResponse', [
    'POST /users/{id}/close-buddy',
    'DELETE /users/{id}/close-buddy',
  ]),

  ...operations('ThemeResponse', [
    'GET /theme',
    'PUT /theme',
  ]),
].map((contract) => {
  if (contract.path === '/feed/viewed' && contract.method === 'post') {
    return { ...contract, request: { schema: 'FeedViewedDto' } };
  }
  return contract;
});

/** Maintained backend operations not currently invoked by the frontend adapters. */
export const BACKEND_ONLY_OPERATION_CONTRACTS: readonly FrontendOperationContract[] = [
  ...operations('HealthLiveResponse', [
    'GET /health',
    'GET /health/live',
  ]),
  ...operations('HealthReadyResponse', ['GET /health/ready']),
  ...operations('FollowRequestListResponse', ['GET /users/me/follow-requests/sent']),
  ...operations('OkResponse', ['DELETE /users/me/follow-requests/{id}']),
  ...operations('CommentPageResponse', ['GET /posts/{postId}/comments/{commentId}/replies']),
  ...operations('ChatKeyResponse', [
    'GET /chat/keys/me',
    'POST /chat/keys',
    'GET /chat/keys/{peerId}',
  ]),
  ...operations('UploadResponse', ['POST /uploads/media']),
  ...operations('UploadBatchResponse', ['POST /uploads/media/batch']),
  ...operations('IntegrationListResponse', ['GET /integrations']),
  ...operations('IntegrationResponse', [
    'POST /integrations/connect',
    'PATCH /integrations/{provider}',
    'DELETE /integrations/{provider}',
  ]),
  ...operations('IntegrationOAuthStartResponse', ['GET /integrations/{provider}/oauth/start']),
  ...operations('ActivityRecordListResponse', ['GET /activities']),
  ...operations('ActivityRecordResponse', [
    'POST /activities',
    'PATCH /activities/{id}',
  ]),
  ...operations('ActivityStatsResponse', ['GET /activities/stats']),
  ...operations('OkResponse', ['DELETE /activities/{id}']),
  ...operations('StoryGroupListResponse', ['GET /stories']),
  ...operations('StoryResponse', ['POST /stories']),
  ...operations('ActiveStoryAuthorListResponse', ['GET /stories/active-authors']),
  ...operations('StoryViewListResponse', ['GET /stories/{id}/views']),
  ...operations('ViewedStateResponse', ['POST /stories/{id}/view']),
  ...operations('StoryReactionResponse', ['POST /stories/{id}/reactions']),
  ...operations('OkResponse', ['DELETE /stories/{id}/reactions']),
  ...operations('StoryReplyResponse', ['POST /stories/{id}/replies']),
  ...operations(null, ['DELETE /stories/{id}']),
].map((contract) => {
  const key = `${contract.method.toUpperCase()} ${contract.path}`;
  if (key === 'POST /chat/keys') return { ...contract, request: { schema: 'RegisterChatKeyDto' } };
  if (key === 'POST /uploads/media') return { ...contract, request: { schema: 'MultipartFileDto', mediaType: 'multipart/form-data' } };
  if (key === 'POST /uploads/media/batch') return { ...contract, request: { schema: 'MultipartFilesDto', mediaType: 'multipart/form-data' } };
  if (key === 'POST /integrations/connect') return { ...contract, request: { schema: 'ConnectIntegrationDto' } };
  if (key === 'PATCH /integrations/{provider}') return { ...contract, request: { schema: 'UpdateIntegrationDto' } };
  if (key === 'POST /activities') return { ...contract, request: { schema: 'CreateActivityDto' } };
  if (key === 'PATCH /activities/{id}') return { ...contract, request: { schema: 'UpdateActivityDto' } };
  if (key === 'POST /stories') return { ...contract, request: { schema: 'CreateStoryDto' } };
  if (key === 'POST /stories/{id}/reactions') return { ...contract, request: { schema: 'ReactStoryDto' } };
  if (key === 'POST /stories/{id}/replies') return { ...contract, request: { schema: 'ReplyStoryDto' } };
  return contract;
});

export const FRONTEND_OPERATION_KEYS = new Set(
  FRONTEND_OPERATION_CONTRACTS.map((contract) => `${contract.method.toUpperCase()} ${contract.path}`),
);
