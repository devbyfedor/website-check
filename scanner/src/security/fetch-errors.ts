/**
 * Which failures of a request are a fact about the site (session fix-a5, review findings 32 and 80).
 *
 * A request can fail on the way to the site (the connection was refused or reset, the certificate was not
 * accepted) or on our side before anything reached it: the name lookup failed, the Worker used up its 50
 * subrequests ("Too many subrequests."), the runtime had an internal error, our own budget of requests refused it.
 * Only the first kind may be reported as "the site cannot be reached"; the second kind is our failure and is
 * "bitte manuell prüfen" or a failed check, never a statement about the site.
 *
 * The text is the error with its cause (`fetch` in Node puts the system error into `cause`).
 */
const CONNECTION_FAILURE =
  /\b(ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|ETIMEDOUT|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|CERT_[A-Z_]+|ERR_TLS_[A-Z_]+|ERR_SSL_[A-Z_]+)\b|connection (was )?(refused|reset|closed)|network connection lost|socket hang up|other side closed|certificate|\bSSL\b|\bTLS\b/i;

/** Failures of our own side that look like network errors: never a fact about the site. */
const OWN_FAILURE = /too many subrequests|internal error|budget|not allowed: /i;

export function isConnectionFailure(errorText: string): boolean {
  return !OWN_FAILURE.test(errorText) && CONNECTION_FAILURE.test(errorText);
}

/**
 * A capture that a refusal of the address rules stopped, where the "refusal" was a failure of the name lookup
 * (`dns-error`: the resolver answered with an error, did not answer in time, or could not be asked because the
 * subrequests were used up). The address itself was never refused.
 */
export function isLookupFailure(message: string): boolean {
  return /^not allowed: dns-error\b/.test(message);
}
