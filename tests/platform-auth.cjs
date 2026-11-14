/* Shared test login for maintenance-only gateway APIs. */
'use strict';

let installed = false;
let cookie = '';

async function login(baseUrl) {
  if (installed) return;
  const realFetch = global.fetch;
  let response;
  for (let attempt = 0; attempt < 30; attempt++) {
    response = await realFetch(baseUrl.replace(/\/$/, '') + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.WCS_TEST_USERNAME || 'sa',
        password: process.env.WCS_TEST_PASSWORD || '0000'
      })
    });
    if (response.status !== 503) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!response.ok) throw new Error(`Test login failed: HTTP ${response.status}`);
  const setCookie = response.headers.get('set-cookie');
  cookie = setCookie ? setCookie.split(';', 1)[0] : '';
  if (!cookie) throw new Error('Test login did not return a session cookie.');
  global.fetch = (url, options = {}) => realFetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: cookie }
  });
  installed = true;
}

module.exports = { login };
