# Changelog

## 0.1.1-alpha.2 — pending release

- Compare installed and bundled versions in the wizard. Upgrade previously installed components in place, block downgrades, and offer to copy data from detected standalone TIM installs into a new wizard installation.
- Add a graphical setup wizard for Desktop, Terminal, and starter models. Review hardware-based model suggestions and disk space, install locally or to an external drive, and open either app when setup finishes.
- Package the standalone TIM terminal installer alongside the desktop builds. The CLI supports model selection, cloud provider setup, scroll and history controls, response and context settings, model memory controls, copying replies, and reviewed Python and JavaScript save and run commands.
- Add Google's five Gemma 4 Q4_0 downloads to the desktop Model Library and terminal model picker. TIM uses the text weights for chat and coding.
- Repair terminal and queue test fixtures. Update the Apple Silicon runner while retaining its required GitHub check name.

## Unreleased — CLI usability, actions and opt-in adapters

- Center responsive artwork, cap idle panels, fix cell-aware editing/Backspace, make Enter submit and keep multiline paste safe.
- Add configured-model natural requests, read-only local port inspection, reviewed single-page image downloads and official prerequisite download plans.
- Add opt-in local Windows dictation, optional nonactivating overlay and explicitly reviewed bounded Windows input adapter; native mic/input remains untested.
- Add fail-closed Tor routing for built-in image fetches only; whole-host Silent Mode remains design/preflight with an explicit no-anonymity-guarantee warning.
- Add local-package Windows PowerShell and macOS/Linux shell installers with user PATH setup, checksums, command collision checks, release rollback and owned uninstall.
- Bundle installer scripts and package checksum with `npm run pack:cli`; require Node.js 24+ and never auto-elevate or configure provider credentials.
- Validate isolated Windows/mock PATH and Git Bash flows; native macOS/Linux execution remains unverified.

- Add explicit OpenAI/xAI Responses text streaming and strict-schema CLI planning, dynamic model discovery, provider boundaries and safe error reporting. No credentials are stored and no provider fallback is automatic.
- Show observed phases, elapsed/last-activity time and conservative historical ETA ranges after sufficient comparable samples; separate UI clocks from backend/provider events. Add reconnect, reviewed retry and idempotent chat submissions.
- Validate with mocked cloud HTTP/SSE, dummy keys and isolated local fixtures; live vendor/account behavior is not certified.

## Unreleased - TIM terminal workspace

- Add the independently installable `tim` full-screen CLI, responsive faceless ASCII artwork, tracked subtitles and bright double-line borders.
- Reuse the local session/model API through an owned loopback backend with automatic guide setup disabled; attaching to an existing backend preserves its ownership.
- Add reviewed local utility/package-manager execution, metadata-verified model-assisted installation, bounded TCP/UDP listeners and offline TShark hex/ASCII packet views.
- Add user-selected persistent toolbox storage, centralized recall before script proposals, versioned drafts, permission/source-bound approval, and locked atomic audit updates.
- Document supported operations and limitations in [CLI.md](CLI.md). Initial implementation passed 61 fixture tests and an isolated Windows package install; integrated-main checks are reported in the draft PR. Real inference, target package installs and external/live capture are not part of this validation.


## Unreleased — 2026-10-26

These changes build on the 0.1.0 desktop alpha. No new release or version tag has been published.

### Added

- A [contribution guide](CONTRIBUTING.md) covering development setup, validation, pull requests, model recipes, and useful bug reports.
- Saved default models for Agent, Chat, Code, Image, Upscale, Video and Audio, plus a startup mode. Settings and the active engine panel's **Set as default** control let users choose their preferred models.
- **Memory on this machine** in Model Library: total and available system RAM, planning room after a safety buffer, and loaded models with measured process RAM or labeled estimates. Specialists can be unloaded individually.
- Multiple resident chat/code specialists alongside the persistent guide. Explicitly loaded models stay ready between jobs, and new loads are checked against available RAM and the estimated combined footprint.
- Six image bundles, bringing the curated catalog to **31 models, including nine image options**: FLUX.2 Klein 4B Fast and Base, Qwen Image 2.1, Qwen Image 2512, Qwen Image Edit 2511, and RealVisXL 5.0. Bundles include required companion weights, pinned download metadata, model-specific settings, and reference-image validation.
- **Photorealism** and **Identity & editing** filters, publisher/license details, and model-card links that open in the system browser from the desktop app.

### Changed

- CI model-loading fixtures use deterministic memory and bounded startup waits, so slow native probes or low-memory runners report failures instead of waiting indefinitely. Windows image tests use native paths. Automated tests and workflow jobs also have time limits; newer runs replace older runs for the same source branch.
- Saved defaults survive restarts and rescans. Missing model files or runtimes produce actionable feedback instead of silently replacing the selected model with a smaller one.
- Prompt budgeting uses the local engine's tokenizer where supported, reserves space for the reply, and omits older complete turns when necessary. The latest request, active tool-call chain and saved conversation remain intact; a notice explains omitted history. Oversized current requests receive guidance instead of being shortened. Older engines use bounded retries after explicit context errors.
- Chat, Code and delegated text specialists request direct answers with thinking disabled where supported. Empty responses, exhausted reply budgets and interrupted streams fail visibly, with partial output retained. Previously saved empty completions display an explanatory message.
- Updated the runtime application guide, reusable [orchestrator specification](ORCHESTRATOR.md), README and automated checks for model defaults, memory controls, image workflows, context handling and response failures.

### Validation and limits

- All **256 automated tests**, the production build, isolated browser checks for model defaults, Model Library and pipelines, and the Mac development desktop startup/preload check passed. These checks do not establish packaged-app or real-model inference compatibility on every platform.
- Memory readings and model estimates aid planning; context size, other apps and GPU allocation affect actual capacity. Process RAM does not include dedicated GPU VRAM. Inference remains sequential even when several models are loaded.
- New image recipes and download metadata were checked against publisher information and engine documentation; native inference for these bundles has not been validated here. A compatible image engine is still required. Identity preservation is best-effort, and individual model licenses apply, including Qwen Image 2.1's non-commercial research terms.
- Code steps generate text. Agents still have no arbitrary filesystem access, shell execution or automated run/test/fix tools.

### TIM CLI final usability and guarded workflow review

- Require a 100-column/16-row interactive viewport; preserve mounted state through resize, pause hidden typing/approvals, retain cancel/quit.
- Complete Enter-submit/grapheme editing, centered responsive art, model-directed local port/image actions and official prerequisite download offers.
- Add opt-in voice/hood overlay, reviewed desktop plans and limited Tor fetch transport with explicit unsupported boundaries; Silent Mode remains preflight only.
- Fix dependency version argument routing and desktop approval-time target changes; add command-level fixture tests and document live/native validation limits in CLI.md.

### Semantic desktop and optional platform adapters

- Add model-assisted observe/plan/review/act/verify workflow, semantic predicates, bounded recovery, per-step approval and exact cloud observation review.
- Add Windows UIA Value/Invoke, optional macOS AX/Linux X11 AT-SPI source adapters and portable local sounddevice/Vosk capture. Missing dependencies and Wayland takeover fail explicitly; native validation is pending.
- Add inactive per-OS Silent Mode and hash-bound rollback plans; no privileged executor or anonymity claim.
- Add low-rate ASCII hoodie shading frames with no-animation/reduced-motion controls and fixed character geometry. See PLATFORM-SUPPORT.md for precise proof and gaps.
