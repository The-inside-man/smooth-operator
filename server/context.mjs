// Keep every message in the active user request, including its tool calls and
// results. Historical requests may only be removed as complete groups.
export function removableHistory(messages) {
  const users = messages.flatMap((message, index) => message.role === 'user' ? [index] : []);
  for (let turn = 0; turn < users.length - 1; turn++) {
    const indices = [], pending = new Set();
    let valid = true;
    for (let index = users[turn]; index < users[turn + 1]; index++) {
      const message = messages[index];
      // Application instructions remain authoritative even if they appear
      // between historical turns.
      if (message.role === 'system' || message.role === 'developer') continue;
      indices.push(index);
      if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          if (!call.id || pending.has(call.id)) valid = false;
          else pending.add(call.id);
        }
      } else if (message.role === 'tool') {
        if (!pending.delete(message.tool_call_id)) valid = false;
      } else if (message.role !== 'user' && message.role !== 'assistant') valid = false;
    }
    // A later user request also closes a failed/interrupted user-only turn:
    // Studio deliberately does not replay failed assistant messages.
    if (valid && !pending.size && indices.length) return indices;
  }
  return [];
}

export function removeOldestHistory(messages) {
  const indices = new Set(removableHistory(messages));
  return { messages: messages.filter((_message, index) => !indices.has(index)), removedMessages: indices.size };
}

export function parseContextError(payload) {
  let value = payload;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { value = { message: value }; }
  }
  const error = value?.error || value;
  const message = typeof error?.message === 'string' ? error.message : '';
  const knownType = ['exceed_context_size_error', 'context_length_exceeded'].includes(error?.type);
  if (!knownType && !/(?:exceeds?|exceeded).{0,60}(?:available context|context (?:size|window|length))|(?:context (?:size|window|length)).{0,60}(?:exceeds?|exceeded)|too (?:large|long).{0,40}context/i.test(message)) return null;
  const positive = number => Number.isInteger(number) && number > 0 ? number : undefined;
  return {
    promptTokens: positive(error?.n_prompt_tokens) || positive(value?.n_prompt_tokens) || positive(Number(message.match(/request \((\d+) tokens\)/i)?.[1])),
    contextTokens: positive(error?.n_ctx) || positive(value?.n_ctx) || positive(Number(message.match(/context (?:size|window|length) \((\d+) tokens\)/i)?.[1]))
  };
}

export function contextLimitError({ promptTokens, contextTokens, responseTokens, fixedContext = false }) {
  const format = value => Number(value).toLocaleString('en-US');
  const capacity = contextTokens ? `The loaded model has a ${format(contextTokens)}-token context.` : 'The request exceeds the loaded model’s context window.';
  const required = promptTokens ? ` This request needs ${format(promptTokens)} input tokens plus ${format(responseTokens)} response tokens.` : ` Leave room for ${format(responseTokens)} response tokens as well as your input.`;
  const needed = Math.max(contextTokens + 1, (promptTokens || 0) + responseTokens + 16);
  const nextContext = contextTokens && needed <= 32768 ? 2 ** Math.ceil(Math.log2(needed)) : null;
  const action = fixedContext
    ? 'The lightweight guide keeps a fixed context. Reduce Response tokens, send less input, or use Chat/Code with a specialist and a larger Context tokens setting.'
    : nextContext ? `Increase Context tokens in Settings to ${format(nextContext)} and reload the model (this uses more memory), reduce Response tokens, or send less code/source.` : 'Reduce Response tokens or send less code/source.';
  return new Error(`${capacity}${required} ${action} Your latest request and source were kept intact.`);
}
