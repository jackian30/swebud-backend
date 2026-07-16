import type { OpenAPIObject } from '@nestjs/swagger';
import type { OperationObject, ParameterObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { BACKEND_ONLY_OPERATION_CONTRACTS, FRONTEND_OPERATION_CONTRACTS } from './openapi.operations';
import { AUTHORITATIVE_CONTRACT_SCHEMAS } from './openapi.schemas';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type JsonContract = {
  path: string;
  method: HttpMethod;
  status: string;
  schema: string;
};

type RequestContract = {
  path: string;
  method: HttpMethod;
  schema: string;
  required?: boolean;
};

const nullableString: SchemaObject = { type: 'string', nullable: true };
const dateTime: SchemaObject = { type: 'string', format: 'date-time' };
const nullableDateTime: SchemaObject = { ...dateTime, nullable: true };
const activityPersonas = ['runner', 'bodybuilder', 'cyclist', 'yogi', 'swimmer', 'powerlifter', 'crossfitter', 'walker', 'hiker', 'climber', 'martial_artist', 'dancer', 'pilates', 'calisthenics', 'rower', 'triathlete', 'soccer_player', 'basketball_player', 'other'];
const activityPersona: SchemaObject = { type: 'string', enum: activityPersonas };
const nullableActivityPersona: SchemaObject = { ...activityPersona, nullable: true };
const postVisibility: SchemaObject = { type: 'string', enum: ['public', 'followers', 'mutuals', 'close_buddies', 'only_me'] };
const publicUserRef = { $ref: '#/components/schemas/PublicUserResponse' };
const feedPostRef = { $ref: '#/components/schemas/FeedPostResponse' };

/**
 * Named response schemas consumed by the web/mobile clients. These deliberately
 * describe the public presentation layer rather than Prisma records: precise
 * coordinates, raw activity provider payloads, recap owner/room identifiers,
 * and anonymous author identifiers are not part of the contract.
 */
export const CLIENT_RESPONSE_SCHEMAS: Record<string, SchemaObject> = {
  RegisterDto: {
    type: 'object',
    required: ['email', 'password', 'username', 'dateOfBirth', 'legalConsent', 'dataConsent'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', format: 'password', minLength: 8, maxLength: 128, writeOnly: true },
      username: { type: 'string', minLength: 3, maxLength: 32 },
      displayName: { type: 'string', maxLength: 80 },
      gender: { type: 'string', enum: ['female', 'male', 'non_binary', 'prefer_not_to_say', 'other'] },
      dateOfBirth: { type: 'string', format: 'date-time' },
      activityPersona,
      activityPersonas: { type: 'array', items: activityPersona },
      captchaToken: { type: 'string', maxLength: 4096 },
      legalConsent: { type: 'boolean' },
      dataConsent: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  LoginDto: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', maxLength: 254, description: 'Email address or username.' },
      password: { type: 'string', format: 'password', minLength: 8, maxLength: 128, writeOnly: true },
      captchaToken: { type: 'string', maxLength: 4096 },
    },
    additionalProperties: false,
  },
  GoogleLoginDto: {
    type: 'object',
    required: ['idToken'],
    properties: { idToken: { type: 'string', maxLength: 4096, writeOnly: true } },
    additionalProperties: false,
  },
  CompleteOnboardingDto: {
    type: 'object',
    required: ['username', 'dateOfBirth', 'legalConsent', 'dataConsent'],
    properties: {
      username: { type: 'string', minLength: 3, maxLength: 32 },
      dateOfBirth: { type: 'string', format: 'date-time' },
      legalConsent: { type: 'boolean' },
      dataConsent: { type: 'boolean' },
      activityPersonas: { type: 'array', items: activityPersona },
    },
    additionalProperties: false,
  },
  RefreshDto: {
    type: 'object',
    properties: { refreshToken: { type: 'string', maxLength: 4096, writeOnly: true } },
    additionalProperties: false,
  },
  LogoutDto: {
    type: 'object',
    properties: { refreshToken: { type: 'string', maxLength: 4096, writeOnly: true } },
    additionalProperties: false,
  },
  ForgotPasswordDto: {
    type: 'object',
    required: ['email'],
    properties: { email: { type: 'string', format: 'email', maxLength: 254 } },
    additionalProperties: false,
  },
  ResetPasswordDto: {
    type: 'object',
    required: ['token', 'password'],
    properties: {
      token: { type: 'string', maxLength: 256, writeOnly: true },
      password: { type: 'string', format: 'password', minLength: 8, maxLength: 128, writeOnly: true },
    },
    additionalProperties: false,
  },
  AcceptGroupInviteCodeDto: {
    type: 'object',
    required: ['code'],
    properties: {
      code: { type: 'string', pattern: '^[a-f0-9]{12}$', writeOnly: true },
    },
    additionalProperties: false,
  },
  PostImageDto: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string' },
      alt: { type: 'string' },
      type: { type: 'string', enum: ['image', 'video'] },
      mediaType: { type: 'string', enum: ['image', 'video'] },
      mimeType: { type: 'string' },
      filename: { type: 'string' },
      size: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
    additionalProperties: false,
  },
  CreatePostDto: {
    type: 'object',
    properties: {
      text: { type: 'string', maxLength: 1000 },
      visibility: { type: 'string', enum: ['public', 'followers', 'mutuals', 'close_buddies', 'only_me'] },
      privacy: { type: 'string', enum: ['public', 'followers', 'mutuals', 'close_buddies', 'only_me'] },
      profileOwnerId: { type: 'string', format: 'uuid' },
      targetUserId: { type: 'string', format: 'uuid' },
      profileUserId: { type: 'string', format: 'uuid' },
      activityId: { type: 'string', format: 'uuid' },
      latitude: { type: 'number', minimum: -90, maximum: 90, writeOnly: true },
      longitude: { type: 'number', minimum: -180, maximum: 180, writeOnly: true },
      images: { type: 'array', maxItems: 10, items: { $ref: '#/components/schemas/PostImageDto' } },
      hashtags: { type: 'array', items: { type: 'string' } },
      taggedUserIds: { type: 'array', maxItems: 50, items: { type: 'string', format: 'uuid' } },
      taggedUsers: { type: 'array', maxItems: 50, items: { type: 'string', format: 'uuid' } },
    },
    additionalProperties: false,
  },
  UpdateThemeDto: {
    type: 'object',
    properties: {
      theme: { type: 'string', enum: ['system', 'light', 'dark'] },
      mapVisual: { type: 'string', enum: ['system', 'streets', 'light', 'dark', 'satellite'] },
    },
    additionalProperties: false,
  },
  PublicUserResponse: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      displayName: nullableString,
      username: nullableString,
      bio: nullableString,
      profileImageUrl: nullableString,
      coverImageUrl: nullableString,
      activityPersona: nullableActivityPersona,
      activityPersonas: { type: 'array', nullable: true, items: activityPersona },
      usernameFinalized: { type: 'boolean' },
      verified: { type: 'boolean' },
      profileVisibility: { type: 'string', enum: ['public', 'followers', 'mutuals', 'close_buddies', 'private'] },
      hideProfileBadges: { type: 'boolean' },
      isBlockedByMe: { type: 'boolean' },
      hasBlockedMe: { type: 'boolean' },
      followsBack: { type: 'boolean' },
      isCloseBuddy: { type: 'boolean' },
      chatPublicKey: nullableString,
      createdAt: dateTime,
      badges: {
        type: 'array',
        items: {
          type: 'object',
          required: ['code', 'label', 'iconUrl'],
          properties: {
            code: { type: 'string' },
            label: { type: 'string' },
            description: nullableString,
            iconUrl: { type: 'string' },
          },
        },
      },
    },
  },
  AuthUserResponse: {
    type: 'object',
    required: ['id', 'email', 'displayName', 'username', 'usernameFinalized', 'bio', 'profileImageUrl', 'gender', 'dateOfBirth', 'activityPersona', 'activityPersonas', 'hideProfileBadges', 'badges', 'onboardingComplete'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      displayName: nullableString,
      username: { type: 'string' },
      usernameFinalized: { type: 'boolean' },
      bio: nullableString,
      profileImageUrl: nullableString,
      gender: { type: 'string', enum: ['female', 'male', 'non_binary', 'prefer_not_to_say', 'other'], nullable: true },
      dateOfBirth: nullableDateTime,
      activityPersona: nullableActivityPersona,
      activityPersonas: { type: 'array', items: activityPersona },
      hideProfileBadges: { type: 'boolean' },
      badges: {
        type: 'array',
        items: {
          type: 'object',
          required: ['code', 'label', 'iconUrl'],
          properties: {
            code: { type: 'string' },
            label: { type: 'string' },
            description: nullableString,
            iconUrl: { type: 'string' },
          },
        },
      },
      onboardingComplete: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  AuthTokensResponse: {
    type: 'object',
    required: ['user', 'accessToken', 'requiresOnboarding', 'onboardingMissing'],
    properties: {
      user: { $ref: '#/components/schemas/AuthUserResponse' },
      accessToken: { type: 'string', description: 'Short-lived bearer token. JWT claims intentionally omit email.' },
      refreshToken: { type: 'string', description: 'Rotating session refresh token returned only to the trusted native transport; browser sessions use an HttpOnly cookie.' },
      requiresOnboarding: { type: 'boolean' },
      onboardingMissing: { type: 'array', items: { type: 'string', enum: ['username', 'dateOfBirth', 'legalConsent', 'dataConsent'] } },
    },
  },
  ActivityResponse: {
    type: 'object',
    required: ['id', 'source', 'type', 'title', 'startedAt', 'durationSeconds', 'distanceMeters', 'elevationGainMeters', 'calories', 'averageHeartRate', 'maxHeartRate', 'averagePaceSecondsKm', 'averageSpeedMetersSec'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      source: { type: 'string', enum: ['manual', 'strava', 'garmin'] },
      type: { type: 'string' },
      title: nullableString,
      startedAt: dateTime,
      durationSeconds: { type: 'integer', nullable: true },
      distanceMeters: { type: 'number', nullable: true },
      elevationGainMeters: { type: 'number', nullable: true },
      calories: { type: 'integer', nullable: true },
      averageHeartRate: { type: 'integer', nullable: true },
      maxHeartRate: { type: 'integer', nullable: true },
      averagePaceSecondsKm: { type: 'integer', nullable: true },
      averageSpeedMetersSec: { type: 'number', nullable: true },
    },
  },
  PublicBuddySessionRecapResponse: {
    type: 'object',
    required: ['id', 'roomName', 'scope', 'groupId', 'groupName', 'groupSlug', 'activity', 'subActivity', 'title', 'caption', 'participantCount', 'participantPreview', 'areaLabel', 'startedAt', 'endedAt', 'durationSeconds', 'includeParticipants', 'includeBroadArea', 'visibility', 'sharedPostId', 'sharedAt', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      roomName: { type: 'string' },
      scope: { type: 'string', enum: ['public', 'group'] },
      groupId: nullableString,
      groupName: nullableString,
      groupSlug: nullableString,
      activity: nullableString,
      subActivity: nullableString,
      title: { type: 'string' },
      caption: nullableString,
      participantCount: { type: 'integer', minimum: 0 },
      participantPreview: {
        type: 'array',
        items: {
          type: 'object',
          required: ['userId', 'displayName', 'username', 'profileImageUrl'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
            displayName: nullableString,
            username: nullableString,
            profileImageUrl: nullableString,
          },
        },
      },
      areaLabel: nullableString,
      startedAt: dateTime,
      endedAt: nullableDateTime,
      durationSeconds: { type: 'integer', nullable: true },
      includeParticipants: { type: 'boolean' },
      includeBroadArea: { type: 'boolean' },
      visibility: postVisibility,
      sharedPostId: nullableString,
      sharedAt: nullableDateTime,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  },
  PostImageResponse: {
    type: 'object',
    required: ['id', 'postId', 'url', 'alt', 'type', 'mediaType', 'mimeType', 'filename', 'size', 'width', 'height', 'sortOrder'],
    properties: {
      id: { type: 'string' },
      postId: { type: 'string', format: 'uuid' },
      url: { type: 'string' },
      alt: nullableString,
      type: { type: 'string', enum: ['image', 'video'] },
      mediaType: { type: 'string', enum: ['image', 'video'], nullable: true },
      mimeType: nullableString,
      filename: nullableString,
      size: { type: 'integer', nullable: true },
      width: { type: 'integer', nullable: true },
      height: { type: 'integer', nullable: true },
      sortOrder: { type: 'integer' },
    },
  },
  CommentImageResponse: {
    type: 'object',
    required: ['id', 'commentId', 'url', 'alt', 'filename', 'mimeType', 'size', 'width', 'height', 'sortOrder', 'createdAt'],
    properties: {
      id: { type: 'string' },
      commentId: { type: 'string', format: 'uuid' },
      url: { type: 'string' },
      alt: nullableString,
      filename: nullableString,
      mimeType: nullableString,
      size: { type: 'integer', nullable: true },
      width: { type: 'integer', nullable: true },
      height: { type: 'integer', nullable: true },
      sortOrder: { type: 'integer' },
      createdAt: dateTime,
    },
  },
  CommentReplyResponse: {
    type: 'object',
    required: ['id', 'postId', 'authorId', 'parentId', 'body', 'likeCount', 'editedAt', 'createdAt', 'author', 'images', 'likes', 'viewerCanManage'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      postId: { type: 'string', format: 'uuid' },
      authorId: { type: 'string', format: 'uuid' },
      parentId: nullableString,
      body: { type: 'string' },
      likeCount: { type: 'integer', minimum: 0 },
      editedAt: nullableDateTime,
      createdAt: dateTime,
      author: publicUserRef,
      images: { type: 'array', items: { $ref: '#/components/schemas/CommentImageResponse' } },
      likes: {
        type: 'array',
        description: 'At most the current viewer\'s like record.',
        items: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', format: 'uuid' } } },
      },
      viewerCanManage: { type: 'boolean' },
    },
  },
  CommentResponse: {
    type: 'object',
    required: ['id', 'postId', 'authorId', 'parentId', 'body', 'likeCount', 'editedAt', 'createdAt', 'author', 'images', 'replies', 'likes', 'viewerCanManage', 'replyCount', 'nextReplyCursor'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      postId: { type: 'string', format: 'uuid' },
      authorId: { type: 'string', format: 'uuid' },
      parentId: nullableString,
      body: { type: 'string' },
      likeCount: { type: 'integer' },
      editedAt: nullableDateTime,
      createdAt: dateTime,
      author: publicUserRef,
      images: { type: 'array', items: { $ref: '#/components/schemas/CommentImageResponse' } },
      replies: { type: 'array', items: { $ref: '#/components/schemas/CommentReplyResponse' } },
      likes: {
        type: 'array',
        description: 'At most the current viewer\'s like record.',
        items: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } } },
      },
      viewerCanManage: { type: 'boolean' },
      replyCount: { type: 'integer', minimum: 0 },
      nextReplyCursor: { type: 'integer', minimum: 0, nullable: true },
    },
  },
  FeedPostResponse: {
    type: 'object',
    required: ['id', 'profileOwnerId', 'groupId', 'text', 'visibility', 'isAnonymous', 'createdAt', 'updatedAt', 'editedAt', 'pinnedAt', 'viewCount', 'likeCount', 'commentCount', 'repostCount', 'activityId', 'author', 'profileOwner', 'images', 'hashtags', 'likes', 'saves', 'buddySessionRecap'],
    description: 'Public post presentation. Anonymous posts omit authorId and return author as null.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      authorId: { type: 'string', format: 'uuid', description: 'Omitted for anonymous posts.' },
      profileOwnerId: nullableString,
      groupId: nullableString,
      text: nullableString,
      visibility: { type: 'string', enum: ['public', 'followers', 'mutuals', 'close_buddies', 'only_me'] },
      isAnonymous: { type: 'boolean' },
      anonymous: { type: 'boolean' },
      viewerCanManage: { type: 'boolean' },
      createdAt: dateTime,
      updatedAt: dateTime,
      editedAt: nullableDateTime,
      pinnedAt: nullableDateTime,
      viewCount: { type: 'integer' },
      likeCount: { type: 'integer' },
      commentCount: { type: 'integer' },
      repostCount: { type: 'integer' },
      author: { allOf: [publicUserRef], nullable: true },
      profileOwner: { allOf: [publicUserRef], nullable: true },
      images: { type: 'array', items: { $ref: '#/components/schemas/PostImageResponse' } },
      hashtags: {
        type: 'array',
        items: {
          type: 'object',
          required: ['hashtag'],
          properties: {
            hashtag: {
              type: 'object',
              required: ['id', 'name'],
              properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } },
            },
          },
        },
      },
      taggedUsers: {
        type: 'array',
        items: {
          type: 'object',
          required: ['userId', 'user'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
            user: publicUserRef,
          },
        },
      },
      comments: { type: 'array', items: { $ref: '#/components/schemas/CommentResponse' } },
      likes: {
        type: 'array',
        description: 'At most the current viewer\'s like record.',
        items: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', format: 'uuid' } } },
      },
      saves: {
        type: 'array',
        description: 'At most the current viewer\'s save record.',
        items: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', format: 'uuid' } } },
      },
      activity: { allOf: [{ $ref: '#/components/schemas/ActivityResponse' }], nullable: true },
      buddySessionRecap: { allOf: [{ $ref: '#/components/schemas/PublicBuddySessionRecapResponse' }], nullable: true },
      group: {
        type: 'object',
        nullable: true,
        required: ['id', 'name', 'slug', 'visibility'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          visibility: { type: 'string', enum: ['public', 'private'] },
        },
      },
      feedItemId: { type: 'string' },
      feedItemType: { type: 'string', enum: ['post', 'repost'] },
      repostId: { type: 'string' },
      repostText: nullableString,
      repostedAt: dateTime,
      repostedBy: publicUserRef,
      repostedByUsers: { type: 'array', items: publicUserRef },
      repostLikeCount: { type: 'integer' },
      repostLikes: { type: 'array', items: { type: 'object', properties: { userId: { type: 'string' } } } },
      activityId: nullableString,
    },
  },
  FeedResponse: { type: 'array', items: feedPostRef },
  MeResponse: {
    type: 'object',
    required: ['id', 'email', 'displayName', 'username', 'usernameFinalized', 'bio', 'profileImageUrl', 'coverImageUrl', 'gender', 'dateOfBirth', 'activityPersona', 'activityPersonas', 'profileVisibility', 'defaultPostVisibility', 'hideProfileBadges', 'hiddenProfileBadgeCodes', 'badges', 'verified', 'chatPublicKey', 'createdAt', 'availableProfileBadges', 'onboardingComplete', '_count'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      displayName: nullableString,
      username: { type: 'string' },
      usernameFinalized: { type: 'boolean' },
      bio: nullableString,
      profileImageUrl: nullableString,
      coverImageUrl: nullableString,
      gender: { type: 'string', enum: ['female', 'male', 'non_binary', 'prefer_not_to_say', 'other'], nullable: true },
      dateOfBirth: nullableDateTime,
      activityPersona: nullableActivityPersona,
      activityPersonas: { type: 'array', items: activityPersona },
      profileVisibility: { type: 'string', enum: ['public', 'followers', 'mutuals', 'close_buddies', 'private'] },
      defaultPostVisibility: postVisibility,
      hideProfileBadges: { type: 'boolean' },
      hiddenProfileBadgeCodes: { type: 'array', items: { type: 'string' } },
      badges: {
        type: 'array',
        items: {
          type: 'object',
          required: ['code', 'label', 'iconUrl'],
          properties: {
            code: { type: 'string' },
            label: { type: 'string' },
            description: nullableString,
            iconUrl: { type: 'string' },
          },
        },
      },
      verified: { type: 'boolean' },
      chatPublicKey: nullableString,
      createdAt: dateTime,
      onboardingComplete: { type: 'boolean' },
      availableProfileBadges: {
        type: 'array',
        items: {
          type: 'object',
          required: ['code', 'label', 'iconUrl'],
          properties: {
            code: { type: 'string' },
            label: { type: 'string' },
            description: nullableString,
            iconUrl: { type: 'string' },
          },
        },
      },
      _count: {
        type: 'object',
        required: ['followers', 'following'],
        properties: {
          followers: { type: 'integer', minimum: 0 },
          following: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  ProfileResponse: {
    allOf: [
      publicUserRef,
      {
        type: 'object',
        required: ['id', 'posts', 'reposts', 'isPrivateLocked', 'isBlockedByMe', 'hasBlockedMe'],
        properties: {
          posts: { type: 'array', items: feedPostRef },
          reposts: { type: 'array', items: { $ref: '#/components/schemas/RepostResponse' } },
          isFollowing: { type: 'boolean' },
          followsMe: { type: 'boolean' },
          isCloseBuddy: { type: 'boolean' },
          isPrivateLocked: { type: 'boolean' },
          isBlockedByMe: { type: 'boolean' },
          hasBlockedMe: { type: 'boolean' },
          followRequestStatus: { type: 'string', enum: ['pending', 'accepted', 'declined'], nullable: true },
          _count: {
            type: 'object',
            required: ['followers', 'following'],
            properties: {
              followers: { type: 'integer', minimum: 0 },
              following: { type: 'integer', minimum: 0 },
              posts: { type: 'integer', minimum: 0 },
              comments: { type: 'integer', minimum: 0 },
              likes: { type: 'integer', minimum: 0 },
              groupMembers: { type: 'integer', minimum: 0 },
              reposts: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    ],
  },
  ThemeResponse: {
    type: 'object',
    required: ['userId', 'theme', 'mapVisual', 'updatedAt'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      theme: { type: 'string', enum: ['system', 'light', 'dark'] },
      mapVisual: { type: 'string', enum: ['system', 'streets', 'light', 'dark', 'satellite'] },
      updatedAt: dateTime,
    },
  },
};

/** Operations already migrated to generated response types in the client. */
export const FRONTEND_JSON_CONTRACTS: readonly JsonContract[] = [
  { path: '/auth/register', method: 'post', status: '201', schema: 'AuthTokensResponse' },
  { path: '/auth/login', method: 'post', status: '200', schema: 'AuthTokensResponse' },
  { path: '/auth/google', method: 'post', status: '200', schema: 'AuthTokensResponse' },
  { path: '/auth/onboarding/complete', method: 'post', status: '200', schema: 'AuthTokensResponse' },
  { path: '/auth/refresh', method: 'post', status: '200', schema: 'AuthTokensResponse' },
  { path: '/auth/forgot-password', method: 'post', status: '200', schema: 'OkResponse' },
  { path: '/auth/reset-password', method: 'post', status: '200', schema: 'OkResponse' },
  { path: '/posts', method: 'post', status: '201', schema: 'FeedPostResponse' },
  { path: '/posts', method: 'get', status: '200', schema: 'FeedResponse' },
  { path: '/posts/{id}', method: 'get', status: '200', schema: 'FeedPostResponse' },
  { path: '/posts/{id}', method: 'patch', status: '200', schema: 'FeedPostResponse' },
  { path: '/feed', method: 'get', status: '200', schema: 'FeedResponse' },
  { path: '/groups', method: 'post', status: '201', schema: 'GroupResponse' },
  { path: '/groups', method: 'get', status: '200', schema: 'GroupListResponse' },
  { path: '/groups/mine', method: 'get', status: '200', schema: 'GroupListResponse' },
  { path: '/groups/invite/accept', method: 'post', status: '201', schema: 'GroupResponse' },
  { path: '/groups/{slug}', method: 'get', status: '200', schema: 'GroupResponse' },
  { path: '/users/me', method: 'get', status: '200', schema: 'MeResponse' },
  { path: '/users/me', method: 'patch', status: '200', schema: 'MeResponse' },
  { path: '/users/{id}', method: 'get', status: '200', schema: 'ProfileResponse' },
  { path: '/theme', method: 'get', status: '200', schema: 'ThemeResponse' },
  { path: '/theme', method: 'put', status: '200', schema: 'ThemeResponse' },
] as const;

export const FRONTEND_REQUEST_CONTRACTS: readonly RequestContract[] = [
  { path: '/auth/register', method: 'post', schema: 'RegisterDto', required: true },
  { path: '/auth/login', method: 'post', schema: 'LoginDto', required: true },
  { path: '/auth/google', method: 'post', schema: 'GoogleLoginDto', required: true },
  { path: '/auth/onboarding/complete', method: 'post', schema: 'CompleteOnboardingDto', required: true },
  { path: '/auth/refresh', method: 'post', schema: 'RefreshDto', required: false },
  { path: '/auth/logout', method: 'post', schema: 'LogoutDto', required: false },
  { path: '/auth/forgot-password', method: 'post', schema: 'ForgotPasswordDto', required: true },
  { path: '/auth/reset-password', method: 'post', schema: 'ResetPasswordDto', required: true },
  { path: '/posts', method: 'post', schema: 'CreatePostDto', required: true },
  { path: '/theme', method: 'put', schema: 'UpdateThemeDto', required: true },
  { path: '/groups/invite/accept', method: 'post', schema: 'AcceptGroupInviteCodeDto', required: true },
] as const;

const PUBLIC_OPERATIONS = new Set([
  'GET /health',
  'GET /health/live',
  'GET /health/ready',
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/google',
  'POST /auth/refresh',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
]);

export function applyClientContract(document: OpenAPIObject) {
  assertNoDuplicateContractSchemas();
  document.components ??= {};
  document.components.schemas = {
    ...(document.components.schemas ?? {}),
    ...CLIENT_RESPONSE_SCHEMAS,
    ...AUTHORITATIVE_CONTRACT_SCHEMAS,
  };

  for (const contract of FRONTEND_REQUEST_CONTRACTS) {
    const operation = operationAt(document, contract.path, contract.method);
    if (!operation) continue;
    operation.requestBody = {
      required: contract.required ?? true,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${contract.schema}` },
        },
      },
    };
  }

  for (const contract of FRONTEND_JSON_CONTRACTS) {
    const operation = operationAt(document, contract.path, contract.method);
    if (!operation) continue;
    operation.responses[contract.status] = {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${contract.schema}` },
        },
      },
    };
  }

  for (const contract of FRONTEND_OPERATION_CONTRACTS) {
    const operation = operationAt(document, contract.path, contract.method);
    if (!operation) continue;
    (operation as OperationObject & { 'x-swebudd-frontend-consumed'?: boolean })['x-swebudd-frontend-consumed'] = true;
    if (contract.request) {
      const mediaType = contract.request.mediaType ?? 'application/json';
      operation.requestBody = {
        required: contract.request.required ?? true,
        content: {
          [mediaType]: {
            schema: { $ref: `#/components/schemas/${contract.request.schema}` },
          },
        },
      };
    }
    const successStatuses = Object.keys(operation.responses ?? {}).filter((status) => /^2\d\d$/.test(status));
    if (contract.responseSchema === null) {
      for (const status of successStatuses) delete operation.responses[status];
      operation.responses['204'] = { description: 'Successful response with no content' };
    } else {
      for (const status of successStatuses) {
        operation.responses[status] = {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${contract.responseSchema}` },
            },
          },
        };
      }
    }
  }

  for (const contract of BACKEND_ONLY_OPERATION_CONTRACTS) {
    const operation = operationAt(document, contract.path, contract.method);
    if (!operation) continue;
    if (contract.request) {
      const mediaType = contract.request.mediaType ?? 'application/json';
      operation.requestBody = {
        required: contract.request.required ?? true,
        content: {
          [mediaType]: {
            schema: { $ref: `#/components/schemas/${contract.request.schema}` },
          },
        },
      };
    }
    const successStatuses = Object.keys(operation.responses ?? {}).filter((status) => /^2\d\d$/.test(status));
    if (contract.responseSchema === null) {
      for (const status of successStatuses) delete operation.responses[status];
      operation.responses['204'] = { description: 'Successful response with no content' };
    } else {
      for (const status of successStatuses) {
        operation.responses[status] = {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${contract.responseSchema}` },
            },
          },
        };
      }
    }
  }

  const logout = operationAt(document, '/auth/logout', 'post');
  if (logout) {
    logout.responses['204'] = { description: 'Session revoked' };
  }

  const feed = operationAt(document, '/feed', 'get');
  for (const parameter of feed?.parameters ?? []) {
    if (!('$ref' in parameter) && parameter.in === 'query') parameter.required = false;
  }

  setOperationParameter(document, '/activities', 'get', {
    name: 'take', in: 'query', required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
  });
  setOperationParameter(document, '/activities/stats', 'get', {
    name: 'window', in: 'query', required: false,
    schema: { type: 'string', enum: ['week', 'month', 'year', 'all'] },
  });
  for (const parameter of [
    { name: 'q', in: 'query', required: false, schema: { type: 'string', maxLength: 120 } },
    { name: 'type', in: 'query', required: false, schema: { type: 'string', enum: ['gifs', 'stickers'] } },
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
  ] satisfies ParameterObject[]) {
    setOperationParameter(document, '/klipy/search', 'get', parameter);
  }
  for (const parameter of [
    { name: 'take', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
    { name: 'cursor', in: 'query', required: false, schema: { type: 'integer', minimum: 0 } },
    { name: 'hashtag', in: 'query', required: false, schema: { type: 'string', maxLength: 500 } },
    { name: 'sort', in: 'query', required: false, schema: { type: 'string', enum: ['relevance', 'latest', 'trending', 'unseen', 'time'] } },
    { name: 'followingOnly', in: 'query', required: false, schema: { type: 'string', enum: ['true', 'false'] } },
    { name: 'tab', in: 'query', required: false, schema: { type: 'string', enum: ['for-you', 'following', 'saved'] } },
    { name: 'timezone', in: 'query', required: false, schema: { type: 'string', maxLength: 100 } },
  ] satisfies ParameterObject[]) {
    setOperationParameter(document, '/feed', 'get', parameter);
  }
  const queryContracts: Array<readonly [string, HttpMethod, ParameterObject[]]> = [
    ['/feed/hashtags', 'get', [
      { name: 'q', in: 'query', required: false, schema: { type: 'string', maxLength: 120 } },
    ]],
    ['/groups', 'get', [
      { name: 'take', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 100_000 } },
      { name: 'discover', in: 'query', required: false, schema: { type: 'boolean' } },
    ]],
    ['/groups/mine', 'get', [
      { name: 'take', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 100_000 } },
    ]],
    ['/groups/{slug}', 'get', [
      { name: 'summary', in: 'query', required: false, schema: { type: 'boolean' } },
    ]],
    ['/groups/{id}/invite-candidates', 'get', [
      { name: 'q', in: 'query', required: false, schema: { type: 'string', maxLength: 120 } },
    ]],
    ['/groups/{id}/posts', 'get', [
      { name: 'sort', in: 'query', required: false, schema: { type: 'string', enum: ['latest', 'trending', 'most-commented', 'oldest'] } },
      { name: 'hashtag', in: 'query', required: false, schema: { type: 'string', maxLength: 500 } },
      { name: 'q', in: 'query', required: false, schema: { type: 'string', maxLength: 120 } },
      { name: 'mine', in: 'query', required: false, schema: { type: 'boolean' } },
      { name: 'take', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 100_000 } },
      { name: 'timezone', in: 'query', required: false, schema: { type: 'string', maxLength: 100 } },
    ]],
    ['/posts', 'get', [
      { name: 'take', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
    ]],
    ['/posts/{id}/comments', 'get', [
      { name: 'sort', in: 'query', required: false, schema: { type: 'string', enum: ['top', 'newest', 'oldest'] } },
      { name: 'take', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 100_000 } },
    ]],
    ['/posts/{postId}/comments/{commentId}/replies', 'get', [
      { name: 'take', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 100_000 } },
    ]],
    ['/actsnaps/active-authors', 'get', [
      { name: 'userIds', in: 'query', required: false, style: 'form', explode: false, schema: { type: 'array', maxItems: 100, items: { type: 'string', format: 'uuid' } } },
    ]],
    ['/buddy/nearby', 'get', [
      { name: 'activity', in: 'query', required: false, schema: { type: 'string', maxLength: 60 } },
      { name: 'roomId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
      { name: 'lat', in: 'query', required: true, schema: { type: 'number', minimum: -90, maximum: 90 } },
      { name: 'lng', in: 'query', required: true, schema: { type: 'number', minimum: -180, maximum: 180 } },
      { name: 'radiusKm', in: 'query', required: false, schema: { type: 'number', minimum: 0.1, maximum: 100 } },
      { name: 'take', in: 'query', required: false, schema: { type: 'number', minimum: 1, maximum: 100 } },
    ]],
    ['/buddy/discoverable', 'get', [
      { name: 'activity', in: 'query', required: false, schema: { type: 'string', maxLength: 60 } },
      { name: 'lat', in: 'query', required: true, schema: { type: 'number', minimum: -90, maximum: 90 } },
      { name: 'lng', in: 'query', required: true, schema: { type: 'number', minimum: -180, maximum: 180 } },
      { name: 'radiusKm', in: 'query', required: true, schema: { type: 'number', minimum: 0.1, maximum: 100 } },
      { name: 'take', in: 'query', required: false, schema: { type: 'number', minimum: 1, maximum: 500 } },
    ]],
    ['/buddy/rooms', 'get', [
      { name: 'scope', in: 'query', required: false, schema: { type: 'string', enum: ['public', 'group'] } },
      { name: 'groupId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
    ]],
    ['/buddy/recaps', 'get', [
      { name: 'groupId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
    ]],
    ['/buddy/rooms/{id}/invite-candidates', 'get', [
      { name: 'q', in: 'query', required: false, schema: { type: 'string', maxLength: 120 } },
    ]],
    ['/chat/search/messages', 'get', [
      { name: 'q', in: 'query', required: false, schema: { type: 'string', maxLength: 120 } },
    ]],
    ['/chat/conversations/{peerId}', 'get', [
      { name: 'cursor', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
    ]],
    ['/chat/buddy-groups/{id}/messages', 'get', [
      { name: 'cursor', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
    ]],
    ['/users/me/following', 'get', [
      { name: 'nonFollowback', in: 'query', required: false, schema: { type: 'boolean' } },
    ]],
    ['/users', 'get', [
      { name: 'q', in: 'query', required: false, schema: { type: 'string', maxLength: 120 } },
      { name: 'take', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 100_000 } },
    ]],
    ['/users/me/search-history', 'get', [
      { name: 'take', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 1000 } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 1000 } },
    ]],
  ];
  for (const [path, method, parameters] of queryContracts) {
    for (const parameter of parameters) setOperationParameter(document, path, method, parameter);
  }
  for (const [path, method] of [
    ['/chat/messages/{id}/reactions', 'delete'],
    ['/buddy/rooms/{id}/messages/{messageId}/reactions', 'delete'],
  ] as const) {
    setOperationParameter(document, path, method, {
      name: 'emoji', in: 'query', required: true,
      schema: { type: 'string', minLength: 1, maxLength: 32 },
    });
  }
  for (const [path, method] of [
    ['/integrations/{provider}/oauth/start', 'get'],
    ['/integrations/{provider}', 'patch'],
    ['/integrations/{provider}', 'delete'],
  ] as const) {
    setOperationParameter(document, path, method, {
      name: 'provider', in: 'path', required: true,
      schema: { type: 'string', enum: ['strava', 'garmin'] },
    });
  }

  const nonUuidPathParameterNames = new Set(['slug', 'provider', 'code']);
  for (const [path, item] of Object.entries(document.paths)) {
    if (!item) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = item[method];
      if (!operation) continue;
      for (const parameter of operation.parameters ?? []) {
        if ('$ref' in parameter || parameter.in !== 'path' || nonUuidPathParameterNames.has(parameter.name)) continue;
        if (path.startsWith('/users/{id}') && parameter.name === 'id') {
          parameter.description = 'User UUID or username';
          parameter.schema = { type: 'string' };
          continue;
        }
        parameter.schema = { ...parameter.schema, type: 'string', format: 'uuid' };
      }
    }
  }

  for (const [path, item] of Object.entries(document.paths)) {
    if (!item) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = item[method];
      if (!operation) continue;
      const key = `${method.toUpperCase()} ${path}`;
      operation.security = PUBLIC_OPERATIONS.has(key) ? [] : [{ bearer: [] }];
      if (FRONTEND_OPERATION_CONTRACTS.some((contract) => contract.path === path && contract.method === method)) {
        const errorResponse = (description: string) => ({
          description,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } },
        });
        operation.responses['400'] ??= errorResponse('Invalid request');
        if (!PUBLIC_OPERATIONS.has(key)) operation.responses['401'] ??= errorResponse('Authentication required');
        operation.responses['403'] ??= errorResponse('Operation is not permitted');
        if (path.includes('{')) operation.responses['404'] ??= errorResponse('Resource not found');
        operation.responses['409'] ??= errorResponse('Request conflicts with current state');
        operation.responses['429'] ??= errorResponse('Rate limit exceeded');
        operation.responses['500'] ??= errorResponse('Unexpected server error');
      }
    }
  }
}

export function assertNoDuplicateContractSchemas(
  clientSchemas: Record<string, SchemaObject> = CLIENT_RESPONSE_SCHEMAS,
  authoritativeSchemas: Record<string, SchemaObject> = AUTHORITATIVE_CONTRACT_SCHEMAS,
) {
  const duplicateNames = Object.keys(clientSchemas).filter((name) => name in authoritativeSchemas);
  if (duplicateNames.length) {
    throw new Error(`OpenAPI contract schemas must have one owner; duplicate names: ${duplicateNames.join(', ')}`);
  }
}

export function operationAt(document: OpenAPIObject, path: string, method: HttpMethod): OperationObject | undefined {
  return document.paths[path]?.[method];
}

function setOperationParameter(
  document: OpenAPIObject,
  path: string,
  method: HttpMethod,
  parameter: ParameterObject,
) {
  const operation = operationAt(document, path, method);
  if (!operation) return;
  operation.parameters = [
    ...(operation.parameters ?? []).filter((current) => '$ref' in current || current.in !== parameter.in || current.name !== parameter.name),
    parameter,
  ];
}
