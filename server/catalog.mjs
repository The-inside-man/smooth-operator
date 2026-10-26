// Curated on 2026-10-26 from publisher model cards and Hugging Face's blobs API.
// Sizes and SHA256 values are pinned to immutable revisions; no model weights are bundled.
// memoryGB is a conservative planning estimate at short context, not a hardware guarantee.
// Qwen3's default uses Unsloth's quantization of the Apache-2.0 Qwen model.
export const catalogModels = Object.freeze([
  {
    "id": "qwen3-0.6b",
    "catalogId": "qwen3-0.6b",
    "name": "Qwen3 0.6B · Orchestrator",
    "kind": "chat",
    "description": "Small always-ready guide for choosing models, short questions and simple task routing. Complex tasks benefit from a specialist.",
    "bestFor": [
      "Model guidance",
      "Task routing",
      "Quick questions"
    ],
    "parameterSize": "0.6B",
    "quantization": "Q4_K_M",
    "downloadBytes": 396705472,
    "memoryGB": 1.6,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF",
    "files": [
      {
        "repo": "unsloth/Qwen3-0.6B-GGUF",
        "revision": "50968a4468ef4233ed78cd7c3de230dd1d61a56b",
        "path": "Qwen3-0.6B-Q4_K_M.gguf",
        "size": 396705472,
        "sha256": "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a"
      }
    ],
    "defaultOrchestrator": true
  },
  {
    "id": "qwen3-1.7b",
    "catalogId": "qwen3-1.7b",
    "name": "Qwen3 1.7B",
    "kind": "chat",
    "description": "Compact multilingual assistant for everyday writing, summaries and light reasoning.",
    "bestFor": [
      "Reasoning",
      "Writing",
      "Multilingual chat"
    ],
    "parameterSize": "1.7B",
    "quantization": "Q8_0",
    "downloadBytes": 1834426016,
    "memoryGB": 3,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen3-1.7B-GGUF",
        "revision": "90862c4b9d2787eaed51d12237eafdfe7c5f6077",
        "path": "Qwen3-1.7B-Q8_0.gguf",
        "size": 1834426016,
        "sha256": "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a"
      }
    ]
  },
  {
    "id": "qwen3-4b",
    "catalogId": "qwen3-4b",
    "name": "Qwen3 4B",
    "kind": "chat",
    "description": "General multilingual reasoning model for writing, analysis, mathematics and coding. Larger sizes trade memory for capacity.",
    "bestFor": [
      "Reasoning",
      "Writing",
      "Multilingual chat"
    ],
    "parameterSize": "4B",
    "quantization": "Q4_K_M",
    "downloadBytes": 2497280256,
    "memoryGB": 4.5,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen3-4B-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen3-4B-GGUF",
        "revision": "bc640142c66e1fdd12af0bd68f40445458f3869b",
        "path": "Qwen3-4B-Q4_K_M.gguf",
        "size": 2497280256,
        "sha256": "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5"
      }
    ]
  },
  {
    "id": "qwen3-8b",
    "catalogId": "qwen3-8b",
    "name": "Qwen3 8B",
    "kind": "chat",
    "description": "General multilingual reasoning model for writing, analysis, mathematics and coding. Larger sizes trade memory for capacity.",
    "bestFor": [
      "Reasoning",
      "Writing",
      "Multilingual chat"
    ],
    "parameterSize": "8B",
    "quantization": "Q4_K_M",
    "downloadBytes": 5027783488,
    "memoryGB": 8,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen3-8B-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen3-8B-GGUF",
        "revision": "7c41481f57cb95916b40956ab2f0b139b296d974",
        "path": "Qwen3-8B-Q4_K_M.gguf",
        "size": 5027783488,
        "sha256": "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785"
      }
    ]
  },
  {
    "id": "qwen3-14b",
    "catalogId": "qwen3-14b",
    "name": "Qwen3 14B",
    "kind": "chat",
    "description": "General multilingual reasoning model for writing, analysis, mathematics and coding. Larger sizes trade memory for capacity.",
    "bestFor": [
      "Reasoning",
      "Writing",
      "Multilingual chat"
    ],
    "parameterSize": "14B",
    "quantization": "Q4_K_M",
    "downloadBytes": 9001752960,
    "memoryGB": 13,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen3-14B-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen3-14B-GGUF",
        "revision": "530227a7d994db8eca5ab5ced2fb692b614357fd",
        "path": "Qwen3-14B-Q4_K_M.gguf",
        "size": 9001752960,
        "sha256": "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0"
      }
    ]
  },
  {
    "id": "qwen2.5-0.5b",
    "catalogId": "qwen2.5-0.5b",
    "name": "Qwen2.5 0.5B",
    "kind": "chat",
    "description": "Instruction-following assistant for conversation, structured text, summaries and multilingual writing. A compact option for lighter computers.",
    "bestFor": [
      "Writing",
      "Summaries",
      "Structured output"
    ],
    "parameterSize": "0.5B",
    "quantization": "Q4_K_M",
    "downloadBytes": 491400032,
    "memoryGB": 1.3,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
        "revision": "9217f5db79a29953eb74d5343926648285ec7e67",
        "path": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "size": 491400032,
        "sha256": "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db"
      }
    ]
  },
  {
    "id": "qwen2.5-coder-0.5b",
    "catalogId": "qwen2.5-coder-0.5b",
    "name": "Qwen2.5 Coder 0.5B",
    "kind": "chat",
    "description": "Code-focused assistant for code generation, explanation and fixes. A small option for simple snippets and quick help.",
    "bestFor": [
      "Code generation",
      "Debugging",
      "Code explanation"
    ],
    "parameterSize": "0.5B",
    "quantization": "Q4_K_M",
    "downloadBytes": 491400064,
    "memoryGB": 1.3,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF",
        "revision": "ebb2015119c907b064c512bf053e945850b5875f",
        "path": "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
        "size": 491400064,
        "sha256": "1d9614638d18024d0fbb36575a15f1302a3adf044df10345688ec4f6e1c4ff32"
      }
    ]
  },
  {
    "id": "qwen2.5-1.5b",
    "catalogId": "qwen2.5-1.5b",
    "name": "Qwen2.5 1.5B",
    "kind": "chat",
    "description": "Instruction-following assistant for conversation, structured text, summaries and multilingual writing. A compact option for lighter computers.",
    "bestFor": [
      "Writing",
      "Summaries",
      "Structured output"
    ],
    "parameterSize": "1.5B",
    "quantization": "Q4_K_M",
    "downloadBytes": 1117320736,
    "memoryGB": 2.5,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
        "revision": "91cad51170dc346986eccefdc2dd33a9da36ead9",
        "path": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
        "size": 1117320736,
        "sha256": "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"
      }
    ]
  },
  {
    "id": "qwen2.5-coder-1.5b",
    "catalogId": "qwen2.5-coder-1.5b",
    "name": "Qwen2.5 Coder 1.5B",
    "kind": "chat",
    "description": "Code-focused assistant for code generation, explanation and fixes. A small option for simple snippets and quick help.",
    "bestFor": [
      "Code generation",
      "Debugging",
      "Code explanation"
    ],
    "parameterSize": "1.5B",
    "quantization": "Q4_K_M",
    "downloadBytes": 1117320768,
    "memoryGB": 2.5,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF",
        "revision": "f86cb2c1fa58255f8052cc32aeede1b7482d4361",
        "path": "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
        "size": 1117320768,
        "sha256": "cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046"
      }
    ]
  },
  {
    "id": "qwen2.5-3b",
    "catalogId": "qwen2.5-3b",
    "name": "Qwen2.5 3B",
    "kind": "chat",
    "description": "Instruction-following assistant for conversation, structured text, summaries and multilingual writing. Use for more involved work when memory allows.",
    "bestFor": [
      "Writing",
      "Summaries",
      "Structured output"
    ],
    "parameterSize": "3B",
    "quantization": "Q4_K_M",
    "downloadBytes": 2104932768,
    "memoryGB": 4,
    "license": "Qwen Research License",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen2.5-3B-Instruct-GGUF",
        "revision": "7dabda4d13d513e3e842b20f0d435c732f172cbe",
        "path": "qwen2.5-3b-instruct-q4_k_m.gguf",
        "size": 2104932768,
        "sha256": "626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d"
      }
    ]
  },
  {
    "id": "qwen2.5-coder-3b",
    "catalogId": "qwen2.5-coder-3b",
    "name": "Qwen2.5 Coder 3B",
    "kind": "chat",
    "description": "Code-focused assistant for code generation, explanation and fixes. Useful for larger coding questions when memory allows.",
    "bestFor": [
      "Code generation",
      "Debugging",
      "Code explanation"
    ],
    "parameterSize": "3B",
    "quantization": "Q4_K_M",
    "downloadBytes": 2104932800,
    "memoryGB": 4,
    "license": "Qwen Research License",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen2.5-Coder-3B-Instruct-GGUF",
        "revision": "f74adce6aa16316c625447af059dbebe4983757c",
        "path": "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
        "size": 2104932800,
        "sha256": "724fb256bec1ff062b2f65e4569e871ad2e95ab2a3989723d1769c54294730b7"
      }
    ]
  },
  {
    "id": "qwen2.5-7b",
    "catalogId": "qwen2.5-7b",
    "name": "Qwen2.5 7B",
    "kind": "chat",
    "description": "Instruction-following assistant for conversation, structured text, summaries and multilingual writing. Use for more involved work when memory allows.",
    "bestFor": [
      "Writing",
      "Summaries",
      "Structured output"
    ],
    "parameterSize": "7B",
    "quantization": "Q4_K_M",
    "downloadBytes": 4683073632,
    "memoryGB": 7.5,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen2.5-7B-Instruct-GGUF",
        "revision": "bb5d59e06d9551d752d08b292a50eb208b07ab1f",
        "path": "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
        "size": 3993201344,
        "sha256": "dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db"
      },
      {
        "repo": "Qwen/Qwen2.5-7B-Instruct-GGUF",
        "revision": "bb5d59e06d9551d752d08b292a50eb208b07ab1f",
        "path": "qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf",
        "size": 689872288,
        "sha256": "539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a"
      }
    ]
  },
  {
    "id": "qwen2.5-coder-7b",
    "catalogId": "qwen2.5-coder-7b",
    "name": "Qwen2.5 Coder 7B",
    "kind": "chat",
    "description": "Code-focused assistant for code generation, explanation and fixes. Useful for larger coding questions when memory allows.",
    "bestFor": [
      "Code generation",
      "Debugging",
      "Code explanation"
    ],
    "parameterSize": "7B",
    "quantization": "Q4_K_M",
    "downloadBytes": 4683073536,
    "memoryGB": 7.5,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
        "revision": "13fb94bfda8c8cf22497dc57b78f391a9acb426a",
        "path": "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
        "size": 4683073536,
        "sha256": "509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c"
      }
    ]
  },
  {
    "id": "qwen2.5-14b",
    "catalogId": "qwen2.5-14b",
    "name": "Qwen2.5 14B",
    "kind": "chat",
    "description": "Instruction-following assistant for conversation, structured text, summaries and multilingual writing. Use for more involved work when memory allows.",
    "bestFor": [
      "Writing",
      "Summaries",
      "Structured output"
    ],
    "parameterSize": "14B",
    "quantization": "Q4_K_M",
    "downloadBytes": 8988110496,
    "memoryGB": 13,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen2.5-14B-Instruct-GGUF",
        "revision": "b466e1f8c07172155743e8e1307507d8a4f91fbd",
        "path": "qwen2.5-14b-instruct-q4_k_m-00001-of-00003.gguf",
        "size": 3991999872,
        "sha256": "a09ea5e7b1eafb1b30b241726c3cc3c905c96f14ad41e246ffa5f44e53904f68"
      },
      {
        "repo": "Qwen/Qwen2.5-14B-Instruct-GGUF",
        "revision": "b466e1f8c07172155743e8e1307507d8a4f91fbd",
        "path": "qwen2.5-14b-instruct-q4_k_m-00002-of-00003.gguf",
        "size": 3989373504,
        "sha256": "21b9457d079680d284e90ef69607c4b2d8ef64a09d4729cb7b5e1357bdba41ae"
      },
      {
        "repo": "Qwen/Qwen2.5-14B-Instruct-GGUF",
        "revision": "b466e1f8c07172155743e8e1307507d8a4f91fbd",
        "path": "qwen2.5-14b-instruct-q4_k_m-00003-of-00003.gguf",
        "size": 1006737120,
        "sha256": "c8d37006760a387a35216e070e6664d7da927f10be8eb870fef2e3d4833d9976"
      }
    ]
  },
  {
    "id": "qwen2.5-coder-14b",
    "catalogId": "qwen2.5-coder-14b",
    "name": "Qwen2.5 Coder 14B",
    "kind": "chat",
    "description": "Code-focused assistant for code generation, explanation and fixes. Useful for larger coding questions when memory allows.",
    "bestFor": [
      "Code generation",
      "Debugging",
      "Code explanation"
    ],
    "parameterSize": "14B",
    "quantization": "Q4_K_M",
    "downloadBytes": 8988110272,
    "memoryGB": 13,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
    "files": [
      {
        "repo": "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
        "revision": "d0a692ef765eefbf2fabb130b3cb2e8917e3d225",
        "path": "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
        "size": 8988110272,
        "sha256": "c1e659736d89ac1065fb495330fb824d94001974a4bfa78e7270e43476a8d940"
      }
    ]
  },
  {
    "id": "whisper-tiny",
    "catalogId": "whisper-tiny",
    "name": "Whisper tiny",
    "kind": "transcribe",
    "description": "Multilingual speech-to-text for WAV audio. Fastest and lightest, with lower accuracy.",
    "bestFor": [
      "Audio transcription",
      "Multilingual speech"
    ],
    "parameterSize": "39M",
    "quantization": "F16",
    "downloadBytes": 77691713,
    "memoryGB": 0.4,
    "license": "mit",
    "sourceUrl": "https://huggingface.co/ggerganov/whisper.cpp",
    "files": [
      {
        "repo": "ggerganov/whisper.cpp",
        "revision": "5359861c739e955e79d9a303bcbc70fb988958b1",
        "path": "ggml-tiny.bin",
        "size": 77691713,
        "sha256": "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"
      }
    ]
  },
  {
    "id": "whisper-tiny-en",
    "catalogId": "whisper-tiny-en",
    "name": "Whisper tiny.en",
    "kind": "transcribe",
    "description": "English-only speech-to-text for WAV audio. Fastest and lightest, with lower accuracy.",
    "bestFor": [
      "Audio transcription",
      "English speech"
    ],
    "parameterSize": "39M",
    "quantization": "F16",
    "downloadBytes": 77704715,
    "memoryGB": 0.4,
    "license": "mit",
    "sourceUrl": "https://huggingface.co/ggerganov/whisper.cpp",
    "files": [
      {
        "repo": "ggerganov/whisper.cpp",
        "revision": "5359861c739e955e79d9a303bcbc70fb988958b1",
        "path": "ggml-tiny.en.bin",
        "size": 77704715,
        "sha256": "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f"
      }
    ]
  },
  {
    "id": "whisper-base",
    "catalogId": "whisper-base",
    "name": "Whisper base",
    "kind": "transcribe",
    "description": "Multilingual speech-to-text for WAV audio. A compact balance for clear recordings.",
    "bestFor": [
      "Audio transcription",
      "Multilingual speech"
    ],
    "parameterSize": "74M",
    "quantization": "F16",
    "downloadBytes": 147951465,
    "memoryGB": 0.6,
    "license": "mit",
    "sourceUrl": "https://huggingface.co/ggerganov/whisper.cpp",
    "files": [
      {
        "repo": "ggerganov/whisper.cpp",
        "revision": "5359861c739e955e79d9a303bcbc70fb988958b1",
        "path": "ggml-base.bin",
        "size": 147951465,
        "sha256": "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"
      }
    ]
  },
  {
    "id": "whisper-base-en",
    "catalogId": "whisper-base-en",
    "name": "Whisper base.en",
    "kind": "transcribe",
    "description": "English-only speech-to-text for WAV audio. A compact balance for clear recordings.",
    "bestFor": [
      "Audio transcription",
      "English speech"
    ],
    "parameterSize": "74M",
    "quantization": "F16",
    "downloadBytes": 147964211,
    "memoryGB": 0.6,
    "license": "mit",
    "sourceUrl": "https://huggingface.co/ggerganov/whisper.cpp",
    "files": [
      {
        "repo": "ggerganov/whisper.cpp",
        "revision": "5359861c739e955e79d9a303bcbc70fb988958b1",
        "path": "ggml-base.en.bin",
        "size": 147964211,
        "sha256": "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
      }
    ]
  },
  {
    "id": "whisper-small",
    "catalogId": "whisper-small",
    "name": "Whisper small",
    "kind": "transcribe",
    "description": "Multilingual speech-to-text for WAV audio. Higher-capacity transcription with more memory use.",
    "bestFor": [
      "Audio transcription",
      "Multilingual speech"
    ],
    "parameterSize": "244M",
    "quantization": "F16",
    "downloadBytes": 487601967,
    "memoryGB": 1.2,
    "license": "mit",
    "sourceUrl": "https://huggingface.co/ggerganov/whisper.cpp",
    "files": [
      {
        "repo": "ggerganov/whisper.cpp",
        "revision": "5359861c739e955e79d9a303bcbc70fb988958b1",
        "path": "ggml-small.bin",
        "size": 487601967,
        "sha256": "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"
      }
    ]
  },
  {
    "id": "whisper-medium",
    "catalogId": "whisper-medium",
    "name": "Whisper medium",
    "kind": "transcribe",
    "description": "Multilingual speech-to-text for WAV audio. Higher-capacity transcription with more memory use.",
    "bestFor": [
      "Audio transcription",
      "Multilingual speech"
    ],
    "parameterSize": "769M",
    "quantization": "F16",
    "downloadBytes": 1533763059,
    "memoryGB": 3,
    "license": "mit",
    "sourceUrl": "https://huggingface.co/ggerganov/whisper.cpp",
    "files": [
      {
        "repo": "ggerganov/whisper.cpp",
        "revision": "5359861c739e955e79d9a303bcbc70fb988958b1",
        "path": "ggml-medium.bin",
        "size": 1533763059,
        "sha256": "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208"
      }
    ]
  },
  {
    "id": "whisper-large-v3-turbo",
    "catalogId": "whisper-large-v3-turbo",
    "name": "Whisper large-v3-turbo",
    "kind": "transcribe",
    "description": "Multilingual speech-to-text for WAV audio. Higher-capacity transcription with more memory use.",
    "bestFor": [
      "Audio transcription",
      "Multilingual speech"
    ],
    "parameterSize": "809M",
    "quantization": "F16",
    "downloadBytes": 1624555275,
    "memoryGB": 3.5,
    "license": "mit",
    "sourceUrl": "https://huggingface.co/ggerganov/whisper.cpp",
    "files": [
      {
        "repo": "ggerganov/whisper.cpp",
        "revision": "5359861c739e955e79d9a303bcbc70fb988958b1",
        "path": "ggml-large-v3-turbo.bin",
        "size": 1624555275,
        "sha256": "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69"
      }
    ]
  },
  {
    "id": "dreamshaper-8",
    "catalogId": "dreamshaper-8",
    "name": "DreamShaper 8",
    "kind": "image",
    "description": "Stable Diffusion 1.5 checkpoint for illustrations, fantasy artwork and stylized images. Start at 512 × 512. Requires an external image engine.",
    "bestFor": [
      "Illustration",
      "Fantasy artwork",
      "Stylized images"
    ],
    "parameterSize": "SD 1.5",
    "quantization": "FP16",
    "downloadBytes": 2132625894,
    "memoryGB": 6,
    "license": "Other (creator terms; see source)",
    "sourceUrl": "https://huggingface.co/Lykon/DreamShaper",
    "files": [
      {
        "repo": "Lykon/DreamShaper",
        "revision": "228d79cb20811466f5c5710aa91f05dabd0b8a14",
        "path": "DreamShaper_8_pruned.safetensors",
        "size": 2132625894,
        "sha256": "879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd"
      }
    ],
    "profile": {
      "family": "checkpoint",
      "args": {},
      "steps": 20,
      "cfg": 7
    }
  },
  {
    "id": "cyberrealistic-8",
    "catalogId": "cyberrealistic-8",
    "name": "CyberRealistic 8",
    "kind": "image",
    "description": "Stable Diffusion 1.5 checkpoint for realistic portraits, fashion and photographic scenes. Start at 512 × 512. Requires an external image engine.",
    "bestFor": [
      "Realistic portraits",
      "Fashion",
      "Photographic scenes"
    ],
    "parameterSize": "SD 1.5",
    "quantization": "FP16",
    "downloadBytes": 2132651162,
    "memoryGB": 6,
    "license": "CreativeML Open RAIL++-M (creator terms)",
    "sourceUrl": "https://huggingface.co/cyberdelia/CyberRealistic",
    "files": [
      {
        "repo": "cyberdelia/CyberRealistic",
        "revision": "99827f96edd717dacb28c68560680c201c55df05",
        "path": "CyberRealistic_V8_FP16.safetensors",
        "size": 2132651162,
        "sha256": "4a74f783f5d57e93ce86eb2a791c4a2d79fc6d281b4fca4f028255a067186a2a"
      }
    ],
    "profile": {
      "family": "checkpoint",
      "args": {},
      "steps": 28,
      "cfg": 7.5
    }
  },
  {
    "id": "juggernaut-xl-9",
    "catalogId": "juggernaut-xl-9",
    "name": "Juggernaut XL 9",
    "kind": "image",
    "description": "SDXL checkpoint for detailed photography, cinematic scenes and landscapes. Best near 1024-pixel resolution; needs more memory and an external image engine.",
    "bestFor": [
      "Detailed photography",
      "Cinematic scenes",
      "Landscapes"
    ],
    "parameterSize": "SDXL",
    "quantization": "FP16",
    "downloadBytes": 7105348188,
    "memoryGB": 12,
    "license": "CreativeML Open RAIL-M + creator terms",
    "sourceUrl": "https://huggingface.co/RunDiffusion/Juggernaut-XL-v9",
    "files": [
      {
        "repo": "RunDiffusion/Juggernaut-XL-v9",
        "revision": "cf419233522daa0b9ea36c3aff98fa2cab1fb0fb",
        "path": "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors",
        "size": 7105348188,
        "sha256": "c9e3e68f89b8e38689e1097d4be4573cf308de4e3fd044c64ca697bdb4aa8bca"
      }
    ],
    "profile": {
      "family": "checkpoint",
      "args": {},
      "steps": 35,
      "cfg": 5
    }
  }
].map(model => Object.freeze({ ...model, bestFor: Object.freeze(model.bestFor), files: Object.freeze(model.files.map(file => Object.freeze(file))) })));

export const defaultOrchestratorId = 'qwen3-0.6b';
const byId = new Map(catalogModels.map(model => [model.id, model]));
export function getCatalogModel(id) { return typeof id === 'string' ? byId.get(id) : undefined; }
