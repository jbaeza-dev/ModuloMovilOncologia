// Public compile-time values only. No server password or Google client secret belongs in an APK.
import { appendFileSync } from 'node:fs';
const profile = process.env.EXPO_PUBLIC_APP_ENV;
if (profile !== 'demo' && profile !== 'universidad-demo')
  throw new Error('The academic APK workflow only accepts demo or universidad-demo profiles.');
const university = profile === 'universidad-demo';
const reviewFlag = process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW;
if (reviewFlag !== undefined && reviewFlag !== 'true' && reviewFlag !== 'false')
  throw new Error('The triage review flag must be true or false.');
const values = {
  EXPO_PUBLIC_DEMO_MODE: university ? 'false' : 'true',
  // Both profiles are academic demonstrations; draft clinical recommendations stay disabled.
  EXPO_PUBLIC_P07_SYNTHETIC_REVIEW: reviewFlag ?? 'true',
};
if (university) {
  const origin = process.env.QC_PUBLIC_ORIGIN;
  const issuer = process.env.QC_AUTH_ISSUER;
  const key = process.env.QC_AUTH_PUBLIC_KEY;
  if (!origin || !issuer || !key)
    throw new Error(
      'Configure repository Variables QC_PUBLIC_ORIGIN, QC_AUTH_ISSUER and QC_AUTH_PUBLIC_KEY before building university APK.',
    );
  const base = new URL(origin),
    auth = new URL(issuer);
  if (
    /[\r\n]/.test(origin + issuer) ||
    base.protocol !== 'https:' ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    base.username ||
    base.password ||
    auth.protocol !== 'https:' ||
    !auth.pathname.endsWith('/auth/v1') ||
    auth.search ||
    auth.hash ||
    auth.username ||
    auth.password
  )
    throw new Error('Invalid public HTTPS origin or Auth issuer.');
  let isPublic = key.startsWith('sb_publishable_');
  try {
    isPublic ||= JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon';
  } catch {
    /* publishable keys have no JWT payload */
  }
  if (!isPublic || /\s/.test(key))
    throw new Error('Only publishable/anon public Auth keys may enter an APK.');
  Object.assign(values, {
    EXPO_PUBLIC_CLINICAL_URL: base.origin + '/quimiocare',
    EXPO_PUBLIC_GATEWAY_URL: base.origin + '/quimiocare-backend',
    // The SDK appends /sync/stream to this service base URL.
    EXPO_PUBLIC_POWERSYNC_URL: base.origin + '/quimiocare-backend',
    EXPO_PUBLIC_AUTH_URL: issuer,
    EXPO_PUBLIC_AUTH_ISSUER: issuer,
    EXPO_PUBLIC_AUTH_PUBLIC_KEY: key,
  });
}
if (!process.env.GITHUB_ENV)
  throw new Error('GITHUB_ENV required. This helper is for the APK workflow.');
appendFileSync(
  process.env.GITHUB_ENV,
  Object.entries(values)
    .map(([k, v]) => k + '=' + v + '\n')
    .join(''),
);
console.log('Public APK configuration validated for ' + process.env.EXPO_PUBLIC_APP_ENV);
