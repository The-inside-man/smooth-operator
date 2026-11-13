// Google's instruction-tuned QAT GGUFs, pinned to the model files' LFS commits.
// TIM's chat adapter uses the text weights without a multimodal projector.
const variants = [
  {
    size: 'E2B', memoryGB: 5,
    description: 'Compact text assistant for short chats, summaries and simple coding tasks.',
    bestFor: ['Quick questions', 'Summarization'],
    revision: '347eef722ec7f151f37d1ef0b5c7c77d8de4efcb',
    path: 'gemma-4-E2B_q4_0-it.gguf', bytes: 3349516256,
    sha256: 'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634'
  },
  {
    size: 'E4B', memoryGB: 8,
    description: 'General-purpose text assistant for everyday coding, writing and reasoning.',
    bestFor: ['Everyday coding', 'Writing', 'Reasoning'],
    revision: 'e998672c8018dd704e347d3b6843c112547244d1',
    path: 'gemma-4-E4B_q4_0-it.gguf', bytes: 5154941280,
    sha256: '676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee'
  },
  {
    size: '12B', memoryGB: 11,
    description: 'Mid-size dense model for multi-step reasoning, coding and longer text tasks.',
    bestFor: ['Coding', 'Multi-step reasoning', 'Long documents'],
    revision: 'ef7b15515d7ed7f34305a08edb5717e7989d6dc9',
    path: 'gemma-4-12b-it-qat-q4_0.gguf', bytes: 6975879296,
    sha256: '93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b'
  },
  {
    size: '26B-A4B', memoryGB: 19,
    description: 'Mixture-of-experts model for complex coding and reasoning. It activates about 4B parameters per token and loads the full set of weights.',
    bestFor: ['Complex coding', 'Multi-step reasoning'],
    revision: '8afd43710afbb87c711f33f7e7c11b1434a9fa1a',
    path: 'gemma-4-26B_q4_0-it.gguf', bytes: 14439363584,
    sha256: '3eca3b8f6d7baf218a7dd6bba5fb59a56ee25fe2d567b6f5f589b4f697eca51d'
  },
  {
    size: '31B', memoryGB: 23,
    description: 'Largest dense Gemma 4 model for complex coding, reasoning and detailed writing.',
    bestFor: ['Complex coding', 'Reasoning', 'Detailed writing'],
    revision: '0e39713ad6f0520613127717c0648c13f71ceb39',
    path: 'gemma-4-31B_q4_0-it.gguf', bytes: 17651001568,
    sha256: '179cfb99212709597eae5929112cfca677e1bbf566178b479ae1da0c4772874b'
  }
];

export const gemmaCatalogModels = variants.map(({ size, memoryGB, description, bestFor, revision, path, bytes, sha256 }) => {
  const id = `gemma-4-${size.toLowerCase()}`;
  const repo = `google/gemma-4-${size}-it-qat-q4_0-gguf`;
  const sourceUrl = `https://huggingface.co/${repo}`;
  const label = size.replace('-', ' ');
  return {
    id, catalogId: id, name: `Gemma 4 ${label}`, kind: 'chat', description, bestFor,
    parameterSize: label, quantization: 'Q4_0', downloadBytes: bytes, memoryGB,
    license: 'apache-2.0', sourceUrl, publisherUrl: `https://huggingface.co/google/gemma-4-${size}-it`,
    requirements: ['Requires a Gemma 4-compatible llama.cpp chat engine.'],
    files: [{ repo, revision, path, size: bytes, sha256 }]
  };
});
