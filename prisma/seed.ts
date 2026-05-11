import { faker } from '@faker-js/faker';
import { PrismaClient, ThemePreference, GroupRole, MessageRequestStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PASSWORD = 'password';
const USER_COUNT = Number(process.env.SEED_USERS ?? 40);
const POST_COUNT = Number(process.env.SEED_POSTS ?? 180);
const GROUP_COUNT = Number(process.env.SEED_GROUPS ?? 12);
const MANILA = { lat: 14.5995, lng: 120.9842 };
const TAGS = ['running', 'gym', 'cycling', 'yoga', 'hiit', 'legday', 'mealprep', 'marathon', 'strength', 'mobility', 'filterme', 'swebud'];

function nearManila() {
  return {
    latitude: Number(faker.location.latitude({ min: MANILA.lat - 0.18, max: MANILA.lat + 0.18, precision: 6 })),
    longitude: Number(faker.location.longitude({ min: MANILA.lng - 0.18, max: MANILA.lng + 0.18, precision: 6 })),
  };
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 54);
}

function sample<T>(items: T[], count: number) {
  return faker.helpers.arrayElements(items, Math.min(count, items.length));
}

async function main() {
  console.log(`🌱 Seeding SweBud dev data: ${USER_COUNT} users, ${POST_COUNT} posts, ${GROUP_COUNT} groups`);
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await prisma.role.upsert({
    where: { key: 'admin' },
    update: { name: 'Admin', description: 'Full administrative access.' },
    create: { key: 'admin', name: 'Admin', description: 'Full administrative access.' },
  });
  await prisma.role.upsert({
    where: { key: 'user' },
    update: { name: 'Users', description: 'Default application user access.' },
    create: { key: 'user', name: 'Users', description: 'Default application user access.' },
  });

  const users = [];
  const admin = await prisma.user.upsert({
    where: { email: 'christopher.ian30.cir@gmail.com' },
    update: {
      username: 'christopherian30cir',
      displayName: 'Christopher Ian',
      roles: { deleteMany: {}, create: [{ role: { connect: { key: 'admin' } } }, { role: { connect: { key: 'user' } } }] },
    },
    create: {
      email: 'christopher.ian30.cir@gmail.com',
      username: 'christopherian30cir',
      passwordHash,
      displayName: 'Christopher Ian',
      legalConsentAt: new Date(),
      dataConsentAt: new Date(),
      dateOfBirth: new Date('1995-05-11T00:00:00.000Z'),
      roles: { create: [{ role: { connect: { key: 'admin' } } }, { role: { connect: { key: 'user' } } }] },
      theme: { create: { theme: ThemePreference.system } },
    },
  });
  users.push(admin);

  for (let i = 0; i < USER_COUNT; i += 1) {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    const loc = nearManila();
    const username = `seed${first}${last}${i + 1}`.toLowerCase().replace(/[^a-z0-9._-]/g, '');
    users.push(await prisma.user.upsert({
      where: { email: `seed.user.${i + 1}@swebud.loc` },
      update: {
        username,
        displayName: `${first} ${last}`,
        bio: faker.helpers.arrayElement([
          `Training for ${faker.helpers.arrayElement(['a 10K', 'hyrox', 'stronger legs', 'better endurance'])}.`,
          `${faker.helpers.arrayElement(['Runner', 'Cyclist', 'Lifter', 'Weekend warrior'])} around Metro Manila.`,
          faker.person.bio(),
        ]),
        profileImageUrl: faker.image.avatar(),
        ...loc,
        roles: { deleteMany: {}, create: { role: { connect: { key: 'user' } } } },
      },
      create: {
        email: `seed.user.${i + 1}@swebud.loc`,
        username,
        passwordHash,
        displayName: `${first} ${last}`,
        bio: `${faker.helpers.arrayElement(['Runner', 'Lifter', 'Cyclist', 'Yoga enjoyer'])}. ${faker.lorem.sentence()}`,
        profileImageUrl: faker.image.avatar(),
        ...loc,
        roles: { create: { role: { connect: { key: 'user' } } } },
        theme: { create: { theme: faker.helpers.arrayElement(Object.values(ThemePreference)) } },
      },
    }));
  }

  for (const user of users) {
    const targets = sample(users.filter((u) => u.id !== user.id), faker.number.int({ min: 4, max: 14 }));
    for (const target of targets) {
      await prisma.follow.upsert({
        where: { followerId_followingId: { followerId: user.id, followingId: target.id } },
        update: {},
        create: { followerId: user.id, followingId: target.id, createdAt: faker.date.recent({ days: 25 }) },
      });
    }
  }

  const groups = [];
  for (let i = 0; i < GROUP_COUNT; i += 1) {
    const baseName = faker.helpers.arrayElement([
      `${faker.location.city()} Runners`,
      `${faker.word.adjective()} Strength Club`,
      `${faker.color.human()} Cycling Crew`,
      `${faker.person.firstName()}'s Mobility Circle`,
    ]);
    const slug = `${slugify(baseName)}-${i + 1}`;
    const owner = faker.helpers.arrayElement(users);
    const group = await prisma.group.upsert({
      where: { slug },
      update: { name: baseName, description: faker.lorem.sentence() },
      create: {
        name: baseName,
        slug,
        description: faker.lorem.sentence(),
        members: { create: { userId: owner.id, role: GroupRole.owner } },
      },
    });
    groups.push(group);

    for (const member of sample(users.filter((u) => u.id !== owner.id), faker.number.int({ min: 8, max: 24 }))) {
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId: member.id } },
        update: {},
        create: { groupId: group.id, userId: member.id, role: GroupRole.member, joinedAt: faker.date.recent({ days: 45 }) },
      });
    }
  }

  for (let i = 0; i < POST_COUNT; i += 1) {
    const author = faker.helpers.arrayElement(users);
    const loc = nearManila();
    const tags = sample(TAGS, faker.number.int({ min: 1, max: 4 }));
    const text = `${faker.helpers.arrayElement([
      'Crushed the workout today',
      'Easy miles, good vibes',
      'New PR attempt soon',
      'Recovery day but still moving',
      'Post-work salute session',
    ])}. ${faker.lorem.sentence()} ${tags.map((t) => `#${t}`).join(' ')}`;
    const imageCount = faker.number.int({ min: 0, max: 3 });
    const post = await prisma.post.create({
      data: {
        authorId: author.id,
        text,
        ...loc,
        viewCount: faker.number.int({ min: 0, max: 500 }),
        createdAt: faker.date.recent({ days: 30 }),
        images: {
          create: Array.from({ length: imageCount }, (_, sortOrder) => ({
            url: `https://picsum.photos/seed/swebud-${i}-${sortOrder}/900/700`,
            alt: faker.helpers.arrayElement(['Workout photo', 'Training snapshot', 'Salute check']),
            sortOrder,
          })),
        },
        hashtags: {
          create: tags.map((name) => ({ hashtag: { connectOrCreate: { where: { name }, create: { name } } } })),
        },
      },
    });

    const likers = sample(users.filter((u) => u.id !== author.id), faker.number.int({ min: 0, max: 18 }));
    for (const liker of likers) await prisma.postLike.create({ data: { postId: post.id, userId: liker.id, createdAt: faker.date.recent({ days: 15 }) } }).catch(() => null);
    const commenters = sample(users.filter((u) => u.id !== author.id), faker.number.int({ min: 0, max: 6 }));
    for (const commenter of commenters) {
      await prisma.comment.create({ data: { postId: post.id, authorId: commenter.id, body: faker.helpers.arrayElement(['Nice work 💪', 'Solid pace!', 'Let’s go!', 'How was the route?', faker.lorem.sentence()]), createdAt: faker.date.recent({ days: 12 }) } });
    }
    await prisma.post.update({ where: { id: post.id }, data: { likeCount: likers.length, commentCount: commenters.length } });
  }

  for (let i = 0; i < 80; i += 1) {
    const [sender, recipient] = sample(users, 2);
    await prisma.message.create({ data: { senderId: sender.id, recipientId: recipient.id, body: faker.helpers.arrayElement(['Training today?', 'Want to join the group run?', 'Nice post earlier!', faker.lorem.sentence()]), createdAt: faker.date.recent({ days: 20 }) } });
  }

  for (let i = 0; i < 30; i += 1) {
    const [sender, recipient] = sample(users, 2);
    await prisma.messageRequest.create({ data: { senderId: sender.id, recipientId: recipient.id, body: faker.helpers.arrayElement(['Want to train together?', 'Can I ask about your routine?', faker.lorem.sentence()]), status: faker.helpers.arrayElement(Object.values(MessageRequestStatus)), createdAt: faker.date.recent({ days: 20 }) } });
  }

  for (const group of groups) {
    const members = await prisma.groupMember.findMany({ where: { groupId: group.id }, select: { userId: true } });
    for (let i = 0; i < faker.number.int({ min: 4, max: 14 }); i += 1) {
      const sender = faker.helpers.arrayElement(members);
      await prisma.message.create({ data: { senderId: sender.userId, groupId: group.id, body: faker.helpers.arrayElement(['Meetup this weekend?', 'Drop your workout!', 'Great session team.', faker.lorem.sentence()]), createdAt: faker.date.recent({ days: 14 }) } });
    }
  }

  const counts = await Promise.all([prisma.user.count(), prisma.post.count(), prisma.group.count(), prisma.follow.count(), prisma.messageRequest.count()]);
  console.log(`✅ Seed complete. Users=${counts[0]} Posts=${counts[1]} Groups=${counts[2]} Follows=${counts[3]} MessageRequests=${counts[4]}`);
  console.log(`Seed users password: ${PASSWORD}`);
}

main().finally(async () => prisma.$disconnect());
