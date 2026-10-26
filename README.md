# TIM Studio

A portable, offline AI workbench with the approved **Neon Terminal** design: midnight blue, cyan rails, magenta controls, pixel typography, and a single conversation for text and media.

This is the first working desktop alpha, built in `smooth-operator`. Model weights are referenced in place on TIM. Nothing in the original Portable-Local-Studio or RedMars directories is modified.

## Run on Windows now

Open `Start-Windows.bat`, or launch `release/win-unpacked/TIM Studio.exe`.

The packaged app includes its JavaScript runtime and interface. It does not need npm or Python. Keep the entire `win-unpacked` folder together. TIM should contain the existing `Coding-Models` and `Portable-Local-Studio` folders. Settings can point to a different library root.

The UI is also available with `npm start` after a build, at `http://127.0.0.1:4317`.

## Platform targets and actual validation

| Platform | Desktop packaging | Existing TIM engine support | Validation here |
| --- | --- | --- | --- |
| Windows 10/11 x64 | Unpacked app and ZIP | CPU/Vulkan chat, CUDA/Vulkan/CPU diffusion, Vulkan upscale, CPU Whisper | Native launch, chat, image, upscale, and spoken-audio transcription passed |
| macOS Apple Silicon | arm64 app ZIP | Existing arm64/Metal engines; the TIM package documents macOS 26+ for its chat/video binaries | Build workflow configured; native execution not tested |
| macOS Intel | x64 app ZIP | Requires separate x64 runtime packs; the supplied TIM Mac engines are arm64 | Build workflow configured; inference not tested |
| Linux x64 | AppImage | Existing CPU/Vulkan engines; TIM documents Ubuntu 24.04-compatible systems with glibc 2.38+ and required GPU/OpenMP libraries | Build workflow configured; native execution not tested |

Native packages must be validated on their own operating systems. `.github/workflows/desktop.yml` runs tests, native packaging, and desktop startup checks on all four architecture targets when this project is placed in GitHub. The workflow has **not** been run remotely. No Mac/Linux artifact is claimed as tested.

## Main conversational agent

Agent is the default entry mode. In Settings, explicitly choose a **Main agent model** with native OpenAI-compatible tool-call support in the installed llama-server build. Agent loads enable `--jinja`, as required by the [llama.cpp function-calling documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md). The installed engine must support this flag and the model must have a compatible template; no custom template is downloaded. Switching between Agent and manual Chat reloads the model when the template mode changes. No model is chosen, downloaded, or launched by this change. Existing Chat, Code and media modes remain manual.

An agent turn can call available registered chat/code, image, video, upscale and transcription specialists, then synthesize their actual returned text and artifact metadata. One specialist runs at a time inside the parent queue slot; chat is unloaded before media work and reloaded for synthesis. Only attachments from the current turn and that turn's generated artifact IDs can be used as tool inputs. There is no shell, arbitrary-file, cloud or network tool. The agent cannot visually inspect generated images/videos or hear audio; the UI labels this limitation.

Settings bound each turn to 1–8 specialist calls (default 4) and 30–1800 seconds (default 600). Cancel applies to the whole turn, including the current specialist. Malformed or unavailable tool calls fail visibly; engine failures return structured errors to the main model. Completed child artifacts remain visible when a later step fails. Interrupted turns are not replayed on restart. Long conversations or results can still exceed a model's context window and fail; automatic context compaction is not implemented.

Validation uses mocked model responses and temporary local fixtures. This does **not** establish that an installed model or llama-server version supports tools, that the model chooses specialists reliably, or that generated media is correct. Real-model validation must be performed separately when hardware use is coordinated. Existing packaged executables must be rebuilt to include these source changes.

## Working features

- Single-window chat and code generation with streaming responses.
- Local sessions, text/code attachments, session export, and editable system prompt, temperature, response length, and context size.
- Model discovery, missing-companion diagnostics, model selection, and explicit runtime selection.
- Image generation and image-to-image/reference editing recipes for known SD, FLUX.2, and Qwen bundles.
- Image previews, save/export, and reuse as input to editing, video, or 4× Real-ESRGAN upscaling.
- WAV transcription using Whisper, displayed in the conversation and saved as text.
- Wan video recipe and inline WebM playback. **A complete video run is unverified:** this computer reported a device-read error when reading the existing Wan weights, independently reproduced by a checksum read outside the sandbox.
- One inference job at a time, queued work, cancellation, interrupted-job recovery, and automatic chat-model unloading before media work.
- Real NVIDIA telemetry where available, system memory elsewhere. Auto mode skips CUDA when no NVIDIA device is detected and can retry failed chat initialization on CPU.
- All interface fonts and assets bundled locally. No accounts, telemetry, cloud inference, content filtering, or automatic model downloads.

“Available” means the required files, runtime, and known recipe were found. It does not guarantee that a model fits available memory or that its architecture is supported by that exact engine build. The library records successful/failed runs for the current OS and architecture.

## Still to implement or validate

- Speech synthesis, microphone conversation, audio denoising/music generation, and dedicated restoration/cleanup tools.
- Real-model validation of main-agent tool calling and specialist synthesis. The orchestration layer is implemented, but requires an explicitly configured compatible local chat model and engine.
- FLUX 3's separate engine recipe, arbitrary model-family plugins, persistent workflow presets, vision chat/projector pairing, and RedMars integration.
- Full validation of larger chat models, image-editing variants, video, memory-pressure behavior, and all Mac/Linux native workflows.
- Signed/notarized release packages and packaged, tested engine bundles for each platform. The current Windows alpha uses the engine files already on TIM.

## Portable storage

Packaged apps create `TIM-Studio-Data` beside the executable, beside the `.app` bundle on Mac, or beside the AppImage. It contains `sessions.json`, `jobs.json`, `settings.json`, `uploads/`, `outputs/`, `work/` logs, and Chromium's `desktop/` state. Use a writable folder. Browser mode defaults to this repository's `data/` directory.

Optional environment variables:

- `TIM_LIBRARY_ROOT`: root containing `Portable-Local-Studio` and `Coding-Models`.
- `TIM_DATA_DIR`: explicit data directory, including when testing.
- `TIM_HOME`: portable desktop home directory; its data lives in `TIM-Studio-Data`.
- `PORT`: browser server port; desktop mode selects a free port automatically.

Discovery handles Windows drive letters, `/Volumes` on Mac, and common `/media`, `/run/media`, and `/mnt` locations on Linux. Saved model identifiers use relative paths. Moving TIM to another mount point does not change those identifiers.

New architecture-specific engine packs can live in either:

```text
TIM-Studio-Data/runtimes/<platform>-<arch>/<engine>/<backend>/<executable>
TIM/TIM-Studio/runtimes/<platform>-<arch>/<engine>/<backend>/<executable>
```

Platforms: `win32`, `darwin`, `linux`. Architectures: `x64`, `arm64`. Engines: `chat`, `image`, `video`, `upscale`, `transcribe`. Backends: `cpu`, `cuda`, `vulkan`, `metal`. Executables: `llama-server`, `sd-cli`, `realesrgan-ncnn-vulkan`, `whisper-cli`, with `.exe` on Windows. Keep each engine's dependent libraries beside it. Upscaling also needs `models/realesrgan-x4plus.bin` and `.param` beside the executable.

## Develop and package

Use Node.js 24 or newer. Dependency setup requires a network connection; running the built app with installed models does not.

```sh
npm ci
npm run setup:desktop
npm run dev
# or
npm run desktop
```

```sh
npm test
npm run build
npm run pack
npm run dist
```

Build on the target operating system. `Start-Mac.command` and `Start-Linux.sh` launch local packages if present and otherwise use the development environment. On Linux, run `sh Start-Linux.sh` if the drive does not retain executable bits; native binaries still need a mount that permits execution.

## Validation performed on October 22, 2026

- TypeScript checking and production build passed.
- Automated tests cover OS/architecture resolution, incomplete bundles, literal subprocess arguments, invalid parameters, serialized atomic saves, cancellation, sequential execution, HTTP isolation, output range requests, and path traversal rejection.
- Browser automation checked model search/selection, settings, generation controls, and compact layout. No page errors or external requests were observed.
- Both development Electron and the final packaged Windows executable passed native startup, isolated preload API checks, and a real streamed Qwen2.5-Coder-1.5B response.
- DreamShaper generated a 512×512 image; Real-ESRGAN produced a 2048×2048 output.
- Whisper transcribed a locally recorded spoken sentence accurately.
- Wan model loading failed with a disk/device read error; a separate checksum read failed too. No repair, overwrite, or replacement download was attempted.

Test outputs and screenshots are under `artifacts/`, excluded from source control. `scripts/smoke-models.mjs` explicitly exercises real engines; ordinary `npm test` uses temporary test data and does not run model inference.

## Architecture

`src/` holds the React/TypeScript interface. `desktop/` owns the Electron window and limited native file-dialog bridge. `server/` provides a loopback-only API, model registry, portable runtime resolution, serialized inference queue, atomic JSON storage, and engine adapters. Model-generated text is rendered as text/code, not executable HTML. Native processes receive argument arrays rather than shell command strings.

Backend integrations are replaceable, which leaves a defined place for RedMars when its runtime contract is ready.

## Third-party components

React, Electron, Vite, Lucide, Fontsource fonts, and their dependencies retain their own licenses in the installed packages. Local engine/model files remain external and retain their original licenses. No upstream Portable-Local-Studio source or model weights are bundled into this alpha.

References: [Electron installation](https://www.electronjs.org/docs/latest/tutorial/installation), [Electron process isolation](https://www.electronjs.org/docs/latest/tutorial/security), [GitHub native runner targets](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
