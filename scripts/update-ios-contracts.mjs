import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const resources = resolve(root, 'apps/ios/Sources/DDLTrackerCore/Resources');
const checkOnly = process.argv.includes('--check');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function writeGenerated(path, content) {
  if (checkOnly) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      console.error(`Generated iOS contract is stale: ${path}`);
      process.exitCode = 1;
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

run('pnpm', ['exec', 'tsc', '-b', 'packages/contracts', 'apps/api', '--pretty', 'false']);
const moduleUrl = pathToFileURL(resolve(root, 'apps/api/dist/openapi.js'));
moduleUrl.searchParams.set('generatedAt', String(Date.now()));
const { openApiDocument } = await import(moduleUrl.href);
writeGenerated(
  resolve(resources, 'openapi.json'),
  `${JSON.stringify(openApiDocument, null, 2)}\n`,
);

const vectors = [
  'api-compatibility-v2.0.json',
  'ranking-v1.json',
  'snapshot-records-v2.json',
  'sync-events-v2.json',
  'sync-responses-v2.json',
];
for (const name of vectors) {
  const source = resolve(root, 'packages/contracts/vectors', name);
  const target = resolve(resources, name);
  const content = readFileSync(source, 'utf8');
  writeGenerated(target, content.endsWith('\n') ? content : `${content}\n`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log(checkOnly ? 'iOS contracts are current.' : 'Updated iOS contract resources.');
