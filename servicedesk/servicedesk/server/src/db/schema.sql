-- ServiceDesk schema (idempotent: safe to run on every start)

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'requester' CHECK (role IN ('admin','agent','requester')),
  password_hash TEXT,
  department    TEXT,
  phone         TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  parent_id        INT REFERENCES categories(id) ON DELETE SET NULL,
  default_group_id INT REFERENCES groups(id) ON DELETE SET NULL,
  keywords         TEXT[] NOT NULL DEFAULT '{}'   -- used to auto-categorise emails
);

CREATE TABLE IF NOT EXISTS sla_policies (
  id                 SERIAL PRIMARY KEY,
  priority           TEXT NOT NULL UNIQUE CHECK (priority IN ('critical','high','medium','low')),
  response_minutes   INT NOT NULL,
  resolution_minutes INT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id            SERIAL PRIMARY KEY,
  tag           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'laptop',
  status        TEXT NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_stock','in_use','repair','retired')),
  manufacturer  TEXT,
  model         TEXT,
  serial_number TEXT,
  assigned_to   INT REFERENCES users(id) ON DELETE SET NULL,
  location      TEXT,
  purchase_date DATE,
  warranty_end  DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id                  SERIAL PRIMARY KEY,
  type                TEXT NOT NULL DEFAULT 'incident' CHECK (type IN ('incident','request','problem','change')),
  subject             TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','open','pending','resolved','closed')),
  priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  source              TEXT NOT NULL DEFAULT 'portal' CHECK (source IN ('email','portal','agent')),
  category_id         INT REFERENCES categories(id) ON DELETE SET NULL,
  requester_id        INT NOT NULL REFERENCES users(id),
  assignee_id         INT REFERENCES users(id) ON DELETE SET NULL,
  group_id            INT REFERENCES groups(id) ON DELETE SET NULL,
  asset_id            INT REFERENCES assets(id) ON DELETE SET NULL,
  parent_id           INT REFERENCES tickets(id) ON DELETE SET NULL, -- incident -> problem link
  conversation_id     TEXT,             -- Microsoft Graph conversationId for threading
  -- SLA
  response_due        TIMESTAMPTZ,
  resolution_due      TIMESTAMPTZ,
  first_response_at   TIMESTAMPTZ,
  sla_paused_at       TIMESTAMPTZ,
  response_breached   BOOLEAN NOT NULL DEFAULT FALSE,
  resolution_breached BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at         TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  -- Change management
  risk                TEXT CHECK (risk IN ('low','medium','high')),
  planned_start       TIMESTAMPTZ,
  planned_end         TIMESTAMPTZ,
  implementation_plan TEXT,
  backout_plan        TEXT,
  approval_status     TEXT CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by         INT REFERENCES users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_status_idx       ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_assignee_idx     ON tickets(assignee_id);
CREATE INDEX IF NOT EXISTS tickets_requester_idx    ON tickets(requester_id);
CREATE INDEX IF NOT EXISTS tickets_conversation_idx ON tickets(conversation_id);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id          SERIAL PRIMARY KEY,
  ticket_id   INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id   INT REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  source      TEXT NOT NULL DEFAULT 'portal',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_ticket_idx ON ticket_comments(ticket_id);

CREATE TABLE IF NOT EXISTS attachments (
  id           SERIAL PRIMARY KEY,
  ticket_id    INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  comment_id   INT REFERENCES ticket_comments(id) ON DELETE SET NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   INT,
  storage_path TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_history (
  id         SERIAL PRIMARY KEY,
  ticket_id  INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id   INT REFERENCES users(id) ON DELETE SET NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS history_ticket_idx ON ticket_history(ticket_id);

-- Every processed email, for de-duplication and reply threading
CREATE TABLE IF NOT EXISTS email_messages (
  id                  SERIAL PRIMARY KEY,
  internet_message_id TEXT UNIQUE,
  ticket_id           INT REFERENCES tickets(id) ON DELETE SET NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('in','out')),
  from_address        TEXT,
  subject             TEXT,
  outcome             TEXT,   -- created / appended / skipped:<reason>
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_articles (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  published   BOOLEAN NOT NULL DEFAULT FALSE,
  author_id   INT REFERENCES users(id) ON DELETE SET NULL,
  views       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- One-time email sign-in links (stored hashed)
ALTER TABLE users ADD COLUMN IF NOT EXISTS magic_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS magic_token_expires TIMESTAMPTZ;
