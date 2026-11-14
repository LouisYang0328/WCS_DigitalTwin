/* Shared HTTP transport for gateway pages. Keep PLC communication in the gateway. */
(() => {
  'use strict';

  async function request(path, options = {}) {
    const { timeoutMs = 15000, ...fetchOptions } = options;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    fetchOptions.signal?.addEventListener('abort', forwardAbort, { once: true });
    if (fetchOptions.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        cache: 'no-store',
        ...fetchOptions,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) }
      });
      if (!response.ok) {
        let detail = `请求失败 (${response.status})`;
        try { detail = (await response.json()).detail || detail; } catch (_) { }
        if (response.status === 401) window.dispatchEvent(new CustomEvent('wcs:unauthorized'));
        if (response.status === 403) detail = detail === `请求失败 (${response.status})` ? '当前角色没有此操作权限。' : detail;
        const error = new Error(detail);
        error.status = response.status;
        throw error;
      }
      return response.status === 204 ? null : await response.json();
    } catch (error) {
      if (error.name === 'AbortError' && !fetchOptions.signal?.aborted) throw new Error('网关请求超时，请检查服务连接。');
      throw error;
    } finally {
      clearTimeout(timeout);
      fetchOptions.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  window.WcsApi = Object.freeze({ request });
})();
