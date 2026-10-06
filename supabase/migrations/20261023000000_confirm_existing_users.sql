-- Confirm every auth user left over from the old invite flow.
--
-- Why this exists: registration now creates the account UNCONFIRMED and
-- emails GoTrue's "Confirm signup" link — the first sign-in gate. The
-- accounts created by the older inviteUserByEmail flow are still
-- unconfirmed in auth.users, so once confirmation is enforced they could
-- never sign in: their invitation links have expired or were already
-- consumed, and no signup confirmation was ever sent to them. This
-- catches them up so deploying the feature does not lock out everyone
-- who registered before it.
--
-- Access is not weakened: confirmation only proves address ownership, and
-- the app's second gate — profiles.status='pending' -> administrator
-- 'active' at /admin/users — still applies ('suspended'/'inactive' still
-- lock the account).
--
-- Idempotent: only rows still missing a confirmation are touched.
-- (`confirmed_at` is a GENERATED column in GoTrue's schema — it is derived
-- from email_confirmed_at, so it must not be assigned directly.)

UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL;
