import test from 'node:test';
import assert from 'node:assert/strict';
import links from '../desktop/model-links.cjs';

test('model links allow only Hugging Face HTTPS pages without credentials or custom ports', () => {
  for (const url of ['https://huggingface.co/Qwen/Qwen-Image-2.1', 'https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE']) assert.equal(links.isModelLink(url), true);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://huggingface.co.evil.example/model', 'https://huggingface.co@evil.example/model', 'https://user:password@huggingface.co/model', 'https://huggingface.co:8443/model', 'http://huggingface.co/model', '//huggingface.co/model', '', null, {}]) assert.equal(links.isModelLink(url), false);
});
