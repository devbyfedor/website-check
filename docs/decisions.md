# Decisions

## Owner decisions

Copied from `docs/brief.md` (brief v1, approved on 19.11.2026), with their dates.

- 23.10.2026: project paused. 19.11.2026: resumed.
- Since October 2026: zero budget, free tiers only.
- 19.11.2026: no separate prototype. Build the real product, starting with the scan core, and measure it on Cloudflare early.
- 19.11.2026: name Website-Check DE. Folder, repository and address: `website-check`.
- 19.11.2026: the repository is public from day one. Results of scans of real third-party websites never go into the repository.
- 19.11.2026: the Impressum of our site will carry Fedor's real name and postal address (stage C).
- 19.11.2026: Fedor answers leads only in writing, by e-mail. The lead form says that the answer comes by e-mail.
- 19.11.2026: Impressum fields are found with templates (regular expressions) first. The Claude API is added later only if the templates miss often on live sites.
- 19.11.2026: design variant "Bauplan" (blueprint) with the improvements is approved. The reference in `design/` is the source of truth.
- No date given in the brief (part of brief v1, 19.11.2026): explanations of findings are written in advance and stored in the repository. No AI generates findings or legal explanations at runtime.

## Technical decisions

- 20.11.2026: the brief arrived as `docs/BRIEF.md` and is committed as `docs/brief.md`, because the brief and all instructions use that name and GitHub paths are case-sensitive.
- 20.11.2026: `.gitattributes` forces LF line endings, so Git on Windows (system `core.autocrlf=true`) never rewrites the read-only files in `design/`.
- 20.11.2026: Node 24.15.0 is pinned in `.nvmrc` and `.node-version`; `engines` allows `>=24.15.0 <25` and `.npmrc` sets `engine-strict`, so a wrong Node major fails at install. Node 24 is the installed LTS line.
- 20.11.2026: dependencies are saved with exact versions (`save-exact`) and `package-lock.json` is committed, so every session installs the same versions.
- 20.11.2026: TypeScript 6.0.3 (the last JavaScript-based release) instead of 7.0 (the native port): stage B uses Next.js and other tools that load the TypeScript JavaScript API; revisit when they support 7.
- 20.11.2026: no build step for TypeScript. Node 24 runs `.ts` files directly (type stripping), so the code uses only erasable syntax (`erasableSyntaxOnly`) and explicit `.ts` import extensions; Vitest and later wrangler read the same files.
- 20.11.2026: Vitest 5 with one project per workspace; `npm test` runs only unit tests without browser or network.
