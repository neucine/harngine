const fragment = new URLSearchParams(location.hash.slice(1)).get('capability');
if (fragment) {
  sessionStorage.setItem('harngine.workbench.capability', fragment);
  history.replaceState({}, '', location.pathname + location.search);
}
const capability =
  document.querySelector<HTMLMetaElement>('meta[name="workbench-capability"]')?.content ||
  fragment ||
  sessionStorage.getItem('harngine.workbench.capability');

function key() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return (
    'req_' +
    btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
  );
}

export async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (capability) headers.set('authorization', 'Bearer ' + capability);
  if (options.body) {
    headers.set('content-type', 'application/json');
    headers.set('idempotency-key', key());
  }
  const response = await fetch('/api/v1' + path, { ...options, headers });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(value.error?.message || 'Request failed'), value.error || {});
  return value;
}

export function watch(
  kind: string,
  id: string,
  update: (value: any) => void,
  reconnect: () => void,
) {
  const query = new URLSearchParams();
  if (capability) query.set('capability', capability);
  if (kind === 'works') query.set('modelDeltas', '1');
  const source = new EventSource(
    '/api/v1/' + kind + '/' + encodeURIComponent(id) + '/events?' + query,
  );
  source.addEventListener('ready', (event) =>
    update(JSON.parse((event as MessageEvent).data).value),
  );
  source.addEventListener('update', (event) =>
    update(JSON.parse((event as MessageEvent).data).value.snapshot),
  );
  source.onerror = reconnect;
  return source;
}

export const terminal = new Set(['completed', 'failed', 'canceled']);
export const pretty = (value: any) => JSON.stringify(value, null, 2);
export const short = (value: string) =>
  value?.length > 30 ? value.slice(0, 14) + '…' + value.slice(-6) : value;
export const time = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
export const display = (value: any) => (typeof value === 'string' ? value : pretty(value));
