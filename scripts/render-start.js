const { spawn } = require('node:child_process');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withMaxSearchParam(value, key, maxValue) {
  try {
    const url = new URL(value);
    const currentValue = Number.parseInt(url.searchParams.get(key) || '', 10);
    if (!Number.isFinite(currentValue) || currentValue < 1 || currentValue > maxValue) {
      url.searchParams.set(key, String(maxValue));
    }
    return url.toString();
  } catch {
    return value;
  }
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function deployMigrations(env) {
  const attempts = Number.parseInt(env.PRISMA_MIGRATE_ATTEMPTS || '3', 10);
  const retrySeconds = Number.parseInt(env.PRISMA_MIGRATE_RETRY_SECONDS || '20', 10);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const code = await run('npx', ['prisma', 'migrate', 'deploy'], env);
    if (code === 0) return;
    if (attempt === attempts) {
      process.exit(code);
    }
    console.error(`Prisma migrate deploy failed with exit code ${code}; retrying in ${retrySeconds}s (${attempt}/${attempts})`);
    await sleep(retrySeconds * 1000);
  }
}

async function main() {
  if (!process.env.DIRECT_URL) {
    console.error('DIRECT_URL is required for Prisma migrations; use Supabase direct DB when IPv4 is available, otherwise use session pooler with connection_limit=1');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required for the running API');
    process.exit(1);
  }

  const migrationEnv = {
    ...process.env,
    DATABASE_URL: withMaxSearchParam(process.env.DIRECT_URL, 'connection_limit', 1),
  };
  await deployMigrations(migrationEnv);

  const appEnv = {
    ...process.env,
    DATABASE_URL: withMaxSearchParam(process.env.DATABASE_URL, 'connection_limit', 3),
  };
  const app = spawn('node', ['dist/src/main.js'], { stdio: 'inherit', env: appEnv });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => app.kill(signal));
  }
  app.on('close', (code, signal) => {
    if (signal) {
      process.exit(signal === 'SIGINT' ? 130 : 143);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { withMaxSearchParam };
