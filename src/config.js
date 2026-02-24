import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.planning-mcp');
const ENV_PATH = join(CONFIG_DIR, '.env');
const SA_KEY_PATH = join(CONFIG_DIR, 'serviceAccountKey.json');

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const content = readFileSync(ENV_PATH, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  }
  return env;
}

const env = loadEnv();

export const config = {
  configDir: CONFIG_DIR,
  serviceAccountPath: SA_KEY_PATH,
  databaseURL: env.FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL || '',
  defaultUserId: env.DEFAULT_USER_ID || process.env.DEFAULT_USER_ID || '',
  defaultUserName: env.DEFAULT_USER_NAME || process.env.DEFAULT_USER_NAME || '',
};

export function validateConfig() {
  const errors = [];
  if (!existsSync(SA_KEY_PATH)) {
    errors.push(`No se encontró serviceAccountKey.json en ${CONFIG_DIR}. Ejecuta: npm run setup`);
  }
  if (!config.databaseURL) {
    errors.push('FIREBASE_DATABASE_URL no configurada. Ejecuta: npm run setup');
  }
  return errors;
}
