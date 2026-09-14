export const HOSTED_ORIGIN = 'https://alongside.184.73.112.43.sslip.io';
export const LOCAL_ORIGIN = 'http://127.0.0.1:5176';
export function isAppOrigin(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) { return false; }
    return url.origin === HOSTED_ORIGIN || (url.hostname === '127.0.0.1' && url.protocol === 'http:');
  } catch { return false; }
}
