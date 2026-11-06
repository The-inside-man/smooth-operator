import {dependencyCatalog} from './dependencies.mjs';
import {modelIntent,proposeToolDraft,validateIntent} from './planner.mjs';
import {inspectPort} from './local-inspect.mjs';
export async function naturalRequest(client,request,{signal,onStatus=()=>{},intentProvider=modelIntent,inspect=inspectPort,propose=proposeToolDraft}={}){
 const intent=validateIntent(await intentProvider(client,'general',request,{signal,onStatus}),'general');
 if(intent.action==='download_images')return {route:'images',url:intent.url,destination:intent.destination,transport:client?.transport};
 if(intent.action==='clarify')return {text:intent.question||intent.reason||'Please clarify the operation and target.'};
 if(client?.transport?.mode==='tor'&&!['inspect_port','clarify','download_images'].includes(intent.action))throw new Error('This action is outside TIM Tor transport coverage; blocked without a direct fallback.');
 if(intent.action==='desktop')return {route:'desktop',request:intent.request||request};
 if(intent.action==='dependencies'){const item=dependencyCatalog.find(d=>d.id===intent.request.trim().toLowerCase());return {text:item?item.name+' / '+item.purpose+'\nOfficial source: '+item.page+'\nRun tim dependencies '+item.id+' to resolve metadata; add --download --destination ABSOLUTE_FOLDER for a separately confirmed download only. Nothing installed.':'Choose a prerequisite: '+dependencyCatalog.map(d=>d.id).join(', ')+'. Run tim dependencies list.'};}
 if(['install','listen'].includes(intent.action))return {route:intent.action,request:intent.request||request};
 if(intent.action==='inspect_port'){
  try{const result=await inspect(intent,{signal,onStatus});return {text:result.summary+'\n\n'+result.output+(result.stderr?'\nWarnings: '+result.stderr:'')};}
  catch(error){if(error.code!=='TOOL_MISSING')throw error;onStatus(error.message+' Searching toolbox first.');}
 }
 const result=await propose({request,client,signal,onStatus});
 if(result.kind==='reuse')return {text:'Existing toolbox candidates (nothing executed):\n'+result.candidates.map(c=>c.id+' / '+c.name).join('\n')+'\nReview source with tim toolbox show ID, then tim toolbox run ID for explicit launch review.'};
 return {text:'Saved unexecuted tool draft '+result.draft.id+'. Review source with tim toolbox show '+result.draft.id+'; tim toolbox run '+result.draft.id+' opens exact-command approval. No generated code has run.'};
}
