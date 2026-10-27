# Contributing to TIM Studio

TIM Studio is an early desktop alpha for local models and visual agent pipelines. Contributions are welcome: bug reports, documentation, accessibility improvements, platform testing, model recipes, and focused fixes.

For larger features, new dependencies, or architecture changes, open an [issue](https://github.com/The-inside-man/smooth-operator/issues) first so we can agree on the scope. Check existing issues and pull requests before starting.

## Set up a development environment

Use **Node.js 24 or newer**, npm, and Git on Windows, macOS, or Linux. Fork the repository, clone your fork, and create a branch for your changes. Run these commands from the project folder:

```sh
npm ci --include=dev
npm run setup:desktop
npm run dev
```

To build and open the Electron desktop app instead:

```sh
npm run desktop
```

Dependency installation needs internet access. Running the app normally can also download the starter guide and chat engine. Set `TIM_AUTO_SETUP=0` in your environment before launching to disable automatic setup. Use `TIM_DATA_DIR` with a separate writable folder when experimenting with settings, downloads, sessions, or pipelines. See the [README](README.md#portable-storage) for storage and runtime details.

Models and engines are separate from the source checkout. Media features require compatible external engine packs; a model appearing in the catalog does not establish that inference works on your platform.

## Find the relevant code

| Location | Purpose |
| --- | --- |
| `src/` | React/TypeScript interface, model library, defaults, and pipeline builder |
| `server/` | Local API, queue, model processes, memory, downloads, and pipeline execution |
| `server/catalog.mjs`, `server/image-catalog.mjs` | Curated model entries and pinned download recipes |
| `desktop/` | Electron startup and native bridges |
| `tests/`, `scripts/` | Automated fixtures, browser checks, and explicit real-model smoke checks |
| `server/app-guide.mjs`, [ORCHESTRATOR.md](ORCHESTRATOR.md) | Runtime application help and portable agent instructions |

## Validate your changes

For code changes, run:

```sh
npm test
npm run build
```

Add focused regression coverage when changing behavior. Keep tests isolated from personal data and large model downloads. The automated suite uses temporary data and model/engine fixtures; passing it does not prove real-model inference or generated-code correctness.

Run the relevant browser checks for interface changes:

```sh
npm run test:catalog-ui
npm run test:defaults-ui
npm run test:pipelines-ui
```

These checks use isolated fixtures and expect an installed Chrome browser by default. `TIM_BROWSER_CHANNEL` can select another supported Playwright browser channel. For desktop bridge or startup changes, build first, then run:

```sh
node scripts/check-desktop.mjs --ui-only
```

Documentation-only changes need a check of links, commands, and wording; the full test suite is not necessary. Run `git diff --check` before submitting.

Real-model `smoke:*` scripts are optional and have different side effects. Read the script before running it: some download weights, start inference, or save pipeline definitions and runs in local app data. Record the model, quantization, engine version, backend, OS/architecture, and settings for any real inference you report. Build and test packages on their target operating system.

CI runs automated tests, packaging, and native desktop startup on Windows x64, macOS Apple Silicon, macOS Intel, and Linux x64. Report what you tested locally and what remains untested; do not claim broader platform compatibility from a fixture or a single-machine run.

## Submit a pull request

- Open a focused pull request from your branch against **`main`**. Link the related issue, if any.
- Explain the problem, the resulting behavior, and how you verified it. Include screenshots for visible interface changes and reproduction steps for fixes.
- Follow the surrounding code style. Keep unrelated refactors and dependency upgrades separate; update `package-lock.json` when changing dependencies.
- Update the README and [changelog](CHANGELOG.md) when behavior, setup, or limitations change. Update the runtime application guide and orchestrator specification when application controls or agent capabilities change.
- Keep model weights, engine binaries, private data, generated builds, and test artifacts out of the commit. The existing ignore rules cover local data, `node_modules/`, `dist/`, `release/`, and `artifacts/`.
- Expect maintainer review, applicable passing CI checks, and follow-up changes before merging. [CODEOWNERS](.github/CODEOWNERS) routes contributions to [@The-inside-man](https://github.com/The-inside-man).

AI-assisted contributions are welcome. Review the entire diff, verify the behavior, and describe the checks you actually ran. Generated code and model output need the same review as other contributions.

## Propose a model or engine recipe

Provide the publisher's model card and license, intended tasks, required runtime, and a complete list of companion files. Catalog downloads need immutable repository revisions, exact filenames, byte sizes, and SHA256 hashes. Include the quantization, input/reference-image requirements, and a clearly labeled working-memory estimate.

Add fixture coverage for the recipe and input validation. Distinguish metadata verification from an actual successful inference run. Avoid claims of guaranteed identity preservation, memory fit, or tool-call compatibility without supporting validation. Preserve third-party license terms and restrictions; TIM's license does not replace them.

## Report a bug

Open an [issue](https://github.com/The-inside-man/smooth-operator/issues/new) with:

- TIM version or commit, installation method, OS version, and CPU architecture.
- Steps to reproduce, expected behavior, and the actual result.
- For model issues: model name and quantization, engine/version, backend, system RAM, loaded models, context tokens, and response tokens.
- Relevant error text and, when useful, a screenshot or a small reproducible pipeline definition.

Remove secrets, private conversations, personal paths, and sensitive files from logs, screenshots, and exported pipelines. A small reproduction is more useful than an entire local data folder.

## License and collaboration

Contributions to TIM Studio's original source and documentation follow the project's [MIT License](LICENSE). Keep required attribution and license notices for third-party material. Be respectful and specific in issues and reviews, and explain disagreements in terms of behavior, evidence, and tradeoffs.
