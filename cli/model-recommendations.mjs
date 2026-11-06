const GiB=2**30;
const bytes=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const positive=value=>bytes(value)!==null&&value>0;
const gib=value=>(value/GiB).toFixed(1);

function normalizeMemory(snapshot){
 const sample=snapshot.memory||{};
 const totalBytes=positive(sample.totalBytes)?sample.totalBytes:positive(sample.total)?sample.total:null;
 const available=bytes(sample.availableBytes)??bytes(sample.free);
 const availableBytes=available===null?null:totalBytes===null?available:Math.min(available,totalBytes);
 const reserveBytes=bytes(sample.reserveBytes)??(totalBytes===null?null:Math.min(totalBytes,Math.max(GiB,totalBytes*.1)));
 const measuredBudget=bytes(sample.modelBudgetBytes);
 const derivedBudget=availableBytes===null||reserveBytes===null?null:Math.max(0,availableBytes-reserveBytes);
 let modelBudgetBytes=measuredBudget??derivedBudget;
 if(modelBudgetBytes!==null){
  if(totalBytes!==null)modelBudgetBytes=Math.min(modelBudgetBytes,Math.max(0,totalBytes-(reserveBytes||0)));
  if(derivedBudget!==null)modelBudgetBytes=Math.min(modelBudgetBytes,derivedBudget);
 }
 const stale=Boolean(sample.stale||sample.status==='stale');
 const fallback=sample.availableSource==='free-fallback'||sample.status==='fallback'||bytes(sample.availableBytes)===null&&measuredBudget===null&&bytes(sample.free)!==null;
 const known=totalBytes!==null&&modelBudgetBytes!==null;
 const reliable=known&&!stale&&!fallback;
 // The backend already leaves an OS reserve. Retain more headroom for model
 // estimates and use half of that budget again when only free RAM was sampled.
 const comfortableBudgetBytes=known&&!stale?modelBudgetBytes*(fallback ? .4 : .8):null;
 const notice=!known?'Memory information is unavailable; no automatic suggestions.':
  stale?'Memory information is stale; refresh before relying on suggestions.':
  fallback?'Memory uses a conservative fallback; suggestions leave extra headroom.':
  'Suggestions leave memory headroom. Estimates use system RAM; speed and longer chats may need more.';
 return {totalBytes,availableBytes,reserveBytes,modelBudgetBytes,comfortableBudgetBytes,reliable,stale,source:sample.availableSource||(fallback?'free-fallback':'reported'),notice};
}

// Keep the complete supported chat catalog visible. Suggestions are a few
// memory-sized choices, not a filter or a promise that a model will load.
export function getModelRecommendations(snapshot={}){
 const memory=normalizeMemory(snapshot),models=snapshot.models||[];
 const options=(snapshot.catalog||[]).filter(entry=>entry.kind==='chat').map(entry=>{
  const model=models.find(model=>model.catalogId===entry.id||entry.modelId&&model.id===entry.modelId);
  const estimatedMemoryBytes=positive(entry.memoryGB)?Math.round(entry.memoryGB*GiB):null;
  const fit=estimatedMemoryBytes===null||memory.modelBudgetBytes===null?'unknown':
   estimatedMemoryBytes>memory.modelBudgetBytes?'too-large':
   memory.comfortableBudgetBytes!==null&&estimatedMemoryBytes<=memory.comfortableBudgetBytes?'comfortable':'tight';
  return {...entry,installed:Boolean(model||entry.installed),available:Boolean(model?.available),modelId:model?.id||entry.modelId,issue:model?.issue||entry.issue||'',
   estimatedMemoryBytes,fit,suggested:false,reason:'',suggestionKind:undefined};
 });
 const eligible=options.filter(option=>option.fit==='comfortable');
 // Equal-sized general and code variants remain selectable, but suggestions
 // cover different memory tiers rather than highlighting every small variant.
 const tiers=[...new Set(eligible.map(option=>option.estimatedMemoryBytes))].sort((a,b)=>a-b);
 const representative=size=>eligible.find(option=>option.estimatedMemoryBytes===size);
 const selected=[];
 if(tiers.length){
  const largest=tiers.at(-1),remaining=new Set(tiers);
  const choose=(target,kind)=>{
   const closest=[...remaining].sort((a,b)=>Math.abs(a-target)-Math.abs(b-target)||a-b)[0];
   if(closest===undefined)return;
   remaining.delete(closest);selected.push({option:representative(closest),kind});
  };
  choose(largest,'capable');
  choose(largest*.6,'balanced');
  choose(largest*.3,'efficient');
  if(selected.length===1)selected[0].kind='balanced';
 }
 for(const {option,kind} of selected){
  option.suggested=true;option.suggestionKind=kind;
  const amount=gib(option.estimatedMemoryBytes);
  option.reason=kind==='balanced'?`Balanced choice: about ${amount} GiB, with room left for other work.`:
   kind==='capable'?`Larger choice: about ${amount} GiB, within your comfortable memory budget.`:
   `Lighter choice: about ${amount} GiB, leaving more memory for other apps.`;
 }
 const priority={balanced:0,capable:1,efficient:2};
 const recommendations=selected.sort((a,b)=>priority[a.kind]-priority[b.kind]).map(({option})=>({catalogId:option.id,reason:option.reason,kind:option.suggestionKind}));
 return {memory,options,suggestedIds:recommendations.map(option=>option.catalogId),recommendations,
  hardware:{...(snapshot.hardware||{}),platform:snapshot.hardware?.platform||snapshot.platform,arch:snapshot.hardware?.arch||snapshot.arch}};
}

// One ordered list drives the picker and numeric /model and /agent commands.
// Installed registry IDs stay intact; a supported model appears only once.
export function getModelChoices(snapshot={}){
 const result=getModelRecommendations(snapshot),choices=[],modelIds=new Set(),catalogIds=new Set();
 for(const model of snapshot.models||[]){
  if(model.kind!=='chat'||typeof model.id!=='string'||!model.id||modelIds.has(model.id))continue;
  const entry=result.options.find(entry=>entry.id===model.catalogId)||result.options.find(entry=>entry.modelId===model.id);
  const catalogId=entry?.id||model.catalogId;
  if(catalogId&&catalogIds.has(catalogId))continue;
  const importedEstimate=positive(model.memoryGB)?Math.round(model.memoryGB*GiB):positive(model.size)?Math.round(model.size*1.2+.5*GiB):null;
  choices.push({...entry,...model,id:model.id,name:model.name||entry?.name||model.id,modelId:model.id,kind:'chat',catalogId,
   installed:true,available:Boolean(model.available),issue:typeof model.issue==='string'?model.issue:entry?.issue||'',
   estimatedMemoryBytes:entry?.estimatedMemoryBytes??importedEstimate,downloadBytes:entry?.downloadBytes??model.downloadBytes,
   fit:entry?.fit||'unknown',suggested:Boolean(entry?.suggested),reason:entry?.reason||'',suggestionKind:entry?.suggestionKind});
  modelIds.add(model.id);if(catalogId)catalogIds.add(catalogId);
 }
 for(const entry of result.options){
  if(catalogIds.has(entry.id))continue;
  // A conflicting registry alias must not hide a different supported download.
  const preferredId=entry.modelId||'catalog:'+entry.id,id=modelIds.has(preferredId)?'catalog:'+entry.id:preferredId;
  if(modelIds.has(id))continue;
  choices.push({...entry,id,modelId:id,catalogId:entry.id,kind:'chat',installed:Boolean(entry.installed),available:false});
  catalogIds.add(entry.id);modelIds.add(id);
 }
 return {...result,choices};
}
