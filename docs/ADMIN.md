# Roles and the staff console

## Roles

| Role | Who | Can do |
|---|---|---|
| **user** (customer) | Everyone, by default | Their own account, profile and applications only |
| **employee** | Imara staff | Everything a user can, plus: see every customer, profile and application; change application status; add internal notes |
| **admin** | Site owners | Everything an employee can, plus: change roles; create, invite, suspend, restore and delete accounts; set passwords and send reset links; change emails; log a user out everywhere; activity log; site health and database status |

**Administration belongs to the site owner only: fayann506@gmail.com (Faith Ndung'u).**

- No other account can ever be made an administrator, whether through the console, the admin function, or even direct database access with the secret key. The database refuses (`user_roles_owner_only_admin` trigger, migration `20261006220000_owner_only_admin.sql`).
- The owner's account can never lose the administrator role.
- The lock is by account id, so it still holds if the owner changes the account's email address.
- The owner can make people **employees** (staff tools, no admin powers) or turn them back into **customers**.

Roles live in the `user_roles` table (no row means `user`). Users can never change their own role.

## The staff console: `/admin.html`

Staff see a **Staff console** link on their account page. Customers who open `/admin.html` see a "Staff only" message and get no data, because the database itself refuses them.

| Tab | Who | What's there |
|---|---|---|
| **Overview** | Employees + admins | Users, active today, profiles complete, applications, awaiting review, amount requested; sign-ups over the last 14 days; applications by status. Admins also get **site health**: live checks of the website, database, log-in service and admin functions with response times, re-checked every minute. |
| **Users** | Employees (read-only) + admins | Search by name, email, phone or business; filter by role. Click a person for their full profile, photo and applications. Admins also get: change role, email a reset link, set a password, mark email confirmed, change email, log out everywhere, suspend/restore, and delete (type their email to confirm). Admins can't suspend or delete themselves. |
| **Applications** | Employees + admins | Every application, searchable and filterable by status. Change status inline. **Notes** holds internal notes that customers never see. |
| **Activity log** | Admins | Who did what and when: role changes, status changes, password actions, suspensions, accounts added or deleted. |
| **System** | Admins | Database engine, uptime, size and connections; account totals and open sessions; photo storage; every table with row counts and whether row-level security is on; migration history; links to the Supabase dashboard. |

## Adding staff

**Users → Add user**, then either:

- **Email an invite:** they get an email, set their own password, and land on the site. Needs custom SMTP (see AUTH_SETUP.md, step 2) unless they're on your Supabase team.
- **Set a password:** the account works immediately. Share the password privately and ask them to change it from My account.

Choose **Employee** as the role. (Administrator isn't offered: only the site owner is an administrator.) To give an existing customer staff tools, open them under Users and change their role to Employee.

## How it's protected

- **Database:** row-level security policies and role-checking functions (`private.is_staff()` / `private.is_admin()`) decide every read and write. The website only decides what to show. Supabase's security advisor lists the admin functions as "callable by signed-in users". That's intentional: each one checks the caller's role first and refuses non-staff.
- **Account actions** (passwords, suspend, delete, invite, ...) run in the `admin-users` Supabase Edge Function. It holds the secret key, which never reaches the browser, and checks on every request that the caller is logged in **and** an admin.
- **Audit:** status and role changes are logged by the database itself. Account actions are logged by the Edge Function, which writes the log entry before a delete so the record survives.
- Customers never see `application_notes` or the `audit_log`.

## Files

- `supabase/migrations/20261006210000_roles_and_admin.sql`: roles, policies, functions, audit log, notes
- `supabase/functions/admin-users/`: `index.ts` (Supabase wiring) and `logic.ts` (rules; unit-tested)
- `public/admin.html`, `public/assets/js/admin.js`, `public/assets/css/admin.css`: the console
