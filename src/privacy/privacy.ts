import { ForbiddenException } from '@nestjs/common';
import { PostVisibility, Prisma, ProfileVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export function visibleAuthorWhere(viewerId: string): Prisma.UserWhereInput {
  return {
    AND: [
      {
        OR: [
          { id: viewerId },
          { profileVisibility: ProfileVisibility.public },
          { profileVisibility: { in: [ProfileVisibility.followers, ProfileVisibility.private] }, followers: { some: { followerId: viewerId } } },
          { profileVisibility: ProfileVisibility.private, followers: { some: { followerId: viewerId } } },
          {
            profileVisibility: ProfileVisibility.mutuals,
            AND: [
              { followers: { some: { followerId: viewerId } } },
              { following: { some: { followingId: viewerId } } },
            ],
          },
          { profileVisibility: ProfileVisibility.close_buddies, closeBuddies: { some: { buddyId: viewerId } } },
        ],
      },
      {
        OR: [
          { id: viewerId },
          { blocksSent: { none: { blockedId: viewerId } }, blocksReceived: { none: { blockerId: viewerId } } },
        ],
      },
    ],
  };
}

export function visiblePostWhere(viewerId: string): Prisma.PostWhereInput {
  return {
    AND: [
      {
        OR: [
          { groupId: null },
          { group: { visibility: 'public' } },
          { group: { visibility: 'private', members: { some: { userId: viewerId } } } },
        ],
      },
      { author: visibleAuthorWhere(viewerId) },
      { OR: [{ profileOwnerId: null }, { profileOwner: visibleAuthorWhere(viewerId) }] },
      {
        OR: [
          { authorId: viewerId },
          { visibility: PostVisibility.public },
          { visibility: PostVisibility.followers, author: { followers: { some: { followerId: viewerId } } } },
          {
            visibility: PostVisibility.mutuals,
            author: {
              AND: [
                { followers: { some: { followerId: viewerId } } },
                { following: { some: { followingId: viewerId } } },
              ],
            },
          },
          { visibility: PostVisibility.close_buddies, author: { closeBuddies: { some: { buddyId: viewerId } } } },
        ],
      },
    ],
  };
}

export function visibleStoryWhere(viewerId: string, now = new Date()): Prisma.StoryWhereInput {
  return {
    AND: [
      { expiresAt: { gt: now } },
      { author: visibleAuthorWhere(viewerId) },
      {
        OR: [
          { authorId: viewerId },
          { visibility: PostVisibility.public },
          { visibility: PostVisibility.followers, author: { followers: { some: { followerId: viewerId } } } },
          {
            visibility: PostVisibility.mutuals,
            author: {
              AND: [
                { followers: { some: { followerId: viewerId } } },
                { following: { some: { followingId: viewerId } } },
              ],
            },
          },
          { visibility: PostVisibility.close_buddies, author: { closeBuddies: { some: { buddyId: viewerId } } } },
        ],
      },
    ],
  };
}

export async function assertCanViewPost(prisma: PrismaService, viewerId: string, postId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, ...visiblePostWhere(viewerId) }, select: { id: true } });
  if (!post) throw new ForbiddenException('You cannot view this post');
}

export async function assertCanViewProfile(prisma: PrismaService, viewerId: string, userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, ...visibleAuthorWhere(viewerId) }, select: { id: true } });
  if (!user) throw new ForbiddenException('This profile is private');
}
