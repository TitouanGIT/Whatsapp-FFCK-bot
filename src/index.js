import 'dotenv/config';
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

import { ensureSchema, pingDb } from './db.js';
import { registerCommands } from './commands.js';
import fs from 'fs';

function resolveChromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/lib/chromium/chrome',
    '/opt/google/chrome/chrome'
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

const DATA_PATH = process.env.LOCAL_AUTH_DATA_PATH || '/app/auth';
console.log('LocalAuth dataPath =', DATA_PATH);

const execPath = resolveChromiumPath();
if (execPath) console.log('Chromium =', execPath);

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: DATA_PATH }),
  puppeteer: {
    executablePath: execPath || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote'
    ]
  }
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', async () => {
  console.log('✅ Bot prêt.');
  try {
    await pingDb();
    await ensureSchema();
    console.log('✅ DB Maria connectée & schéma OK');
  } catch (e) {
    console.error('❌ DB issue:', e?.message || e);
  }
});

registerCommands(client);
client.initialize().catch((e) => console.error('Init error:', e));
