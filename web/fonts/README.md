# Fonts

Self-hosted with `next/font/local` (`web/app/fonts.ts`); the site never requests fonts from Google.

- Barlow 400, 500, 600 and Barlow Semi Condensed 500, 600, latin subset, WOFF2.
- Since session B3 part 2 (Fedor, 25.11.2026): the same weights in the latin-ext subset (`*-latin-ext-*-normal.woff2`), for Polish, Czech, Turkish and other letters of Latin Extended in names of a scanned site. They are faces of their own with the `unicode-range` of latin-ext (that of Fontsource and Google Fonts), never preloaded and first in the font lists of `web/app/globals.css`: the browser loads one only when the page has a letter in its range. Cyrillic, Greek and other scripts are drawn by the system font (the fallback of the latin subset).
- Source: the npm packages `@fontsource/barlow` 5.3.0 (Google Fonts version v13) and `@fontsource/barlow-semi-condensed` 5.3.0 (Google Fonts version v16), folder `files/`. Fontsource takes the files from Google Fonts, so they are the files the design reference loads: the visual check of `design/reference/start.html` with the files from Google and with these files gave 0 different pixels at 1440 and 390 px (24.11.2026). The latin files of the packages are byte for byte the ones here (checked again on 25.11.2026, when the latin-ext files were taken from the same packages).
- License: SIL Open Font License 1.1, `OFL-barlow.txt` and `OFL-barlow-semi-condensed.txt` (copied from the packages).
