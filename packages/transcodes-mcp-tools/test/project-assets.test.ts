import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkProjectAssets } from '../src/project.js';

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
