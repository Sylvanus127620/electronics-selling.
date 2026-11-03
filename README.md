# ELECTRONICS SELLING — Store + Cloudflare-protected admin

Static storefront with a Cloudflare Pages Function for admin authentication and GitHub publishing. Admin signs in with a password; no GitHub token is pasted into the browser. The GitHub token is stored as a Cloudflare secret and used only by the server function.

## What changed
- Admin password login (initial password to configure in Cloudflare: `Sylvasika`).
- Removed the GitHub token field from the dashboard. The server function uses `GITHUB_TOKEN` stored in Cloudflare.
- Added **Videos** in the admin dashboard. To publish, upload a video to YouTube, then paste its YouTube URL, title and description. It appears in the public site's Latest videos section. This implementation posts YouTube embeds; it does not upload large video files directly to GitHub.

## Deploy to GitHub
1. Extract this ZIP.
2. Create a new repository on GitHub, e.g. `electronics-selling`.
3. Open PowerShell in the extracted `electronics-selling` folder and run:

```powershell
git init
git add .
git commit -m "Initial electronics store"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/electronics-selling.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your GitHub username.

## Deploy to Cloudflare Pages (required for secure admin)
1. Sign in to Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Select the GitHub repository.
3. Framework preset: **None**. Build command: leave empty. Build output directory: `/`.
4. Deploy.
5. Open the Pages project → **Settings** → **Variables and Secrets** → add these as encrypted secrets:
   - `ADMIN_PASSWORD` = `Sylvasika`
   - `GITHUB_TOKEN` = your GitHub fine-grained personal access token
6. For `GITHUB_TOKEN`, create a fine-grained token in GitHub → Settings → Developer settings → Personal access tokens. Limit it to this repository and grant **Contents: Read and write** only. Store it only in Cloudflare; do not paste it into the website or share it.
7. Save secrets and trigger a new deployment (Deployments → Retry deployment).
8. Open `https://YOUR-PAGES-DOMAIN.pages.dev/admin/` and sign in with `Sylvasika`.
9. In the Repository tab enter your GitHub owner, repository name and branch (`main`), then Connect & load catalogue.

**Important:** GitHub Pages alone cannot run the secure server function in `functions/`. Use Cloudflare Pages for this version. You may keep GitHub as the source repository and let Cloudflare deploy from it.

## Publish a video
1. Upload the video to your YouTube channel (set visibility to Public or Unlisted).
2. Open `/admin/`, sign in, and connect the repository once.
3. Select **Videos**, enter the title, YouTube link and description, then click **Publish video**.
4. The video appears in the public site's **Latest videos** section. Use the delete button in admin to remove a post.

## Important security notes
- `ADMIN_PASSWORD` and `GITHUB_TOKEN` must be configured as Cloudflare encrypted secrets. Never commit them into this repository.
- The dashboard keeps the admin password in memory only for the current tab/session and sends it to the Pages Function over HTTPS.
- The Cloudflare function rejects unauthenticated GitHub proxy requests. The GitHub token never reaches browser JavaScript.
- Change the initial password after first deployment by updating the `ADMIN_PASSWORD` secret in Cloudflare and redeploying.
- Keep the GitHub token restricted to this repository and revoke it if exposed.

## Local preview
For storefront-only preview, run `python -m http.server 8000` in this folder. The secure admin will not work on this simple server because it does not execute Cloudflare Pages Functions. Test admin on the deployed Cloudflare Pages site.
