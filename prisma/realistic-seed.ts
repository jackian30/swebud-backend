import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://swebud:swebud@localhost:5432/swebud?schema=public';
  console.log('DATABASE_URL not set; using local Docker default postgres://localhost:5432/swebud');
}

const prisma = new PrismaClient();

const PASSWORD = 'password123';
const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
const MANILA = { lat: 14.5995, lng: 120.9842 };

const firstNames = ['Mika', 'Jules', 'Nico', 'Ari', 'Bea', 'Rafi', 'Sam', 'Kai', 'Luna', 'Miggy', 'Iya', 'Theo', 'Gia', 'Paolo', 'Yna', 'Luis', 'Tala', 'Enzo', 'Mara', 'Ren', 'Sofia', 'Marco', 'Aya', 'Leo'];
const lastNames = ['Santos', 'Reyes', 'Cruz', 'Garcia', 'Torres', 'Ramos', 'Dizon', 'Lim', 'Castro', 'Mendoza', 'Flores', 'Tan', 'Villanueva', 'Navarro', 'Aquino', 'Bautista'];
const neighborhoods = ['BGC', 'Makati', 'Ortigas', 'QC Circle', 'UP Diliman', 'Marikina Riverbanks', 'MOA', 'Rockwell', 'Pasig', 'Alabang', 'Binondo', 'Intramuros'];
const tags = ['running', 'legday', 'mobility', 'mealprep', 'cycling', 'yoga', 'boxing', 'hyrox', 'trailrun', 'recovery', 'strength', 'zone2', 'pilates', 'basketball', 'swim', 'swebud'];
const workoutTypes = ['easy run', 'tempo session', 'push day', 'pull day', 'leg day', 'mobility flow', 'recovery walk', 'bike commute', 'boxing rounds', 'swim drills', 'meal prep', 'group run'];
const moods = ['felt smooth', 'almost died but worth it', 'kept it chill', 'finally back after a lazy week', 'needed this reset', 'legs are cooked', 'solid but humbling', 'good sweat, better mood'];
const comments = [
  'Solid work 🫡', 'Pace is looking clean.', 'Need that route!', 'Bro this looks brutal 😂', 'Adding this to my next session.',
  'Strong finish!', 'How many sets?', 'That place gets packed after 6pm.', 'Respect the consistency.', 'See you next weekend?',
  'Recovery meal reveal pls.', 'This is the kind of chaos I support.', 'Form looks better than last week!', 'Okay coach 👀',
  'I need to stop skipping this.', 'Saved this for later.', 'Let’s run this route soon.', 'The caption is too real.', 'Big salute energy.',
];
const repostNotes = ['Need to try this.', 'This is the route.', 'Saving for Saturday crew.', 'Mood.', 'Everyone in the group should see this.', 'Clean session.', 'Stealing this workout.', 'No excuses after seeing this.'];

function rand(max: number) { return Math.floor(Math.random() * max); }
function one<T>(arr: T[]) { return arr[rand(arr.length)]; }
function many<T>(arr: T[], min: number, max: number) {
  const count = min + rand(max - min + 1);
  return [...arr].sort(() => Math.random() - 0.5).slice(0, count);
}
function recentDate(days: number) { return new Date(Date.now() - rand(days * 86400000)); }
function nearManila() {
  return {
    latitude: +(MANILA.lat + (Math.random() - 0.5) * 0.36).toFixed(6),
    longitude: +(MANILA.lng + (Math.random() - 0.5) * 0.36).toFixed(6),
  };
}
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 52); }
function sentence() {
  return one([
    `${one(workoutTypes)} at ${one(neighborhoods)} — ${one(moods)}.`,
    `${one(moods)} during ${one(workoutTypes)}. ${one(['Small win today.', 'Progress is progress.', 'Posting this for accountability.', 'Need more days like this.'])}`,
    `${one(['Morning', 'Lunch break', 'After-work', 'Late night'])} ${one(workoutTypes)} with ${one(['the crew', 'zero motivation', 'surprising energy', 'a new playlist'])}.`,
  ]);
}
function maybeLongText(i: number) {
  if (i % 37 !== 0) return sentence();
  return [sentence(), 'Full session notes:', 'Warmup felt stiff but opened up after ten minutes.', 'Main block was controlled, not all-out.', 'Last round got ugly, but that is honestly the point.', 'Reminder to hydrate and stop pretending coffee counts as water.'].join(' ');
}

async function main() {
  const userCount = Number(process.env.REALISTIC_SEED_USERS ?? 60);
  const postCount = Number(process.env.REALISTIC_SEED_POSTS ?? 360);
  const commentTarget = Number(process.env.REALISTIC_SEED_COMMENTS ?? 420);
  const saluteTarget = Number(process.env.REALISTIC_SEED_SALUTES ?? 260);
  const repostTarget = Number(process.env.REALISTIC_SEED_REPOSTS ?? 120);

  console.log(`realistic-seed-start run=${RUN_ID}`);
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const users: { id: string; username: string | null }[] = [];
  for (let i = 0; i < userCount; i += 1) {
    const first = one(firstNames);
    const last = one(lastNames);
    const username = `fit${first.toLowerCase()}${last.toLowerCase()}${i}`.replace(/[^a-z0-9]/g, '');
    const user = await prisma.user.upsert({
      where: { email: `real.user.${i + 1}@swebud.loc` },
      update: {
        displayName: `${first} ${last}`,
        username,
        bio: `${one(['Runner', 'Lifter', 'Cyclist', 'Weekend warrior', 'Mobility nerd', 'Trying to be consistent'])} around ${one(neighborhoods)}. ${one(['Coffee before cardio.', 'Slow progress still counts.', 'Always down for a group session.', 'Here for accountability.'])}`,
        profileImageUrl: `https://i.pravatar.cc/160?img=${(i % 70) + 1}`,
        coverImageUrl: `https://picsum.photos/seed/swebud-cover-${i}/1200/420`,
        ...nearManila(),
      },
      create: {
        email: `real.user.${i + 1}@swebud.loc`,
        passwordHash,
        displayName: `${first} ${last}`,
        username,
        bio: `${one(['Runner', 'Lifter', 'Cyclist', 'Weekend warrior', 'Mobility nerd', 'Trying to be consistent'])} around ${one(neighborhoods)}.`,
        profileImageUrl: `https://i.pravatar.cc/160?img=${(i % 70) + 1}`,
        coverImageUrl: `https://picsum.photos/seed/swebud-cover-${i}/1200/420`,
        ...nearManila(),
        theme: { create: { theme: one(['system', 'light', 'dark']) } },
      },
      select: { id: true, username: true },
    });
    users.push(user);
  }

  for (const user of users) {
    for (const target of many(users.filter((u) => u.id !== user.id), 5, Math.min(18, users.length - 1))) {
      await prisma.follow.upsert({
        where: { followerId_followingId: { followerId: user.id, followingId: target.id } },
        update: {},
        create: { followerId: user.id, followingId: target.id, createdAt: recentDate(45) },
      });
    }
  }

  const groupIdeas = ['Saturday Run Club', 'Makati Lifters', 'QC Mobility Lab', 'BGC Zone 2 Crew', 'Marikina Bike Train', 'Ortigas After Office', 'Meal Prep Buddies', 'Boxing Beginners'];
  const groups: { id: string; slug: string }[] = [];
  for (let i = 0; i < groupIdeas.length; i += 1) {
    const name = groupIdeas[i];
    const owner = one(users);
    const group = await prisma.group.upsert({
      where: { slug: `${slug(name)}-real` },
      update: { description: `${name}. ${one(['Beginner friendly.', 'No ego, just consistency.', 'Post your sessions and invite people.', 'Mostly around Metro Manila.'])}` },
      create: {
        name,
        slug: `${slug(name)}-real`,
        description: `${name}. ${one(['Beginner friendly.', 'No ego, just consistency.', 'Post your sessions and invite people.'])}`,
        visibility: i === 7 ? 'private' : 'public',
        inviteCode: `real${RUN_ID}${i}`,
        members: { create: { userId: owner.id, role: 'owner' } },
      },
      select: { id: true, slug: true },
    });
    groups.push(group);
    for (const member of many(users.filter((u) => u.id !== owner.id), 18, Math.min(42, users.length - 1))) {
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId: member.id } },
        update: {},
        create: { groupId: group.id, userId: member.id, joinedAt: recentDate(60) },
      });
    }
  }

  const posts: { id: string; authorId: string }[] = [];
  for (let i = 0; i < postCount; i += 1) {
    const author = one(users);
    const chosenTags = many(tags, 1, 4);
    const group = Math.random() < 0.35 ? one(groups) : null;
    const imageCount = i % 41 === 0 ? 7 + rand(3) : (Math.random() < 0.42 ? 1 + rand(3) : 0);
    const text = `${maybeLongText(i)} ${chosenTags.map((t) => `#${t}`).join(' ')}`.slice(0, 1000);
    const post = await prisma.post.create({
      data: {
        authorId: author.id,
        groupId: group?.id,
        text,
        ...nearManila(),
        viewCount: rand(2200),
        createdAt: recentDate(35),
        images: imageCount ? { create: Array.from({ length: imageCount }, (_, sortOrder) => ({ url: `https://picsum.photos/seed/real-${RUN_ID}-${i}-${sortOrder}/900/700`, alt: `${one(workoutTypes)} photo`, sortOrder })) } : undefined,
        hashtags: { create: chosenTags.map((name) => ({ hashtag: { connectOrCreate: { where: { name }, create: { name } } } })) },
      },
      select: { id: true, authorId: true },
    });
    posts.push(post);
  }

  let commentCount = 0;
  for (let i = 0; i < commentTarget; i += 1) {
    const post = one(posts);
    const author = one(users.filter((u) => u.id !== post.authorId));
    await prisma.comment.create({ data: { postId: post.id, authorId: author.id, body: one(comments), createdAt: recentDate(20) } });
    await prisma.post.update({ where: { id: post.id }, data: { commentCount: { increment: 1 } } });
    commentCount += 1;
  }

  let saluteCount = 0;
  for (let i = 0; saluteCount < saluteTarget && i < saluteTarget * 20; i += 1) {
    const post = one(posts);
    const user = one(users.filter((u) => u.id !== post.authorId));
    const ok = await prisma.postLike.create({ data: { postId: post.id, userId: user.id, createdAt: recentDate(18) } }).then(() => true).catch(() => false);
    if (ok) {
      await prisma.post.update({ where: { id: post.id }, data: { likeCount: { increment: 1 } } });
      saluteCount += 1;
    }
  }

  let repostCount = 0;
  for (let i = 0; repostCount < repostTarget && i < repostTarget * 20; i += 1) {
    const post = one(posts);
    const user = one(users.filter((u) => u.id !== post.authorId));
    const ok = await prisma.repost.create({ data: { postId: post.id, userId: user.id, text: one(repostNotes), createdAt: recentDate(15) } }).then(() => true).catch(() => false);
    if (ok) repostCount += 1;
  }

  for (let i = 0; i < 80; i += 1) {
    const sender = one(users);
    const recipient = one(users.filter((u) => u.id !== sender.id));
    await prisma.message.create({ data: { senderId: sender.id, recipientId: recipient.id, body: one(['Training later?', 'Saw your post. Solid work.', 'Can you share that route?', 'Want to join Saturday?', 'What app do you use for tracking?']), createdAt: recentDate(14) } });
  }

  const total = posts.length + commentCount + saluteCount + repostCount;
  console.log(`realistic-seed-ok users=${users.length} groups=${groups.length} posts=${posts.length} comments=${commentCount} salutes=${saluteCount} reposts=${repostCount} totalActivities=${total}`);
  console.log('sample-login real.user.1@swebud.loc / password123');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
