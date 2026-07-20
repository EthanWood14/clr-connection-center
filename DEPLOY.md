# Deploying CLR Connection Center to Railway

## Prerequisites
- A [Railway account](https://railway.app) (free to sign up)
- A [GitHub account](https://github.com)
- Git installed locally

---

## Step 1 — Push the code to GitHub

1. Create a new **private** repository on GitHub (e.g. `clr-connection-center`)
2. In your terminal, from the project folder:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/clr-connection-center.git
git push -u origin main
```

---

## Step 2 — Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in
2. Click **New Project → Deploy from GitHub repo**
3. Connect your GitHub account if prompted, then select your `clr-connection-center` repo
4. Railway will detect the `Dockerfile` automatically — click **Deploy**

---

## Step 3 — Add a persistent volume (for the SQLite database)

Without a volume, the database resets on every deploy.

1. In your Railway project, click on your service
2. Go to **Settings → Volumes**
3. Click **Add Volume**
   - **Mount path**: `/data`
   - **Size**: 1 GB (more than enough)
4. Click **Add**

Railway will redeploy automatically with the volume attached.

---

## Step 4 — Set environment variables

In your Railway service, go to **Variables** and add:

| Variable | Value |
|---|---|
| `DATABASE_PATH` | `/data/clr.db` |
| `SESSION_SECRET` | Choose a strong random string (e.g. `clr-prod-2026-xxxx`) |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |

---

## Step 5 — Get your public URL

1. Go to **Settings → Networking**
2. Click **Generate Domain** under Public Networking
3. Railway assigns a free `.up.railway.app` URL

Your app will be live at that URL within 1–2 minutes.

---

## Login credentials

Credentials are stored in the Railway environment variables / password manager — never commit them to this repo.

---

## Estimated cost

Railway's **Hobby plan** is $5/month and includes:
- 512 MB RAM / shared CPU
- Persistent volumes (1 GB free per project)
- Custom domains

The free trial gives you $5 of credit to test before billing starts.

---

## Troubleshooting

**App crashes on startup**: Check the Railway logs. The most common cause is a missing environment variable — make sure `DATABASE_PATH`, `SESSION_SECRET`, and `NODE_ENV` are all set.

**Login says "Failed to fetch"**: The app is running but the cookie domain may be mismatched. Make sure you're accessing the `.up.railway.app` URL directly (not through a proxy or iframe).

**Database resets after deploy**: The volume isn't mounted. Go back to Step 3 and verify the mount path is exactly `/data`.
