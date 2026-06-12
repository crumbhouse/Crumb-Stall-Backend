import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootEnvPath = resolve(process.cwd(), '..', '.env');
const localEnvPath = resolve(process.cwd(), '.env');

if (existsSync(rootEnvPath)) {
  config({ path: rootEnvPath });
}

if (existsSync(localEnvPath)) {
  config({ path: localEnvPath, override: true });
}
