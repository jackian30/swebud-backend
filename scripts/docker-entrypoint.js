const { spawn } = require('node:child_process');
const { deployMigrations, withMaxSearchParam } = require('./render-start');

function resolveCommand(args) {
  return args.length ? args : ['node', 'dist/src/main.js'];
}

function requireDatabaseUrls(env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for the running API');
  if (!env.DIRECT_URL) throw new Error('DIRECT_URL is required for production migrations');
}

async function main() {
  const env = { ...process.env };
  if (env.SWEBUDD_SKIP_ENTRYPOINT_MIGRATIONS !== 'true') {
    requireDatabaseUrls(env);
    await deployMigrations({
      ...env,
      DATABASE_URL: withMaxSearchParam(env.DIRECT_URL, 'connection_limit', 1),
    });
  }
  if (env.DATABASE_URL) {
    env.DATABASE_URL = withMaxSearchParam(env.DATABASE_URL, 'connection_limit', 3);
  }

  const [command, ...args] = resolveCommand(process.argv.slice(2));
  const child = spawn(command, args, { stdio: 'inherit', env });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('close', (code, signal) => {
    if (signal) {
      process.exit(signal === 'SIGINT' ? 130 : 143);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = { requireDatabaseUrls, resolveCommand };
