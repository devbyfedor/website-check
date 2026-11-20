import { describe, expect, it } from 'vitest';
import { buildBannerProbeScript } from '../src/consent/probe-script.ts';
import type { ConsentTool } from '../src/consent/tools.ts';

const tools: ConsentTool[] = [
  { id: 'cookiebot', name: 'Cookiebot', kind: 'saas', selectors: ['#CybotCookiebotDialog'], shadowRoot: false, serviceIds: [], evidence: ['test'] },
  { id: 'usercentrics', name: 'Usercentrics', kind: 'saas', selectors: ['#usercentrics-root'], shadowRoot: true, serviceIds: [], evidence: ['test'] },
];

describe('buildBannerProbeScript', () => {
  const script = buildBannerProbeScript(tools);

  it('is valid JavaScript', () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it('embeds the selectors of the consent tools as data', () => {
    expect(script).toContain('"#CybotCookiebotDialog"');
    expect(script).toContain('"shadow":true');
  });

  it('only watches the top-level document and never clicks', () => {
    expect(script).toContain('if (window.top !== window) return;');
    expect(script).not.toMatch(/\.click\(|dispatchEvent|submit\(/);
  });
});
