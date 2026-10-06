# Email login: setup and operations

Imara Capital uses **Supabase Auth** for email-only login on Supabase project `ownmlbmnpadfbedcwrph`. People can log in two ways:

- **Email + password**: create account, confirm email, log in, forgot/reset password
- **Email log-in link** (magic link): no password, one-time link by email

No social or phone login is set up.

## What's already done

| Area | Status |
|---|---|
| Database tables `profiles` and `loan_applications` with row-level security | ✅ Applied (`supabase/migrations/…_auth_profiles_and_applications.sql`) |
| Profile auto-created on sign-up (password or magic link) | ✅ Trigger `on_auth_user_created` |
| Users can only read/edit **their own** profile and applications | ✅ Tested |
| Users can't change application status, delete, or impersonate others | ✅ Tested |
| Max 5 applications per user per 24 h | ✅ Trigger `loan_applications_rate_limit` |
| Supabase security & performance advisors | ✅ No issues |
| Pages: `/login.html`, `/account.html`, `/reset-password.html` | ✅ |
| Home page: "Log in" / "My account" in the nav; applications pre-filled and saved to the account when logged in | ✅ |
| CSP allows the Supabase API; supabase-js self-hosted (no third-party script) | ✅ |
| Branded email templates | ✅ Written, **you paste them in** (step 4) |

## What you need to do in the Supabase dashboard

Open <https://supabase.com/dashboard/project/ownmlbmnpadfbedcwrph>.

### 1. Set your site URL (required)

**Authentication → URL Configuration**

- **Site URL:** your Netlify address, e.g. `https://imara-capital.netlify.app` (or your custom domain).
- **Redirect URLs:** add each of these, replacing the domain with yours:
  - `https://imara-capital.netlify.app/**`
  - `https://*--imara-capital.netlify.app/**` (Netlify deploy previews; optional)
  - `http://localhost:8000/**` (local testing; optional)

Without this, links in confirmation, magic-link and reset emails send people to the wrong place, or are refused.

### 2. Connect an email provider (required before real customers sign up)

Supabase's built-in email sender **only delivers to members of your Supabase team** and only a few emails per hour. Customers won't receive their confirmation or log-in emails until you connect your own provider.

**Authentication → Emails → SMTP Settings → Enable custom SMTP**

Any provider works. Resend, Brevo, Postmark, SendGrid, Mailgun and Amazon SES all have free or cheap tiers. You'll need:

- a sender address on a domain you own (e.g. `no-reply@imaracapital.co.ke`)
- the provider's SMTP host, port, username and password
- the provider's DNS records (SPF/DKIM) added to your domain, so emails don't land in spam
- **link tracking turned off** at the provider (it rewrites links and can break them)

Then, under **Authentication → Rate Limits**, raise "emails sent per hour" to suit your traffic.

### 3. Password and security settings (recommended)

**Authentication → Providers → Email**

- **Confirm email:** keep **on**.
- **Secure email change:** keep **on** (confirms on both old and new address).
- **Minimum password length:** set to **8**, and **Password requirements** to "letters and digits". This matches the website's check.
- **Email OTP expiration:** 3600 seconds (1 hour) or less.

**Authentication → Attack Protection** (optional): turn on CAPTCHA if you see bot sign-ups. That also needs a small website change, so ask before enabling it.

### 4. Paste the branded email templates (recommended)

**Authentication → Emails → Templates.** For each template, copy the subject (first line of the file) and the HTML body from `supabase/templates/`:

| Supabase template | File |
|---|---|
| Confirm signup | `confirm-signup.html` |
| Magic Link | `magic-link.html` |
| Reset Password | `reset-password.html` |
| Change Email Address | `change-email.html` |

They use `{{ .ConfirmationURL }}`, which works with the site's login flow as-is.

### 5. Protect your Supabase account

Turn on multi-factor authentication for your own Supabase login (**Account → Security**). Whoever controls that account controls every customer's data.

## Managing applications (staff)

Customers submit applications and can only read them. Staff change the status in **Table Editor → loan_applications → status**:

`submitted → in_review → offer_sent → disbursed` (or `declined` / `withdrawn`)

Customers see the new status on their account page right away. Every application also still arrives through **Netlify Forms** as before, so email notifications keep working.

## How it fits together

```
Browser (Netlify static site)
  ├─ login.html / account.html / reset-password.html
  │    └─ supabase-js (self-hosted) ──► Supabase Auth  (sign-up, log-in, emails)
  │                                 └─► Supabase DB    (profiles, loan_applications; RLS)
  └─ index.html
       ├─ session-hint.js   reads the stored session → "Log in" or "My account"
       └─ account-bridge.js loads supabase-js only for logged-in visitors,
                           pre-fills and saves applications
```

- **Keys:** `public/assets/js/supabase-config.js` holds the project URL and the **publishable** key. That key is meant to be public; the database's row-level security is what protects data. **Never** put the `service_role` / secret key in the website.
- **Sessions:** stored in the browser under `imara-auth` and refreshed automatically. "Log out on all devices" revokes every session.
- **Email-link flow:** implicit flow, so links still work when opened in a different browser than the one that asked for them (common with mail apps on phones).

## Ideas for later

- **Account deletion:** for a lender this is a policy decision (records you may be required to keep vs. a customer's right to erasure under Kenya's Data Protection Act). Once decided, it's a small Supabase Edge Function.
- **Staff dashboard:** a page for officers to update statuses without the Supabase dashboard (needs a staff role and extra policies).
- **Notifications:** email or SMS the customer when the status changes (Supabase Database Webhook → Edge Function).
