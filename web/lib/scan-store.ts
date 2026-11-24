// What the form hands to the scan screen in the same tab (session B2 part 2): the address for the heading and the
// token for "Prüfung abbrechen". sessionStorage, so it lives only in this tab and is never in the address of the page:
// a link to the scan screen that a visitor passes on can show the scan, but cannot cancel it. Unavailable storage
// (private mode, blocked) only means the heading waits for the API and the button only leads home.

const ID = /^[a-z2-7]{26}$/;
const key = (id: string): string => `wc-scan:${id}`;

export interface StoredScan {
  displayHost: string | null;
  cancelToken: string | null;
}

export function rememberScan(id: string, scan: StoredScan): void {
  try {
    sessionStorage.setItem(key(id), JSON.stringify(scan));
  } catch {
    // no storage: see above
  }
}

export function recallScan(id: string): StoredScan | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(id)) ?? 'null') as unknown;
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    return {
      displayHost: typeof v.displayHost === 'string' && v.displayHost.length > 0 && v.displayHost.length <= 253 ? v.displayHost : null,
      cancelToken: typeof v.cancelToken === 'string' && ID.test(v.cancelToken) ? v.cancelToken : null,
    };
  } catch {
    return null;
  }
}

export function forgetScan(id: string): void {
  try {
    sessionStorage.removeItem(key(id));
  } catch {
    // no storage
  }
}
