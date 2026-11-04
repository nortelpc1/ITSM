# ServiceDesk

An internal IT service desk in the style of SolarWinds Service Desk / Web Help Desk. Employees email a shared
Microsoft 365 mailbox (or use the web portal), and IT works the tickets with SLAs, assets, change approvals and a
knowledge base.

## What it does

- **Email to ticket (Microsoft 365).** The shared mailbox is checked every minute through Microsoft Graph. A new email
  becomes a ticket and the sender gets their ticket number by email. Replies are threaded back to the same ticket by the
  `[Ticket #123]` subject tag, the Outlook conversation, or the reply headers. Only the new part of a reply is stored.
  Out-of-office replies, bounces, mailing lists and duplicates are ignored. Attachments are kept; inline signature images
  are not. Processed mail moves to a `Processed` folder.
- **Agent replies go out by email** from the support mailbox, so employees can work entirely from Outlook.
- **Ticket types:** incidents, service requests, problems (with linked incidents) and changes (risk, schedule,
  implementation and back-out plans, admin approval).
- **SLA engine:** response and resolution targets per priority, counted in business hours with holidays. Time in
  *Pending* doesn't count. Breaches are flagged every minute and the assignee is emailed.
- **Routing:** keyword-based categories send tickets to the right group automatically.
- **Assets:** inventory with owner, location, warranty and the tickets raised against each device.
- **Knowledge base:** articles are suggested while an employee types a new ticket.
- **Roles:** *admin* (everything), *agent* (works tickets), *employee* (sees only their own tickets).
- **Sign-in:** password, or a one-time link emailed to the user (no password needed for employees).
- **Audit history** on every ticket field change.

## Run it

Requirements: a Linux server (or VM) with Docker and Docker Compose, reachable by your staff over HTTPS.

```bash
cp .env.example .env
# edit .env: PUBLIC_URL, TZ, JWT_SECRET, DB_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD, and the M365_* values
docker compose up -d --build
docker compose logs -f app
```

Open `PUBLIC_URL` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Change the password under **Account**.

Put a reverse proxy with TLS in front of port 8080 (IIS, nginx, Caddy, or your load balancer). Sign-in tokens travel in
request headers, so the site must be served over HTTPS.

### First-day checklist

1. **Administration → People:** add your IT staff as *Agents* and put them in groups.
2. **Administration → Groups / Categories & routing:** adjust the default categories (Hardware, Software, Network,
   Access) and their keywords, and choose which group each one routes to.
3. **Administration → Business hours & email:** set working days (for a Sunday–Thursday week, tick Sun–Thu), hours and
   holidays. Set *Only accept email from these domains* to your company domain.
4. **Administration → SLA targets:** set response and resolution minutes per priority.
5. **Administration → Mailbox status:** click *Check mailbox now* and send a test email to the support address.

## Microsoft 365 setup

You need a Microsoft 365 admin for this (about 20 minutes).

### 1. Create the shared mailbox

In the Exchange admin center, create a shared mailbox such as `support@yourcompany.com`. Shared mailboxes don't need a
licence.

### 2. Register the app

In the Entra admin center go to **App registrations → New registration**:

- Name: `ServiceDesk`
- Supported account types: *Accounts in this organizational directory only*
- No redirect URI is needed.

Copy the **Application (client) ID** and **Directory (tenant) ID** into `.env`. Then open **Certificates & secrets → New
client secret** and copy the secret's **Value** (not the Secret ID) into `M365_CLIENT_SECRET`. Note the expiry date and
put a reminder in your calendar to rotate it.

### 3. Give the app access to the support mailbox only

Don't add `Mail.ReadWrite` / `Mail.Send` *application* permissions in Entra's API permissions page. Granted there,
they apply to every mailbox in the company. Instead, scope them to the one mailbox with Exchange
**RBAC for Applications**. In PowerShell:

```powershell
Install-Module ExchangeOnlineManagement   # once
Connect-ExchangeOnline

# AppId = Application (client) ID. ObjectId = the Object ID shown under Enterprise applications → ServiceDesk
# (this is different from the app registration's Object ID).
New-ServicePrincipal -AppId <AppId> -ObjectId <EnterpriseAppObjectId> -DisplayName "ServiceDesk"

New-ManagementScope -Name "ServiceDesk mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'support@yourcompany.com'"

New-ManagementRoleAssignment -App <AppId> -Role "Application Mail.ReadWrite" -CustomResourceScope "ServiceDesk mailbox"
New-ManagementRoleAssignment -App <AppId> -Role "Application Mail.Send"      -CustomResourceScope "ServiceDesk mailbox"

# Check: should show InScope = True for the support mailbox, False for any other mailbox
Test-ServicePrincipalAuthorization -Identity <AppId> -Resource support@yourcompany.com
```

Permission changes can take a while to apply across Microsoft 365. If the first poll fails with *Access is denied*,
wait and use **Check mailbox now** again.

### 4. Restart

```bash
docker compose up -d
```

The log shows `[email] Polling support@yourcompany.com every 60s`. **Administration → Mailbox status** shows every email
received and sent and what happened to it.

### How email behaves

| Situation | Result |
|---|---|
| New email from an employee | New ticket; sender gets "Ticket #N created" |
| Reply with `[Ticket #N]` in the subject, or in the same Outlook thread | Added to ticket N; reopens it if it was Pending or Resolved |
| Reply to a **closed** ticket | New ticket that references the old one |
| Email marked *High importance* in Outlook | Ticket priority High |
| Out-of-office, bounce, newsletter | Ignored and logged |
| Sender outside the allowed domains | Ignored and logged |
| Email that fails to process 3 times | Left in the Inbox marked read, logged as failed |

## Development

```bash
# PostgreSQL 14+ running locally with a database "servicedesk"
cd server && npm install
DATABASE_URL=postgres://user:pass@localhost:5432/servicedesk npm run dev     # API on :8080

cd web && npm install && npm run dev                                         # UI on :5173 (proxies /api)

cd server && NODE_ENV=test npm test                                          # SLA + email intake tests (needs the DB)
```

Without the `M365_*` variables, outgoing emails are printed to the server log instead of being sent.

### Project layout

```
server/src/
  index.js                 Express app, static web app, startup
  config.js                environment variables
  auth.js                  sessions and role checks
  db/schema.sql            tables (applied automatically on every start)
  db/migrate.js            schema + default settings, SLA policies, first admin
  services/emailIngest.js  mailbox → tickets (threading, loop protection, attachments)
  services/graph.js        Microsoft Graph client (client-credentials flow)
  services/mailer.js       outgoing email templates
  services/tickets.js      ticket rules: SLA, status changes, history, notifications
  services/sla.js          business-hours maths
  services/jobs.js         SLA breach checks, auto-close
  routes/                  REST API
web/src/                   React app (pages/, components/)
```

## Operations

- **Backups:** back up the `pgdata` volume (or run `docker compose exec db pg_dump -U servicedesk servicedesk > backup.sql`)
  **and** the `uploads` volume, which holds attachments.
- **Updates:** `git pull && docker compose up -d --build`. Schema changes apply automatically on start.
- **Logs:** `docker compose logs app`.
- **Dependencies:** the file-upload library `multer` has a newer release (2.5.0) that fixes an issue with asynchronous
  upload filters. This code doesn't use those filters, but update to it once it has been out for a few weeks.

## Suggested next steps

- **Microsoft Entra single sign-on** for agents and employees (replace the password / email-link sign-in).
- **Teams notifications** for new critical tickets and SLA breaches.
- **Asset import** from Intune or a CSV export.
- **Reports export** to Excel and scheduled weekly summaries for IT management.
- **Customer satisfaction survey** link in the resolution email.
