# Changelog

## Unreleased — 2026-10-26

These changes build on the 0.1.0 desktop alpha. No new release or version tag has been published.

### Added

- Saved default models for Agent, Chat, Code, Image, Upscale, Video and Audio, plus a startup mode. Settings and the active engine panel's **Set as default** control let users choose their preferred models.
- **Memory on this machine** in Model Library: total and available system RAM, planning room after a safety buffer, and loaded models with measured process RAM or labeled estimates. Specialists can be unloaded individually.
- Multiple resident chat/code specialists alongside the persistent guide. Explicitly loaded models stay ready between jobs, and new loads are checked against available RAM and the estimated combined footprint.
- Six image bundles, bringing the curated catalog to **31 models, including nine image options**: FLUX.2 Klein 4B Fast and Base, Qwen Image 2.1, Qwen Image 2512, Qwen Image Edit 2511, and RealVisXL 5.0. Bundles include required companion weights, pinned download metadata, model-specific settings, and reference-image validation.
- **Photorealism** and **Identity & editing** filters, publisher/license details, and model-card links that open in the system browser from the desktop app.

### Changed

- Saved defaults survive restarts and rescans. Missing model files or runtimes produce actionable feedback instead of silently replacing the selected model with a smaller one.
- Prompt budgeting uses the local engine's tokenizer where supported, reserves space for the reply, and omits older complete turns when necessary. The latest request, active tool-call chain and saved conversation remain intact; a notice explains omitted history. Oversized current requests receive guidance instead of being shortened. Older engines use bounded retries after explicit context errors.
- Chat, Code and delegated text specialists request direct answers with thinking disabled where supported. Empty responses, exhausted reply budgets and interrupted streams fail visibly, with partial output retained. Previously saved empty completions display an explanatory message.
- Updated the runtime application guide, reusable [orchestrator specification](ORCHESTRATOR.md), README and automated checks for model defaults, memory controls, image workflows, context handling and response failures.

### Validation and limits

- All **253 automated tests**, the production build, isolated browser checks for model defaults, Model Library and pipelines, and the Mac development desktop startup/preload check passed. These checks do not establish packaged-app or real-model inference compatibility on every platform.
- Memory readings and model estimates aid planning; context size, other apps and GPU allocation affect actual capacity. Process RAM does not include dedicated GPU VRAM. Inference remains sequential even when several models are loaded.
- New image recipes and download metadata were checked against publisher information and engine documentation; native inference for these bundles has not been validated here. A compatible image engine is still required. Identity preservation is best-effort, and individual model licenses apply, including Qwen Image 2.1's non-commercial research terms.
- Code steps generate text. Agents still have no arbitrary filesystem access, shell execution or automated run/test/fix tools.
