# Authentication configuration

New passwords require 15-128 printable ASCII characters (U+0020-U+007E): English letters, digits, punctuation/symbols and ordinary spaces. Thai, other non-ASCII characters, tabs and line breaks are rejected without removing or transliterating them. No specific character class is mandatory. This restriction is the project owner's organizational requirement, not an OWASP/NIST requirement. Existing passwords retain their original characters for login and hash migration; the new character rule applies to new passwords only. Signup checks Pwned Passwords using a SHA-1 hash prefix (five characters), padding enabled, never the password/full hash. If lookup fails, signup returns 503 rather than accepting an unchecked password. Existing password verification does not require internet access.

Passwords use Argon2id (19 MiB, two passes, parallelism one). Legacy SHA-256 hashes are accepted only for migration and are upgraded after a successful password verification. Blank hashes never authenticate; affected accounts need an independently verified recovery process. No automatic password reset endpoint is provided.

The browser receives an HttpOnly, SameSite=Strict session cookie, never a token in JSON/localStorage. Local storage contains only a random tab coordination marker. Sessions have an eight-hour absolute lifetime and a 30-minute server-enforced idle timeout. Logout deletes the cookie and revokes its session. JWT issuer, audience, algorithm, expiration and identity claims are validated.

Session and account-attempt state is stored in SQLite at AUTH_STATE_PATH (default backend/.auth/state.sqlite3). Keep it private and persistent. It supports workers on one host. For multiple application hosts, replace it with a shared session/throttle service such as Redis. Five account attempts within 15 minutes trigger a temporary throttle; successful login clears the account counter. Failed attempts and throttling log a hashed account identifier, never credentials.

Profile endpoints require a valid session and resolve its owner by signed user ID. Only the display name is writable; posted email, role and organisation cannot select or modify another account.

New registrations accept only the exact gmail.com domain (case-insensitive); surrounding whitespace is removed and Gmail aliases are preserved. Existing accounts on other domains are not deleted or blocked from login. This domain restriction does not verify ownership of the mailbox.

## Local setup

1. Install backend/requirements.txt in the backend virtual environment.
2. Copy backend/.env.example to backend/.env if needed, configure DATABASE_URL, and generate a random JWT_SECRET. Do not copy the example marker as a real key.
3. Run npm run dev or npm run prod from frontend. The scripts load backend/.env.
4. Log in again after changing JWT_SECRET. Existing browser tokens from older versions are discarded.

## Production

Set AUTH_ENV=production and provide a unique JWT_SECRET through the deployment's secret manager. Missing, short or placeholder keys fail startup. Serve all pages through an HTTPS reverse proxy. Configure Uvicorn to trust forwarded scheme/client information only from that proxy; do not expose the app port directly to untrusted clients. Preserve the public Host. Do not enable credentialed cross-origin access.

Cookie writes require X-Requested-With: BruiseWeb and, when supplied, an Origin matching the public request origin. Vite preserves Host for the local development proxy. Non-browser clients may use a valid, server-issued bearer session; no public endpoint returns bearer credentials.

For Compose, supply MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, DATABASE_URL and JWT_SECRET via a private environment file using docker compose --env-file /private/deployment.env up --build. The auth_state volume preserves session and throttle state.

## Remaining operator actions and limitations

Credentials previously committed are considered exposed. Replace the deployed database passwords and signing keys, update private deployment configuration, and invalidate old sessions. Changing MySQL image environment variables does NOT rotate passwords in an existing MySQL volume. Perform actual database credential rotation with the database administrator. This code change does not alter database passwords or rewrite shared Git history.

Coordinate Git history cleanup with collaborators if needed; removing history does not replace credential rotation. Do not force-push automatically.

MFA and self-service password recovery/change are not implemented. Email cannot be changed through profile. Do not describe this implementation as fully OWASP compliant. Verify TLS/proxy settings in the actual deployment before opening public access.
