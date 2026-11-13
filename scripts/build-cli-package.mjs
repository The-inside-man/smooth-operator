import {buildVoice} from './build-voice.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const staging=path.join(root,'artifacts','tim-cli-package');
await fs.rm(staging,{recursive:true,force:true});
await fs.mkdir(staging,{recursive:true});
for(const directory of ['cli','server'])await fs.cp(path.join(root,directory),path.join(staging,directory),{recursive:true});
const voice=await buildVoice(root);if(voice){await fs.copyFile(voice,path.join(staging,'cli/voice/WindowsCapture.exe'));await fs.copyFile(path.join(root,'artifacts/voice/WindowsControl.exe'),path.join(staging,'cli/control/WindowsControl.exe'));}
const original=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const manifest={name:'@tim-studio/cli',version:original.version,description:'TIM Studio full-screen local terminal workspace',license:original.license,type:'module',bin:{tim:'cli/index.mjs'},engines:{node:'>=24'},files:['cli','server','README.md','SILENT-MODE.md','PLATFORM-SUPPORT.md'],dependencies:Object.fromEntries(['ink','react','strip-ansi','string-width'].map(name=>[name,original.dependencies[name]]))};
await fs.writeFile(path.join(staging,'package.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.copyFile(path.join(root,'CLI.md'),path.join(staging,'README.md'));
await fs.copyFile(path.join(root,'SILENT-MODE.md'),path.join(staging,'SILENT-MODE.md'));
await fs.copyFile(path.join(root,'PLATFORM-SUPPORT.md'),path.join(staging,'PLATFORM-SUPPORT.md'));
await fs.copyFile(path.join(root,'LICENSE'),path.join(staging,'LICENSE'));
// npm's JS entry avoids a shell and works with Windows installations.
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run this script with npm run pack:cli.');
execFileSync(process.execPath,[npm,'pack',staging,'--pack-destination',path.join(root,'artifacts')],{stdio:'inherit',windowsHide:true});

// A runnable local distribution; no unpublished registry URL is assumed.
const bundle=path.join(root,'artifacts','tim-studio-installer');
await fs.mkdir(bundle,{recursive:true});
const priorManifest=await fs.readFile(path.join(bundle,'tim-package.json'),'utf8').catch(error=>{
 if(error.code!=='ENOENT')throw error;
 return null;
});
for(const file of ['installer.mjs','install-tim.cmd','install-tim.ps1','install-tim.sh','bootstrap-node.ps1','bootstrap-node.sh'])await fs.copyFile(path.join(root,'installers',file),path.join(bundle,file));
const filename='tim-studio-cli-'+original.version+'.tgz';
await fs.copyFile(path.join(root,'artifacts',filename),path.join(bundle,filename));
const sha256=crypto.createHash('sha256').update(await fs.readFile(path.join(bundle,filename))).digest('hex');
await fs.writeFile(path.join(bundle,'tim-package.json'),JSON.stringify({filename,sha256},null,2)+'\n');
await fs.copyFile(path.join(root,'CLI.md'),path.join(bundle,'README.md'));
await fs.copyFile(path.join(root,'SILENT-MODE.md'),path.join(bundle,'SILENT-MODE.md'));
await fs.copyFile(path.join(root,'PLATFORM-SUPPORT.md'),path.join(bundle,'PLATFORM-SUPPORT.md'));
await fs.copyFile(path.join(root,'LICENSE'),path.join(bundle,'LICENSE'));
const priorFilename=priorManifest&&JSON.parse(priorManifest).filename;
if(priorFilename!==filename&&/^tim-studio-cli-[\w.+-]+\.tgz$/.test(priorFilename||''))await fs.rm(path.join(bundle,priorFilename),{force:true});
console.log('User installer bundle: '+bundle);
