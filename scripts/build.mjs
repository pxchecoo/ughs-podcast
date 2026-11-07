import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
await rm('dist', {recursive:true,force:true});await mkdir('dist/lib',{recursive:true});
for(const file of ['index.html','style.css','script.js','assets','admin','privacy']) await cp(file,join('dist',file),{recursive:true});
await cp('lib/interview-validation.js','dist/lib/interview-validation.js');
const forbidden=['.env','.env.local','api','docs','supabase','test','package.json','lib/interview-server.js','lib/interview-health.js'];
const files=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else files.push(path);}}
await walk('dist');
if(forbidden.some(file=>files.some(path => path === join('dist',file) || path.startsWith(join('dist',file) + '/'))))throw new Error('Private source in static output');
console.log(`Built ${files.length} static files. Vercel builds the root api/ functions separately.`);
