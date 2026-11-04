import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool, one, query } from './index.js';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SETTINGS = {
  business_hours: {
    // 0 = Sunday ... 6 = Saturday. Change to [0,1,2,3,4] for a Sunday–Thursday week.
    workdays: [1, 2, 3, 4, 5],
    start: '08:00',
    end: '17:00',
    holidays: [], // ['2026-12-25', ...]
  },
  email: {
    allowed_domains: [],          // e.g. ['yourcompany.com']; empty = accept any sender
    auto_create_requesters: true, // unknown senders become requester accounts
    send_acknowledgement: true,
    default_priority: 'medium',
  },
  tickets: {
    auto_close_days: 3, // resolved tickets close after N days without a reply
  },
};

export async function migrate() {
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  await query(sql);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await query('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }

  const defaults = [
    ['critical', 15, 240],
    ['high', 60, 480],
    ['medium', 240, 1440],
    ['low', 480, 2880],
  ];
  for (const [p, r, s] of defaults) {
    await query(
      'INSERT INTO sla_policies(priority, response_minutes, resolution_minutes) VALUES ($1,$2,$3) ON CONFLICT (priority) DO NOTHING',
      [p, r, s]
    );
  }

  const admins = await one("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
  if (admins.n === 0) {
    if (!config.admin.password || config.admin.password.length < 10) {
      throw new Error('Set ADMIN_PASSWORD (at least 10 characters) in .env to create the first administrator.');
    }
    const hash = await bcrypt.hash(config.admin.password, 12);
    await query(
      `INSERT INTO users(email, name, role, password_hash) VALUES ($1, 'Administrator', 'admin', $2)
       ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash`,
      [config.admin.email.toLowerCase(), hash]
    );
    const g = await one("INSERT INTO groups(name, description) VALUES ('IT Support', 'First-line support') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id");
    for (const [name, kw] of [
      ['Hardware', ['laptop', 'printer', 'monitor', 'keyboard', 'mouse', 'screen']],
      ['Software', ['install', 'license', 'outlook', 'excel', 'teams', 'application']],
      ['Network', ['wifi', 'vpn', 'internet', 'network', 'connection']],
      ['Access', ['password', 'login', 'locked', 'access', 'account', 'mfa']],
    ]) {
      await query('INSERT INTO categories(name, default_group_id, keywords) VALUES ($1,$2,$3)', [name, g.id, kw]);
    }
    console.log(`[migrate] Created admin ${config.admin.email} — change the password after first login.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => { console.log('[migrate] done'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
