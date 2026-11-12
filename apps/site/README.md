# Flytower website

The public site: landing page, docs, changelog, sponsor and legal pages. It is a Nuxt app that runs
as a Cloudflare Worker. Every page is prerendered at build time and served as a static asset; the
Worker only answers anything else (a 404 today, and later server routes under `/api`, such as a
mailing list).

- **Docs** come from the repo's `docs/` folder (the same Markdown the panel will show), excluding
  `testing-*.md`. The sidebar order lives in `app/app.config.ts`.
- **Site-only pages** written in Markdown live in `content/pages/` and `content/legal/`.
- **The domain** (`flytower.dev`) and contact addresses are set in `app/app.config.ts`.
- **Analytics**: set `NUXT_PUBLIC_CF_ANALYTICS_TOKEN` at build time to add Cloudflare Web
  Analytics. Visitors can switch it off on the privacy page, and Global Privacy Control is honoured.

## Working on it

```sh
bun run --filter @flytower/site dev      # http://localhost:3000
bun run build:site                       # from the repo root
cd apps/site && bunx wrangler dev        # serve the build in the Workers runtime
```

## Deploying

`.github/workflows/site.yml` builds on every change. Once the repository has the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, pull requests get a preview URL and
`main` (and each release, to refresh the changelog) deploys the `flytower-site` Worker.
