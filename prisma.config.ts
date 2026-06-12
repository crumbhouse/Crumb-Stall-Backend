import { defineConfig, env } from 'prisma/config';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const configDir = __dirname;
const localEnvPath = resolve(configDir, '.env');
const rootEnvPath = resolve(configDir, '..', '.env');

if (existsSync(rootEnvPath)) {
  config({ path: rootEnvPath });
}

if (existsSync(localEnvPath)) {
  config({ path: localEnvPath, override: true });
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});
