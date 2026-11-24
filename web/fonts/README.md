# Fonts

Self-hosted with `next/font/local` (`web/app/fonts.ts`); the site never requests fonts from Google.

- Barlow 400, 500, 600 and Barlow Semi Condensed 500, 600, latin subset, WOFF2.
- Source: the npm packages `@fontsource/barlow` 5.3.0 (Google Fonts version v13) and `@fontsource/barlow-semi-condensed` 5.3.0 (Google Fonts version v16), folder `files/`. Fontsource takes the files from Google Fonts, so they are the files the design reference loads: the visual check of `design/reference/start.html` with the files from Google and with these files gave 0 different pixels at 1440 and 390 px (24.11.2026).
- License: SIL Open Font License 1.1, `OFL-barlow.txt` and `OFL-barlow-semi-condensed.txt` (copied from the packages).
