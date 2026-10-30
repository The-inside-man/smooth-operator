import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const staging=path.join(root,'artifacts','tim-cli-package');
await fs.mkdir(staging,{recursive:true});
for(const directory of ['cli','server'])await fs.cp(path.join(root,directory),path.join(staging,directory),{recursive:true});
const original=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const manifest={name:'@tim-studio/cli',version:original.version,description:'TIM Studio full-screen local terminal workspace',type:'module',bin:{tim:'cli/index.mjs'},engines:{node:'>=24'},files:['cli','server','README.md'],dependencies:Object.fromEntries(['ink','react','strip-ansi'].map(name=>[name,original.dependencies[name]]))};
await fs.writeFile(path.join(staging,'package.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.copyFile(path.join(root,'CLI.md'),path.join(staging,'README.md'));
// npm's JS entry avoids a shell and works with Windows installations.
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run this script with npm run pack:cli.');
execFileSync(process.execPath,[npm,'pack',staging,'--pack-destination',path.join(root,'artifacts')],{stdio:'inherit',windowsHide:true});
