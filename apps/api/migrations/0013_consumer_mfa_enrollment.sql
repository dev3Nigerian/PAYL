-- New consumers enroll their own authenticator without changing existing MFA.
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mfa_pending_secret text;
