// Image bundles verified against publisher model cards and Hugging Face blobs metadata on 2026-10-26.
// Primary diffusion file is first; companion filenames match the engine profile after installation.
// Each bundle is complete and independently verified; shared companions count in each download.
// memoryGB estimates working memory at 1024 × 1024, including companion weights; it is not VRAM capacity.
export const imageCatalogModels = [
  {
    "id": "flux2-klein-4b",
    "name": "FLUX.2 Klein 4B · Fast",
    "description": "Compact four-step image generation and reference-guided editing for photographs, products and fast local experiments. Attach a photo to guide subject consistency.",
    "bestFor": [
      "Fast photography",
      "Product images",
      "Reference editing"
    ],
    "imageUseCases": [
      "photorealism",
      "reference-editing",
      "identity"
    ],
    "parameterSize": "4B + 4B encoder",
    "quantization": "Q4_0 + Q4_K_M",
    "memoryGB": 12,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/leejet/FLUX.2-klein-4B-GGUF",
    "publisherUrl": "https://huggingface.co/black-forest-labs/FLUX.2-klein-4B",
    "licenseUrl": "https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/blob/e7b7dc27f91deacad38e78976d1f2b499d76a294/LICENSE.md",
    "requirements": [
      "Requires a recent stable-diffusion.cpp image engine connected in Settings.",
      "Memory is a planning estimate at 1024 × 1024; leave room for TIM and other apps.",
      "Includes diffusion weights, Qwen3 text encoder and VAE. Reference consistency depends on the input and prompt."
    ],
    "files": [
      {
        "repo": "leejet/FLUX.2-klein-4B-GGUF",
        "revision": "3b1f5a9dc3abb32238b053aeb3d823c30afdacbd",
        "path": "flux-2-klein-4b-Q4_0.gguf",
        "size": 2460378560,
        "sha256": "d1023499ef3f2f82ff7c50e6778495195c1b6cc34835741778868428111f9ff4"
      },
      {
        "repo": "unsloth/Qwen3-4B-GGUF",
        "revision": "22c9fc8a8c7700b76a1789366280a6a5a1ad1120",
        "path": "Qwen3-4B-Q4_K_M.gguf",
        "size": 2497281312,
        "sha256": "f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a"
      },
      {
        "repo": "Comfy-Org/flux2-klein-4B",
        "revision": "533c4cbc3d3b89af1743d9466c434e89810391c0",
        "path": "split_files/vae/flux2-vae.safetensors",
        "size": 336211292,
        "sha256": "868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3"
      }
    ],
    "profile": {
      "family": "flux2",
      "args": {
        "vae": "flux2-vae.safetensors",
        "llm": "Qwen3-4B-Q4_K_M.gguf"
      },
      "inputMode": "reference",
      "requiresReference": false,
      "steps": 4,
      "cfg": 1,
      "sampler": "euler",
      "width": 1024,
      "height": 1024
    },
    "catalogId": "flux2-klein-4b",
    "kind": "image",
    "downloadBytes": 5293871164
  },
  {
    "id": "qwen-image-2.1",
    "name": "Qwen Image 2.1",
    "description": "Newer compact Qwen model for realistic textures, portrait lighting, precise text and reference-guided edits. Supports people and product identity consistency from a reference image.",
    "bestFor": [
      "Realistic portraits",
      "Identity preservation",
      "Product editing"
    ],
    "imageUseCases": [
      "photorealism",
      "reference-editing",
      "identity"
    ],
    "parameterSize": "7B + 8B encoder",
    "quantization": "Q4_K_M + UD-Q4_K_XL",
    "memoryGB": 20,
    "license": "Qwen Research · non-commercial",
    "sourceUrl": "https://huggingface.co/unsloth/Qwen-Image-2.1-GGUF",
    "publisherUrl": "https://huggingface.co/Qwen/Qwen-Image-2.1",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen-Image-2.1/blob/d26bb61231c349cf6b7896fa83353113880e1ba3/LICENSE",
    "requirements": [
      "Requires a recent stable-diffusion.cpp image engine connected in Settings.",
      "Memory is a planning estimate at 1024 × 1024; leave room for TIM and other apps.",
      "Non-commercial research license; commercial use requires a separate publisher license.",
      "Includes the Qwen3-VL encoder, vision projector and dedicated 2.1 VAE. Attach one reference image in TIM for identity editing; likeness is not guaranteed."
    ],
    "files": [
      {
        "repo": "unsloth/Qwen-Image-2.1-GGUF",
        "revision": "2c31ccd392b367a6637841a143813320a02dff55",
        "path": "qwen-image-2.1-Q4_K_M.gguf",
        "size": 4199565024,
        "sha256": "631d532e7ca71e8d90a87c71d3699761a812039d22e3370e87498d87754660fe"
      },
      {
        "repo": "unsloth/Qwen3-VL-8B-Instruct-GGUF",
        "revision": "b93a7ee713758252c555be4210c00540df954dc2",
        "path": "Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf",
        "size": 5148699488,
        "sha256": "e3d1a6e87c5cb31e054f2c3bc0dd82ffde052f613de5eef3665b7bd33c9b703e"
      },
      {
        "repo": "unsloth/Qwen3-VL-8B-Instruct-GGUF",
        "revision": "b93a7ee713758252c555be4210c00540df954dc2",
        "path": "mmproj-F16.gguf",
        "size": 1159030336,
        "sha256": "d406d03ebabefdef86a2c86bf0c1b65f9e046f7a81c218f25de4931b46a07fc4"
      },
      {
        "repo": "unsloth/Qwen-Image-2.1-FP8",
        "revision": "bb21a8ba7f0371c19ad1f72c82a5e8fc10f39939",
        "path": "vae/qwen_image_2.1_vae_bf16.safetensors",
        "size": 675508656,
        "sha256": "71879ffd5321e6d10c3c87513e2b474b1252efa7f3dec2969214a9bf06a6dd5c"
      }
    ],
    "profile": {
      "family": "qwen-image-2.1",
      "args": {
        "vae": "qwen_image_2.1_vae_bf16.safetensors",
        "llm": "Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf",
        "llm_vision": "mmproj-F16.gguf"
      },
      "inputMode": "reference",
      "requiresReference": false,
      "steps": 20,
      "cfg": 6,
      "sampler": "euler",
      "width": 1024,
      "height": 1024
    },
    "catalogId": "qwen-image-2.1",
    "kind": "image",
    "downloadBytes": 11182803504
  },
  {
    "id": "qwen-image-2512",
    "name": "Qwen Image 2512",
    "description": "Large Qwen text-to-image model focused on natural-looking people, fine landscape and fur detail, and accurate text in images. Use an editing model when you need to preserve an existing subject.",
    "bestFor": [
      "Photorealistic people",
      "Natural detail",
      "Text in images"
    ],
    "imageUseCases": [
      "photorealism"
    ],
    "parameterSize": "20B + 7B encoder",
    "quantization": "Q5_0 + Q4_K_M",
    "memoryGB": 28,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/unsloth/Qwen-Image-2512-GGUF",
    "publisherUrl": "https://huggingface.co/Qwen/Qwen-Image-2512",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen-Image-2512#license-agreement",
    "requirements": [
      "Requires a recent stable-diffusion.cpp image engine connected in Settings.",
      "Memory is a planning estimate at 1024 × 1024; leave room for TIM and other apps.",
      "Text-to-image only in TIM. Includes a quantized Qwen2.5-VL text encoder and VAE; this is a large download."
    ],
    "files": [
      {
        "repo": "unsloth/Qwen-Image-2512-GGUF",
        "revision": "1626d7531f84b4d2ea1cd6d2e69f41ec027dd354",
        "path": "qwen-image-2512-Q5_0.gguf",
        "size": 14400813600,
        "sha256": "c077d5a3f867b6441235d071d76912ce6575db9832651e8b1769e8329d33d798"
      },
      {
        "repo": "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
        "revision": "cfa2baa09946b211c107e6e104948987a64dd2c1",
        "path": "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf",
        "size": 4683072512,
        "sha256": "0f00a930ba3108b6861ddadf74d8ebbd82e257c63eba728e62c3e8970f5eed94"
      },
      {
        "repo": "Comfy-Org/Qwen-Image_ComfyUI",
        "revision": "1f12b17be14c89b026c51a91d67c32f84bb047bc",
        "path": "split_files/vae/qwen_image_vae.safetensors",
        "size": 253806246,
        "sha256": "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f"
      }
    ],
    "profile": {
      "family": "qwen-image",
      "args": {
        "vae": "qwen_image_vae.safetensors",
        "llm": "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf"
      },
      "inputMode": "none",
      "requiresReference": false,
      "steps": 40,
      "cfg": 2.5,
      "sampler": "euler",
      "flowShift": 3,
      "width": 1024,
      "height": 1024
    },
    "catalogId": "qwen-image-2512",
    "kind": "image",
    "downloadBytes": 19337692358
  },
  {
    "id": "qwen-image-edit-2511",
    "name": "Qwen Image Edit 2511",
    "description": "Reference-image editor built for character consistency, reduced image drift and precise changes. Preserve a person or product while changing clothing, background or composition.",
    "bestFor": [
      "Identity preservation",
      "Consistent characters",
      "Photo editing"
    ],
    "imageUseCases": [
      "photorealism",
      "reference-editing",
      "identity"
    ],
    "parameterSize": "20B + 7B encoder",
    "quantization": "Q4_K_M",
    "memoryGB": 28,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/unsloth/Qwen-Image-Edit-2511-GGUF",
    "publisherUrl": "https://huggingface.co/Qwen/Qwen-Image-Edit-2511",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen-Image-Edit-2511#license-agreement",
    "requirements": [
      "Requires a recent stable-diffusion.cpp image engine connected in Settings.",
      "Memory is a planning estimate at 1024 × 1024; leave room for TIM and other apps.",
      "Attach a reference image before running. TIM currently passes one image; identity preservation improves consistency but does not guarantee an exact likeness.",
      "Includes all required model components. Needs an image engine with Qwen Image Edit 2511 support."
    ],
    "files": [
      {
        "repo": "unsloth/Qwen-Image-Edit-2511-GGUF",
        "revision": "0d33d9692b4b26212297240d87b0d4719aa4fd06",
        "path": "qwen-image-edit-2511-Q4_K_M.gguf",
        "size": 13244758624,
        "sha256": "8677bac90627adbbc11efab87b1870e701c4eb3689ee865a3de8ab81b705a723"
      },
      {
        "repo": "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
        "revision": "cfa2baa09946b211c107e6e104948987a64dd2c1",
        "path": "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf",
        "size": 4683072512,
        "sha256": "0f00a930ba3108b6861ddadf74d8ebbd82e257c63eba728e62c3e8970f5eed94"
      },
      {
        "repo": "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
        "revision": "cfa2baa09946b211c107e6e104948987a64dd2c1",
        "path": "Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf",
        "size": 853119712,
        "sha256": "2185ca0adf339f96845318c7b666f5d242f86bbace5657a89cb834785d0cea57"
      },
      {
        "repo": "Comfy-Org/Qwen-Image_ComfyUI",
        "revision": "1f12b17be14c89b026c51a91d67c32f84bb047bc",
        "path": "split_files/vae/qwen_image_vae.safetensors",
        "size": 253806246,
        "sha256": "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f"
      }
    ],
    "profile": {
      "family": "qwen-image-edit",
      "args": {
        "vae": "qwen_image_vae.safetensors",
        "llm": "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf",
        "llm_vision": "Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf"
      },
      "inputMode": "reference",
      "requiresReference": true,
      "steps": 40,
      "cfg": 2.5,
      "sampler": "euler",
      "flowShift": 3,
      "modelArgs": {
        "qwen_image_zero_cond_t": true
      },
      "width": 1024,
      "height": 1024
    },
    "catalogId": "qwen-image-edit-2511",
    "kind": "image",
    "downloadBytes": 19034757094
  },
  {
    "id": "realvisxl-5",
    "name": "RealVisXL 5.0",
    "description": "SDXL checkpoint tuned for photorealistic portraits and everyday photographic scenes. A simpler single-file option for realistic images; image-to-image is available, but it is not an identity-specific editor.",
    "bestFor": [
      "Photorealistic portraits",
      "Everyday photography",
      "SDXL workflows"
    ],
    "imageUseCases": [
      "photorealism"
    ],
    "parameterSize": "SDXL",
    "quantization": "FP16",
    "memoryGB": 12,
    "license": "CreativeML Open RAIL++-M",
    "sourceUrl": "https://huggingface.co/SG161222/RealVisXL_V5.0",
    "publisherUrl": "https://huggingface.co/SG161222/RealVisXL_V5.0",
    "licenseUrl": "https://huggingface.co/SG161222/RealVisXL_V5.0",
    "requirements": [
      "Requires a recent stable-diffusion.cpp image engine connected in Settings.",
      "Memory is a planning estimate at 1024 × 1024; leave room for TIM and other apps.",
      "Single checkpoint with included VAE and text encoders. Uses the creator-recommended DPM++ 2M Karras schedule at 50 steps."
    ],
    "files": [
      {
        "repo": "SG161222/RealVisXL_V5.0",
        "revision": "ac93e0dda1f6d448cae19bbfab8c5e720a5e48bc",
        "path": "RealVisXL_V5.0_fp16.safetensors",
        "size": 6938065488,
        "sha256": "6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80"
      }
    ],
    "profile": {
      "family": "checkpoint",
      "args": {},
      "inputMode": "img2img",
      "requiresReference": false,
      "steps": 50,
      "cfg": 5,
      "sampler": "dpm++2m",
      "scheduler": "karras",
      "width": 1024,
      "height": 1024
    },
    "catalogId": "realvisxl-5",
    "kind": "image",
    "downloadBytes": 6938065488
  },
  {
    "id": "flux2-klein-base-4b",
    "name": "FLUX.2 Klein Base 4B",
    "description": "Undistilled Klein model for more control and output diversity in local image pipelines. Generates photos or edits a reference image, using more steps than the fast version.",
    "bestFor": [
      "Controlled photography",
      "Reference editing",
      "Local experiments"
    ],
    "imageUseCases": [
      "photorealism",
      "reference-editing",
      "identity"
    ],
    "parameterSize": "4B + 4B encoder",
    "quantization": "Q4_0 + Q4_K_M",
    "memoryGB": 12,
    "license": "apache-2.0",
    "sourceUrl": "https://huggingface.co/leejet/FLUX.2-klein-base-4B-GGUF",
    "publisherUrl": "https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4B",
    "licenseUrl": "https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4B/blob/a3b4f4849157f664bdbc776fd7453c2783562f4d/LICENSE.md",
    "requirements": [
      "Requires a recent stable-diffusion.cpp image engine connected in Settings.",
      "Memory is a planning estimate at 1024 × 1024; leave room for TIM and other apps.",
      "Includes diffusion weights, Qwen3 text encoder and VAE. Start at 20 steps; higher step counts trade speed for control."
    ],
    "files": [
      {
        "repo": "leejet/FLUX.2-klein-base-4B-GGUF",
        "revision": "d12671125306ca6b5f6db1b33ed4c80c8511a53f",
        "path": "flux-2-klein-base-4b-Q4_0.gguf",
        "size": 2460378560,
        "sha256": "c3a2854510677b7aa37dd7547d908c54889a76c6d6aa3ffe902fcaa092d1328b"
      },
      {
        "repo": "unsloth/Qwen3-4B-GGUF",
        "revision": "22c9fc8a8c7700b76a1789366280a6a5a1ad1120",
        "path": "Qwen3-4B-Q4_K_M.gguf",
        "size": 2497281312,
        "sha256": "f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a"
      },
      {
        "repo": "Comfy-Org/flux2-klein-4B",
        "revision": "533c4cbc3d3b89af1743d9466c434e89810391c0",
        "path": "split_files/vae/flux2-vae.safetensors",
        "size": 336211292,
        "sha256": "868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3"
      }
    ],
    "profile": {
      "family": "flux2",
      "args": {
        "vae": "flux2-vae.safetensors",
        "llm": "Qwen3-4B-Q4_K_M.gguf"
      },
      "inputMode": "reference",
      "requiresReference": false,
      "steps": 20,
      "cfg": 4,
      "sampler": "euler",
      "width": 1024,
      "height": 1024
    },
    "catalogId": "flux2-klein-base-4b",
    "kind": "image",
    "downloadBytes": 5293871164
  }
];
