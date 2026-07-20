# Publishing Tarkov Companion — from your phone

Goal: a public URL anyone can open (and install as an app) with zero setup.
Everything below works from Android using Chrome + Termux. Budget ~20 minutes
the first time.

## 1. Create the GitHub repository (in Chrome)

1. Go to https://github.com and sign up / sign in.
2. Tap **+** → **New repository**.
3. Name it `tarkov-companion`, set it **Public**, do NOT add a README
   (the project already has one). Create.

## 2. Create an access token (in Chrome)

Git on your phone needs a password-substitute to push.

1. GitHub → profile picture → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name: `termux`. Repository access: **Only select repositories** →
   `tarkov-companion`. Permissions: **Contents → Read and write**.
3. Generate, then **copy the token** — you'll paste it once in step 3.

## 3. Push the project (in Termux)

Replace `YOURNAME` with your GitHub username. When asked for a password,
paste the token (long-press → paste; nothing shows while pasting — normal).

```
pkg install -y git
cd ~/storage/downloads/tarkov-companion
git init -b main
git add -A
git commit -m "Tarkov Companion v0.4.0"
git remote add origin https://github.com/YOURNAME/tarkov-companion.git
git push -u origin main
```

To avoid re-pasting the token every push:
```
git config credential.helper store
```
(then it's asked for once more and remembered on this device)

## 4. Turn on the website (in Chrome)

1. Your repo → **Settings** → **Pages**.
2. Under *Build and deployment*: Source **Deploy from a branch**,
   Branch **main**, folder **/ (root)**. Save.
3. After a minute or two the page shows your URL:
   `https://YOURNAME.github.io/tarkov-companion/`

That URL is the app. Anyone can open it; on Android, Chrome's menu offers
**Add to Home screen → Install** and from then on it launches like a native
app and works offline after the first visit.

## 5. Turn on automatic data updates

1. Repo → **Actions** tab → enable workflows if prompted.
2. The included **Update game data** workflow now runs nightly, imports
   fresh quests/items/hideout/ammo from tarkov.dev, and publishes them.
   You can also run it any time with the **Run workflow** button.

## 6. Releasing app updates later

From Termux, after replacing files with a new version:
```
cd ~/storage/downloads/tarkov-companion
git add -A
git commit -m "v0.5.0"
git push
```
GitHub Pages redeploys automatically within a couple of minutes.

## Notes

- **Saves**: each visitor's progress lives in their own browser
  (Settings → Export save for backups). Your existing save on
  `localhost:8080` won't follow automatically — export it there, open the
  new URL, import it. One time only.
- **Custom domain**: optional, configurable later in Settings → Pages.
- **Credits**: game data © Battlestate Games, served via the community
  tarkov.dev API. This is an unofficial fan project — keep the credit
  line in the README.
