export function scriptInstructions(language){
 if(language===undefined)return '';
 if(!['python','javascript'].includes(language))throw new Error('Choose Python or JavaScript for generated script output.');
 const fence=language==='python'?'python':'javascript';
 return `\n\nThe user requested a script for a separate terminal Save/Run review. Return exactly one complete fenced ${fence} code block containing the entire runnable program. Include all imports and an entry point; do not omit sections or replace code with placeholders. The terminal host will show the source, destination and exact interpreter command for the user's approval. You are preparing source only: do not claim a file has been written, dependencies installed, a window opened, or the program executed. Do not add shell installation commands to the source block. For a requested graphical program, use its normal graphical backend and event loop.`;
}
