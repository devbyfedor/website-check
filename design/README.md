# Design reference: Website-Check DE ("Bauplan")

Approved by the owner on 19 November 2026. This folder is the single source of truth for how the site looks and behaves. Reproduce it 1:1.

## Files

- `reference/start.html`: home page.
- `reference/pruefung.html`: the screen shown while a scan runs.
- `reference/bericht.html`: the report.
- `reference/bfsg.html`: the BFSG decision scheme ("Gilt das BFSG für Sie?").
- `tokens.css`: colors, fonts, grid background and motion values taken from the reference.

Open any reference file directly in a browser. They are plain HTML and CSS with a little vanilla JavaScript for the interactive parts. The links between them work, so the flow home → scan → report can be clicked through. All data in them is an example for a fictional shop, roesterei-muster.de.

The `data-dc-*` attributes and the small script at the end of each file exist only to make the reference clickable. Do not copy that pattern: implement state with React in the app.

## Rules

1. Match the reference exactly: layout, spacing, sizes, colors, copy, SVG paths, animation timings and easing. Do not improve or reinterpret anything. If something cannot be matched, stop and ask.
2. Port it to the project stack: Next.js with static export, TypeScript, Tailwind CSS v4 with the values from `tokens.css` as theme variables. Keep the CSS keyframe animations as they are; use GSAP only where CSS cannot do the same thing, and keep the timings identical.
3. Fonts: Barlow (400, 500, 600) and Barlow Semi Condensed (500, 600), self-hosted with `next/font`. Production must never request anything from fonts.googleapis.com or fonts.gstatic.com: the product checks other websites for exactly that. The reference files load Google Fonts only for viewing.
4. Every animation must respect `prefers-reduced-motion: reduce` exactly as the reference does: the final state is shown without motion.
5. Accessibility as in the reference: real buttons and links, labels for inputs, `aria-pressed` and `aria-selected` states, visible focus, text contrast of at least 4.5:1. The site must pass its own scanner with zero errors.
6. The site language is German (`lang="de"`). The copy is final, except where this file marks it as a draft.

## Interactive behavior

- Home: the four "Was wir messen" buttons switch the highlighted callout and the note on the drawing. Layer 1 is active on load.
- Scan screen: in the reference the whole sequence is compressed to about 8 seconds. In the app the steps appear as the real scan reports progress, the plotter animation runs while waiting, and the "Bericht öffnen" panel appears when the report is ready.
- Report: system tabs WordPress, Shopify, Wix, Jimdo and Shopware; the detected system is selected on load. The button "Liste für die Datenschutzerklärung kopieren" copies the list of services and changes its label to "Liste kopiert".
- BFSG scheme: yes/no questions, the highlighted path and the verdict follow the logic in the reference script. "Neu beginnen" resets it.

## Drafts and scope

- The fix instructions for Shopify, Wix, Jimdo and Shopware are drafts and must be checked against the real systems before launch. The WordPress text is the template for their tone and length.
- The "Revisionen" table and the "Arbeitsauftrag für Ihren Entwickler" button are part of the design, but they are built in the second wave, after the core scan works.

## How to verify 1:1

1. With Playwright, take full-page screenshots of each reference file and of the matching app page at 1440 px and 390 px width, with `reducedMotion: 'reduce'` so every animation shows its final state.
2. Compare them pixel by pixel. Differences are allowed only where real data differs from the example data.
3. Report the remaining difference in percent for every page and width.
