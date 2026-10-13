# The Learning Minds Higher Secondary School — Website & Management System

Public website + Admissions + Announcements + real login system with three roles (Principal/Admin, Teacher, Student), backed by a real Node.js/Express server and a real SQLite database. No payment/fee system exists anywhere in this project.

## Website upgrade: pages, dynamic content, notifications

**Public pages** (shared navigation on every page): `index.html` (home), `about.html`, `principal.html`, `teachers.html`, `academics.html`, `gallery.html`, `admission.html`, `announcement.html`, `connect.html`. (`galary.html` simply forwards to `gallery.html`.)
- On the **home page** the menu smooth-scrolls to each section; on every **other page** the menu opens the matching HTML page. Each home section also has a "see more" link to its full page.

**Admin panel → new tabs** (`/admin.html`)
- **Principal** – edit name, title, message and photo.
- **Teachers** – add / edit / delete profiles (photo, name, designation, bio, display order).
- **Gallery** – upload many photos at once, edit captions, delete.
Changes appear instantly on the public site. Images are saved in `public/uploads/content/` (JPG/PNG/WEBP/GIF, max 5 MB).

**Notifications** – green success toasts + a soft three-note chime on every successful form/action (admission, login, password change, all admin actions, teacher announcements). Errors show a red toast with no sound. The 🔔 button in the admin top bar mutes/unmutes the chime (remembered per browser).

**Where the new data lives** – in a separate file, `db/content.db` (created automatically on first start). `db/school.db` is never opened, changed or cleared by these features. On first start `content.db` is pre-filled once with Sir Hader and the five teachers that used to be hard-coded; deleting them later is permanent (they are not re-added).

**New/changed files**: `routes/content.js`, `db/content.js`, `public/js/notify.js`, `public/js/admin-content.js`; `server.js` gained a single `app.use(require('./routes/content')(...))` line; all other backend code is unchanged.

## Requirements
- Node.js 18+ installed on your computer or server.

## Setup
```bash
cd tlm-school
npm install
npm run create-admin
npm start
```
Then open http://localhost:3000 in a browser.

The database file is created automatically at `db/school.db` the first time you run the server — nothing to configure.

## Creating the first Principal/Admin account
There is no self-registration anywhere in this system. The very first admin account is created once, from the command line:
```bash
npm run create-admin
```
It will ask for a full name, username, and temporary password. After that, the Principal/Admin creates every other account (teachers, students, and any additional admins) from the Admin Dashboard — never from the command line again.

## Logging in
Go to **http://localhost:3000/login.html** and sign in with a username and password.
- On first login (or right after an admin resets a password), you'll be required to set a new password before continuing.
- You'll land on the dashboard that matches your role automatically:
  - Admin → `/admin.html`
  - Teacher → `/teacher-dashboard.html`
  - Student → `/student-dashboard.html`

Passwords are hashed with bcrypt and never stored in plain text. Sessions are stored server-side and identified by a secure, HTTP-only cookie.

## What the Principal/Admin can do (Admin Dashboard → Accounts tab)
- Create a teacher, student, or another admin account: full name, **username (chosen by the admin, never auto-generated)**, temporary password, role, subject (teachers) or class (students), and account status.
- Edit an account's username or full name.
- Reset a password (the user must set a new one on next login).
- Deactivate or reactivate an account. A deactivated account cannot log in.

The Admin Dashboard also keeps the Admissions and Announcements management from Step 2 (search/approve/reject/delete applications; create/edit/publish/delete announcements).

## What a Teacher can do
Log in, see their own profile and subject, add a short bio, see classes assigned to them (empty until the Admin builds out class assignments), and post announcements to their own students or a specific class they teach — teachers cannot post school-wide or teacher-only announcements.

## What a Student can do
Log in, see their own profile and class, and see announcements addressed to everyone, to students, or to their specific class.

## What to test
1. `npm run create-admin`, then `npm start`.
2. Log in as the admin at `/login.html`, set a new password when prompted.
3. In the Accounts tab, create a teacher account (e.g. username `saddam`, subject `Mathematics`) and a student account (username + class). Log out.
4. Log in as that teacher/student, confirm the forced password-change screen appears, then confirm the right dashboard loads with the right data and nothing from another role is accessible.
5. As admin, reset that user's password and deactivate/reactivate the account; confirm login behaves accordingly.
6. Re-confirm Admissions and Announcements from Step 2 still work end-to-end.

## Project structure
```
tlm-school/
  server.js               Express app: auth, accounts, admissions, announcements, dashboards
  scripts/create-admin.js  One-time command-line script to create the first admin account
  db/
    schema.sql             Full database schema (users, sessions, teachers, students, classes, admissions, announcements, ...)
    index.js               Opens/creates db/school.db and applies the schema
  public/
    index.html              Public website (Home, About, Principal, Teachers, Admissions, Announcements, Contact)
    login.html               Login page (all roles)
    change-password.html     Forced password-change page
    admin.html               Principal/Admin Dashboard (Accounts, Admissions, Announcements)
    teacher-dashboard.html   Teacher Dashboard
    student-dashboard.html   Student Dashboard
    css/styles.css
    js/main.js               Public site behaviour
    js/auth-guard.js         Shared client-side "am I logged in as the right role" check
    js/admin.js, teacher.js, student.js   Dashboard behaviour
    assets/logo.png          School logo (replace this file to update the logo everywhere)
    uploads/                 Admission photos/documents land here
```

## Security notes
- Every admin/teacher/student API route checks the server-side session and role before returning or changing any data — the dashboard pages themselves redirect you to `/login.html` if you're not signed in, but the real protection is on the server, not the page.
- Change `SESSION_SECRET` (environment variable) to a long random value before deploying anywhere public. The default is only for local testing.
- Passwords must be at least 6 characters; consider raising this if you'd like.

## Database
`db/schema.sql` is the single source of truth. It includes tables for the whole system we planned (`users`, `sessions`, `teachers`, `students`, `classes`, `class_teacher_subject`, `admissions`, `announcements`, `attendance`, `results`). `attendance` and `results` are not wired to any feature yet — that's future work.

## Replacing the logo
Replace `public/assets/logo.png` (and `public/assets/favicon.png` for the browser tab icon) with a new file of the same name — nothing else needs to change.

## Important limitation to know about
This project must run on a real Node.js server (your own computer, a school office PC, or real web hosting) — it cannot run as a Claude.ai "artifact" page, because Claude's artifact platform can't combine public access with a shared database. When you're ready to go live, this can be deployed to ordinary web hosting with Node support (a VPS, or platforms like Render/Railway) at low or no cost.
