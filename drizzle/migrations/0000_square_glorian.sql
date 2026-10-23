CREATE TABLE "activity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"assessment_id" text,
	"finding_id" text,
	"created_at" text DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"target_url" text NOT NULL,
	"target_attested" boolean DEFAULT false NOT NULL,
	"approved_scope" text DEFAULT '' NOT NULL,
	"modules" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'passive' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" text DEFAULT now() NOT NULL,
	"updated_at" text DEFAULT now() NOT NULL,
	"cancelled_at" text
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"assessment_id" text,
	"title" text NOT NULL,
	"severity" text NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"affected_asset" text NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"impact" text DEFAULT '' NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"remediation" text DEFAULT '' NOT NULL,
	"reference_links" text DEFAULT '' NOT NULL,
	"discovered_at" text DEFAULT now() NOT NULL,
	"updated_at" text DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"created_at" text DEFAULT now() NOT NULL,
	"updated_at" text DEFAULT now() NOT NULL
);

INSERT INTO projects (id, name, description, environment, created_at, updated_at) VALUES
('proj_payments', 'Payments API', 'Sample project: customer payments gateway and webhooks.', 'production', '2026-09-01T08:00:00Z', '2026-10-20T10:00:00Z'),
('proj_portal', 'Customer Portal', 'Sample project: authenticated web portal for account holders.', 'production', '2026-09-10T08:00:00Z', '2026-10-21T09:30:00Z'),
('proj_staging', 'Internal Admin (Staging)', 'Sample project: staging copy of the internal admin console.', 'staging', '2026-09-20T08:00:00Z', '2026-10-22T14:00:00Z');

INSERT INTO assessments (id, project_id, title, target_url, target_attested, approved_scope, modules, mode, status, created_at, updated_at, cancelled_at) VALUES
('asmt_001', 'proj_payments', 'Q3 payments API review', 'https://api.payments.example.com', true, 'api.payments.example.com; /v1/* endpoints', 'tls-config,security-headers,auth-review', 'passive', 'completed', '2026-10-02T09:00:00Z', '2026-10-03T16:00:00Z', NULL),
('asmt_002', 'proj_portal', 'Portal authorization check', 'https://portal.example.com', true, 'portal.example.com; authenticated test accounts only', 'access-control,session-management', 'active', 'queued', '2026-10-22T11:00:00Z', '2026-10-22T11:00:00Z', NULL),
('asmt_003', 'proj_staging', 'Admin console smoke test', 'https://admin.staging.example.com', true, 'admin.staging.example.com', 'security-headers', 'passive', 'cancelled', '2026-10-18T12:00:00Z', '2026-10-18T12:30:00Z', '2026-10-18T12:30:00Z');

INSERT INTO findings (id, project_id, assessment_id, title, severity, confidence, status, affected_asset, owner, description, impact, evidence, remediation, reference_links, discovered_at, updated_at) VALUES
('fnd_001', 'proj_payments', 'asmt_001', 'TLS 1.0 still enabled on payments gateway', 'high', 'high', 'in_progress', 'api.payments.example.com:443', 'Priya Nair', 'The gateway accepts TLS 1.0 handshakes, which are deprecated and vulnerable to downgrade attacks.', 'An on-path attacker may weaken transport security for card traffic.', 'Handshake accepted: TLSv1.0 ECDHE-RSA-AES128-SHA', 'Disable TLS 1.0 and 1.1 on the load balancer listener and retest.', 'https://owasp.org/www-project-web-security-testing-guide/', '2026-10-02T10:15:00Z', '2026-10-21T08:00:00Z'),
('fnd_002', 'proj_payments', 'asmt_001', 'Missing Content-Security-Policy on API docs', 'medium', 'high', 'open', 'api.payments.example.com/docs', 'Marco Silva', 'The developer documentation page is served without a Content-Security-Policy header.', 'Reflected or stored script injection in docs would have a wider blast radius.', 'Response headers: no Content-Security-Policy present', 'Add a restrictive CSP to the docs route.', 'https://developer.mozilla.org/docs/Web/HTTP/CSP', '2026-10-02T10:40:00Z', '2026-10-02T10:40:00Z'),
('fnd_003', 'proj_payments', 'asmt_001', 'Webhook signature check uses non-constant-time compare', 'critical', 'medium', 'open', 'api.payments.example.com/v1/webhooks', 'Priya Nair', 'Webhook signatures are compared with a standard string equality operator.', 'Timing differences could help an attacker forge webhook payloads over many attempts.', 'Code path confirmed by request timing samples (redacted)', 'Use a constant-time comparison for HMAC signatures.', 'https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html', '2026-10-03T14:20:00Z', '2026-10-03T14:20:00Z'),
('fnd_004', 'proj_portal', NULL, 'Session cookie missing SameSite attribute', 'medium', 'high', 'open', 'portal.example.com', 'Dana Okafor', 'The session cookie is issued without an explicit SameSite attribute.', 'Browsers may send the cookie on cross-site requests, enabling CSRF in some flows.', 'Set-Cookie: sid=[REDACTED]; Path=/; HttpOnly; Secure', 'Set SameSite=Lax (or Strict) on the session cookie.', 'https://owasp.org/www-community/SameSite', '2026-10-15T09:00:00Z', '2026-10-15T09:00:00Z'),
('fnd_005', 'proj_portal', NULL, 'Account settings endpoint returns other users'' email addresses', 'critical', 'high', 'in_progress', 'portal.example.com/api/accounts/:id', 'Dana Okafor', 'An authenticated user can request account records belonging to other account IDs.', 'Broken object-level authorization exposes personal data across accounts.', 'GET /api/accounts/10442 returned a record for a different tenant (values masked)', 'Enforce ownership checks on every account lookup.', 'https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/', '2026-10-16T13:05:00Z', '2026-10-22T10:00:00Z'),
('fnd_006', 'proj_portal', NULL, 'Verbose error pages reveal framework version', 'low', 'high', 'accepted', 'portal.example.com/404', 'Marco Silva', 'Custom error pages include the framework name and version string.', 'Helps attackers narrow down known vulnerabilities; low direct impact.', 'Response body contains framework version banner', 'Suppress version banners in production error responses.', 'https://owasp.org/www-project-web-security-testing-guide/', '2026-10-16T15:30:00Z', '2026-10-19T09:00:00Z'),
('fnd_007', 'proj_staging', 'asmt_003', 'Admin console lacks HSTS header', 'medium', 'high', 'fixed', 'admin.staging.example.com', 'Lena Park', 'Responses do not include a Strict-Transport-Security header.', 'Users may be downgraded to plain HTTP on first visit.', 'Response headers: no Strict-Transport-Security present', 'Send HSTS with a max-age of at least six months.', 'https://developer.mozilla.org/docs/Web/HTTP/Headers/Strict-Transport-Security', '2026-10-18T12:20:00Z', '2026-10-21T16:45:00Z'),
('fnd_008', 'proj_staging', NULL, 'Outdated JavaScript library with known XSS advisory', 'high', 'medium', 'open', 'admin.staging.example.com/static/vendor.js', 'Lena Park', 'The bundled UI library version has a published cross-site scripting advisory.', 'Exploitation depends on the vulnerable code path being reachable.', 'Detected library version string in vendor bundle', 'Upgrade the library to a patched release and rebuild.', 'https://owasp.org/www-community/attacks/xss/', '2026-10-19T08:00:00Z', '2026-10-19T08:00:00Z'),
('fnd_009', 'proj_payments', NULL, 'Rate limiting absent on login endpoint', 'high', 'medium', 'fixed', 'api.payments.example.com/v1/auth/login', 'Marco Silva', 'Repeated login attempts are not throttled.', 'Credential stuffing attacks are not slowed down.', 'Sustained requests accepted without 429 responses (sample count redacted)', 'Add per-account and per-IP rate limits with backoff.', 'https://owasp.org/www-project-api-security/', '2026-09-28T11:00:00Z', '2026-10-08T12:00:00Z'),
('fnd_010', 'proj_portal', NULL, 'Password reset token does not expire quickly', 'low', 'low', 'false_positive', 'portal.example.com/reset', 'Dana Okafor', 'Reset tokens appear valid for longer than expected.', 'Would only matter if tokens leaked; retest showed expiry is enforced server-side.', 'Token validity observed within policy after retest', 'No action required after retest.', 'https://owasp.org/www-project-web-security-testing-guide/', '2026-10-10T10:00:00Z', '2026-10-14T10:00:00Z');

INSERT INTO activity_events (id, kind, message, assessment_id, finding_id, created_at) VALUES
('act_001', 'assessment', 'Assessment "Q3 payments API review" completed', 'asmt_001', NULL, '2026-10-03T16:00:00Z'),
('act_002', 'finding', 'Critical finding recorded: Webhook signature check uses non-constant-time compare', 'asmt_001', 'fnd_003', '2026-10-03T14:20:00Z'),
('act_003', 'assessment', 'Assessment "Portal authorization check" queued', 'asmt_002', NULL, '2026-10-22T11:00:00Z'),
('act_004', 'assessment', 'Assessment "Admin console smoke test" cancelled', 'asmt_003', NULL, '2026-10-18T12:30:00Z'),
('act_005', 'finding', 'Finding fixed: Admin console lacks HSTS header', 'asmt_003', 'fnd_007', '2026-10-21T16:45:00Z'),
('act_006', 'finding', 'Status changed to in progress: Account settings endpoint returns other users'' email addresses', NULL, 'fnd_005', '2026-10-22T10:00:00Z');
