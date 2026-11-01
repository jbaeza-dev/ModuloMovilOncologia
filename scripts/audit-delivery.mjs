// Scan the prospective Git delivery, including untracked files but excluding ignored local artifacts.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
const files = [
  ...new Set(
    execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean),
  ),
];
const problems = [];
for (const file of files) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue;
  } // deleted tracked files
  if (!stat.isFile()) continue;
  if (
    /(^|\/)\.env($|\.(?!example$|template$))|\.(env|apk|aab|ipa|dump|backup|tar|tar\.gz|pem|p12|jks|keystore)$/i.test(
      file,
    )
  )
    problems.push(file + ': private/runtime artifact');
  if (stat.size > 5 * 1024 * 1024) {
    problems.push(file + ': review file above 5 MiB');
    continue;
  }
  const text = readFileSync(file, 'utf8');
  if (
    /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text) ||
    /sb_secret_[A-Za-z0-9_-]{16,}/.test(text)
  )
    problems.push(file + ': private credential detected');
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      if (
        JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role === 'service_role'
      )
        problems.push(file + ': privileged JWT detected');
    } catch {
      /* not a JWT */
    }
  }
}
if (problems.length) throw new Error(problems.join('\n'));
console.log(
  'Delivery audit passed: ' + files.length + ' candidate files; ignored local data excluded.',
);
