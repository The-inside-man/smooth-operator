// Closed schemas shared by cloud planning and the local intent validator.
const string={type:'string'},strings={type:'array',items:string};
export function intentSchema(kind){
 const properties=kind==='install'?{action:{const:'install',type:'string'},package:string,manager:string,reason:string}:kind==='read'?{action:{const:'read',type:'string'},view:{type:'string',enum:['hex','ascii']},filter:string,reason:string}:kind==='listen'?{action:{const:'listen',type:'string'},mode:{type:['string','null'],enum:['bind','capture',null]},protocol:{type:['string','null'],enum:['tcp','udp',null]},port:{type:'integer'},host:string,reason:string}:kind==='build'?{action:{const:'build',type:'string'},name:string,description:string,source:string,platforms:strings,dependencies:strings,tags:strings,permissions:string,networkScope:string}:null;
 if(!properties)throw new Error('Unsupported structured intent.');
 return {type:'object',properties,required:Object.keys(properties),additionalProperties:false};
}
