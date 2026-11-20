# Sources for the risk classes of third-party services

This file justifies every risk class in `scanner/data/third-party-services.json`. The brief requires a source for every class assignment: a court ruling, guidance of the German data protection authorities, the law text or official documentation. No source means `grey-zone`. The unit test `scanner/test/rules-data.test.ts` checks that every source cited in the data has a heading here, that every heading is used, and that every service is listed below.

How the sources were checked (20.11.2026): a research helper opened each source and wrote down what it says; a second, independent helper opened it again and tried to refute it. Sources that could not be confirmed were dropped. A service that lost its only source was set to `grey-zone`. Hosts were checked against the providers' own documentation where possible.

This is technical documentation for the scanner. It is not legal advice and not a final legal text.

## Risk classes and their basis

- `precedent`: only Google Fonts loaded from Google servers. LG München I, 20.01.2022, 3 O 17493/20, held that passing the visitor's dynamic IP address to Google through Google Fonts without consent infringes the general right of personality, and that there is no legitimate interest because the fonts can be hosted locally. German data protection authorities recommend local hosting (TLfDI 2022, BayLfD AKI 42, LfD Niedersachsen 2022).
- `consent-required`: analytics, tag managers, advertising and social pixels, session recording. Basis: § 25 TDDDG (storing or reading information on the device needs consent unless it is strictly necessary), BGH Cookie-Einwilligung II and EuGH Planet49 (consent for advertising and market research cookies, actively given), the DSK OH Digitale Dienste, EDPB Guidelines 2/2023 (pixels and similar techniques), service-specific sources such as the DSK resolution on Google Analytics (2020) and VG Hannover on Google Tag Manager (2025), and providers' own documentation that requires consent in the EU. A service whose loader can be used in a documented consent-respecting way (for example Klaviyo, HubSpot, Matomo Cloud, Mouseflow) is `grey-zone`, because a request alone does not prove tracking.
- `usually-consent`: maps, video embeds, external chat widgets, social media embeds. Basis: DSK OH Digitale Dienste Rz. 101 (third-party content passes personal data to the third party and needs a legal basis), EuGH Fashion ID (the site operator is jointly responsible for the transmission caused by embedded content), LfDI Baden-Württemberg FAQ and video handout (two-click solutions), plus provider documentation. Review widgets have no specific source and are therefore `grey-zone`; so are chat widgets whose documentation shows no storage on load.
- `grey-zone`: public CDNs (jsDelivr, unpkg, cdnjs and others: no German court ruling or authority guidance covers them), other font services, payment, captcha, accessibility overlays, translation widgets, platform telemetry, and every service without a specific source. Unknown third parties are grey-zone too. Shown as a hint, never as a violation.
- `not-flagged`: the site's own servers (first party, not listed here), the consent tool itself (owner decision in the brief; DSK OH Digitale Dienste Rz. 84 accepts storing the consent result; no source addresses the IP address that reaches a third-party consent tool host, see `docs/decisions.md`), and platform hosts that deliver the site's own files as part of the hosting, documented by the platform (Shopify CDN, Wix media).

The scan never clicks, so every listed request happened before consent. Requests inside a third-party iframe or triggered by an embedded product belong to that product (see `docs/decisions.md`, 20.11.2026).

## Services by risk class

Generated from `scanner/data/third-party-services.json` (20.11.2026). Host patterns: an exact host, `*.domain` for any subdomain, or a host with a path prefix.

#### Class `precedent` (1)

- `google-fonts`: Google Fonts (Google), fonts. Hosts: `fonts.googleapis.com`, `fonts.gstatic.com`. Sources: [lg-muenchen-2022-google-fonts](#lg-muenchen-2022-google-fonts), [lfd-nds-2022-google-fonts](#lfd-nds-2022-google-fonts), [tlfdi-2022-google-fonts](#tlfdi-2022-google-fonts), [baylfd-aki42-web-fonts](#baylfd-aki42-web-fonts), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [eugh-fashion-id](#eugh-fashion-id), [lg-muenchen-2023-google-fonts-crawler](#lg-muenchen-2023-google-fonts-crawler).

#### Class `consent-required` (17)

- `google-tag-manager`: Google Tag Manager / Google tag (gtag.js) (Google), tag-manager. Hosts: `www.googletagmanager.com`. Sources: [vg-hannover-2025-10-a-5385-22](#vg-hannover-2025-10-a-5385-22), [dsk-2020-google-analytics](#dsk-2020-google-analytics), [google-tag-install](#google-tag-install), [google-eu-user-consent-policy](#google-eu-user-consent-policy), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `google-analytics`: Google Analytics (Google), analytics. Hosts: `*.google-analytics.com`, `*.analytics.google.com`. Sources: [dsk-2020-google-analytics](#dsk-2020-google-analytics), [google-eu-user-consent-policy](#google-eu-user-consent-policy), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `yandex-metrica`: Yandex Metrica (Yandex), analytics. Hosts: `mc.yandex.ru`, `mc.yandex.com`, `mc.yandex.az`, `mc.yandex.by`, `mc.yandex.co.il`, `mc.yandex.com.am`, `mc.yandex.com.ge`, `mc.yandex.com.tr`, `mc.yandex.ee`, `mc.yandex.fr`, `mc.yandex.kg`, `mc.yandex.kz`, `mc.yandex.lt`, `mc.yandex.lv`, `mc.yandex.md`, `mc.yandex.tj`, `mc.yandex.tm`, `mc.yandex.uz`, `mc.webvisor.com`, `mc.webvisor.org`. Sources: [yandex-metrica-cookies](#yandex-metrica-cookies), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `hotjar`: Hotjar (Hotjar), session-recording. Hosts: `*.hotjar.com`, `*.hotjar.io`. Sources: [hotjar-tracking-code-cookies](#hotjar-tracking-code-cookies), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `microsoft-clarity`: Microsoft Clarity (Microsoft), session-recording. Hosts: `*.clarity.ms`. Sources: [microsoft-clarity-consent-mode](#microsoft-clarity-consent-mode), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023).
- `brevo-tracker`: Brevo (Sendinblue) tracker (Brevo), marketing-automation. Hosts: `sibautomation.com`. Sources: [brevo-tracker-faq](#brevo-tracker-faq), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `klaviyo-client-events`: Klaviyo onsite tracking events (Klaviyo), marketing-automation. Hosts: `a.klaviyo.com/client/events`. Sources: [klaviyo-cookies](#klaviyo-cookies), [klaviyo-client-events-api](#klaviyo-client-events-api), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `criteo`: Criteo (OneTag retargeting) (Criteo), advertising. Hosts: `*.criteo.com`. Sources: [tdddg-25](#tdddg-25), [bgh-cookie-einwilligung-2](#bgh-cookie-einwilligung-2), [eugh-planet49](#eugh-planet49), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [lfdi-bw-faq-cookies-tracking](#lfdi-bw-faq-cookies-tracking).
- `google-ads`: Google Ads / DoubleClick / AdSense (Google), advertising. Hosts: `*.doubleclick.net`, `*.googlesyndication.com`, `*.googleadservices.com`, `adservice.google.com`, `www.google.com/pagead/`, `www.google.de/pagead/`, `www.google.com/ads/`, `www.google.de/ads/`. Sources: [tdddg-25](#tdddg-25), [bgh-cookie-einwilligung-2](#bgh-cookie-einwilligung-2), [eugh-planet49](#eugh-planet49), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [lfdi-bw-faq-cookies-tracking](#lfdi-bw-faq-cookies-tracking), [google-eu-user-consent-policy](#google-eu-user-consent-policy).
- `google-analytics-advertising-features`: Google Analytics advertising features (Google signals / remarketing audiences) (Google), advertising. Hosts: `stats.g.doubleclick.net`, `www.google.com/ads/ga-audiences`, `www.google.de/ads/ga-audiences`. Sources: [tdddg-25](#tdddg-25), [bgh-cookie-einwilligung-2](#bgh-cookie-einwilligung-2), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [lfdi-bw-faq-cookies-tracking](#lfdi-bw-faq-cookies-tracking), [google-eu-user-consent-policy](#google-eu-user-consent-policy).
- `microsoft-advertising-uet`: Microsoft Advertising UET (Bing Ads) (Microsoft), advertising. Hosts: `bat.bing.com`. Sources: [tdddg-25](#tdddg-25), [bgh-cookie-einwilligung-2](#bgh-cookie-einwilligung-2), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [lfdi-bw-faq-cookies-tracking](#lfdi-bw-faq-cookies-tracking), [microsoft-uet-add-tag-consent](#microsoft-uet-add-tag-consent), [microsoft-uet-consent-mode](#microsoft-uet-consent-mode).
- `linkedin-insight-tag`: LinkedIn Insight Tag (LinkedIn), social-pixel. Hosts: `snap.licdn.com`, `*.ads.linkedin.com`, `p.adsymptotic.com`, `sjs.bizographics.com`, `cdn.linkedin.oribi.io`, `gw.linkedin.oribi.io`. Sources: [tdddg-25](#tdddg-25), [bgh-cookie-einwilligung-2](#bgh-cookie-einwilligung-2), [eugh-fashion-id](#eugh-fashion-id), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [edpb-guidelines-8-2020](#edpb-guidelines-8-2020), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [lfdi-bw-faq-cookies-tracking](#lfdi-bw-faq-cookies-tracking), [linkedin-insight-tag-help](#linkedin-insight-tag-help).
- `meta-pixel`: Meta Pixel (Facebook Pixel) (Meta), social-pixel. Hosts: `connect.facebook.net/en_US/fbevents.js`, `connect.facebook.net/signals/`, `www.facebook.com/tr`. Sources: [tdddg-25](#tdddg-25), [eugh-planet49](#eugh-planet49), [bgh-cookie-einwilligung-2](#bgh-cookie-einwilligung-2), [eugh-fashion-id](#eugh-fashion-id), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [edpb-guidelines-8-2020](#edpb-guidelines-8-2020), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [lfdi-bw-faq-cookies-tracking](#lfdi-bw-faq-cookies-tracking), [eugh-meta-bundeskartellamt](#eugh-meta-bundeskartellamt), [meta-business-tools-terms](#meta-business-tools-terms).
- `pinterest-tag`: Pinterest Tag (Pinterest), social-pixel. Hosts: `s.pinimg.com/ct/`, `ct.pinterest.com`. Sources: [tdddg-25](#tdddg-25), [bgh-cookie-einwilligung-2](#bgh-cookie-einwilligung-2), [eugh-fashion-id](#eugh-fashion-id), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [edpb-guidelines-8-2020](#edpb-guidelines-8-2020), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [lfdi-bw-faq-cookies-tracking](#lfdi-bw-faq-cookies-tracking), [pinterest-tag-base-code-consent](#pinterest-tag-base-code-consent).
- `snap-pixel`: Snap Pixel (Snapchat) (Snap Inc.), social-pixel. Hosts: `sc-static.net/scevent.min.js`, `tr.snapchat.com`. Sources: [tdddg-25](#tdddg-25), [bgh-cookie-einwilligung-2](#bgh-cookie-einwilligung-2), [eugh-fashion-id](#eugh-fashion-id), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [edpb-guidelines-8-2020](#edpb-guidelines-8-2020), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [lfdi-bw-faq-cookies-tracking](#lfdi-bw-faq-cookies-tracking).
- `tiktok-pixel`: TikTok Pixel (TikTok), social-pixel. Hosts: `analytics.tiktok.com`, `analytics.pangle-ads.com`. Sources: [tdddg-25](#tdddg-25), [bgh-cookie-einwilligung-2](#bgh-cookie-einwilligung-2), [eugh-fashion-id](#eugh-fashion-id), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [edpb-guidelines-8-2020](#edpb-guidelines-8-2020), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [lfdi-bw-faq-cookies-tracking](#lfdi-bw-faq-cookies-tracking), [tiktok-pixel-cookies](#tiktok-pixel-cookies).
- `x-pixel`: X (Twitter) Pixel (X), social-pixel. Hosts: `analytics.twitter.com`, `t.co/i/adsct`. Sources: [tdddg-25](#tdddg-25), [bgh-cookie-einwilligung-2](#bgh-cookie-einwilligung-2), [eugh-fashion-id](#eugh-fashion-id), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [edpb-guidelines-8-2020](#edpb-guidelines-8-2020), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [lfdi-bw-faq-cookies-tracking](#lfdi-bw-faq-cookies-tracking).

#### Class `usually-consent` (14)

- `google-maps`: Google Maps (embed and Maps JavaScript API) (Google), maps. Hosts: `maps.googleapis.com`, `maps.gstatic.com`, `www.google.com/maps/`, `maps.google.com`, `maps.google.de`. Sources: [lfdi-bw-faq-tracking-2022-maps](#lfdi-bw-faq-tracking-2022-maps), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `openstreetmap-tiles`: OpenStreetMap standard tile server (OpenStreetMap Foundation), maps. Hosts: `tile.openstreetmap.org`, `*.tile.openstreetmap.org`. Sources: [lfdi-bw-faq-tracking-2022-maps](#lfdi-bw-faq-tracking-2022-maps), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `vimeo`: Vimeo embedded player (Vimeo), video. Hosts: `player.vimeo.com`, `*.vimeocdn.com`. Sources: [lfdi-bw-handreichung-videos-2022](#lfdi-bw-handreichung-videos-2022), [vimeo-help-player-parameters](#vimeo-help-player-parameters), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25).
- `youtube`: YouTube embedded player (standard domain) (Google), video. Hosts: `www.youtube.com`, `i.ytimg.com`. Sources: [lfdi-bw-faq-tracking-2022-embeds](#lfdi-bw-faq-tracking-2022-embeds), [lfdi-bw-handreichung-videos-2022](#lfdi-bw-handreichung-videos-2022), [tlfdi-anfrage-youtube-cookies-2022](#tlfdi-anfrage-youtube-cookies-2022), [youtube-api-developer-policies](#youtube-api-developer-policies), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [eugh-fashion-id](#eugh-fashion-id).
- `youtube-nocookie`: YouTube Privacy Enhanced Mode (youtube-nocookie.com) (Google), video. Hosts: `www.youtube-nocookie.com`. Sources: [youtube-help-privacy-enhanced-mode](#youtube-help-privacy-enhanced-mode), [youtube-api-developer-policies](#youtube-api-developer-policies), [lfdi-bw-handreichung-videos-2022](#lfdi-bw-handreichung-videos-2022), [lfdi-bw-faq-tracking-2022-embeds](#lfdi-bw-faq-tracking-2022-embeds), [tlfdi-anfrage-youtube-cookies-2022](#tlfdi-anfrage-youtube-cookies-2022), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25).
- `facebook-social-plugins`: Facebook social plugins (Like/Share button, Page plugin, embedded posts, JS SDK) (Meta), social-embed. Hosts: `www.facebook.com/plugins/`, `web.facebook.com/plugins/`, `connect.facebook.net/de_DE/sdk`, `connect.facebook.net/en_US/sdk`. Sources: [eugh-fashion-id](#eugh-fashion-id), [lfdi-bw-faq-tracking-2022-embeds](#lfdi-bw-faq-tracking-2022-embeds), [meta-cookie-policy](#meta-cookie-policy), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `instagram-embeds`: Instagram embeds and Instagram content images (Meta), social-embed. Hosts: `www.instagram.com`, `*.cdninstagram.com`. Sources: [lfdi-bw-faq-tracking-2022-embeds](#lfdi-bw-faq-tracking-2022-embeds), [meta-cookie-policy](#meta-cookie-policy), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `x-embeds`: X (Twitter) embedded posts and timelines (X), social-embed. Hosts: `platform.twitter.com`, `syndication.twitter.com`, `cdn.syndication.twimg.com`. Sources: [lfdi-bw-faq-tracking-2022-embeds](#lfdi-bw-faq-tracking-2022-embeds), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `crisp`: Crisp chat widget (Crisp), chat. Hosts: `*.crisp.chat`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25), [crisp-docs-cookie-policies](#crisp-docs-cookie-policies).
- `intercom`: Intercom Messenger (Intercom), chat. Hosts: `*.intercom.io`, `*.intercomcdn.com`, `*.intercomcdn.eu`, `*.intercomassets.com`, `*.intercomassets.eu`, `*.intercom-messenger.com`, `*.intercomusercontent.com`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25), [intercom-docs-web-installation](#intercom-docs-web-installation).
- `livechat`: LiveChat widget (LiveChat (Text)), chat. Hosts: `*.livechatinc.com`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25).
- `smartsupp`: Smartsupp chat widget (Smartsupp), chat. Hosts: `*.smartsuppchat.com`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25), [smartsupp-docs-configuration](#smartsupp-docs-configuration).
- `tawk-to`: tawk.to chat widget (tawk.to), chat. Hosts: `*.tawk.to`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25).
- `zendesk-web-widget`: Zendesk Web Widget (messaging/classic) (Zendesk), chat. Hosts: `ekr.zdassets.com`, `static.zdassets.com/ekr/`, `static.zdassets.com/web_widget/`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25), [zendesk-docs-messaging-cookies](#zendesk-docs-messaging-cookies).

#### Class `grey-zone` (47)

- `adobe-fonts`: Adobe Fonts (Typekit) (Adobe), fonts. Hosts: `use.typekit.net`, `*.typekit.net`. Sources: [typekit-webfontloader-source](#typekit-webfontloader-source), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `bunny-fonts`: Bunny Fonts (bunny.net), fonts. Hosts: `fonts.bunny.net`. Sources: [bunny-fonts-about](#bunny-fonts-about), [baylfd-aki42-web-fonts](#baylfd-aki42-web-fonts), [lfd-nds-2022-google-fonts](#lfd-nds-2022-google-fonts), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `font-awesome`: Font Awesome (Kits / CDN) (Font Awesome), fonts. Hosts: `kit.fontawesome.com`, `*.fontawesome.com`. Sources: [fontawesome-use-kit](#fontawesome-use-kit), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `cloudflare-web-analytics`: Cloudflare Web Analytics (Cloudflare), analytics. Hosts: `static.cloudflareinsights.com`, `cloudflareinsights.com/cdn-cgi/rum`. Sources: [cloudflare-privacy-first-web-analytics](#cloudflare-privacy-first-web-analytics), [cloudflare-web-analytics-faq](#cloudflare-web-analytics-faq), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023).
- `etracker`: etracker Analytics (etracker), analytics. Hosts: `*.etracker.com`, `*.etracker.de`. Sources: [etracker-basis-integration](#etracker-basis-integration), [etracker-consent-free](#etracker-consent-free), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `fathom`: Fathom Analytics (Fathom), analytics. Hosts: `cdn.usefathom.com`. Sources: [fathom-compliance](#fathom-compliance), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023).
- `jetpack-stats`: Jetpack Stats (WordPress.com Stats) (Automattic), analytics. Hosts: `stats.wp.com`, `pixel.wp.com/g.gif`. Sources: [jetpack-stats-support](#jetpack-stats-support), [jetpack-cookies](#jetpack-cookies), [jetpack-stats-source-tracking-pixel](#jetpack-stats-source-tracking-pixel), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `matomo-cloud`: Matomo Cloud (Matomo), analytics. Hosts: `*.matomo.cloud`. Sources: [matomo-consent-faq](#matomo-consent-faq), [matomo-tracking-consent-guide](#matomo-tracking-consent-guide), [matomo-js-cookies-faq](#matomo-js-cookies-faq), [matomo-cloud-data-location](#matomo-cloud-data-location), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `plausible`: Plausible Analytics (Plausible), analytics. Hosts: `plausible.io`. Sources: [plausible-data-policy](#plausible-data-policy), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023).
- `mouseflow`: Mouseflow (session recording traffic) (Mouseflow), session-recording. Hosts: `*.mouseflow.com`. Sources: [mouseflow-consent-integration](#mouseflow-consent-integration), [mouseflow-cookie-policy](#mouseflow-cookie-policy), [mouseflow-disable-cookies](#mouseflow-disable-cookies), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `mouseflow-loader`: Mouseflow script loader (Mouseflow), session-recording. Hosts: `cdn.mouseflow.com`. Sources: [mouseflow-consent-integration](#mouseflow-consent-integration).
- `hubspot-tracking-code`: HubSpot tracking code (HubSpot), marketing-automation. Hosts: `*.hs-scripts.com`, `*.hs-analytics.net`, `*.hscollectedforms.net`. Sources: [hubspot-cookies](#hubspot-cookies), [hubspot-domain-security](#hubspot-domain-security), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `klaviyo-onsite-js`: Klaviyo onsite JavaScript (klaviyo.js) (Klaviyo), marketing-automation. Hosts: `static.klaviyo.com`. Sources: [klaviyo-cookies](#klaviyo-cookies), [klaviyo-onsite-tracking](#klaviyo-onsite-tracking).
- `leadfeeder`: Leadfeeder / Dealfront Web Visitors (Dealfront), marketing-automation. Hosts: `*.lfeeder.com`, `*.leadfeeder.com`. Sources: [leadfeeder-tracking-script](#leadfeeder-tracking-script), [leadfeeder-cmp-consent-mode](#leadfeeder-cmp-consent-mode), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `awin`: AWIN (affiliate tracking: MasterTag and conversion tag) (Awin), advertising. Hosts: `*.dwin1.com`, `www.awin1.com`. Sources: [tdddg-25](#tdddg-25), [edpb-guidelines-2-2023](#edpb-guidelines-2-2023), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [awin-consent-framework](#awin-consent-framework), [awin-advertiser-mastertag](#awin-advertiser-mastertag), [awin-gtm-consent-signals](#awin-gtm-consent-signals).
- `tidio`: Tidio chat widget (Tidio), chat. Hosts: `*.tidio.co`, `uploads.tidio.com`, `*.tidiochat.com`, `tidio-images-messenger.s3.us-east-1.amazonaws.com`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `userlike`: Userlike chat widget (Lime Connect since Sept. 2025) (Userlike / Lime Connect (Lime Technologies)), chat. Hosts: `*.userlike.com`, `userlike-cdn-widgets.s3-eu-west-1.amazonaws.com`, `userlike-cdn-operators.s3-eu-west-1.amazonaws.com`, `userlike-store-media-files.s3.amazonaws.com`, `userlike-cdn-umm.b-cdn.net`, `userlike-cdn-web.b-cdn.net`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `judge-me`: Judge.me product review widgets (Judge.me), reviews. Hosts: `cdn.judge.me`, `cdnwidget.judge.me`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `provenexpert`: ProvenExpert review seal and widgets (ProvenExpert), reviews. Hosts: `www.provenexpert.com`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `trusted-shops`: Trusted Shops Trustbadge and review widgets (Trusted Shops), reviews. Hosts: `*.trustedshops.com`, `integrations.etrusted.com`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `trustpilot`: Trustpilot TrustBox widgets (Trustpilot), reviews. Hosts: `widget.trustpilot.com`, `invitejs.trustpilot.com`, `ecommplugins-scripts.trustpilot.com`, `images-static.trustpilot.com`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `calendly`: Calendly scheduling embed (Calendly), booking. Hosts: `assets.calendly.com`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `elfsight`: Elfsight widget platform (Elfsight), widget-platform. Hosts: `*.elfsight.com`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `trustindex`: Trustindex review widgets (Trustindex), widget-platform. Hosts: `cdn.trustindex.io`. Sources: [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `klarna`: Klarna (Web SDK / On-Site Messaging) (Klarna), payment. Hosts: `js.klarna.com`, `*.klarna.com`, `x.klarnacdn.net`, `*.klarnacdn.net`, `osm.klarnaservices.com`, `*.klarnaservices.com`, `*.klarnaevt.com`. Sources: [klarna-websdk-browser-security](#klarna-websdk-browser-security), [klarna-osm-web-integration](#klarna-osm-web-integration), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25).
- `paypal`: PayPal (JavaScript SDK) (PayPal), payment. Hosts: `*.paypal.com`, `*.paypalobjects.com`. Sources: [paypal-sdk-best-practices](#paypal-sdk-best-practices), [paypal-sdk-configuration](#paypal-sdk-configuration), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25).
- `stripe`: Stripe (Stripe.js, Link) (Stripe), payment. Hosts: `js.stripe.com`, `m.stripe.com`, `*.stripe.com`, `link.com`, `*.link.com`. Sources: [stripe-security-guide](#stripe-security-guide), [stripe-advanced-fraud-detection](#stripe-advanced-fraud-detection), [stripe-js-including](#stripe-js-including), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25).
- `cloudflare-turnstile`: Cloudflare Turnstile (Cloudflare), captcha. Hosts: `challenges.cloudflare.com`. Sources: [turnstile-csp](#turnstile-csp), [turnstile-client-rendering](#turnstile-client-rendering), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `friendly-captcha`: Friendly Captcha (Friendly Captcha), captcha. Hosts: `*.frcapi.com`, `*.friendlycaptcha.com`, `*.friendlycaptcha.eu`, `cdn.jsdelivr.net/npm/friendly-challenge`, `cdn.jsdelivr.net/npm/@friendlycaptcha/`. Sources: [friendlycaptcha-csp](#friendlycaptcha-csp), [friendlycaptcha-eu-endpoint](#friendlycaptcha-eu-endpoint), [friendlycaptcha-v1-upgrade](#friendlycaptcha-v1-upgrade), [friendlycaptcha-wp-readme](#friendlycaptcha-wp-readme), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `google-recaptcha`: Google reCAPTCHA (Google), captcha. Hosts: `www.google.com/recaptcha/`, `www.gstatic.com/recaptcha/`, `recaptcha.google.com/recaptcha/`, `www.recaptcha.net`. Sources: [recaptcha-faq](#recaptcha-faq), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste), [tdddg-25](#tdddg-25).
- `hcaptcha`: hCaptcha (hCaptcha (Intuition Machines)), captcha. Hosts: `hcaptcha.com`, `*.hcaptcha.com`. Sources: [hcaptcha-docs](#hcaptcha-docs), [stripe-advanced-fraud-detection](#stripe-advanced-fraud-detection), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `accessibe`: accessiBe (accessiBe), accessibility-overlay. Hosts: `acsbapp.com`, `*.acsbapp.com`. Sources: [accessibe-wp-plugin-source](#accessibe-wp-plugin-source), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `eye-able`: Eye-Able (Eye-Able), accessibility-overlay. Hosts: `cdn.eye-able.com`, `*.eye-able.com`. Sources: [eye-able-help-center-source](#eye-able-help-center-source), [eye-able-usage-tracking](#eye-able-usage-tracking), [eye-able-data-processing](#eye-able-data-processing), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `userway`: UserWay accessibility widget (UserWay), accessibility-overlay. Hosts: `cdn.userway.org`, `*.userway.org`. Sources: [userway-wp-plugin-source](#userway-wp-plugin-source), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `google-translate-widget`: Google Translate (website widget, legacy) (Google), translation. Hosts: `translate.google.com/translate_a/`, `translate-pa.googleapis.com`. Sources: [gtranslate-blog-google-widget](#gtranslate-blog-google-widget), [gtranslate-wp-readme](#gtranslate-wp-readme), [google-website-translator-2020](#google-website-translator-2020), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `gtranslate`: GTranslate widget (GTranslate), translation. Hosts: `cdn.gtranslate.net`. Sources: [gtranslate-wp-readme](#gtranslate-wp-readme), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `cdnjs`: cdnjs (Cloudflare), cdn. Hosts: `cdnjs.cloudflare.com`. Sources: [cdnjs-about](#cdnjs-about), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `google-hosted-libraries`: Google Hosted Libraries (Google), cdn. Hosts: `ajax.googleapis.com`. Sources: [google-hosted-libraries-docs](#google-hosted-libraries-docs), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `jetpack-site-accelerator`: Jetpack Site Accelerator (image and asset CDN) (Automattic), cdn. Hosts: `i0.wp.com`, `i1.wp.com`, `i2.wp.com`, `i3.wp.com`, `c0.wp.com`. Sources: [jetpack-site-accelerator-docs](#jetpack-site-accelerator-docs), [jetpack-asset-cdn-source](#jetpack-asset-cdn-source), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `jquery-cdn`: jQuery CDN (OpenJS Foundation), cdn. Hosts: `code.jquery.com`. Sources: [jquery-cdn-releases](#jquery-cdn-releases), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `jsdelivr`: jsDelivr (incl. BootstrapCDN) (jsDelivr), cdn. Hosts: `cdn.jsdelivr.net`, `*.jsdelivr.net`, `*.bootstrapcdn.com`. Sources: [jsdelivr-readme](#jsdelivr-readme), [bootstrapcdn-site](#bootstrapcdn-site), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `unpkg`: unpkg (unpkg), cdn. Hosts: `unpkg.com`, `*.unpkg.com`. Sources: [unpkg-homepage](#unpkg-homepage), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `wordpress-emoji`: WordPress emoji images (s.w.org) (WordPress.org), cdn. Hosts: `s.w.org/images/core/emoji/`. Sources: [wordpress-emoji-url-hook](#wordpress-emoji-url-hook), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `jimdo-static-assets`: Jimdo (platform assets) (Jimdo), platform. Hosts: `assets.jimstatic.com`, `*.jimstatic.com`. Sources: [jimdo-legal-page-assets](#jimdo-legal-page-assets), [fastly-jimdo-case-study](#fastly-jimdo-case-study).
- `shopify-platform-telemetry`: Shopify (platform telemetry) (Shopify), platform. Hosts: `monorail-edge.shopifysvc.com`, `*.shopifysvc.com`. Sources: [shopify-dev-use-preconnect](#shopify-dev-use-preconnect), [shopify-help-consent](#shopify-help-consent).
- `wix-platform-other`: Wix (platform scripts and telemetry) (Wix), platform. Hosts: `static.parastorage.com`, `*.parastorage.com`, `frog.wix.com`. Sources: [wix-support-frog](#wix-support-frog), [wix-engineering-cdn-2021](#wix-engineering-cdn-2021).
- `gravatar`: Gravatar (Automattic), other. Hosts: `gravatar.com`, `*.gravatar.com`. Sources: [gravatar-image-requests](#gravatar-image-requests), [wordpress-get-avatar-data](#wordpress-get-avatar-data), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).

#### Class `not-flagged` (16)

- `shopify-cdn`: Shopify (store hosting CDN) (Shopify), platform. Hosts: `cdn.shopify.com`, `fonts.shopifycdn.com`. Sources: [shopify-changelog-asset-urls-2023](#shopify-changelog-asset-urls-2023), [shopify-dev-platform-cdn](#shopify-dev-platform-cdn), [shopify-dev-use-shopify-cdn](#shopify-dev-use-shopify-cdn), [shopify-dev-use-preconnect](#shopify-dev-use-preconnect), [shopify-changelog-file-cdn-2026](#shopify-changelog-file-cdn-2026), [shopify-dawn-theme-liquid](#shopify-dawn-theme-liquid).
- `wix-media`: Wix (site media hosting) (Wix), platform. Hosts: `static.wixstatic.com`. Sources: [wix-support-static-media](#wix-support-static-media), [wix-dev-image-transformation](#wix-dev-image-transformation), [wix-engineering-cdn-2021](#wix-engineering-cdn-2021).
- `ccm19`: CCM19 (cloud) (CCM19), consent. Hosts: `*.ccm19.de`. Sources: [ccm19-integration-docs](#ccm19-integration-docs), [ccm19-vendor-site](#ccm19-vendor-site), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `consentmanager`: consentmanager.net CMP (consentmanager), consent. Hosts: `*.consentmanager.net`. Sources: [consentmanager-stub-code](#consentmanager-stub-code), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `cookiebot`: Cookiebot CMP (Usercentrics), consent. Hosts: `consent.cookiebot.com`, `consentcdn.cookiebot.com`, `consentcdn.cookiebot.eu`. Sources: [cookiebot-developer-docs](#cookiebot-developer-docs), [cookiebot-uc-js](#cookiebot-uc-js), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `cookiefirst`: CookieFirst (CookieFirst), consent. Hosts: `consent.cookiefirst.com`. Sources: [cookiefirst-public-api](#cookiefirst-public-api), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `cookieyes`: CookieYes (CookieYes), consent. Hosts: `cdn-cookieyes.com`, `*.cookieyes.com`. Sources: [cookieyes-csp](#cookieyes-csp), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `didomi`: Didomi CMP (Didomi), consent. Hosts: `sdk.privacy-center.org`, `api.privacy-center.org`. Sources: [didomi-domains](#didomi-domains), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `hu-manity`: Cookie Compliance by Hu-manity.co (Cookie Notice plugin, Compliance mode) (Hu-manity.co), consent. Hosts: `*.hu-manity.co`. Sources: [cookie-notice-plugin-source](#cookie-notice-plugin-source), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `iubenda`: iubenda Cookie Solution (iubenda), consent. Hosts: `*.iubenda.com`. Sources: [iubenda-cs-advanced-guide](#iubenda-cs-advanced-guide), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `klaro`: Klaro! (KIProtect CDN) (KIProtect), consent. Hosts: `cdn.kiprotect.com`. Sources: [klaro-readme](#klaro-readme), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `onetrust`: OneTrust Cookie Consent / CookiePro (OneTrust), consent. Hosts: `cdn.cookielaw.org`, `cookie-cdn.cookiepro.com`, `*.onetrust.com`. Sources: [onetrust-csp-cdn](#onetrust-csp-cdn), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `shopify-privacy-banner`: Shopify cookie banner / Customer Privacy API scripts (Shopify), consent. Hosts: `cdn.shopify.com/shopifycloud/privacy-banner/`, `cdn.shopify.com/shopifycloud/consent-tracking-api/`. Sources: [shopify-privacy-banner-scripts](#shopify-privacy-banner-scripts), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `sourcepoint`: Sourcepoint CMP (Sourcepoint), consent. Hosts: `cdn.privacy-mgmt.com`, `*.privacy-mgmt.com`. Sources: [sourcepoint-docs-api](#sourcepoint-docs-api), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `trustarc`: TrustArc Consent Manager (TrustArc), consent. Hosts: `*.trustarc.com`. Sources: [trustarc-notice-script](#trustarc-notice-script), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).
- `usercentrics`: Usercentrics CMP (Browser UI v2 / Web CMP v3) (Usercentrics), consent. Hosts: `*.usercentrics.eu`. Sources: [usercentrics-csp-domains](#usercentrics-csp-domains), [tdddg-25](#tdddg-25), [dsk-oh-digitale-dienste](#dsk-oh-digitale-dienste).

## Sources

### accessibe-wp-plugin-source

- Kind: official-documentation
- Issuer: accessiBe
- Reference: plugins.svn.wordpress.org trunk
- URL: https://plugins.svn.wordpress.org/accessibe/trunk/class.accessibeforwp.php
- What it supports: The official plugin loads the widget from https://acsbapp.com/apps/app/dist/js/app.js.
- Used for: `accessibe`

### awin-advertiser-mastertag

- Kind: official-documentation
- Issuer: Awin
- Date: 2024-10-31
- URL: https://help.awin.com/developers/docs/advertiser-mastertag
- What it supports: New source added by the fact-checker. The MasterTag (Journey Tag) loads from https://www.dwin1.com/{advertiserId}.js and is meant to be appended unconditionally to every page. It creates a first-party cookie whose value comes from the awc= click parameter. The page does not discuss consent.
- Used for: `awin`

### awin-consent-framework

- Kind: official-documentation
- Issuer: Awin
- Date: 2026-04-23
- URL: https://help.awin.com/developers/docs/consent-framework
- What it supports: Awin makes the advertiser responsible for obtaining cookie consent for Awin's tracking. It says Awin may set cookies without consent where it considers them strictly necessary (cashback, loyalty), and that it assumes consent when no consent parameter is passed.
- Used for: `awin`

### awin-gtm-consent-signals

- Kind: official-documentation
- Issuer: Awin
- Date: 2026-09-09
- URL: https://help.awin.com/developers/docs/gtm-consent
- What it supports: New source added by the fact-checker. Awin's consent-signal tags fire first, and the MasterTag and conversion tag fire on Page View. If consent is denied, no cookie is set on the landing page and cookies are not read at checkout, except cookies Awin considers strictly necessary for cashback and loyalty.
- Used for: `awin`

### baylfd-aki42-web-fonts

- Kind: dpa-guidance
- Issuer: Der Bayerische Landesbeauftragte für den Datenschutz (BayLfD)
- Date: 2022-11-01
- Reference: Aktuelle Kurz-Information 42, Stand: 1. November 2022
- URL: https://www.datenschutz-bayern.de/datenschutzreform2018/aki42.pdf
- Where: Rn. 4, 6-8 (incl. Hinweis on § 25 TTDSG), 10, 14-15
- What it supports: Externally hosted web fonts send at least the IP address to the third-party provider (Rn. 4), and this needs an Art. 6(1) GDPR legal basis (Rn. 6). The site operator is controller for the collection and transmission (Rn. 7, citing EuGH C-40/17). Bavarian public bodies can in practice rely only on consent. Private bodies could not rely on legitimate interest either while local hosting is a preferable alternative (Rn. 8, citing LG München I 3 O 17493/20 Rn. 8). No data may go to the third-party server before consent (Rn. 10). Self-hosting is recommended (Rn. 14-15). Caveats: the guidance is addressed to Bavarian public bodies (it is BayLfD, not the private-sector authority BayLDA), and § 25 TTDSG applies only if cookies or similar technologies are used (Hinweis in Rn. 8).
- Used for: `bunny-fonts`, `google-fonts`

### bgh-cookie-einwilligung-2

- Kind: court-ruling
- Issuer: Bundesgerichtshof (I. Zivilsenat)
- Date: 2020-05-28
- Reference: I ZR 7/16 (Pressemitteilung Nr. 067/2020)
- URL: https://www.bundesgerichtshof.de/SharedDocs/Pressemitteilungen/DE/2020/2020067.html
- Where: Press release, section on cookie consent
- What it supports: § 15(3) sentence 1 TMG must be read in line with Art. 5(3) ePrivacy Directive. Using cookies to create user profiles for advertising or market research therefore requires the user's consent. A pre-ticked checkbox that the user must untick is not valid consent, both under the law before 25.05.2018 and under Art. 4(11) GDPR. This is the German case-law starting point for consent before § 25 TTDSG/TDDDG.
- Used for: `criteo`, `google-ads`, `google-analytics-advertising-features`, `microsoft-advertising-uet`, `linkedin-insight-tag`, `meta-pixel`, `pinterest-tag`, `snap-pixel`, `tiktok-pixel`, `x-pixel`

### bootstrapcdn-site

- Kind: official-documentation
- Issuer: jsDelivr (BootstrapCDN)
- Reference: www.bootstrapcdn.com; github.com/jsdelivr/bootstrapcdn README
- URL: https://www.bootstrapcdn.com/
- What it supports: www.bootstrapcdn.com says it is powered by jsDelivr and the Globalping platform. The BootstrapCDN README, in the jsdelivr GitHub organisation, uses cdn.jsdelivr.net in its example links. Neither page names the legacy subdomains (maxcdn., stackpath. or netdna.bootstrapcdn.com).
- Used for: `jsdelivr`

### brevo-tracker-faq

- Kind: official-documentation
- Issuer: Brevo
- Reference: help.brevo.com article 209465705
- URL: https://help.brevo.com/hc/en-us/articles/209465705-FAQs-What-is-the-Brevo-tracker-and-how-to-install-it
- What it supports: The Brevo tracker uses first- or third-party cookies to collect visitor activity and sends it to the Brevo account. It tracks page views automatically once installed. By default a visitor_id cookie is placed when the tracker is installed. The tracker is also needed for the Conversations, Web Push, Automations and Segments apps.
- Used for: `brevo-tracker`

### bunny-fonts-about

- Kind: official-documentation
- Issuer: BunnyWay d.o.o. (bunny.net)
- Date: undated (accessed 2026-11-20)
- URL: https://fonts.bunny.net/about
- Where: Section 'Fully GDPR Compliant'
- What it supports: The provider describes Bunny Fonts as an open-source, privacy-first web-font platform with a zero-tracking, no-logging policy, delivered over bunny.net's global CDN. It says the fonts are hosted by BunnyWay d.o.o., which it calls an EU-based company. The API is compatible with the Google Fonts CSS v1 API, and sites are told to put https://fonts.bunny.net/css in place of https://fonts.googleapis.com/css. These are the provider's own claims, not an authority's assessment.
- Used for: `bunny-fonts`

### ccm19-integration-docs

- Kind: official-documentation
- Issuer: CCM19 (Papoo Software & Media GmbH)
- URL: https://docs.ccm19.com/integrationen/ccm19-standard/
- What it supports: The snippet has the form <script src="http://CCM19ServerUrl/app.js?apiKey=...&domain=...&lang=de_DE" referrerpolicy="origin">. The real snippet is generated per domain in the CCM19 dashboard. The page does not say whether CCM19ServerUrl is the cloud or a self-hosted server and names no concrete cloud host.
- Used for: `ccm19`

### ccm19-vendor-site

- Kind: official-documentation
- Issuer: CCM19 (Papoo Software & Media GmbH)
- URL: https://www.ccm19.de/en/
- What it supports: The vendor's own site embeds https://pcdn.ccm19.de/app.js?apiKey=...&domain=...&lang=en_US. This confirms a CCM19 cloud script host under ccm19.de. cloud.ccm19.de is the dashboard login.
- Used for: `ccm19`

### cdnjs-about

- Kind: official-documentation
- Issuer: cdnjs / Cloudflare
- URL: https://cdnjs.com/about
- What it supports: The page says cdnjs is powered by Cloudflare and that every file is served directly from Cloudflare's global network. Library file URLs use cdnjs.cloudflare.com, for example on cdnjs.com/libraries/jquery. Apart from a link to Cloudflare's privacy policy, the page makes no privacy statement.
- Used for: `cdnjs`

### cloudflare-privacy-first-web-analytics

- Kind: official-documentation
- Issuer: Cloudflare (blog, author Jon Levine)
- Date: 2020-12-09
- URL: https://blog.cloudflare.com/privacy-first-web-analytics/
- What it supports: Cloudflare uses no client-side state such as cookies or localStorage for analytics. It does not track users over time by IP, user agent or other immutable attributes, and it counts a visit as a page view arriving from another site.
- Used for: `cloudflare-web-analytics`

### cloudflare-web-analytics-faq

- Kind: official-documentation
- Issuer: Cloudflare
- URL: https://developers.cloudflare.com/web-analytics/faq/
- What it supports: The beacon script is https://static.cloudflareinsights.com/beacon.min.js. Manual setups report to cloudflareinsights.com/cdn-cgi/rum. Automatic setups on proxied sites report to the site's own /cdn-cgi/rum.
- Used for: `cloudflare-web-analytics`

### consentmanager-stub-code

- Kind: official-documentation
- Issuer: consentmanager (by iubenda)
- URL: https://www.consentmanager.net/en/help/developer-reference/adjusting-the-stub-code/
- What it supports: The default stub sets cmp_host='delivery.consentmanager.net' (cmp.php config) and cmp_cdn='cdn.consentmanager.net' (cmp_<lang>.min.js).
- Used for: `consentmanager`

### cookie-notice-plugin-source

- Kind: official-documentation
- Issuer: Hu-manity.co
- Reference: Cookie Notice 3.1.19
- URL: https://plugins.svn.wordpress.org/cookie-notice/trunk/cookie-notice.php
- What it supports: The plugin defines app.hu-manity.co, account-api., designer-api. and transactional-api.hu-manity.co, and the widget //cdn.hu-manity.co/hu-banner.min.js. bot_detection defaults to true. In includes/frontend.php, maybe_display_banner() returns false for crawlers. The cn_is_bot result is forced to false when WP_CACHE is true. The hu-banner script (id hu-banner-js) is only output when the banner is displayed. includes/bot-detect.php is a CrawlerDetect-based list that includes HeadlessChrome and Lighthouse. It matches against the HTTP User-Agent plus other headers such as From and X-Scanner.
- Used for: `hu-manity`

### cookiebot-developer-docs

- Kind: official-documentation
- Issuer: Cookiebot (Usercentrics A/S)
- URL: https://www.cookiebot.com/en/developer/
- What it supports: The script tag loads https://consent.cookiebot.com/uc.js with data-cbid. consent.method is 'implied' when consent is given automatically and 'explicit' when the user gives it. The page does not mention bots, EU domains or #CybotCookiebotDialog.
- Used for: `cookiebot`

### cookiebot-uc-js

- Kind: official-documentation
- Issuer: Cookiebot (Usercentrics)
- Date: 2026-11-19
- Reference: uc.js 2.146.0
- URL: https://consent.cookiebot.com/uc.js
- What it supports: The header reads '2.146.0 - 2026-11-19'. The default host is consent.cookiebot.com with CDN consentcdn.cookiebot.com, or consentcdn.cookiebot.eu if the script host ends in cookiebot.eu. isSpider() tests a UA regex: Googlebot/, bingbot/, Applebot/, Chrome-Lighthouse, Google Page Speed Insights, PTST/, SEMrushBot, Siteimprove, Prerender/, PetalBot/ and others, with no HeadlessChrome. init() then calls setOutOfRegion(), which sets preferences, statistics and marketing to true with method 'implied'. Bot detection is on by default. It is disabled by g_disable_bot_detection=1 in the page URL (read from window.location.href). uc.js can also inject TWIPLA visitor analytics (privacy-analytics-proxy.cookiebot.com, app-worker.visitor-analytics.io), which it skips for spiders.
- Used for: `cookiebot`

### cookiefirst-public-api

- Kind: official-documentation
- Issuer: CookieFirst
- URL: https://support.cookiefirst.com/hc/en-us/articles/360011568738-Cookie-Banner-Public-API-documentation
- What it supports: The banner is embedded via https://consent.cookiefirst.com/banner.js?cookiefirst-key=... The vendor's banner.js document.writes consent.cookiefirst.com/sites/<domain>-<key>/consent.js, with a wildcard-domain fallback, and logs a warning that banner.js is deprecated.
- Used for: `cookiefirst`

### cookieyes-csp

- Kind: official-documentation
- Issuer: CookieYes
- Date: 2024-03-14
- URL: https://www.cookieyes.com/documentation/content-security-policy/
- What it supports: The CSP example allows cdn-cookieyes.com in script-src, img-src and connect-src. *.cookieyes.com is allowed only in connect-src. The prose also names cdn.cookieyes.com, which is in no directive.
- Used for: `cookieyes`

### crisp-docs-cookie-policies

- Kind: official-documentation
- Issuer: Crisp IM SAS (per page footer; not 'Crisp IM SARL')
- URL: https://docs.crisp.chat/guides/chatbox-sdks/web-sdk/cookie-policies/
- What it supports: Crisp's docs describe a chatbox session cookie, set on the site's base domain by default, with a default lifetime of six months (CRISP_COOKIE_EXPIRE can shorten it). Its expiry is extended on every visit by a visitor who already has the cookie. The loader is client.crisp.chat/l.js.
- Used for: `crisp`

### didomi-domains

- Kind: official-documentation
- Issuer: Didomi
- URL: https://developers.didomi.io/api-and-platform/domains/reverse-proxy.md
- What it supports: The Didomi SDKs are served on sdk.privacy-center.org and the API on api.privacy-center.org. The getting-started page says the SDK creates div#didomi-host and appends it to the end of <body>.
- Used for: `didomi`

### dsk-2020-google-analytics

- Kind: dpa-guidance
- Issuer: Konferenz der unabhängigen Datenschutzaufsichtsbehörden des Bundes und der Länder (DSK)
- Date: 2020-05-12
- Reference: Beschluss vom 12.05.2020
- URL: https://www.datenschutzkonferenz-online.de/media/dskb/20200526_beschluss_hinweise_zum_einsatz_von_google_analytics.pdf
- Where: III. Rechtsgrundlage; IV.1
- What it supports: Section III: Google Analytics can as a rule be used lawfully only with effective consent of the site visitors, not under Art. 6(1)(b) or (f) GDPR. Section IV.1: consent must be informed, voluntary, active and prior, and before active consent no data may be collected and no elements from Google websites may be loaded. The resolution covers Google's recommended default settings as of 11.03.2020. It is a GDPR analysis written before the TTDSG.
- Used for: `google-tag-manager`, `google-analytics`

### dsk-oh-digitale-dienste

- Kind: dpa-guidance
- Issuer: Datenschutzkonferenz (DSK)
- Date: 2024-11
- Reference: Version 1.2 (Stand November 2024), Rn. 74, 84, 92, 121
- URL: https://www.datenschutzkonferenz-online.de/media/oh/OH_Digitale_Dienste.pdf
- Where: Rz. 5, 8, 21-24, 74-84, 87-95, 101, 109-114, 121-122
- What it supports: Rn. 74 only lists 'Verwaltung von Einwilligungen mittels Consent-Management-Tools' among add-on services offered next to the basic service. The same list includes advertising, maps and videos. It makes no finding that consent management is strictly necessary, so the research overstated it. Rn. 84: proving consent needs no long-lived UID cookies; a cookie without UID or extra data holding the result is generally enough. Rn. 92: CMP cookies with a unique user ID are not needed to store consent status and suggest reuse for marketing. Rn. 121: while the banner is shown, no consent-requiring scripts or third-party content may load. No paragraph exempts CMP requests as such. Not-flagged for consent tools therefore rests on the product rule plus the § 25(2) Nr. 2 / Rn. 84 reasoning, not on Rn. 74.
- Used for: `adobe-fonts`, `bunny-fonts`, `font-awesome`, `google-fonts`, `google-tag-manager`, `cloudflare-web-analytics`, `etracker`, `fathom`, `google-analytics`, `jetpack-stats`, `matomo-cloud`, `plausible`, `yandex-metrica`, `hotjar`, `microsoft-clarity`, `mouseflow`, `brevo-tracker`, `hubspot-tracking-code`, `klaviyo-client-events`, `leadfeeder`, `awin`, `criteo`, `google-ads`, `google-analytics-advertising-features`, `microsoft-advertising-uet`, `linkedin-insight-tag`, `meta-pixel`, `pinterest-tag`, `snap-pixel`, `tiktok-pixel`, `x-pixel`, `google-maps`, `openstreetmap-tiles`, `vimeo`, `youtube`, `youtube-nocookie`, `facebook-social-plugins`, `instagram-embeds`, `x-embeds`, `crisp`, `intercom`, `livechat`, `smartsupp`, `tawk-to`, `tidio`, `userlike`, `zendesk-web-widget`, `judge-me`, `provenexpert`, `trusted-shops`, `trustpilot`, `calendly`, `elfsight`, `trustindex`, `klarna`, `paypal`, `stripe`, `cloudflare-turnstile`, `friendly-captcha`, `google-recaptcha`, `hcaptcha`, `accessibe`, `eye-able`, `userway`, `google-translate-widget`, `gtranslate`, `cdnjs`, `google-hosted-libraries`, `jetpack-site-accelerator`, `jquery-cdn`, `jsdelivr`, `unpkg`, `wordpress-emoji`, `ccm19`, `consentmanager`, `cookiebot`, `cookiefirst`, `cookieyes`, `didomi`, `hu-manity`, `iubenda`, `klaro`, `onetrust`, `shopify-privacy-banner`, `sourcepoint`, `trustarc`, `usercentrics`, `gravatar`

### edpb-guidelines-2-2023

- Kind: dpa-guidance
- Issuer: European Data Protection Board (EDPB)
- Date: 2024-10-07
- Reference: Version 2.0 adopted 7 October 2024 (Version 1.0 adopted 14 November 2023 for public consultation)
- URL: https://www.edpb.europa.eu/system/files/documents/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf
- Where: paras 32-34, 40, 47-51, 54-56
- What it supports: Art. 5(3) ePD applies whenever an entity instructs the terminal to send back information (paras 32-34). Examples: cookies, JavaScript sending asynchronous requests, and a website making the terminal send information to third-party advertising services through a tracking pixel. Distributing tracking pixels or links counts as storage, at least through caching (para 50). Collecting the identifiers they carry is 'gaining of access' (para 51). IP-only tracking can be covered when the IP address originates from the user's terminal (paras 54-55). The guidelines do not analyse the consent exemptions, and applicability does not automatically mean consent is required (paras 40, 56).
- Used for: `cloudflare-web-analytics`, `fathom`, `plausible`, `microsoft-clarity`, `awin`, `criteo`, `google-ads`, `google-analytics-advertising-features`, `microsoft-advertising-uet`, `linkedin-insight-tag`, `meta-pixel`, `pinterest-tag`, `snap-pixel`, `tiktok-pixel`, `x-pixel`

### edpb-guidelines-8-2020

- Kind: dpa-guidance
- Issuer: European Data Protection Board
- Date: 2021-04-13
- Reference: Version 2.0
- URL: https://www.edpb.europa.eu/system/files/documents/2021-04/edpb_guidelines_082020_on_the_targeting_of_social_media_users_en.pdf
- Where: Section 5.3, Example 4 'Pixel-based targeting', 5.3.1 Roles, 5.3.2 Legal basis
- What it supports: Section 5.3, Example 4 'Pixel-based targeting'. Section 5.3.1: the website and the social media provider are joint controllers for collecting and transmitting data via the pixel. Section 5.3.2: Art. 5(3) ePrivacy applies, consent must come before processing, and legitimate interest cannot be the legal basis because the targeting monitors behaviour across websites.
- Used for: `linkedin-insight-tag`, `meta-pixel`, `pinterest-tag`, `snap-pixel`, `tiktok-pixel`, `x-pixel`

### etracker-basis-integration

- Kind: official-documentation
- Issuer: etracker
- URL: https://help.etracker.com/article/basis-integration/
- What it supports: The tracking code loads //code.etracker.com/code/e.js with data-block-cookies="true", so no etracker cookies are set by default; cookies can be activated after consent. The CSP needs script-src *.etracker.com and *.etracker.de, connect-src *.etracker.de, and img-src *.etracker.com and *.etracker.de. An own tracking domain is possible.
- Used for: `etracker`

### etracker-consent-free

- Kind: official-documentation
- Issuer: etracker
- URL: https://www.etracker.com/en/consent-free-and-legally-compliant/
- What it supports: This is the provider's own legal view, not a DPA statement. By default etracker reads no device properties such as screen size, does no fingerprinting and uses only functional or strictly necessary cookies. Analytics cookies are activated only after consent ('hybrid mode'). The page cites OH Digitale Dienste Rn. 24 for the fingerprinting point.
- Used for: `etracker`

### eugh-fashion-id

- Kind: court-ruling
- Issuer: Gerichtshof der Europäischen Union
- Date: 2019-07-29
- Reference: C-40/17 (Pressemitteilung Nr. 99/19)
- URL: https://curia.europa.eu/site/upload/docs/application/pdf/2019-07/cp190099de.pdf
- Where: Press release, summary of the operative findings
- What it supports: A site operator that embeds Facebook's 'Like' button, which makes visitors' browsers send personal data to Facebook, can be joint controller with Facebook for collecting and transmitting those data. It is in principle not responsible for Facebook's later processing. If consent is the legal basis, the operator must obtain it in advance, but only for the operations it co-controls: collection and transmission. If legitimate interests are the basis, each joint controller must pursue one. The case was decided under Directive 95/46/EC. BayLfD AKI 42 Rn. 7 applies the same reasoning to externally hosted web fonts.
- Used for: `google-fonts`, `linkedin-insight-tag`, `meta-pixel`, `pinterest-tag`, `snap-pixel`, `tiktok-pixel`, `x-pixel`, `youtube`, `facebook-social-plugins`

### eugh-meta-bundeskartellamt

- Kind: court-ruling
- Issuer: Court of Justice of the European Union
- Date: 2023-07-04
- Reference: C-252/21
- URL: https://curia.europa.eu/jcms/upload/docs/application/pdf/2023-07/cp230113en.pdf
- Where: Press release No 113/23
- What it supports: Meta collects 'off-Facebook data' on visits to third-party websites and apps and uses it for personalised advertising. The Court held that this personalised advertising cannot justify the processing as Meta's legitimate interest without the user's consent. This concerns Meta's own legal basis, so for the website operator it is supporting evidence only.
- Used for: `meta-pixel`

### eugh-planet49

- Kind: court-ruling
- Issuer: Gerichtshof der Europäischen Union
- Date: 2019-10-01
- Reference: C-673/17 (Pressemitteilung Nr. 125/19)
- URL: https://curia.europa.eu/site/upload/docs/application/pdf/2019-10/cp190125de.pdf
- Where: Press release, summary of the operative findings
- What it supports: A pre-ticked checkbox that the user must untick is not valid consent to storing or accessing cookies. It makes no difference whether the information is personal data. Consent must be given for the specific case: clicking the button to join the lottery is not consent to cookies. The provider must tell users, among other things, how long cookies last and whether third parties can access them. The press release is a non-binding document for the media.
- Used for: `criteo`, `google-ads`, `meta-pixel`

### eye-able-data-processing

- Kind: official-documentation
- Issuer: Eye-Able
- URL: https://help.eye-able.com/datenverarbeitung-bei-eye-able
- What it supports: Eye-Able Assist can be loaded from the customer's own server, from a German server in Frankfurt, or through a European CDN. Translation data is sent to servers in the EU over TLS. The page names no hostnames.
- Used for: `eye-able`

### eye-able-help-center-source

- Kind: official-documentation
- Issuer: Eye-Able
- URL: https://help.eye-able.com/
- What it supports: Eye-Able's own help center loads cdn.eye-able.com/configs/help.eye-able.com.js and cdn.eye-able.com/public/js/eyeAble.js, plus access.eye-able.com/configs/help.eye-able.com.js. This is technical evidence of the standard integration hosts.
- Used for: `eye-able`

### eye-able-usage-tracking

- Kind: official-documentation
- Issuer: Eye-Able
- URL: https://help.eye-able.com/nutzungs-tracking-bei-den-eye-able-website-tools
- What it supports: Eye-Able says it does not track or store usage of its website tools itself. Site owners who want usage statistics can set up their own tracking.
- Used for: `eye-able`

### fastly-jimdo-case-study

- Kind: official-documentation
- Issuer: Fastly
- URL: https://www.fastly.com/customers/jimdo
- What it supports: Jimdo first used Fastly to serve static assets such as JavaScript and CSS to website visitors, and later to resize images on its customers' sites. The page names no Jimdo asset hosts.
- Used for: `jimdo-static-assets`

### fathom-compliance

- Kind: official-documentation
- Issuer: Fathom
- URL: https://usefathom.com/legal/compliance
- What it supports: Fathom uses no tracking cookies and builds site-specific visitor signatures with a daily-rotating salt. Fathom says hashing is not by itself a legal guarantee of anonymity, and that cookie-free does not automatically mean outside device-access rules; consent depends on the technology, purpose and law.
- Used for: `fathom`

### fontawesome-use-kit

- Kind: official-documentation
- Issuer: Font Awesome
- URL: https://docs.fontawesome.com/web/setup/use-kit
- What it supports: The kit embed script loads from kit.fontawesome.com, and Font Awesome counts a pageview whenever a kit loads on a page. The page does not name ka-f., ka-p. or use.fontawesome.com.
- Used for: `font-awesome`

### friendlycaptcha-csp

- Kind: official-documentation
- Issuer: Friendly Captcha
- URL: https://developer.friendlycaptcha.com/docs/v2/guides/csp.md
- What it supports: The v2 widget iframes come from *.frcapi.com, and in most cases frame-src https://*.frcapi.com is the only directive needed.
- Used for: `friendly-captcha`

### friendlycaptcha-eu-endpoint

- Kind: official-documentation
- Issuer: Friendly Captcha
- URL: https://developer.friendlycaptcha.com/docs/v2/guides/eu-endpoint.md
- What it supports: By default the widget talks to a global service served from all over the world (global.frcapi.com), and depending on the user's location requests may be served from outside the EU. An optional EU endpoint (eu.frcapi.com) is hosted in Germany. It is a premium feature that needs an Advanced or Enterprise plan.
- Used for: `friendly-captcha`

### friendlycaptcha-v1-upgrade

- Kind: official-documentation
- Issuer: Friendly Captcha
- URL: https://developer.friendlycaptcha.com/docs/v2/guides/upgrading-from-v1/script.md
- What it supports: The v1 widget loads from cdn.jsdelivr.net/npm/friendly-challenge@0.9.12/ and the v2 widget from cdn.jsdelivr.net/npm/@friendlycaptcha/sdk@1.1.5/. The v1 EU puzzle endpoint is eu-api.friendlycaptcha.eu.
- Used for: `friendly-captcha`

### friendlycaptcha-wp-readme

- Kind: official-documentation
- Issuer: Friendly Captcha
- Reference: Stable tag 1.19.1
- URL: https://plugins.svn.wordpress.org/friendly-captcha/trunk/readme.txt
- What it supports: The vendor says its end-user solution uses no cookies, that it does not store end users' personal data, and that requests are processed at the point of presence closest to the user by default. The 1.2.0 changelog names api.friendlycaptcha.com.
- Used for: `friendly-captcha`

### google-eu-user-consent-policy

- Kind: official-documentation
- Issuer: Google
- URL: https://www.google.com/about/company/user-consent-policy/
- What it supports: For end users in the EEA, UK and Switzerland, sites using Google products must obtain consent to the use of cookies or other local storage where legally required, and to the collection, sharing and use of personal data for ad personalisation. They must clearly identify each party that may collect, receive or use the data. This is a contractual requirement that defers to the law, so it supports but does not decide the class.
- Used for: `google-tag-manager`, `google-analytics`, `google-ads`, `google-analytics-advertising-features`

### google-hosted-libraries-docs

- Kind: official-documentation
- Issuer: Google
- URL: https://developers.google.com/speed/libraries
- What it supports: Google describes the service as a stable, reliable, high-speed, globally available content distribution network for open-source JavaScript libraries. Library URLs are on ajax.googleapis.com. The page says nothing about privacy, logging or cookies.
- Used for: `google-hosted-libraries`

### google-tag-install

- Kind: official-documentation
- Issuer: Google
- URL: https://developers.google.com/tag-platform/gtagjs/install
- What it supports: The current Google tag snippet loads https://www.googletagmanager.com/gtm.js?id=TAG_ID. Google says it upgraded all Google tags (gtag.js) to include Tag Manager capabilities. The tag is used with Google Ads, Google Analytics, Campaign Manager, DV360 and SA360.
- Used for: `google-tag-manager`

### google-website-translator-2020

- Kind: official-documentation
- Issuer: Google
- Date: 2020-05-19
- URL: https://developers.google.com/search/blog/2020/05/google-translates-website-translator
- What it supports: Google reopened access to the Website Translator, with use restricted to government, non-profit and non-commercial websites. The post gives no end-of-support date. It names translate.google.com but not translate.googleapis.com.
- Used for: `google-translate-widget`

### gravatar-image-requests

- Kind: official-documentation
- Issuer: Gravatar (Automattic)
- URL: https://docs.gravatar.com/sdk/images/
- What it supports: Avatar images are requested from gravatar.com/avatar/HASH, with www.gravatar.com in the examples. HASH is a SHA256 hash of the user's email address.
- Used for: `gravatar`

### gtranslate-blog-google-widget

- Kind: official-documentation
- Issuer: GTranslate
- Date: 2026-09-06
- URL: https://gtranslate.io/blog/google-translate-website-widget-discontinued
- What it supports: The legacy widget code loads translate.google.com/translate_a/element.js?cb=googleTranslateElementInit. GTranslate says the widget is no longer supported from October 1, 2026. Its 'Google announced' link points to Google's May 2020 Search Central post, which does not contain that date. The date is therefore a third-party claim only.
- Used for: `google-translate-widget`

### gtranslate-wp-readme

- Kind: official-documentation
- Issuer: GTranslate, Inc.
- Reference: Stable tag 5.0.2
- URL: https://plugins.svn.wordpress.org/gtranslate/trunk/readme.txt
- What it supports: The widget files load from cdn.gtranslate.net. When page translation is requested, page text is sent from the visitor's browser to translate-pa.googleapis.com. The readme lists a feature 'Auto-switch language based on browser defined language'. It advises site owners to review these services for their privacy information and consent and CSP settings. Version 5.0.1 replaced Google's legacy widget, and the FAQ says Google's support for it ends on October 1, 2026.
- Used for: `google-translate-widget`, `gtranslate`

### hcaptcha-docs

- Kind: official-documentation
- Issuer: hCaptcha (Intuition Machines)
- URL: https://docs.hcaptcha.com/
- What it supports: The script is https://js.hcaptcha.com/1/api.js. The CSP for script-src, frame-src, style-src and connect-src should include hcaptcha.com and *.hcaptcha.com. Specific subdomains such as newassets.hcaptcha.com should not be hard-coded.
- Used for: `hcaptcha`

### hotjar-tracking-code-cookies

- Kind: official-documentation
- Issuer: Hotjar
- Reference: help.hotjar.com article 36819973371409
- URL: https://help.hotjar.com/hc/en-us/articles/36819973371409-Cookies-Set-by-the-Hotjar-Tracking-Code
- What it supports: When the tracking code loads it sets _hjSessionUser_{site_id} on the user's first landing (365 days; persists the Hotjar user ID). It also sets _hjSession_{site_id} (30 minutes), test cookies, and local and session storage items. Hotjar does not track users who have cookies disabled. To stop the code loading before consent, Hotjar points to consent solutions that block loading. It leaves cookie classification, and whether a cookie manager is needed, to the customer's legal counsel and does not itself say consent is required.
- Used for: `hotjar`

### hubspot-cookies

- Kind: official-documentation
- Issuer: HubSpot
- Date: 2026-09-09
- Reference: Last updated September 9, 2026
- URL: https://knowledge.hubspot.com/privacy-and-consent/what-cookies-does-hubspot-set-in-a-visitor-s-browser
- What it supports: The tracking-code analytics cookies are non-essential and controlled by the cookie banner: __hstc and hubspotutk (6 months), __hssc (30 minutes) and __hssrc (session). The page does not say whether the tracking code loads or sends data before opt-in.
- Used for: `hubspot-tracking-code`

### hubspot-domain-security

- Kind: official-documentation
- Issuer: HubSpot
- Date: 2026-09-17
- Reference: Last updated September 17, 2026
- URL: https://knowledge.hubspot.com/domains-and-urls/ssl-and-domain-security-in-hubspot
- What it supports: The CSP table lists *.hs-scripts.com (HubSpot tracking code), *.hs-analytics.net (Analytics), *.hs-banner.com (cookie banner), *.hscollectedforms.net (non-HubSpot forms), *.hsadspixel.net (Ads), *.usemessages.com (conversations and chatflows), *.hsforms.com (forms and surveys) and *.hubspot.com (pop-up CTAs and chatflows). track.hubspot.com is not listed.
- Used for: `hubspot-tracking-code`

### intercom-docs-web-installation

- Kind: official-documentation
- Issuer: Intercom
- URL: https://developers.intercom.com/installing-intercom/web/installation
- What it supports: Intercom's installation docs say anonymous visitors' conversations are kept in the browser via a cookie. Intercom uses cookies, including an intercom-id- cookie that stores an anonymous identifier and can persist after shutdown. The snippets use widget.intercom.io and the regional API hosts api-iam(.eu/.au).intercom.io.
- Used for: `intercom`

### iubenda-cs-advanced-guide

- Kind: official-documentation
- Issuer: iubenda
- Date: 2026-10-23
- URL: https://www.iubenda.com/en/help/1205-how-to-configure-your-cookie-solution-advanced-guide
- What it supports: The code examples load the Cookie Solution only from cdn.iubenda.com: /cs/iubenda_cs.js, /cs/stable/, /cs/beta/, /cs/tcf/stub-v2.js and the safe.js variants. A CSS example targets #iubenda-cs-banner. iubenda.com is mentioned for the cross-site consent cookie. No other subdomains and no bot handling are documented.
- Used for: `iubenda`

### jetpack-asset-cdn-source

- Kind: official-documentation
- Issuer: Automattic (Jetpack)
- Reference: Automattic/jetpack trunk
- URL: https://raw.githubusercontent.com/Automattic/jetpack/trunk/projects/plugins/jetpack/modules/photon-cdn.php
- What it supports: The Asset CDN module serves WordPress core, Jetpack and WooCommerce JS and CSS from c0.wp.com, and adds a preconnect to c0.wp.com. Other plugins are rewritten only through a filter.
- Used for: `jetpack-site-accelerator`

### jetpack-cookies

- Kind: official-documentation
- Issuer: Automattic (Jetpack)
- URL: https://jetpack.com/support/cookies/
- What it supports: The only Stats cookie listed is stnojs (2 days), set only in the admin area. No visitor-side Stats cookie is listed. A separate 'General Analytics' section lists tk_ai and tk_qs, which are set on the frontend only with Instant Search or WooCommerce Analytics.
- Used for: `jetpack-stats`

### jetpack-site-accelerator-docs

- Kind: official-documentation
- Issuer: Automattic (Jetpack)
- URL: https://jetpack.com/support/site-accelerator/
- What it supports: Images are served from i0, i1, i2 and i3.wp.com. The asset CDN serves a limited set of static files only from WordPress core, Jetpack and WooCommerce. The privacy section lists 'None' for site visitors under data used, activity tracked and data synced. The page does not name c0.wp.com.
- Used for: `jetpack-site-accelerator`

### jetpack-stats-source-tracking-pixel

- Kind: official-documentation
- Issuer: Automattic
- Reference: trunk
- URL: https://raw.githubusercontent.com/Automattic/jetpack/trunk/projects/packages/stats/src/class-tracking-pixel.php
- What it supports: The Stats script is 'https://stats.wp.com/e-' plus gmdate('YW') plus '.js', for example e-202647.js. The AMP pixel constant is https://pixel.wp.com/g.gif. The inline browser code gates tracking on window.wp_has_consent('statistics') and on consent-change events.
- Used for: `jetpack-stats`

### jetpack-stats-support

- Kind: official-documentation
- Issuer: Automattic (Jetpack)
- URL: https://jetpack.com/support/jetpack-stats/
- What it supports: Stats processes visitor IP, user agent, visited and referring URLs, timestamps, browser language and country. Logs are kept by Automattic for 28 days. With the WP Consent API plugin active (automatic from Jetpack 16.4), a visit is counted only after statistics consent. The page does not say consent is legally required.
- Used for: `jetpack-stats`

### jimdo-legal-page-assets

- Kind: official-documentation
- Issuer: Jimdo GmbH
- URL: https://legal.jimdo.com/hc/en-us/articles/26840490952084-Jimdo-Privacy-Notice-for-Jimdo-com
- What it supports: Jimdo's own legal page loads its consent-management script and a PDF from assets.jimstatic.com, and fonts from webteam.jimstatic.com. This is technical evidence that jimstatic.com is a Jimdo domain. The text names Jimdo GmbH, Hamburg, as controller and does not cover files on customer websites.
- Used for: `jimdo-static-assets`

### jquery-cdn-releases

- Kind: official-documentation
- Issuer: OpenJS Foundation / jQuery
- URL: https://releases.jquery.com/
- What it supports: All file URLs are on code.jquery.com. The footer says 'CDN by Fastly' and that the OpenJS Foundation's terms, privacy and cookie policies apply.
- Used for: `jquery-cdn`

### jsdelivr-readme

- Kind: official-documentation
- Issuer: jsDelivr
- Reference: github.com/jsdelivr/jsdelivr, master branch
- URL: https://raw.githubusercontent.com/jsdelivr/jsdelivr/master/README.md
- What it supports: The root endpoint is always cdn.jsdelivr.net, and the CDN providers named are Cloudflare and Fastly. The privacy policy says jsDelivr stores no user data and does not track users in any way.
- Used for: `jsdelivr`

### klarna-osm-web-integration

- Kind: official-documentation
- Issuer: Klarna
- URL: https://docs.klarna.com/acquirer/adyen/on-site-messaging/web-integration.md
- What it supports: The Web SDK is loaded from https://js.klarna.com/web-sdk/v2/klarna.mjs. Merchants are responsible for informing customers about the SDK's tracking technologies. The page does not say that consent is required.
- Used for: `klarna`

### klarna-websdk-browser-security

- Kind: official-documentation
- Issuer: Klarna
- URL: https://docs.klarna.com/klarna-network-distribution/payment-presentation/web-sdk-configuration/browser-security-configuration.md
- What it supports: The CSP list covers x.klarnacdn.net, js.klarna.com, js.playground.klarna.com, *.klarna.com, *.klarnaevt.com and osm.klarnaservices.com. *.klarnaevt.com is a telemetry fallback used when the browser blocks the main channel, and osm.klarnaservices.com serves fallback badge images. The page says nothing about cookies or consent.
- Used for: `klarna`

### klaro-readme

- Kind: official-documentation
- Issuer: KIProtect / Klaro project
- Reference: master
- URL: https://raw.githubusercontent.com/kiprotect/klaro/master/README.md
- What it supports: The README embeds Klaro from https://cdn.kiprotect.com/klaro/[version]/ (klaro.js, klaro-no-css.js, CSS) and offers self-hosting from dist/. src/lib.js has no user-agent or bot logic.
- Used for: `klaro`

### klaviyo-client-events-api

- Kind: official-documentation
- Issuer: Klaviyo
- URL: https://developers.klaviyo.com/en/reference/create_client_event
- What it supports: The client-side event endpoint is https://a.klaviyo.com/client/events?company_id=PUBLIC_API_KEY. It is designed to be called only from publicly browsable, client-side environments.
- Used for: `klaviyo-client-events`

### klaviyo-cookies

- Kind: official-documentation
- Issuer: Klaviyo
- Date: 2026-10-26
- Reference: help.klaviyo.com article 360034666712
- URL: https://help.klaviyo.com/hc/en-us/articles/360034666712
- What it supports: __kla_id is set to expire after 2 years (browsers may shorten this). It is placed where onsite tracking is enabled, the script is not blocked by a consent tool, and platform privacy settings do not suppress it. Klaviyo's tracking cookies collect behavioural data the site does not need to function, and merchants typically class them as analytics or marketing, not strictly necessary.
- Used for: `klaviyo-client-events`, `klaviyo-onsite-js`

### klaviyo-onsite-tracking

- Kind: official-documentation
- Issuer: Klaviyo
- Reference: help.klaviyo.com article 115005076767
- URL: https://help.klaviyo.com/hc/en-us/articles/115005076767
- What it supports: klaviyo.js is installed from https://static.klaviyo.com/onsite/js/PUBLIC_API_KEY/klaviyo.js. On Shopify, depending on the Customer Privacy settings, Klaviyo may not track onsite events for EU, EEA, UK and CH visitors without consent.
- Used for: `klaviyo-onsite-js`

### leadfeeder-cmp-consent-mode

- Kind: official-documentation
- Issuer: Dealfront (Leadfeeder)
- URL: https://help.leadfeeder.com/en/articles/13922292-configuring-the-leadfeeder-tracking-script-with-your-consent-management-platform-cmp
- What it supports: Leadfeeder does not recommend blocking the whole script before consent. In consent mode no cookie is set before consent, but the script still identifies the visiting company by IP. Whether consent is legally required is left to the customer.
- Used for: `leadfeeder`

### leadfeeder-tracking-script

- Kind: official-documentation
- Issuer: Dealfront (Leadfeeder)
- URL: https://help.leadfeeder.com/en/articles/13922296-what-is-the-leadfeeder-tracking-script
- What it supports: The script captures each visitor's IP address, domain and location to identify the visiting company. It sets _lfa (1 year by default), _lfa_consent and _lfa_test_cookie_stored, plus the localStorage value _lfa_expiry.
- Used for: `leadfeeder`

### lfd-nds-2022-google-fonts

- Kind: dpa-guidance
- Issuer: Die Landesbeauftragte für den Datenschutz Niedersachsen
- Date: 2022-11-24
- Reference: Pressemitteilung vom 24.11.2022
- URL: https://www.lfd.niedersachsen.de/download/190184
- Where: Sections 'Verschiedene Moeglichkeiten der Einbindung' and 'Ueberpruefung der Abmahnschreiben'
- What it supports: When Google Fonts is embedded online, the fonts load from Google servers as the page opens, and users' personal data go automatically to Google in the USA. Downloading the fonts and hosting them locally is the compliant variant the LfD recommends. If Google Fonts is embedded online without valid consent under § 25(1) TTDSG and Art. 6(1)(a) GDPR, that is a data protection violation. Fonts from many other providers can be compliant if suitably embedded. The LfD says it is not competent for the civil demand-letter disputes themselves.
- Used for: `bunny-fonts`, `google-fonts`

### lfdi-bw-faq-cookies-tracking

- Kind: dpa-guidance
- Issuer: Landesbeauftragter für den Datenschutz und die Informationsfreiheit Baden-Württemberg
- Date: 2022-03
- URL: https://www.baden-wuerttemberg.datenschutz.de/faq-zu-cookies-und-tracking-2/
- Where: A 1.4; A 4.2
- What it supports: A 1.4: elements that combine user behaviour across websites or devices need active, explicit, informed, voluntary and prior consent. This applies in particular, but not only, to plugins of social media providers, large online platforms and advertising networks. The § 25 exceptions do not apply to tracking cookies, web bugs or fingerprinting. A 4.2: before active consent, no data may be collected and no such elements may be loaded.
- Used for: `criteo`, `google-ads`, `google-analytics-advertising-features`, `microsoft-advertising-uet`, `linkedin-insight-tag`, `meta-pixel`, `pinterest-tag`, `snap-pixel`, `tiktok-pixel`, `x-pixel`

### lfdi-bw-faq-tracking-2022-embeds

- Kind: dpa-guidance
- Issuer: Landesbeauftragter für den Datenschutz und die Informationsfreiheit Baden-Württemberg (LfDI BW)
- Date: 2022-03
- Reference: Version 2.0.1 (Stand März 2022), Abschnitt A Nr. 1.4 (S. 8), Nr. 2-2.2 (S. 9-12)
- URL: https://www.baden-wuerttemberg.datenschutz.de/wp-content/uploads/2022/03/FAQ-Tracking-online.pdf
- Where: Abschnitt A, Nr. 1.4, 2, 2.1, 2.2 (S. 8-12)
- What it supports: A.2.2: directly embedding tweets, Facebook posts or YouTube videos always sends personal data, often the exact identity, to these services. A two-click solution such as Embetty shows a preview without sending the IP address or browser data. Tweets should not be embedded directly (use a screenshot or quote instead), and videos can be self-hosted or linked. A.2.1: use link-only share buttons or Shariff. A.1.4: elements that combine user behaviour across websites need prior GDPR consent, in particular plugins of social-media providers, large platforms and ad networks.
- Used for: `youtube`, `youtube-nocookie`, `facebook-social-plugins`, `instagram-embeds`, `x-embeds`

### lfdi-bw-faq-tracking-2022-maps

- Kind: dpa-guidance
- Issuer: Landesbeauftragter für den Datenschutz und die Informationsfreiheit Baden-Württemberg (LfDI BW)
- Date: 2022-03
- Reference: Version 2.0.1 (Stand März 2022), Abschnitt A Nr. 2 und 2.3, S. 9-12
- URL: https://www.baden-wuerttemberg.datenschutz.de/wp-content/uploads/2022/03/FAQ-Tracking-online.pdf
- Where: Abschnitt A, Nr. 2 und 2.3 (S. 9-12)
- What it supports: A.2.3 (p. 12): external map services such as Google Maps need a two-click solution that informs users before personal data reach the map provider, subject to further restrictions such as third-country transfers. OpenStreetMap through a proxy, or an own OSM server with locally stored tiles, is presented as a compliant alternative because then no data go to third parties. Correction: the FAQ does not say 'only'. It simply does not offer direct loading from OSM servers as compliant. A.2 (pp. 9-10): any external element makes the browser send at least the IP address and the referrer to the third party.
- Used for: `google-maps`, `openstreetmap-tiles`

### lfdi-bw-handreichung-videos-2022

- Kind: dpa-guidance
- Issuer: Landesbeauftragter für den Datenschutz und die Informationsfreiheit Baden-Württemberg (LfDI BW)
- Date: 2022-11
- Reference: Stand: November 2022
- URL: https://www.baden-wuerttemberg.datenschutz.de/wp-content/uploads/2022/11/20221107_Einbindung-Videos.pdf
- Where: Einleitung (S. 3); I.A.3 (S. 4-5); I.B.3 (S. 6)
- What it supports: Introduction (p. 3): embedding content directly from commercial video platforms usually sends visitors' personal data, such as the IP address or cookies, to the platform and its partners, often as soon as the page is opened. Applying Fashion ID, the site operator is usually a joint controller. I.A.3 (pp. 4-5): with joint control, consent is usually required and can be obtained through a two-click preview that sends no IP or browser data to third parties. I.B.3 (p. 6): for other people's videos, the platform or third parties may receive the IP address or browser information only after the visitor clicks the preview. No platform is named; the handout covers commercial platforms in general, such as YouTube and Vimeo.
- Used for: `vimeo`, `youtube`, `youtube-nocookie`

### lg-muenchen-2022-google-fonts

- Kind: court-ruling
- Issuer: Landgericht München I
- Date: 2022-01-20
- Reference: 3 O 17493/20 (Fundstellen per gesetze-bayern.de: K&R 2022, 865; ZD 2022, 290; GRUR-RS 2022, 612; also cited as BeckRS 2022, 612, e.g. in BayLfD AKI 42 fn. 4)
- URL: https://www.gesetze-bayern.de/Content/Document/Y-300-Z-BECKRS-B-2022-N-612
- Where: Tenor Nr. 1-3; Rn. 4-5, 6-7, 8, 12
- What it supports: Tenor 1: the operator must stop disclosing the plaintiff's IP address to the font provider by providing Google Fonts when he visits its site. Tenor 2: it must tell him whether and which of his personal data it processes (Art. 15 GDPR). Tenor 3 with Rn. 12: EUR 100 non-material damages under Art. 82(1) GDPR. A dynamic IP address is personal data (Rn. 4-5). Passing it to Google automatically and without consent infringes the right to informational self-determination (Rn. 6-7). There is no legitimate interest under Art. 6(1)(f) GDPR, because Google Fonts can be used without connecting to a Google server when the page loads (Rn. 8).
- Used for: `google-fonts`

### lg-muenchen-2023-google-fonts-crawler

- Kind: court-ruling
- Issuer: Landgericht München I
- Date: 2023-03-30
- Reference: 4 O 13063/22 (Fundstellen per gesetze-bayern.de: K&R 2023, 537; GRUR-RS 2023, 6354; ZD 2023, 558; MMR 2023, 524)
- URL: https://www.gesetze-bayern.de/Content/Document/Y-300-Z-BECKRS-B-2023-N-6354
- Where: Rn. 24, 26-30, 35-36
- What it supports: A site operator brought a negative declaratory action. The court declared that the defendant, who sent a mass demand letter (20.10.2022) about dynamically embedded Google Fonts found with a web crawler, has no injunction claim and no damages claim. Reasons: no personal affectedness, because he did not visit the site himself (Rn. 27); the claim was self-provoked and commercially motivated (Rn. 28-30); there was no Art. 82 GDPR damage (Rn. 35); and any damages claim would be an abuse of rights under § 242 BGB (Rn. 36). The court left open whether the dynamic embedding violated the GDPR (Rn. 24). Rn. 26 is conditional: if the dynamic embedding violates the GDPR and the IP address goes to Google in the USA without compelling technical reason and without consent, this can violate informational self-determination.
- Used for: `google-fonts`

### linkedin-insight-tag-help

- Kind: official-documentation
- Issuer: LinkedIn
- URL: https://www.linkedin.com/help/lms/answer/a489169
- What it supports: The page says the Insight Tag creates cookies and a first-party pseudonymous identifier (li_adsid), and puts the responsibility for obtaining any necessary permissions or consents from users on the advertiser. It mentions the EU/EEA, but only for data transfers and for which features apply in which regions; it does not mention the GDPR or ePrivacy. Supporting evidence only.
- Used for: `linkedin-insight-tag`

### matomo-cloud-data-location

- Kind: official-documentation
- Issuer: Matomo
- URL: https://matomo.org/faq/in-which-locations-does-the-matomo-cloud-store-the-data/
- What it supports: All Matomo Cloud data and backups are stored in Europe. The company is based in New Zealand, which has an EU adequacy decision.
- Used for: `matomo-cloud`

### matomo-consent-faq

- Kind: official-documentation
- Issuer: Matomo
- URL: https://matomo.org/faq/new-to-piwik/how-do-i-use-matomo-analytics-without-consent-or-cookie-banner/
- What it supports: For Germany, Matomo says only server-side tracking (Log Analytics, HTTP Tracking API) is clearly outside the TDDDG. JavaScript tracking without cookies or identifiers may reduce risk but still accesses the device, so Matomo recommends treating JavaScript tracking as requiring consent. On the advice of the customer's privacy team, a very narrow configuration of On-Premise or Cloud (passive JavaScript only, browser feature detection fully disabled) may be usable without consent.
- Used for: `matomo-cloud`

### matomo-js-cookies-faq

- Kind: official-documentation
- Issuer: Matomo
- Reference: faq_146
- URL: https://matomo.org/faq/general/faq_146/
- What it supports: The default JS tracker cookies are _pk_id (13 months), _pk_ses (30 minutes), _pk_ref (6 months), _pk_cvar (30 minutes) and the very short-lived _pk_testcookie. Default cookies can be disabled.
- Used for: `matomo-cloud`

### matomo-tracking-consent-guide

- Kind: official-documentation
- Issuer: Matomo (developer.matomo.org)
- URL: https://developer.matomo.org/guides/tracking-consent
- What it supports: New source. With requireConsent, no tracking request is sent and no cookies are set until consent. With requireCookieConsent, tracking requests are still sent but no cookies are set. Both are commands to the JavaScript tracker (_paq.push), so a consent-compliant site can load matomo.js (on Matomo Cloud: cdn.matomo.cloud) before consent without tracking.
- Used for: `matomo-cloud`

### meta-business-tools-terms

- Kind: official-documentation
- Issuer: Meta
- Date: 2025-11-03
- URL: https://www.facebook.com/legal/businesstech
- Where: Section 3.d (Besondere Bestimmungen für die Nutzung bestimmter Business-Tools)
- What it supports: Section 3.d: where informed consent is required to store or access cookies or similar information on the device, for example in the EU, the business must verifiably ensure that end users give all necessary consents before using the Meta Business Tools (including the Pixel) for that purpose.
- Used for: `meta-pixel`

### meta-cookie-policy

- Kind: official-documentation
- Issuer: Meta (the page names no legal entity; 'Meta Platforms Ireland Limited' is not on the page)
- Date: 2023-12-12
- Reference: Gültig ab 12. Dezember 2023
- URL: https://www.facebook.com/privacy/policies/cookies/
- What it supports: Meta uses cookies when people have a Facebook or Instagram account, use Meta Products, or visit other websites and apps that use Meta Products (including the Like button). It receives information from those sites without any further action by the visitor, whether or not they have an account or are logged in. The page does not mention Instagram embeds and does not define 'Meta-Produkte' in its text.
- Used for: `facebook-social-plugins`, `instagram-embeds`

### microsoft-clarity-consent-mode

- Kind: official-documentation
- Issuer: Microsoft
- Date: 2025-08-14
- Reference: ms.date 2025-08-14 (updated_at 2025-12-05)
- URL: https://learn.microsoft.com/en-us/clarity/setup-and-installation/consent-mode
- What it supports: From 31.10.2025 Clarity enforces consent-signal requirements for visits from the EEA, UK and CH; a valid signal is needed for full functionality of Clarity features. Consent Mode is on by default for these regions, so Clarity sets no cookies until it gets a valid consent signal. Microsoft's implementation guide tells site owners to obtain user consent before collecting any data (Step 1). Its verification steps nevertheless expect Clarity to keep running and sending /collect calls after a visitor declines; only the _clck and _clsk cookies are suppressed.
- Used for: `microsoft-clarity`

### microsoft-uet-add-tag-consent

- Kind: official-documentation
- Issuer: Microsoft
- Date: 2026-05-30
- URL: https://learn.microsoft.com/en-us/advertising/msa-help/hlp_ba_proc_uetv2addtag
- Where: 'Important' notice at the top of the page
- What it supports: Microsoft tells advertisers to send consent signals (Consent Mode or TCF) with UET for visitors from the EEA, UK and Switzerland, and says this reflects the ePrivacy Directive and the GDPR. The page documents //bat.bing.com/bat.js and the main tracking request to bat.bing.com/action/0?ti=...
- Used for: `microsoft-advertising-uet`

### microsoft-uet-consent-mode

- Kind: official-documentation
- Issuer: Microsoft
- Date: 2026-06-18
- URL: https://learn.microsoft.com/en-us/advertising/msa-help/hlp_ba_conc_uet_consent
- What it supports: New source added by the fact-checker. UET consent is controlled by ad_storage. In Advanced Consent Mode the tag loads immediately with consent denied by default and still sends 'anonymized' data. The asc parameter in UET events shows denied or granted. Microsoft enforces Consent Mode for the EEA, UK and Switzerland, defaulting to denied where enforced. Complying with local consent rules is the advertiser's responsibility.
- Used for: `microsoft-advertising-uet`

### mouseflow-consent-integration

- Kind: official-documentation
- Issuer: Mouseflow
- Date: 2026-08-14
- URL: https://help.mouseflow.com/en/articles/5167246-integrating-mouseflow-with-your-cookie-consent
- What it supports: Mouseflow calls consent integration essential for GDPR and CCPA compliance. It offers two methods: delay loading the script until consent, or load //cdn.mouseflow.com/projects/<id>.js with window.mouseflowAutoStart=false and call mouseflow.start() after analytics consent. In the GTM setup the script loads on all pages but does not start recording; mouseflow.isRecording() should be false before consent.
- Used for: `mouseflow`, `mouseflow-loader`

### mouseflow-cookie-policy

- Kind: official-documentation
- Issuer: Mouseflow
- Date: 2026-08-14
- URL: https://help.mouseflow.com/en/articles/4282966-what-is-your-cookie-policy
- What it supports: Mouseflow sets first-party cookies mf_[website-id] (session) and mf_user (new or returning visitor, 90 days), labelled Functional / Statistics. It recommends categorising them as statistics, not necessary. Mouseflow can be prevented from setting cookies, or set to start recording only after consent.
- Used for: `mouseflow`

### mouseflow-disable-cookies

- Kind: official-documentation
- Issuer: Mouseflow
- Date: 2026-08-14
- URL: https://help.mouseflow.com/en/articles/5167255-disable-cookies
- What it supports: New source. With the 'Disable Cookies' integration Mouseflow uses localStorage and sessionStorage instead of cookies, and tracking behaviour stays the same. Mouseflow states that using local storage instead of cookies does not remove consent or privacy obligations, and that customers must obtain any required consent before enabling such tracking.
- Used for: `mouseflow`

### onetrust-csp-cdn

- Kind: official-documentation
- Issuer: OneTrust
- Date: 2025-12-15
- URL: https://developer.onetrust.com/onetrust/docs/content-security-policy-cdn.md
- What it supports: Lists cdn.cookielaw.org (banner script, otSDKStub.js) and cookie-cdn.cookiepro.com (CookiePro only). Also privacyportal.onetrust.com and geolocation.onetrust.com, needed when consent logging is enabled. It allows wildcarding *onetrust.com.
- Used for: `onetrust`

### paypal-sdk-best-practices

- Kind: official-documentation
- Issuer: PayPal
- URL: https://developer.paypal.com/sdk/js/best-practices/
- What it supports: The recommended CSP sources for child-src, connect-src, frame-src, img-src, script-src and style-src are *.paypal.com, *.paypalobjects.com and *.venmo.com.
- Used for: `paypal`

### paypal-sdk-configuration

- Kind: official-documentation
- Issuer: PayPal
- URL: https://developer.paypal.com/sdk/js/configuration/
- What it supports: The SDK is loaded directly from https://www.paypal.com/sdk/js. The sandbox examples use sandbox.paypal.com.
- Used for: `paypal`

### pinterest-tag-base-code-consent

- Kind: official-documentation
- Issuer: Pinterest
- URL: https://help.pinterest.com/en/business/article/install-the-base-code
- Where: Section 'Obtain consent to use the Pinterest tag'
- What it supports: The base code loads https://s.pinimg.com/ct/core.js, and the noscript pixel is https://ct.pinterest.com/v3/?tid=...&event=init&noscript=1. Advertisers operating in the EU must obtain legally compliant consent before sending any events to Pinterest. pintrk('setconsent', false) stops events and deletes the tag's first-party cookies.
- Used for: `pinterest-tag`

### plausible-data-policy

- Kind: official-documentation
- Issuer: Plausible
- URL: https://plausible.io/data-policy
- What it supports: Plausible uses no cookies and generates no persistent visitor identifiers. It counts visitors with a daily identifier, a hash of a daily salt plus domain, IP and user agent, and discards the salt every 24 hours. Raw IP and user agent are never stored. Visitor data does not leave the EU.
- Used for: `plausible`

### recaptcha-faq

- Kind: official-documentation
- Issuer: Google
- URL: https://developers.google.com/recaptcha/docs/faq
- What it supports: CSP: script-src www.google.com/recaptcha/ and www.gstatic.com/recaptcha/; frame-src www.google.com/recaptcha/ and recaptcha.google.com/recaptcha/; connect-src www.google.com/recaptcha/. www.recaptcha.net can be used where www.google.com is not accessible. reCAPTCHA sets a necessary cookie (_GRECAPTCHA) for its risk analysis. The page says nothing about consent or the GDPR.
- Used for: `google-recaptcha`

### shopify-changelog-asset-urls-2023

- Kind: official-documentation
- Issuer: Shopify
- Date: 2023-05-09
- URL: https://changelog.shopify.com/posts/changes-to-asset-urls
- What it supports: Shopify started serving some store assets (for example images, JS and CSS) from the shop's own domain under /cdn instead of a Shopify CDN domain. The old cdn.shopify.com URL format keeps working indefinitely.
- Used for: `shopify-cdn`

### shopify-changelog-file-cdn-2026

- Kind: official-documentation
- Issuer: Shopify
- Date: 2026-04-07
- URL: https://shopify.dev/changelog/replacing-or-deleting-a-shopify-hosted-file-no-longer-purges-its-cdn-url
- What it supports: When a file is replaced or deleted in the Shopify admin, Shopify no longer proactively purges its URL on cdn.shopify.com. This shows that files merchants upload in the admin are served from cdn.shopify.com.
- Used for: `shopify-cdn`

### shopify-dawn-theme-liquid

- Kind: official-documentation
- Issuer: Shopify
- Reference: Shopify/dawn main
- URL: https://raw.githubusercontent.com/Shopify/dawn/main/layout/theme.liquid
- What it supports: Dawn preconnects to fonts.shopifycdn.com unless both the header and body fonts are system fonts. It also imports https://cdn.shopify.com/storefront/standard-events.js.
- Used for: `shopify-cdn`

### shopify-dev-platform-cdn

- Kind: official-documentation
- Issuer: Shopify
- URL: https://shopify.dev/docs/storefronts/themes/best-practices/performance/platform
- What it supports: Shopify provides merchants with a CDN backed by Cloudflare. Storefront asset URLs use a /cdn path on the domain that serves the page, and /cdn/fonts/ is used for fonts from the Shopify font library. The page names cdn.shopify.com but not fonts.shopifycdn.com.
- Used for: `shopify-cdn`

### shopify-dev-use-preconnect

- Kind: official-documentation
- Issuer: Shopify
- URL: https://shopify.dev/docs/storefronts/themes/best-practices/performance/use-preconnect
- What it supports: Shopify names cdn.shopify.com and monorail-edge.shopifysvc.com as its own domains, whose connections the platform manages. The page does not say what monorail-edge does.
- Used for: `shopify-cdn`, `shopify-platform-telemetry`

### shopify-dev-use-shopify-cdn

- Kind: official-documentation
- Issuer: Shopify
- URL: https://shopify.dev/docs/storefronts/themes/best-practices/performance/use-shopify-cdn
- What it supports: Theme assets and merchant images are served through the Shopify CDN, and Shopify chooses the asset host. Themes do not need to hard-code cdn.shopify.com.
- Used for: `shopify-cdn`

### shopify-help-consent

- Kind: official-documentation
- Issuer: Shopify
- URL: https://help.shopify.com/en/manual/privacy-and-security/privacy/consent
- What it supports: When Shopify's cookie banner is active for a region, data from visitors in that region is collected only after consent. The page names no hosts.
- Used for: `shopify-platform-telemetry`

### shopify-privacy-banner-scripts

- Kind: official-documentation
- Issuer: Shopify
- URL: https://cdn.shopify.com/shopifycloud/privacy-banner/storefront-banner.js
- What it supports: storefront-banner.js defines DialogId 'shopify-pc__banner', #shopify-pc__banner__styles and the buttons -btn-accept / -btn-decline. It inserts the banner into the light DOM. cdn.shopify.com/shopifycloud/consent-tracking-api/v0.1/consent-tracking-api.js is the Customer Privacy API (feature 'consent-tracking-api' on shopify.dev). Neither script has bot logic; 'headless' there refers to headless storefronts.
- Used for: `shopify-privacy-banner`

### smartsupp-docs-configuration

- Kind: official-documentation
- Issuer: Smartsupp
- URL: https://docs.smartsupp.com/chat-box/configuration/
- Where: cookieDomain, privacyNoticeCheckRequired
- What it supports: Smartsupp's docs say chat visitors are identified by a unique key stored in cookies (cookieDomain sets the cookie domain). An option, privacyNoticeCheckRequired, makes users' consent required. The chat code loads from www.smartsuppchat.com/loader.js.
- Used for: `smartsupp`

### sourcepoint-docs-api

- Kind: official-documentation
- Issuer: Sourcepoint
- Date: 2025-05-14
- Reference: articles 4416092045587 and 14491535971987
- URL: https://docs.sourcepoint.com/api/v2/help_center/articles/search.json?query=iframe%20sp_message_container
- What it supports: baseEndpoint is https://cdn.privacy-mgmt.com and can be changed to a CNAME first-party subdomain. The messaging library is cdn.privacy-mgmt.com/unified/wrapperMessagingWithoutDetection.js. The message div is styled via [id^="sp_message_container"]. An anti-adblock baseEndpoint on d3fkv551xkjrmm.cloudfront.net appears, in an HTML comment.
- Used for: `sourcepoint`

### stripe-advanced-fraud-detection

- Kind: official-documentation
- Issuer: Stripe
- URL: https://docs.stripe.com/disputes/prevention/advanced-fraud-detection
- What it supports: Stripe.js collects device and activity risk signals and sends them to Stripe through periodic requests to m.stripe.com. hCaptcha may be loaded on every page where Stripe.js is loaded, and turning hCaptcha off requires contacting Stripe support. Stripe recommends loading Stripe.js on every shop page. Activity signals are limited to one shopping session on one site and are never used for advertising. Merchants can turn the signals off with advancedFraudSignals=false.
- Used for: `stripe`, `hcaptcha`

### stripe-js-including

- Kind: official-documentation
- Issuer: Stripe
- URL: https://docs.stripe.com/js/including.md
- What it supports: Stripe.js should always be loaded directly from https://js.stripe.com, and Stripe recommends including it on every page, not just the checkout page.
- Used for: `stripe`

### stripe-security-guide

- Kind: official-documentation
- Issuer: Stripe
- URL: https://docs.stripe.com/security/guide
- What it supports: For Stripe.js the CSP section lists js.stripe.com and *.js.stripe.com (script-src and frame-src), api.stripe.com (connect-src) and hooks.stripe.com (frame-src). It also lists maps.googleapis.com, but only for the Address Element with the merchant's own Google Maps key. checkout.stripe.com and img-src *.stripe.com are listed for Stripe Checkout and Connect embedded components, not for Stripe.js. For Link it adds link.com and *.link.com, described as Stripe-managed Link subdomains (for example checkout.link.com and statics.link.com).
- Used for: `stripe`

### tdddg-25

- Kind: law
- Issuer: Bundesgesetzgeber (official text: gesetze-im-internet.de, Bundesministerium der Justiz)
- Date: 2021-06-23
- Reference: TDDDG vom 23.06.2021 (BGBl. I S. 1982; 2022 I S. 1045); named TTDSG until 13.05.2024 (renamed with effect from 14.05.2024); zuletzt geändert durch Art. 3 G v. 10.3.2026 (BGBl. 2026 I Nr. 64)
- URL: https://www.gesetze-im-internet.de/ttdsg/__25.html
- Where: § 25 Abs. 1, Abs. 2 Nr. 1 und 2
- What it supports: Para 1: storing information in the end user's terminal equipment, or accessing information already stored there, is allowed only with consent based on clear and comprehensive information. The information and the consent must follow the GDPR. Para 2: consent is not needed (no. 1) when the sole purpose is transmitting a message over a public telecommunications network, or (no. 2) when the storage or access is strictly necessary for the provider to deliver a digital service the user expressly requested.
- Used for: `google-tag-manager`, `google-analytics`, `matomo-cloud`, `yandex-metrica`, `hotjar`, `microsoft-clarity`, `mouseflow`, `brevo-tracker`, `klaviyo-client-events`, `awin`, `criteo`, `google-ads`, `google-analytics-advertising-features`, `microsoft-advertising-uet`, `linkedin-insight-tag`, `meta-pixel`, `pinterest-tag`, `snap-pixel`, `tiktok-pixel`, `x-pixel`, `vimeo`, `youtube-nocookie`, `crisp`, `intercom`, `livechat`, `smartsupp`, `tawk-to`, `zendesk-web-widget`, `klarna`, `paypal`, `stripe`, `google-recaptcha`, `ccm19`, `consentmanager`, `cookiebot`, `cookiefirst`, `cookieyes`, `didomi`, `hu-manity`, `iubenda`, `klaro`, `onetrust`, `shopify-privacy-banner`, `sourcepoint`, `trustarc`, `usercentrics`

### tiktok-pixel-cookies

- Kind: official-documentation
- Issuer: TikTok
- Date: 2025-07
- URL: https://ads.tiktok.com/help/article?aid=10007540
- Where: Cookie table and section on consent management
- What it supports: The page lists the Pixel's first-party cookies (_ttp, ttcsid, ttclid) and the third-party _ttp on .tiktok.com, all for ad measurement and personalisation and kept 13 months from last use. It also lists _pangle on analytics.pangle-ads.com, which the Pixel reads rather than sets where Pangle is supported. It recommends a consent management platform.
- Used for: `tiktok-pixel`

### tlfdi-2022-google-fonts

- Kind: dpa-guidance
- Issuer: Thüringer Landesbeauftragter für den Datenschutz und die Informationsfreiheit (TLfDI)
- Date: 2022-08-18
- Reference: Pressemitteilung, Erfurt, 18. August 2022
- URL: https://www.tlfdi.de/fileadmin/tlfdi/presse/Pressemitteilungen_2022/220818_PM_Google_Fonts.pdf
- Where: Sections 'Worum geht es genau bei Google Fonts?' and 'Empfehlungen des TLfDI'
- What it supports: Dynamic embedding loads the fonts from the US company's servers into the visitor's browser and sends personal data such as the IP address to the USA. Citing LG München I (3 O 17493/20), the release says this violates the general personality right and the GDPR. Embedded Google services such as Google Maps and reCAPTCHA can load Google Fonts automatically. The TLfDI recommends storing the fonts locally and embedding them from the site's own server.
- Used for: `google-fonts`

### tlfdi-anfrage-youtube-cookies-2022

- Kind: dpa-guidance
- Issuer: Thüringer Landesbeauftragter für den Datenschutz und die Informationsfreiheit (TLfDI)
- Date: 2022-12-09
- URL: https://www.tlfdi.de/fileadmin/tlfdi/info/Veroeffentlichungen_nach_dem_ThuerTG/2/Youtube_Cookies_01.pdf
- Where: S. 1 und 3
- What it supports: In a reply to an individual enquiry, the TLfDI says embedding YouTube is usually not technically necessary for running a site, so the processing (by cookies) can only be justified by consent. It advises using youtube-nocookie and getting consent for each video before any transfer, and compares the case to LG München I 3 O 17493/20. Its third-country reasoning predates the EU-US DPF decision of 10.07.2023 and is outdated on that point.
- Used for: `youtube`, `youtube-nocookie`

### trustarc-notice-script

- Kind: official-documentation
- Issuer: TrustArc
- URL: https://consent.trustarc.com/notice?domain=trustarc.com&c=teconsent&js=nj&noticeType=bb
- What it supports: The script is served from consent.trustarc.com and uses container 'teconsent'. It references api-js-log.trustarc.com (error log, disabled there), submit-irm.trustarc.com and user-consent-center.trustarc.com. Its default acsUrl is d1leee6d0c4cew.cloudfront.net/amzn-consent.js (shared CDN, must not be pattern-matched). There is no bot, crawler, headless or webdriver logic.
- Used for: `trustarc`

### turnstile-client-rendering

- Kind: official-documentation
- Issuer: Cloudflare
- URL: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- What it supports: The script URL is https://challenges.cloudflare.com/turnstile/v0/api.js. The page says nothing about cookies or data collection.
- Used for: `cloudflare-turnstile`

### turnstile-csp

- Kind: official-documentation
- Issuer: Cloudflare
- URL: https://developers.cloudflare.com/turnstile/reference/content-security-policy/
- What it supports: script-src and frame-src must allow https://challenges.cloudflare.com. In pre-clearance mode Turnstile sets the cf_clearance cookie through a fetch to a /cdn-cgi/ endpoint on the site's own domain.
- Used for: `cloudflare-turnstile`

### typekit-webfontloader-source

- Kind: official-documentation
- Issuer: Typekit (Adobe)
- Reference: github.com/typekit/webfontloader, master, src/modules/typekit.js
- URL: https://raw.githubusercontent.com/typekit/webfontloader/master/src/modules/typekit.js
- What it supports: The default kit API host is https://use.typekit.net. This is technical evidence that use.typekit.net belongs to Adobe Fonts (Typekit).
- Used for: `adobe-fonts`

### unpkg-homepage

- Kind: official-documentation
- Issuer: unpkg
- URL: https://unpkg.com/
- What it supports: UNPKG describes itself as a fast, global content delivery network for everything on npm. The page names unpkg.com and esm.unpkg.com and says nothing about privacy, logging or cookies.
- Used for: `unpkg`

### usercentrics-csp-domains

- Kind: official-documentation
- Issuer: Usercentrics
- Date: 2025-05-15
- URL: https://support.usercentrics.com/hc/en-us/articles/17328859437852-Which-Usercentrics-domains-do-I-need-to-define-if-I-use-Content-Security-Policy-CSP
- What it supports: Lists the CMP domains under usercentrics.eu with their purposes. These are graphql., api., app., web.cmp., aggregator.service., consents., img., and uct./uct.service. (CMP 'Advanced Analytics' of user interaction). Also consent-api.service.consent., consent-rt-ret.service.consent. and v1.api.service.cmp. EU-mode hosts are aggregator.eu., app.eu., config.eu., consent-api.service.consent.eu1. and uct.eu.*. The rest are privacy-proxy. (Smart Data Protector files), privacy-proxy-server. (proxy for e.g. YouTube cover images) and logger.service. (crash reports). It recommends allowlisting *.usercentrics.eu.
- Used for: `usercentrics`

### userway-wp-plugin-source

- Kind: official-documentation
- Issuer: UserWay
- Reference: plugins.svn.wordpress.org trunk
- URL: https://plugins.svn.wordpress.org/userway-accessibility-widget/trunk/userway.php
- What it supports: The official plugin inserts the widget script from https://cdn.userway.org/widget.js. The plugin and author URIs are on userway.org.
- Used for: `userway`

### vg-hannover-2025-10-a-5385-22

- Kind: court-ruling
- Issuer: Verwaltungsgericht Hannover (10. Kammer)
- Date: 2025-03-19
- Reference: 10 A 5385/22
- URL: https://voris.wolterskluwer-online.de/browse/document/230df5cf-d76c-4561-9499-e44445a96f11
- Where: Leitsatz 4; Entscheidungsgründe 3.c.aa.(1)
- What it supports: Leitsatz 4: using Google Tag Manager requires consent under § 25(1) TTDSG (now TDDDG) and Art. 6(1)(a) GDPR. In 3.c.aa.(1)(a)-(c) the court finds that GTM both stores and reads information on users' devices, that this happens before any interaction with the banner, and that the § 25(2) Nr. 2 exception does not apply because the service is not expressly requested by users and serves the operator's interests. Per the facts (the DPA's test): on first visit without consent GTM was contacted, the IP address, device configuration, country and referrer were transmitted, and gtm.js was stored on the device.
- Used for: `google-tag-manager`

### vimeo-help-player-parameters

- Kind: official-documentation
- Issuer: Vimeo
- URL: https://help.vimeo.com/hc/en-us/articles/12426260232977-Player-parameters-overview
- Where: Parameter dnt
- What it supports: By default the Vimeo player collects session data and analytics. Setting dnt=true blocks this, but some essential cookies stay active even then, so the player stores information on the visitor's device.
- Used for: `vimeo`

### wix-dev-image-transformation

- Kind: official-documentation
- Issuer: Wix
- URL: https://dev.wix.com/docs/api-reference/assets/media/media-manager/url-image-transformation.md
- What it supports: Image transformations work only with Wix-hosted media URLs on static.wixstatic.com, which serve public files from the Media API (Media Manager).
- Used for: `wix-media`

### wix-engineering-cdn-2021

- Kind: official-documentation
- Issuer: Wix (Alon Kochba)
- Date: 2021-08-23
- URL: https://www.wix.engineering/post/how-we-improved-website-performance-by-evolving-our-infrastructure
- What it supports: Wix has always used CDNs to serve all JavaScript and images on user websites. The text does not tie any specific host to customer sites.
- Used for: `wix-media`, `wix-platform-other`

### wix-support-frog

- Kind: official-documentation
- Issuer: Wix
- URL: https://support.wix.com/en/article/google-search-console-googlebot-couldnt-get-all-resources-for-this-page
- What it supports: URLs beginning with frog.wix.com are part of the structure of a Wix site and do not affect crawling or SEO. Wix does not say what they do. The page's own HTML loads Wix code from static.parastorage.com and preconnects to frog.wix.com.
- Used for: `wix-platform-other`

### wix-support-static-media

- Kind: official-documentation
- Issuer: Wix
- URL: https://support.wix.com/en/article/wix-media-request-replacing-the-staticwixstaticcommedia-part-of-an-image-url-with-your-domain-name
- What it supports: static.wixstatic.com/media is the server where Wix hosts all its images. Site owners cannot currently replace this host with their own domain; this is an open feature request.
- Used for: `wix-media`

### wordpress-emoji-url-hook

- Kind: official-documentation
- Issuer: WordPress.org
- URL: https://developer.wordpress.org/reference/hooks/emoji_url/
- What it supports: The filter sets the URL where emoji PNG images are hosted. The default is https://s.w.org/images/core/emoji/<version>/72x72/; version 17.0.2 at the time of checking.
- Used for: `wordpress-emoji`

### wordpress-get-avatar-data

- Kind: official-documentation
- Issuer: WordPress.org
- URL: https://developer.wordpress.org/reference/functions/get_avatar_data/
- What it supports: WordPress core builds avatar URLs as https://secure.gravatar.com/avatar/ followed by the email hash. Changelog: 6.7.0 'Gravatar URLs always use HTTPS'; 6.8.0 switched to SHA-256 hashing.
- Used for: `gravatar`

### yandex-metrica-cookies

- Kind: official-documentation
- Issuer: Yandex
- URL: https://yandex.com/support/metrica/general/cookie-usage.html
- What it supports: Metrica sets _ym_uid (1 year, identifies site users), _ym_d (1 year), _ym_fa, _ym_isad (20 hours), _ym_metrika_enabled and _ym_visorc_* (30 minutes, Session Replay), among others.
- Used for: `yandex-metrica`

### youtube-api-developer-policies

- Kind: official-documentation
- Issuer: Google / YouTube
- Reference: Section III.E.4.i (item 9 of III.E.4 'Refreshing, Storing, and Displaying API Data')
- URL: https://developers.google.com/youtube/terms/developer-policies
- Where: III.E.4.i
- What it supports: When an API client loads, the YouTube embedded player collects and shares some basic user data with YouTube. Google says this is used to render the thumbnail and title, check playability and restrictions, and fight fraud and abuse; more data is shared on playback. With autoplay, this happens without any user interaction. Sites can limit what is shared before interaction, for example by not enabling autoplay.
- Used for: `youtube`, `youtube-nocookie`

### youtube-help-privacy-enhanced-mode

- Kind: official-documentation
- Issuer: Google / YouTube
- Reference: answer 171780
- URL: https://support.google.com/youtube/answer/171780?hl=en
- Where: Section on Privacy Enhanced Mode
- What it supports: Privacy Enhanced Mode is turned on by changing the embed domain to www.youtube-nocookie.com. Google describes it only as keeping embedded views from personalising YouTube and ads. It does not say that data transmission or storage on the device stops.
- Used for: `youtube-nocookie`

### zendesk-docs-messaging-cookies

- Kind: official-documentation
- Issuer: Zendesk
- URL: https://developer.zendesk.com/api-reference/widget-messaging/web/core/
- Where: Cookies setting
- What it supports: Zendesk says the messaging Web Widget uses cookies plus local and session storage to function. It sorts cookies into essential, functional and analytics, and by default stores all three unless the site restricts this with zE('messenger:set','cookies', ...).
- Used for: `zendesk-web-widget`
