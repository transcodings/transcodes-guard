import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';

import {
  HttpError,
  hasJsonContentType,
  isAllowedRequestOrigin,
  statusForError,
} from '../src/commands/transcodes/dashboard-csrf.js';

test('a same-origin POST from the dashboard itself is allowed', () => {
  assert.equal(
    isAllowedRequestOrigin({
      method: 'POST',
      secFetchSite: 'same-origin',
      origin: 'http://127.0.0.1:3847',
    }),
    true,
  );
});

test('a cross-site POST is denied', () => {
  assert.equal(
    isAllowedRequestOrigin({
      method: 'POST',
      secFetchSite: 'cross-site',
      origin: 'https://evil.example',
    }),
    false,
  );
});

test('a same-site POST is denied — every http://localhost:* is same-site', () => {
  // A rogue server on localhost:9999 is same-site with us, so `!== cross-site`
  // would let it through.
  assert.equal(
    isAllowedRequestOrigin({
      method: 'POST',
      secFetchSite: 'same-site',
      origin: 'http://localhost:9999',
    }),
    false,
  );
});

test('a POST with Sec-Fetch-Site: none is denied', () => {
  assert.equal(
    isAllowedRequestOrigin({ method: 'POST', secFetchSite: 'none' }),
    false,
  );
});

test('an off-origin Origin without Sec-Fetch-Site is denied', () => {
  assert.equal(
    isAllowedRequestOrigin({
      method: 'POST',
      origin: 'https://evil.example',
    }),
    false,
  );
});

test('a localhost Origin without Sec-Fetch-Site is allowed', () => {
  // Safari <= 16.3 sends no Sec-Fetch-Site. The Host guard accepts `localhost`,
  // so a user who typed it in the address bar must keep working.
  assert.equal(
    isAllowedRequestOrigin({
      method: 'POST',
      origin: 'http://localhost:3847',
    }),
    true,
  );
});

test('the origin port is ignored, matching the Host guard', () => {
  assert.equal(
    isAllowedRequestOrigin({
      method: 'POST',
      origin: 'http://127.0.0.1:9999',
    }),
    true,
  );
  assert.equal(
    isAllowedRequestOrigin({ method: 'POST', origin: 'http://127.0.0.53:3847' }),
    true,
  );
  // URL.hostname keeps the brackets on IPv6.
  assert.equal(
    isAllowedRequestOrigin({ method: 'POST', origin: 'http://[::1]:3847' }),
    true,
  );
});

test('an opaque Origin is denied', () => {
  assert.equal(
    isAllowedRequestOrigin({ method: 'POST', origin: 'null' }),
    false,
  );
});

test('a malformed Origin is denied instead of throwing', () => {
  assert.equal(
    isAllowedRequestOrigin({ method: 'POST', origin: 'not a url' }),
    false,
  );
});

test('a POST with neither header is allowed — curl is not the threat model', () => {
  assert.equal(isAllowedRequestOrigin({ method: 'POST' }), true);
});

test('GET is never gated — port discovery and the offline poll depend on it', () => {
  // probeHealth() hits GET /health with no browser headers at all, and the
  // offline page polls it every 3s.
  assert.equal(isAllowedRequestOrigin({ method: 'GET' }), true);
  assert.equal(
    isAllowedRequestOrigin({ method: 'GET', secFetchSite: 'cross-site' }),
    true,
  );
  // Address bar, bookmark, reload and PWA launch all send `none`.
  assert.equal(
    isAllowedRequestOrigin({ method: 'GET', secFetchSite: 'none' }),
    true,
  );
  assert.equal(isAllowedRequestOrigin({ method: 'HEAD' }), true);
  assert.equal(isAllowedRequestOrigin({ method: 'OPTIONS' }), true);
  assert.equal(isAllowedRequestOrigin({ method: 'get' }), true);
});

test('Sec-Fetch-Site wins over Origin when both are present', () => {
  // A browser cannot be talked out of its own Sec-Fetch-Site, so the stricter
  // signal decides: a spoofed-looking Origin cannot rescue a cross-site POST,
  // and a loopback Origin cannot rescue a same-site one.
  assert.equal(
    isAllowedRequestOrigin({
      method: 'POST',
      secFetchSite: 'same-origin',
      origin: 'https://evil.example',
    }),
    true,
  );
  assert.equal(
    isAllowedRequestOrigin({
      method: 'POST',
      secFetchSite: 'cross-site',
      origin: 'http://127.0.0.1:3847',
    }),
    false,
  );
});

/** Minimal stand-in for the one header hasJsonContentType reads. */
function withContentType(contentType?: string): IncomingMessage {
  return {
    headers: contentType ? { 'content-type': contentType } : {},
  } as unknown as IncomingMessage;
}

test('text/plain is rejected — that is the simple-request bypass', () => {
  assert.equal(hasJsonContentType(withContentType('text/plain')), false);
});

test('a missing Content-Type is rejected', () => {
  assert.equal(hasJsonContentType(withContentType()), false);
});

test('a charset parameter and odd casing are accepted', () => {
  // Rejecting `application/json; charset=utf-8` would itself be over-blocking.
  assert.equal(
    hasJsonContentType(withContentType('application/json; charset=utf-8')),
    true,
  );
  assert.equal(hasJsonContentType(withContentType('Application/JSON')), true);
  assert.equal(
    hasJsonContentType(withContentType('  application/json  ')),
    true,
  );
});

test('a plain application/json is accepted', () => {
  assert.equal(hasJsonContentType(withContentType('application/json')), true);
});

test('a rejected Content-Type answers 415 under either catch', () => {
  // The persona routes catch at 400 and the outer handler at 500, so the same
  // bad header would otherwise be reported as a server fault on one path.
  const err = new HttpError(415, 'Content-Type must be application/json');
  assert.equal(statusForError(err, 400), 415);
  assert.equal(statusForError(err, 500), 415);
});

test('an ordinary error keeps each route group its own status', () => {
  const err = new Error('Persona name is required.');
  assert.equal(statusForError(err, 400), 400);
  assert.equal(statusForError(err, 500), 500);
  assert.equal(statusForError('not an error', 500), 500);
});
