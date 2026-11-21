import { CAPTURE_SETTINGS } from '@website-check/scanner';

/**
 * The visitor that the Cloudflare adapter presents to a site, as Chrome DevTools Protocol
 * commands. It copies what Playwright sends for the local adapter (locale `de-DE`, time zone
 * `Europe/Berlin`, viewport and screen 1440 x 900, a normal desktop Chrome user agent on
 * Windows with the same client hints, focus emulation), so both adapters look the same to
 * consent tools that guess the country from language or time zone.
 */

export interface CdpCommand {
  method: string;
  params: Record<string, unknown>;
}

/** `navigator.platform` of the local run (Windows laptop); Browser Run itself runs on Linux. */
export const VISITOR_PLATFORM = 'Win32';

/** Client hints as Playwright computes them for a Windows desktop user agent. */
export function userAgentMetadataOf(userAgent: string): Record<string, unknown> {
  const windows = /Windows\D+(\d+(\.\d+)?(\.\d+)?)/.exec(userAgent);
  return {
    mobile: false,
    model: '',
    architecture: userAgent.includes('ARM') ? 'arm' : 'x86',
    platform: windows ? 'Windows' : userAgent.toLowerCase().includes('linux') ? 'Linux' : 'Windows',
    platformVersion: windows?.[1] ?? '',
  };
}

/** Language, time zone and user agent: needed in every frame, also in out-of-process iframes. */
export function frameEmulation(userAgent: string): CdpCommand[] {
  return [
    {
      method: 'Emulation.setUserAgentOverride',
      // platform: navigator.platform as on Fedor's Windows laptop, so it matches the Windows user agent.
      params: { userAgent, acceptLanguage: CAPTURE_SETTINGS.acceptLanguage, userAgentMetadata: userAgentMetadataOf(userAgent), platform: VISITOR_PLATFORM },
    },
    { method: 'Emulation.setLocaleOverride', params: { locale: CAPTURE_SETTINGS.locale } },
    { method: 'Emulation.setTimezoneOverride', params: { timezoneId: CAPTURE_SETTINGS.timezoneId } },
  ];
}

/** Viewport, screen and focus of the top-level page. */
export function viewportEmulation(): CdpCommand[] {
  const { width, height } = CAPTURE_SETTINGS.viewport;
  return [
    { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } },
    {
      method: 'Emulation.setDeviceMetricsOverride',
      params: {
        mobile: false,
        width,
        height,
        deviceScaleFactor: 1,
        screenWidth: width,
        screenHeight: height,
        screenOrientation: { angle: 0, type: 'landscapePrimary' },
      },
    },
  ];
}

/** Everything for the top-level page: frame emulation plus viewport, screen and focus. */
export function pageEmulation(userAgent: string): CdpCommand[] {
  return [...viewportEmulation(), ...frameEmulation(userAgent)];
}

/** Sends the commands without waiting between them (like Playwright), errors ignored. */
export function sendAll(send: CdpSend, commands: readonly CdpCommand[]): void {
  for (const command of commands) void send(command.method, command.params).catch(() => undefined);
}

export type CdpSend = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** Sends the commands in order. Returns the methods that failed (best effort, never throws). */
export async function applyEmulation(send: CdpSend, commands: readonly CdpCommand[]): Promise<string[]> {
  const failed: string[] = [];
  for (const command of commands) {
    try {
      await send(command.method, command.params);
    } catch {
      failed.push(command.method);
    }
  }
  return failed;
}

/**
 * Read inside the page to check that the emulation took effect (used by the lab endpoint for
 * the location check, never for findings).
 */
export const ENVIRONMENT_EXPRESSION = `(() => ({
  userAgent: navigator.userAgent,
  language: navigator.language,
  languages: Array.from(navigator.languages || []),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  intlLocale: Intl.DateTimeFormat().resolvedOptions().locale,
  platform: navigator.platform,
  webdriver: navigator.webdriver === true,
  viewport: [innerWidth, innerHeight],
  screen: [screen.width, screen.height],
  hasFocus: document.hasFocus(),
}))()`;

export interface EnvironmentCheck {
  userAgent: string;
  language: string;
  languages: string[];
  timeZone: string;
  intlLocale: string;
  platform: string;
  webdriver: boolean;
  viewport: [number, number];
  screen: [number, number];
  hasFocus: boolean;
}
