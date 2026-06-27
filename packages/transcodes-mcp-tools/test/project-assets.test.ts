import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  checkProjectAssets,
  checkRelatedOriginRegistration,
} from '../src/project.js';

// 최소 Response mock으로 asset probe 결과만 표현한다.
function response(status: number) {
  return { ok: status >= 200 && status < 300, status } as Response;
}

describe('checkProjectAssets', () => {
  it('keeps auth SDK success separate from missing PWA assets', async () => {
    const previous = process.env.TRANSCODES_CDN_BASE_URL;
    process.env.TRANSCODES_CDN_BASE_URL = 'https://cdn.example.test';
    try {
      const report = await checkProjectAssets('proj_123', async (url) =>
        String(url).endsWith('/webworker.js') ? response(200) : response(404),
      );

      assert.equal(report.ok, true);
      assert.equal(report.summary.auth_sdk, 'available');
      assert.equal(report.summary.pwa_assets, 'not_configured_or_missing');
    } finally {
      process.env.TRANSCODES_CDN_BASE_URL = previous;
    }
  });

  it('does not collapse unreachable PWA assets into missing configuration', async () => {
    const previous = process.env.TRANSCODES_CDN_BASE_URL;
    process.env.TRANSCODES_CDN_BASE_URL = 'https://cdn.example.test';
    try {
      const report = await checkProjectAssets('proj_123', async (url) => {
        if (String(url).endsWith('/webworker.js')) return response(200);
        throw new Error('timeout');
      });

      assert.equal(report.ok, true);
      assert.equal(report.summary.pwa_assets, 'unreachable');
    } finally {
      process.env.TRANSCODES_CDN_BASE_URL = previous;
    }
  });

  it('falls back to GET when HEAD is not supported', async () => {
    const previous = process.env.TRANSCODES_CDN_BASE_URL;
    process.env.TRANSCODES_CDN_BASE_URL = 'https://cdn.example.test';
    const methods: string[] = [];
    try {
      const report = await checkProjectAssets('proj_123', async (_url, init) => {
        methods.push(init?.method ?? 'GET');
        return response(init?.method === 'HEAD' ? 405 : 200);
      });

      assert.equal(report.ok, true);
      assert.equal(methods.includes('HEAD'), true);
      assert.equal(methods.includes('GET'), true);
    } finally {
      process.env.TRANSCODES_CDN_BASE_URL = previous;
    }
  });
});

describe('checkRelatedOriginRegistration', () => {
  it('allows redirect_uri origin from authentication.related_origins', () => {
    const report = checkRelatedOriginRegistration(
      {
        domain_url: 'https://auth.transcodes.io',
        authentication: {
          related_origins: ['http://localhost:5173'],
        },
      },
      'http://localhost:5173/callback',
    );

    assert.equal(report.ok, true);
    assert.equal(report.checked_origin, 'http://localhost:5173');
  });

  it('does not treat hosted auth domain_url as a redirect origin', () => {
    const report = checkRelatedOriginRegistration(
      {
        domain_url: 'https://auth.transcodes.io',
        authentication: {
          related_origins: [],
        },
      },
      'http://localhost:5173/callback',
    );

    assert.equal(report.ok, false);
    assert.deepEqual(report.registered_origins, []);
    assert.equal(
      report.next_action?.add_related_origin,
      'http://localhost:5173',
    );
  });

  it('keeps non-hosted domain_url compatibility without local auth env overrides', () => {
    const report = checkRelatedOriginRegistration(
      {
        domain_url: 'https://app.example.com',
      },
      'https://app.example.com/callback',
    );

    assert.equal(report.ok, true);
    assert.deepEqual(report.registered_origins, ['https://app.example.com']);
  });

  it('does not let MCP-local auth env change backend default hosted origins', () => {
    const previous = process.env.TRANSCODES_AUTH_APP_URL;
    process.env.TRANSCODES_AUTH_APP_URL = 'https://auth.transcodes.io';
    try {
      const report = checkRelatedOriginRegistration(
        {
          domain_url: 'https://auth.transcodes.io',
        },
        'https://auth.transcodes.io/callback',
      );

      assert.equal(report.ok, false);
      assert.deepEqual(report.registered_origins, []);
      assert.deepEqual(report.source.auth_host_origins, [
        'https://auth.transcodes.io',
        'https://auth.automexpert.com',
      ]);
    } finally {
      if (previous !== undefined) process.env.TRANSCODES_AUTH_APP_URL = previous;
      else delete process.env.TRANSCODES_AUTH_APP_URL;
    }
  });

  it('ignores MCP-local custom auth env because backend env is the SSOT', () => {
    const previous = process.env.TRANSCODES_AUTH_APP_URL;
    process.env.TRANSCODES_AUTH_APP_URL = 'https://custom-auth.example.com';
    try {
      const report = checkRelatedOriginRegistration(
        {
          domain_url: 'https://custom-auth.example.com',
        },
        'https://custom-auth.example.com/callback',
      );

      assert.equal(report.ok, true);
      assert.deepEqual(report.registered_origins, [
        'https://custom-auth.example.com',
      ]);
      assert.deepEqual(report.source.auth_host_origins, [
        'https://auth.transcodes.io',
        'https://auth.automexpert.com',
      ]);
    } finally {
      if (previous !== undefined) process.env.TRANSCODES_AUTH_APP_URL = previous;
      else delete process.env.TRANSCODES_AUTH_APP_URL;
    }
  });
});
