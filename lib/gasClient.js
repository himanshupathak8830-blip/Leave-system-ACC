/**
 * gasClient.js - High Compatibility Version
 * Uses native https module to handle Google Apps Script redirects reliably
 */
const https = require('https');
const http = require('http');

function gasGet(targetUrl, redirectCount) {
  redirectCount = redirectCount || 0;
  if (redirectCount > 10) return Promise.reject(new Error('Too many redirects'));

  return new Promise((resolve, reject) => {
    const lib = targetUrl.startsWith('https') ? https : http;

    lib.get(targetUrl, { headers: { 'Accept': 'application/json' } }, (res) => {
      // Follow redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return resolve(gasGet(res.headers.location, redirectCount + 1));
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    }).on('error', reject);
  });
}

async function gasRequest({ action, payload }) {
  const baseUrl = process.env.GOOGLE_SCRIPT_URL;
  if (!baseUrl) throw new Error('GOOGLE_SCRIPT_URL is not configured');

  const url = new URL(String(baseUrl).trim().replace(/\/+$/, ''));
  url.searchParams.set('action', action);
  if (payload) url.searchParams.set('payload', JSON.stringify(payload));

  console.log('[GAS] Requesting:', action);

  const { status, body } = await gasGet(url.toString());

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    console.error('[GAS] Non-JSON response', { action, status, text: body.substring(0, 300) });
    throw new Error(
      'Google Sheets returned an invalid response. ' +
      'Make sure your script is deployed with "Who has access: Anyone" and re-deployed as a New Version.'
    );
  }

  if (parsed.ok === false) {
    throw new Error(parsed.error || 'GAS request failed');
  }

  return parsed;
}

module.exports = { gasRequest };
