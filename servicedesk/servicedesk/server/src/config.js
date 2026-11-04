// All configuration comes from environment variables (see .env.example).
const env = process.env;

function required(name, fallback) {
  const v = env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  port: Number(env.PORT || 8080),
  databaseUrl: required('DATABASE_URL', 'postgres://sd:sd@localhost:5432/servicedesk'),
  jwtSecret: required('JWT_SECRET', env.NODE_ENV === 'production' ? undefined : 'dev-only-secret-change-me'),
  publicUrl: (env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, ''),
  uploadDir: env.UPLOAD_DIR || './data/uploads',
  maxAttachmentMb: Number(env.MAX_ATTACHMENT_MB || 20),

  admin: {
    email: env.ADMIN_EMAIL || 'admin@example.com',
    password: env.ADMIN_PASSWORD || (env.NODE_ENV === 'production' ? '' : 'ChangeMe!123'),
  },

  // Microsoft 365 / Graph (email intake + outbound mail). Leave blank to disable.
  graph: {
    tenantId: env.M365_TENANT_ID || '',
    clientId: env.M365_CLIENT_ID || '',
    clientSecret: env.M365_CLIENT_SECRET || '',
    mailbox: (env.M365_MAILBOX || '').toLowerCase(), // e.g. support@yourcompany.com
    pollSeconds: Number(env.M365_POLL_SECONDS || 60),
    processedFolder: env.M365_PROCESSED_FOLDER || 'Processed',
  },
  get graphEnabled() {
    const g = this.graph;
    return Boolean(g.tenantId && g.clientId && g.clientSecret && g.mailbox);
  },
};
