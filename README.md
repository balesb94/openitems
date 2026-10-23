# Open Items

A shared tracker for open action items across jobs. Everyone on the team signs in, sees what's assigned to them, checks items off, and adds new ones under shared section headers. Each job has its own page and notes for job team meetings.

The app is four files hosted free on GitHub Pages. The data lives in a free Supabase database (Postgres with logins built in). Nothing gets installed on anyone's PC.

```
index.html   the page
app.js       everything the page does
config.js    your Supabase address and key (the only file you edit)
schema.sql   database setup, run once in Supabase
```

If `config.js` is left blank, the app runs in **demo mode** with sample data saved only in that browser. That's a handy way to check the GitHub Pages part works before the database is ready.

---

## 1. Set up the database (about 10 minutes, once)

1. Go to **supabase.com** and sign up (signing in with your GitHub account is easiest).
2. Click **New project**. Name it `open-items`, set a strong database password and save it somewhere safe, pick a US region, and click **Create**. It takes a minute or two to start.
3. In the left menu, open **SQL Editor**, click **New query**, paste in the whole contents of `schema.sql`, and click **Run**. You should see "Success. No rows returned."
4. **Turn off public sign-ups (important).** Go to **Authentication → Sign In / Providers** (on some layouts it's **Authentication → Settings**). Turn **off** "Allow new users to sign up". Leave the **Email** provider turned on.
   *Why:* the key in `config.js` is visible to anyone who opens the page. With sign-ups off, the only people who can get in are the ones you add yourself.
5. **Add your team.** Go to **Authentication → Users → Add user → Create new user**. Enter their work email and a temporary password, check **Auto Confirm User**, and click **Create**. Repeat for each person. Give each person their temporary password; they can change it from the sidebar after signing in.
6. **Get the two connection values.** Go to **Project Settings → API** (or click **Connect** at the top of the project). Copy:
   - the **Project URL** (looks like `https://abcdefghijklm.supabase.co`)
   - the **anon public** key (newer projects call it the **publishable** key)

   Paste them into `config.js`:
   ```js
   supabaseUrl: 'https://abcdefghijklm.supabase.co',
   supabaseAnonKey: 'eyJhbGciOi...',
   ```
   Never paste the **service_role** or **secret** key anywhere in these files. That key bypasses all security.

## 2. Put the app online (about 5 minutes, once)

1. On github.com, click **New repository**. Name it `openitems`, set it to **Public**, and click **Create repository**.
2. Click **uploading an existing file**, drag in `index.html`, `app.js`, `config.js`, `schema.sql` and `README.md`, and click **Commit changes**.
3. Go to **Settings → Pages**. Set Source to **Deploy from a branch**, Branch to **main** and **/ (root)**, and click **Save**.
4. After a minute or two it's live at `https://YOUR-USERNAME.github.io/openitems/`. Open it in Chrome and bookmark it.

## 3. First sign-in

1. Sign in with the email and password you created for yourself.
2. Your name starts out based on your email address. Click **Change name** in the sidebar to fix it. Each person can do the same.
3. Add your jobs with **+ Add job** in the sidebar. "Office / General" is already there for items that aren't tied to a job.
4. Send the link to your team along with their temporary passwords.

## Updating the app

When there's a new version, open the repo on GitHub, click **Add file → Upload files**, drag in the changed files, and commit. **Don't overwrite `config.js`** unless you mean to; it holds your connection settings. Then press **Ctrl+F5** in the app. Data is not affected; it lives in Supabase.

If an update comes with a database change, it will include a separate `.sql` file to run in the SQL Editor. Never re-run the full `schema.sql` on a database that's already set up.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| "That email and password don't match" | Check the user exists under **Authentication → Users** and the email is spelled the same. Passwords are case-sensitive. |
| "Email not confirmed" | You missed **Auto Confirm User** when creating them. Click the user in **Authentication → Users** and confirm them. |
| "Can't reach the database server" | Open `https://YOUR-PROJECT.supabase.co/rest/v1/` in the same browser. A short message about a missing API key means the network is fine and the problem is elsewhere. A block page or timeout means the network is blocking supabase.co, which needs your IT firm. |
| Sidebar says "Not synced" | Same as above. Your edits on screen may not be saved; click **Refresh now** once the connection is back. |
| The app looks like the old version after an update | Press **Ctrl+F5**. GitHub Pages can take a couple of minutes to publish. |
| Nobody can sign in, and Supabase says the project is paused | Free projects pause after about a week with no use. Click **Restore** in the Supabase dashboard. Daily use keeps it awake. |
| Demo mode banner shows even though you filled in config.js | Check both values are inside the quotes and you uploaded the edited `config.js`, then Ctrl+F5. |
| "Someone else changed these notes while you were typing" | Two people edited the same job's notes at once. Click **Load theirs**; your text is kept underneath theirs so nothing is lost. |

**Resetting someone's password.** In Supabase, open **SQL Editor** and run this with their email and a new temporary password:
```sql
update auth.users
set encrypted_password = extensions.crypt('NewTemp-2026!', extensions.gen_salt('bf'))
where email = 'their.email@grunloh.com';
```

**When someone leaves.** In **Table Editor → profiles**, set their `active` to false. They drop out of the assignee lists but their history stays. Then reset their password as above so they can't sign in. Avoid deleting the user: that clears their name from every item they created or completed.

**Backups.** In **Table Editor**, open `items` and click **Export → CSV** now and then. Do the same for `jobs`, `sections` and `job_notes` if you want a full copy.

---

## How it works

- **Logins and security.** Only signed-in users can read or change anything. The database enforces this, not just the page. Everyone signed in sees every job. People can only rename themselves.
- **Staying in sync.** The app saves each change as you make it and pulls everyone else's changes every 20 seconds, and whenever you come back to the tab. If you're typing in a cell when an update arrives, it waits until you click away so nothing jumps around under you.
- **Who did what.** Every item records who added it, who last changed it, and who checked it off and when. Open an item's **···** menu to see it.
- **Archiving jobs.** **Archive job** on a job page hides the job and its items from every list. Adding a job with the same number later brings it back.
- **The dashboard.** The PM dashboard can read these same tables (`items`, `jobs`, `sections`) to roll up counts by job, person, section, overdue and critical.

## Shortcuts in an "Add item" cell

| Type | Does |
|---|---|
| `@mike` | Assigns to Mike (matches the start of a name) |
| `fri`, `tmrw`, `today`, `11/3`, `in 5d`, `in 2w` | Sets the due date |
| `!` | Flags as critical |
| `#2417` | Puts it on job 2417 (only needed in the across-all-jobs views) |
| `/buyout`, `/owner`, `/subs`, `/man` | Puts it in that section (any word from the section name) |

In job notes, any line starting with `[]` can be turned into an item with **Turn [] lines into items**, using the same shortcuts.
