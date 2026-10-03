import path from 'node:path';

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR ?? path.join(process.cwd(), '..', 'data'));

export const config = {
  dataDir,
  dbPath: env.DB_PATH ?? path.join(dataDir, 'yapp.db'),
  audioDir: env.AUDIO_DIR ?? path.join(dataDir, 'audio'),
  certDir: env.CERT_DIR ?? path.join(dataDir, 'certs'),
  migrationsDir: env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'drizzle'),
  passwordHash: env.APP_PASSWORD_HASH ?? '',
  voiceLabUrl: (env.VOICE_LAB_URL ?? 'http://localhost:8000').replace(/\/$/, ''),
  // Paths as seen by voice-lab (it mounts the same ./data volume, maybe at another path).
  voiceLabDataDir: env.VOICE_LAB_DATA_DIR ?? '/data',
  ollamaUrl: (env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, ''),
  ollamaModel: env.OLLAMA_MODEL ?? 'qwen3:8b',
  vapidSubject: env.VAPID_SUBJECT ?? 'mailto:yapp@example.com',
  httpsPort: Number(env.HTTPS_PUBLIC_PORT ?? env.PORT ?? 4321),
  sessionDays: 30,
};

/** Translate a path under our data dir to the path voice-lab sees. */
export function toVoiceLabPath(p: string): string {
  const rel = path.relative(config.dataDir, p);
  if (rel.startsWith('..')) return p;
  return path.posix.join(config.voiceLabDataDir, rel.split(path.sep).join('/'));
}
