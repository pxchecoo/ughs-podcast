import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const dir of ['api','admin','lib','assets','scripts']) {
  for (const file of readdirSync(dir)) if (/\.(js|mjs)$/.test(file)) execFileSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
}
JSON.parse(readFileSync('vercel.json','utf8'));
console.log('Syntax and Vercel JSON checks passed.');
