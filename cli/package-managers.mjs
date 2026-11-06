import {makeReview} from './tool-runner.mjs';

// Each adapter declares exact supported operations. No arbitrary subcommands or flags.
const manager=(id,platforms,operations,privileged=false)=>({id:'pkg-'+id,name:id,command:id,category:'Packages',platforms,defaultArgs:[],description:'Package manager / reviewed operations',manager:id,operations,privileged});
export const packageManagers=[
 manager('apt',['linux'],{version:['--version'],search:['search','$'],list:['list','--installed'],install:['install','$'],update:['install','--only-upgrade','$'],remove:['remove','$']},true),
 manager('dnf',['linux'],{version:['--version'],search:['search','$'],list:['list','--installed'],install:['install','$'],update:['upgrade','$'],remove:['remove','$']},true),
 manager('pacman',['linux'],{version:['--version'],search:['-Ss','$'],list:['-Q'],install:['-S','$'],remove:['-R','$']},true),
 manager('zypper',['linux'],{version:['--version'],search:['search','$'],list:['search','--installed-only'],install:['install','$'],update:['update','$'],remove:['remove','$']},true),
 manager('apk',['linux'],{version:['--version'],search:['search','$'],list:['info'],install:['add','$'],update:['upgrade','$'],remove:['del','$']},true),
 manager('brew',['linux','darwin'],{version:['--version'],search:['search','$'],list:['list'],install:['install','$'],update:['upgrade','$'],remove:['uninstall','$']}),
 manager('winget',['win32'],{version:['--version'],search:['search','--query','$'],list:['list'],install:['install','--id','$','--exact'],update:['upgrade','--id','$','--exact'],remove:['uninstall','--id','$','--exact']}),
 manager('choco',['win32'],{version:['--version'],search:['search','$'],list:['list'],install:['install','$'],update:['upgrade','$'],remove:['uninstall','$']},true),
 manager('scoop',['win32'],{version:['--version'],search:['search','$'],list:['list'],install:['install','$'],update:['update','$'],remove:['uninstall','$']}),
 manager('npm',['linux','darwin','win32'],{version:['--version'],search:['search','$'],list:['list','--depth=0'],install:['install','$'],update:['update','$'],remove:['uninstall','$']}),
 manager('pnpm',['linux','darwin','win32'],{version:['--version'],search:['search','$'],list:['list','--depth=0'],install:['add','$'],update:['update','$'],remove:['remove','$']}),
 manager('yarn',['linux','darwin','win32'],{version:['--version']}),
 manager('pip',['linux','darwin','win32'],{version:['--version'],list:['list'],install:['install','$'],update:['install','--upgrade','$'],remove:['uninstall','$']}),
 manager('uv',['linux','darwin','win32'],{version:['--version'],list:['pip','list'],install:['pip','install','$'],update:['pip','install','--upgrade','$'],remove:['pip','uninstall','$']}),
 manager('cargo',['linux','darwin','win32'],{version:['--version'],search:['search','$'],list:['install','--list'],install:['install','$'],remove:['uninstall','$']}),
];

export function packageReview(tool,operation,input='',options={}) {
 const template=tool.operations?.[operation];if(!template)throw new Error(`Operation ${operation} is unsupported by ${tool.name}.`);
 const name=input.trim();
 // A single registry identifier only: no leading options, URLs, paths, versions,
 // sources, shell syntax or manager-specific expression language.
 if(template.includes('$')&&(!name||name.length>160||!(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name)||tool.manager==='npm'&&/^@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))))throw new Error('Enter one package identifier (letters, digits, dot, underscore, + or -). No flags, URLs or paths.');
 const args=template.map(arg=>arg==='$'?name:arg),mutation=['install','update','remove'].includes(operation);
 return Object.freeze({...makeReview({...tool,network:operation!=='version'&&operation!=='list',risk:mutation?'This changes packages in the displayed working directory or the manager’s configured scope. Package scripts may execute. No automatic elevation or confirmation flags are added.':'Read-only adapter operation; search may contact package registries.'},[...(tool.prefixArgs||[]),...args],options),operation,packageName:name,mutation});
}
