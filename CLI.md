# TIM Studio CLI — usage and limits

TIM is a full-screen terminal application with responsive pixel-art branding, multiline input, streaming output and keyboard navigation. It requires Node.js 24 or newer. It does not require the graphical frontend, Electron, a browser or a manually started server.

## Install and start

From the corrected supplied archive:

```sh
npm install -g ./tim-studio-cli-0.1.0.tgz
tim
```

The installation above is a user action; development validation uses an isolated prefix. Windows also accepts `TIM`; Unix uses lowercase `tim`. Build an archive from source with `npm run pack:cli`. The package contains CLI/server code and depends on React, Ink and strip-ansi; it is not a self-contained executable.

```sh
tim --help
tim --version
tim --demo
tim --tools
tim setup
tim providers
tim --data-dir DIRECTORY --library MODEL_LIBRARY_DIRECTORY
tim --url http://127.0.0.1:PORT
```

Normal startup owns an ephemeral loopback-only backend and closes it on exit. `--url` attaches to an existing backend without stopping it. After a crash, inspect a stale `cli.lock` before manually removing it. Models are not downloaded or run on startup. If no usable model is selected, TIM opens the model chooser. `/models` reopens this same chooser: installed chat models appear first, followed by supported catalog models available to download. Rows identify the current model, installed models and downloads; download size, memory estimates and suggestions help you choose. Use Up/Down or a model number, then Enter. An installed available model is selected immediately; a downloadable model opens its setup review, and a second Enter confirms the download. Esc returns to your draft. Your request stays ready for a separate Enter to send after model selection or setup. Press **S** to browse local setup or **P** for cloud connection instructions; Ctrl+R refreshes the catalog and memory reading. `--demo` is sample data. Noninteractive use prints guidance and never silently approves an action.

`/model N` and `/agent N` use the same numbered rows shown by `/models`, including installed imports and downloadable catalog models. An available installed row selects immediately. A downloadable row opens review for that exact model before confirmation. `/model N` selects Chat and keeps your main agent; `/agent N` changes the main agent. Choosing a model directly in `/models` keeps your current Agent, Chat or Code mode, including when a download is needed. Chat and Code downloads keep the existing main agent too; standalone `tim setup` and `/setup` prepare an Agent model.

### Set up a local model without the desktop app

Choose a downloadable row in `/models` to go straight to its setup review. You can also run `tim setup`, enter `/setup` in TIM, or press **S** in the model chooser to browse the supported local catalog in a dedicated setup screen. Both paths include larger Qwen3 and Qwen2.5 Coder options. Use Up/Down or a model number to choose, then Enter to review that model's download size, memory estimate and destination. Press Enter again to confirm the download and chat-engine setup. Browsing the list and opening review do not start a download.

Several entries are marked **[SUGGESTED]** in cyan from a fresh system-memory reading and TIM's model-memory estimates. Text also identifies each suggestion, and amber warnings explain a tighter fit. These are planning estimates, not guarantees of speed, output quality, native tool support or a successful load; other applications and context settings affect memory use. The full supported catalog stays available to inspect. Press Ctrl+R after closing other apps to refresh the memory reading and suggestions.

Your choice determines which model is downloaded and selected; setup does not fall back to Qwen3 0.6B if a larger model fails. The small Qwen3 0.6B option is still available (about 397 MB) when you want a compact download. A compatible chat engine is installed when needed (about 12–25 MB). Setup verifies files and shows download, verification and loading progress or an error. Internet access is needed for downloads; chat runs locally afterward. `--data-dir DIRECTORY` chooses where TIM saves the files.

An installed selected model can be reused, including repair of a missing chat engine. If a saved model's files are disconnected, reconnect them using `tim --library PATH` or explicitly choose another catalog model in setup. Finish or cancel running jobs before setup. Failed setup can be retried explicitly; verified completed files are reused. Esc returns from review to the catalog, then to Models. During setup, Esc leaves monitoring while shared backend setup may continue; quitting the last owned TIM session closes its backend. Your original request stays ready for a separate Enter to send after setup succeeds.

Enter sends (Ctrl+S is an alias); Ctrl+J inserts a newline; Esc cancels; Ctrl+Q quits. `/help`, `/setup`, `/providers`, `/models`, `/model N`, `/agent N`, `/sessions` and `/tools` expose controls. `NO_COLOR=1` disables color; `TIM_ASCII=1` selects ASCII borders. The enlarged hero subtitle uses bold, tracked terminal cells, not independent font scaling.

In the main command box, **Up** recalls an older request or command and **Down** recalls a newer one. Recall fills the draft without sending it: review or edit it, then press **Enter** to run it again. Down past the newest entry restores the draft you were writing. With line breaks in a draft, plain Up/Down first moves between its lines; history begins at the first/last line. Once browsing history, the arrows move between whole entries, including multiline entries. History uses user messages from the current session and submitted slash commands from this CLI run. Assistant/system text is excluded, and TIM adds no separate history file; slash-command recall is not retained across restarts.

To review a long reply, press **Ctrl+P** for the previous page and **Ctrl+N** for the next page. **Ctrl+L** jumps to the latest text and resumes following the live reply. While you read earlier chat, the visible text stays in place as more tokens arrive; the line-position indicator shows where you are. These shortcuts also page through provider guides, reviews and model menus. On Mac, use the **Control** key, not Command. PageUp/PageDown still work; Option/Alt+Up/Down work when your terminal forwards modified arrows. On Mac keyboards, Fn+Up/Down may also send PageUp/PageDown. Plain Up/Down move one line through guides/reviews and select rows in model menus.

Two-finger trackpad scrolling and the mouse wheel scroll TIM's content when the terminal forwards mouse reports. Full-screen TIM enables reporting by default. In **Apple Terminal**, check **View → Allow Mouse Reporting**; the terminal must allow reporting as well as TIM requesting it. See [Apple's mouse-reporting instructions](https://support.apple.com/guide/terminal/turn-on-mouse-reporting-trmlc69728a5/mac). In **iTerm2**, enable **Profiles → Terminal → Enable mouse reporting** and **Report mouse wheel events**. See [iTerm2's terminal profile settings](https://iterm2.com/documentation-preferences-profiles-terminal.html).

TIM follows the scroll direction your terminal reports, respecting macOS natural scrolling without adding an inversion. To use the terminal's own text selection and scrollback controls instead, launch **`tim --no-mouse`**. Ctrl+P/Ctrl+N/Ctrl+L remain available with mouse reporting disabled.

### Model memory and unloading

Enter `/memory` to refresh host RAM and list the model processes owned by the current TIM backend. It shows total and available RAM, the safety buffer, the resulting model budget, and each process's role, PID, measured resident RAM (RSS), and pin status. When RSS cannot be measured, the report labels any available estimate. Catalog RAM estimates describe requirements; they are not measurements of current usage. Process RSS does not represent the full unified/GPU memory footprint.

Use `/unload` or `/unload idle` to release idle non-guide models. To unload a particular model's non-guide processes, run `/memory`, then `/unload N` using a row number from that report, rather than the numbers in `/models`. TIM verifies the displayed process identity before unloading; if processes changed, run `/memory` again. The guide stays resident. Unloading requires current work to finish or be cancelled, keeps downloaded files and selected defaults, and allows a later task to load the model again.

### Response length and context

New setups use **Auto** response length. Auto removes TIM's reply-token cap and uses the space left in the loaded model's context after your prompt. It cannot exceed the model's physical context, a provider's output limit or available memory. Existing saved numeric limits stay in effect until you change them. Auto does not start extra continuation requests.

```sh
tim --max-tokens auto
tim --max-tokens 65536 --context 131072
```

Inside TIM, `/tokens` shows the current response setting, `/tokens auto` enables Auto, and `/tokens N` sets a manual response limit from 1 to 1,048,576 tokens. `/context N` sets the loaded context from 512 to 1,048,576 tokens; the model and engine must support your choice. Larger contexts use more RAM. The context must hold your instructions, conversation, source and reply together, so a manual response limit is a ceiling rather than a guaranteed answer length.

In desktop Settings, choose **Response tokens → Auto** or **Manual limit**, then set **Context tokens** and save. Pipeline **Advanced settings → Response tokens** offers **Use Settings**, **Auto**, or **Manual limit**. Use Settings inherits the global response length; Auto explicitly removes the step's TIM reply cap. Both remain bounded by actual model/context limits.

The CLI launcher selects the production React/Ink renderer before loading the UI when `NODE_ENV` is unset or empty. This keeps idle animation from accumulating development profiling records in Node's heap. Animation stays enabled; a larger heap is not required. Set `NODE_ENV=development` only for short debugging sessions: its profiling records can grow for as long as the UI runs. Launch through `tim`, `npm run cli`, or `node cli/index.mjs` so this initialization runs.

## Provider selection and activity

Local models remain the default. Cloud access is explicit and never a fallback:

~~~sh
tim providers
tim providers openai
tim providers xai
tim providers anthropic
tim models --provider openai
tim models --provider xai
tim models --provider anthropic
tim --provider openai --model MODEL_ID_FROM_LIST
tim --provider xai --model MODEL_ID_FROM_LIST
tim --provider anthropic --model MODEL_ID_FROM_LIST
tim install "a tool request" --provider openai --model MODEL_ID
tim listen port 9999 --provider xai --model MODEL_ID
tim read capture.pcap "show hex for port 9999" --provider openai --model MODEL_ID
tim toolbox propose "a small tool request" --provider xai --model MODEL_ID
~~~

### Connect ChatGPT, Grok or Claude from the terminal

You do not need the TIM desktop app, Model Library or a local model download. `tim providers` lists the choices, and `tim providers openai`, `tim providers xai` or `tim providers anthropic` prints the complete setup guide. Inside TIM, `/providers` opens the same guides; press P in the model chooser to open them. Use Tab or Left/Right to switch guides, Ctrl+P/Ctrl+N to page, and Ctrl+L to jump to the end. Up/Down move one line through the guide and PageUp/PageDown also work, including in an 80-column terminal.

TIM connects to these providers' **model APIs**. Signing in to the ChatGPT, Grok or Claude website/app does not automatically sign TIM in. Create an API key in the provider account and check API access, billing and credits there. Subscription benefits vary by provider and plan; TIM does not use the consumer app login.

| What you want to use | TIM provider | Create an API key | Environment variable |
| --- | --- | --- | --- |
| ChatGPT / OpenAI models | `openai` | [OpenAI API keys](https://platform.openai.com/api-keys) | `OPENAI_API_KEY` |
| Grok / xAI models | `xai` | [xAI Console](https://console.x.ai), then API Keys for your team | `XAI_API_KEY` |
| Claude / Anthropic models | `anthropic` | [Claude Console API keys](https://platform.claude.com/settings/keys); scope the key to your TIM workspace | `ANTHROPIC_API_KEY` |

Quit TIM, then enter these commands in a normal terminal. On **macOS with zsh**, this example asks for the OpenAI key without displaying it or putting its value in your command history:

```zsh
read -r -s 'OPENAI_API_KEY?Paste your OpenAI API key: '
export OPENAI_API_KEY
printf '\n'
tim models --provider openai
tim --provider openai --model MODEL_ID
```

Paste your key only at the hidden-input prompt. Replace `MODEL_ID` with an exact text-model ID returned by the list command. For Grok, change `OPENAI_API_KEY` to `XAI_API_KEY` and `openai` to `xai`; for Claude, use `ANTHROPIC_API_KEY` and `anthropic`.

For **Linux/bash**, use `read -r -s -p 'Paste your OpenAI API key: ' OPENAI_API_KEY` as the first command; the other commands are the same. On **Windows PowerShell**, use:

```powershell
$timApiKey = Read-Host 'Paste your OpenAI API key' -AsSecureString
$timApiCredential = [System.Net.NetworkCredential]::new('', $timApiKey)
$env:OPENAI_API_KEY = $timApiCredential.Password
Remove-Variable timApiKey, timApiCredential
tim models --provider openai
tim --provider openai --model MODEL_ID
```

These examples set a key only for the current terminal session. A new terminal needs the key again, or a secret manager you configure. Do not paste keys into the TIM command box, source, screenshots or shared files. TIM reads keys from the **backend process environment** and does not prompt for, save or print them. With `--url`, set the key in the existing backend's terminal before starting that server; exporting it only in the connecting client terminal is insufficient. A missing-key error identifies the required variable. For 401/403 errors check the key and account permissions; for 429 check API credits and limits before retrying manually. Development checks use dummy keys and mock HTTP only.

Official account/authentication guidance: [OpenAI API authentication](https://developers.openai.com/api/reference/overview), [xAI quickstart](https://docs.x.ai/developers/quickstart), and [Claude API keys](https://platform.claude.com/docs/en/get-api-key).

### Model capabilities and activity

The model list is fetched only on request. IDs are account-visible, not a capability guarantee: select a text model supporting the provider's API; planning additionally requires structured-output support. Unsupported model/schema requests fail clearly without falling back to plain text, another model or another provider. There is no hardcoded cloud model list. Local --model selects the model for chat and planning; /model N changes the local chat selection. TIM_PROVIDER and TIM_MODEL are optional environment-based selection references, overridden by flags. Cloud selection does not overwrite desktop/local defaults.

OpenAI and xAI use HTTPS POST /v1/responses with SSE, stream:true and store:false at api.openai.com or api.x.ai. Anthropic uses its native streaming Messages API at api.anthropic.com. No configurable arbitrary proxy endpoint, background response, vendor-hosted tool, file upload or reasoning transcript is enabled. store:false is not a promise of zero provider retention; provider policies still apply. Model discovery uses GET /v1/models. Cloud support covers text chat/code and typed install/listen/read/build planning, not desktop media, pipelines or autonomous agent mode.

The header names the provider; cloud startup opens a fresh session. Typed prompts, that cloud session's text history and planning requests go to the selected vendor. Local session history, attachments, artifacts, tool transcripts and packet contents are blocked from crossing that boundary automatically. Capture planning receives only the typed request. Toolbox draft planning may receive candidate names/status metadata after local recall. Do not paste secrets into prompts: this is not a general secret scanner.

During work, TIM shows the observed phase, elapsed time and last activity age. Tool stdout/stderr, model tokens/phase changes and provider lifecycle events count as activity. Provider reasoning events can indicate processing but their text is never displayed or saved. SSE comments update connection freshness only. The UI clock explicitly does **not** prove that a worker is alive. A quiet job is flagged after 60 seconds without activity. Historical ETA ranges become available after at least five usable comparable completions. Typed install/listen/read planning is keyed by provider, model, operation, input-size bucket, runtime settings and local warm/cold state. Cold local model loading has a separate load-only estimate. Repeated identical tool commands use session-only timing history. Ranges use filtered recent durations with a 20% margin, labeled low confidence (5-11 samples) or moderate confidence (12+); these are empirical ranges, not statistical coverage guarantees. No token-total percentage is invented. Free-form chat/build generation, listeners and jobs without comparable evidence remain unavailable; timeout limits are not completion estimates.

Timing durations and activity gaps use monotonic clocks. Cancelled, failed, timed-out and stalled runs never train estimates. Outliers are filtered; fewer than five usable samples, widely varying samples, a current stall or exceeding the historical range suppresses the estimate. Model timing history contains only hashed grouping keys, aggregate bounded duration samples and an update timestamp in timings.json under the selected backend data directory (20 samples/key, 128 keys, 30-day expiry). It contains no prompts, arguments, outputs or credentials. /eta-reset clears this history when no job is running; changing provider/model automatically selects a separate group. Tool history disappears when the CLI exits. Known-byte download counters are not connected to this CLI estimator; no download ETA is claimed.

Ctrl+R or /reconnect reconnects backend events without resubmitting. Backend silence expires after 45 seconds (the backend sends transport keepalives every 20 seconds); cloud transport silence closes locally after 90 seconds, with a ten-minute request/planning ceiling. Escape cancels the current job. A cloud cancellation aborts the HTTP stream locally; vendor-side stopping and final billing cannot be confirmed. OpenAI's response-cancel endpoint is for background responses, which this client does not create.

Failed sends retain the draft and reuse a submission ID for the same unchanged request. The server deduplicates accepted IDs, including concurrent retries. After an observed failed/cancelled/interrupted turn, /retry restores the prior request for review; Ctrl+S then starts a new turn. It never silently repeats a paid request. 401/403, 429 (with numeric Retry-After where supplied), unsupported capabilities, malformed/incomplete streams and disconnects surface safe errors. There are no automatic provider retries, including after an uncertain outcome. Cancellation/reconnection never retries installation or tool execution; those retain fresh exact-command approval.

Official protocol references checked for this implementation: [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs), [OpenAI cancellation](https://developers.openai.com/api/reference/resources/responses/methods/cancel), [xAI Responses](https://docs.x.ai/developers/rest-api-reference/inference/responses), [xAI structured output](https://docs.x.ai/developers/model-capabilities/text/structured-outputs), and [xAI model discovery](https://docs.x.ai/developers/rest-api-reference/inference/models).

## Tools and package managers

`tim --tools` discovers installed utilities without starting a model. Type to search, Tab to change category, arrows to select, and Enter to edit arguments. Review the executable, literal argv, targets and working directory; Ctrl+S launches once. Esc cancels the owned process tree. Output is sanitized and bounded; ordinary runs have a 60-second limit, package operations up to five minutes. Child stdin is closed. Interactive terminal applications are unsupported.

Registry utilities include Node, Git, curl, ping, dig, whois, nmap, tcpdump, TShark, OpenSSL, ip and ss where available. Discovery is platform-filtered PATH inspection, not a complete machine inventory. Windows script shims are unsupported except npm's known JavaScript entry point. No automatic elevation, firewall changes or blanket yes/accept flags are added. General utility argv validation is structural, not a semantic allowlist of every option: review targets and effects.

```sh
tim install "the tool I need"
tim install typescript --manager npm
```

Natural-language planning uses the explicitly selected provider/model, otherwise the loaded or configured local main chat model, through existing sessions/jobs/SSE and model services. Only validated structured intent is accepted. Explicit manager plus exact package ID bypasses inference. The planner verifies actual metadata for npm, APT and Homebrew formulae. It selects a uniquely verified compatible candidate; multiple verified alternatives require a manager choice. Unrelated package environments do not automatically create ambiguity. npm/APT pin the observed version; Homebrew displays the candidate but does not pin it.

Exact install argv/source review is required before mutation. Metadata queries may contact configured registries beforehand. No automatic new repositories, credentials or license acceptance. Manager-native prompts may fail with closed stdin; use the displayed command in a normal terminal when necessary. On a failed/missing-tool plan, Ctrl+B explicitly requests the shared recall-first small-tool proposal workflow. Nothing generated is executed automatically.

Declared manager adapters (V=version, S=search, L=list, I=install, U=update named package, R=remove):

| Managers | Operations | Automatic metadata-verified install |
| --- | --- | --- |
| apt, brew, npm | V S L I U R | Yes |
| dnf, zypper, apk, winget, choco, scoop, pnpm | V S L I U R | No; reviewed launcher only |
| pacman, cargo | V S L I R | No |
| pip, uv | V L I U R | No |
| yarn | V | No |

Declared support is not proof of native execution on every platform/version. A Windows Scoop/pnpm script shim can be detected yet unsupported. Package identifiers reject leading flags, URLs, paths and shell syntax. This is not arbitrary natural-language shell orchestration.

## Network data

```sh
tim listen port 9999 --protocol tcp
tim listen port 9999 --protocol udp --host 127.0.0.1
tim listen --show-source
tim read capture.pcap as hex --filter "tcp.port == 9999"
tim read capture.pcapng as ascii
tim read capture.pcap "show ASCII payloads for port 9999"
```

Listen creates a new TCP/UDP socket; it does not sniff an occupied port. Protocol, bind address and port are reviewed. Default is loopback; external binds are disclosed. A fixed Node built-in helper is used, not model-generated code or automatic system-tool selection. Exact numeric port requests can fall back without a model. Runs last at most five minutes with bounded display, peer/idle limits and cancellation. Raw bytes are hex/printable ASCII, never interpreted as terminal control sequences, silently saved or sent to a model. High-volume bytes may be omitted with a counter.

Offline capture requires installed TShark. `read` takes the filename first and optionally a natural-language request afterward. It reads at most 200 packets with name lookup disabled. Hex shows packet bytes; ASCII extracts TCP/UDP/data payload fields. These are packet views, not stream reconstruction. Encrypted data remains encrypted. Only simple numeric/address display filters are supported. Model planning receives request text, never file contents or captured payloads.

Live capture is available only as a manually reviewed installed tcpdump/TShark utility command. Automatic interface selection, capture permissions, privilege setup and full Wireshark parity are not implemented. No live host capture is used in development tests.

## User-selected persistent toolbox

Create and choose an existing writable directory yourself:

```sh
tim toolbox location "D:\My tools"
tim toolbox list
tim toolbox search "port formatter"
tim toolbox add ./my-tool.mjs "why I built it" --name "My tool"
tim toolbox propose "a small local port formatter"
tim toolbox show TOOL-ID
tim toolbox run TOOL-ID argument
tim toolbox add ./updated.mjs "reason for revision" --id TOOL-ID
```

Commands accept `--toolbox DIRECTORY` for an explicit one-time root. Selection persists in ordinary TIM configuration; `--data-dir` isolates that configuration. The directory must exist and be writable. No default is silently selected, unavailable drives fail without fallback, and changing location never migrates/deletes old tools. Selection is a command, not an interactive setup wizard.

All executable-tool proposal paths share recall before generation: `toolbox propose` and the install screen's Ctrl+B fallback. Compatible keyword matches are returned before a model is called. Otherwise the configured model may produce a bounded JavaScript draft. The low-level build planner refuses calls that bypass this recall gate. Ordinary chat/specialist text has no script creation/execution capability; code printed in conversation is not a saved or approved tool.

Drafts record stable ID/version, name/description, timestamps, request/rationale, tags, runtime/platform/dependencies, entry point/argv schema, permissions/network scope, model provenance, source hash, review state, validation notes and bounded status-only outcome history. They never store packet payloads or execution output. Do not put secrets in requests or source; automatic secret redaction is not provided.

Show and inspect source before running. Each run needs fresh exact-command approval. Source hash and permission/compatibility metadata are rechecked against that approval. Changed source must become a new version; corrupted entries are reported and not executed. Draft versions and execution audit updates use a shared exclusive lock and atomic writes, with a bounded wait. A stale lock produces an error instead of silent overwrite; investigate the prior writer before manually removing it.

Execution currently supports Node ES modules without declared external dependencies. Compatibility uses declared metadata, not static analysis. Code is not sandboxed, and 'reviewed' is not a security or test certification. Other runtimes, dependency repair, semantic recall and automatic migration are unsupported.

## Validation and remaining limits

Development uses mocked model/API responses, harmless local processes, synthetic captures and localhost sockets. No real target package installation, external scan, live host capture, model inference or RI/GPU work is part of validation. Windows isolated installation, repeated GUI-free backend lifecycle, toolbox persistence and synthetic-terminal cleanup are checked. Manager adapters use argv/metadata fixtures; non-Windows native execution and real-model behavior remain unverified.

Preview images rasterize actual Ink output with ANSI colors and fixed-cell block geometry. They are not native-terminal screenshots or font-compatibility checks. Panel/frame borders use bright phosphor-green double lines (ASCII fallback available), with a distinct brighter composer border and amber sending state. The wordmark shares the hooded profile's lime-green palette: solid pixel letters, a dim offset outline and fixed scan fragments in lighter and darker green shades. A broken green signal backdrop spans the full welcome area behind both the hood and the lettering; dark contours preserve letter contrast. The amber prompt includes the leading `>`.

## User-level installer (Windows, macOS and Linux)

`npm.cmd run pack:cli` on Windows (`npm run pack:cli` on Unix) creates `artifacts/tim-studio-installer/`: keep all files in
that folder together. It contains the verified package, SHA-256 manifest, common
installer engine and platform scripts. No published npm package or release URL
is assumed. Obtain the whole folder from a trusted distributor; the adjacent
checksum detects corruption, not a malicious replacement of the whole bundle.

Install Node.js 24 or newer **with npm** from https://nodejs.org/en/download first.
The scripts check prerequisites and give instructions if unavailable; they never
install a runtime, elevate privileges or change execution policy automatically.
Package dependencies are fetched through your configured npm registry/cache;
lifecycle scripts are disabled. Installation does not launch a model or GUI.

Windows PowerShell or Command Prompt, from the extracted distribution folder (works when PowerShell script files are disabled):

```powershell
.\install-tim.cmd
# Open a new terminal, then:
tim
```

From the repository root, no ZIP extraction is needed:

```powershell
npm.cmd run pack:cli
.\artifacts\tim-studio-installer\install-tim.cmd
```

The CMD entry runs Node directly and accepts `--prefix`, `--package`, `--sha256`,
`--rollback` and `--uninstall`. It does not run the PowerShell installer script
or change execution policy. The Node core uses a small inline Windows API call
for User PATH only, with no encoded command or policy override. Restart the
terminal after CMD installation because the caller's process PATH is unchanged.
If `npm` selects a blocked `npm.ps1`, use `npm.cmd`; npm is already installed.

Optional PowerShell script entry (when local script policy permits), from the distribution folder:

```powershell
.\install-tim.ps1
# Optional user-owned destination:
.\install-tim.ps1 -Prefix "$env:LOCALAPPDATA\My Tools\TIM"
tim --help
```

Default Windows destination: `%LOCALAPPDATA%\TIMStudio\cli`. The installer adds
its `bin` directory to **User PATH**, preserves existing entries and updates the
calling PowerShell process PATH. Open a new terminal for other applications.
If local script execution is restricted, follow your organization's policy; the
installer does not weaken it. Alternatively run `node .\installer.mjs` from the
bundle, then open a new terminal (same user-level installation, no policy change).

macOS/Linux, from the distribution folder:

```sh
sh ./install-tim.sh --shell zsh   # macOS default; select your actual shell
sh ./install-tim.sh --shell bash # Linux bash users
# fish users: --shell fish
# Optional: --prefix "$HOME/My Tools/TIM"
```

Default Unix destination: `$XDG_DATA_HOME/tim-studio/cli`, or
`$HOME/.local/share/tim-studio/cli`. The detected `$SHELL` is used if `--shell` is
omitted. Bash gets an owned block in `.bashrc` and its selected login profile;
zsh in `.zshrc`/`.zprofile` (honoring `ZDOTDIR`); fish gets an owned `conf.d` file
(honoring `XDG_CONFIG_HOME`). Open a new shell or source the reported profile.
An executed script cannot change its parent shell's environment. Other shells
require an explicit supported shell selection or manual PATH configuration;
no unrelated profile is silently chosen. Unix command names are case-sensitive:
use `tim`. No provider keys or other secrets are written by this installer.

Repeat the same command to update from a new bundle. An identical package is
idempotent. A new package is installed in an isolated release directory and its
CLI version check must succeed before activation; failed activation restores
prior managed files/PATH. Previous releases remain for rollback:

```powershell
.\install-tim.ps1 -Rollback
.\install-tim.ps1 -Uninstall
```

```sh
sh ./install-tim.sh --rollback
sh ./install-tim.sh --uninstall
```

Pass the same `-Prefix`/`--prefix` for a custom destination on later operations.
Rollback switches to the previous successful release. Uninstall removes only
owned releases/launchers and exact managed PATH blocks/entries, preserving
unrelated files and preexisting PATH entries. Modified launcher files or profile
blocks require manual reconciliation; the installer refuses to overwrite them.
Filesystem failures during uninstall may require retry/manual cleanup; uninstall
is not a transactional backup of release contents. A stale `.install.lock`
after an interrupted process requires checking that no installer is running
before removing that lock. Existing `tim` commands on PATH are reported as
collisions rather than replaced. System PATH, administrator settings, firewalls
and model/provider configuration are never modified.

For a separately supplied local archive, use `-Package <file> -Sha256 <hash>`
(PowerShell) or `--package <file> --sha256 <hash>` (shell). Verify the hash through
a trusted channel. Do not use arbitrary archives or model-generated installer
commands. Development-only `--sandbox <directory>` / `-SandboxRoot <directory>`
redirects profiles and Windows PATH to an isolated directory/JSON mock; it is
not a real host installation. `--platform` is allowed only in that sandbox.

Validation: actual Windows wrapper/Node installer with isolated prefixes and
mock user PATH; Git Bash wrapper smoke test; bash/zsh/fish profile generation,
repeat/update/rollback/uninstall, collisions, missing prerequisites, read-only
profiles, checksum rejection and failed activation tests. Native macOS/Linux,
fish/zsh execution and real Windows registry writes have not been exercised.

## Responsive terminal and natural requests

The welcome view centers its art group and uses large, compact and small ASCII
variants according to both available rows and columns. Empty cards are capped;
the composer remains pinned during resize and streaming. Enter sends, Ctrl+S
is an alias, and Ctrl+J (or Alt+Enter where delivered) inserts a newline.
Bracketed multiline paste never submits. BS/DEL Backspace, forward Delete,
grapheme-aware arrows/deletion, Home/End, Ctrl+Left/Right, Ctrl+W, Ctrl+U and
Ctrl+K support ordinary editing. Shift+Enter is not assumed portable.

Long replies use Ctrl+P/Ctrl+N for earlier/later pages and Ctrl+L to return to
the latest text and live following. Reading earlier chat stays anchored while
new text streams in; the line indicator tracks the visible range. These page
shortcuts also work in model menus, guides and reviews. Mac users hold Control,
not Command. PageUp/PageDown and terminal-forwarded Option/Alt+Up/Down are
alternatives; Fn+Up/Down may send page keys on a Mac keyboard. Plain arrows
move between lines in a chat draft until its first/last line, then recall
older/newer requests or commands. While browsing history they recall whole
entries. Down past newest restores the unsent draft; Enter separately runs
the recalled text. Menus and reviews keep their normal arrow navigation.
Two-finger trackpad or wheel scrolling also works when the terminal forwards
mouse reports; full-screen TIM requests them by default. `tim --no-mouse`
leaves text selection and scrollback gestures with the terminal. Scroll
direction follows the terminal and macOS natural-scrolling setting.

```powershell
tim check port 999
tim "go get me all the images at https://example.com/gallery"
```

Unknown non-option arguments form an initial natural-language request; unknown
flags still produce helpful validation errors. The selected local/OpenAI/xAI
model proposes a closed typed intent. Local port ownership/socket inspection
uses installed netstat, ss or lsof, executes read-only without an extra approval
prompt, and displays actual output/exit status. It does not connect to targets,
scan, capture traffic or invent bandwidth statistics. Unsupported/ambiguous
requests ask for clarification or offer toolbox recall and a stored, unexecuted
script draft. Inspect drafts with `tim toolbox show ID`, then explicitly review
`tim toolbox run ID`. Generated code is never executed merely because the model
suggested it. Install/listen intents open their existing review workflows.

Image requests show the single public page and a fresh destination for approval
before fetching or writing. A built-in reviewed downloader handles img src,
srcset and common lazy attributes, relative URLs, redirects and deduplication.
It rejects private/loopback/metadata destinations and credentials in URLs,
pins resolved public addresses, caps page/image/total sizes and duration, never
overwrites an existing destination, and saves a manifest including failures.
Downloads are sequential (one concurrent request); no JavaScript evaluation,
CSS backgrounds, SVG, authenticated sessions or whole-site crawling is claimed.
A cancellation keeps completed images and a partial manifest. Page contents and
image bytes are never supplied to the model. Local inspection output likewise
stays in the terminal, separate from subsequent model clarification requests.

Provider/model IDs (not keys) persist in `cli-selection.json` under the selected
TIM data directory. Explicit flags/environment override saved choices. The UI
shows the selected provider and cloud boundary. A missing model preserves the
request and gives model-selection guidance; no silent cloud fallback occurs.
Noninteractive natural requests are displayed with interactive-start guidance
and do not execute actions.


## Opt-in voice and optional overlay

```powershell
npm.cmd run build:voice       # existing Windows .NET Framework compiler only
node cli/index.mjs voice --devices  # metadata only; does not open microphone
tim voice                    # starts MUTED; type unmute to explicitly listen
tim voice --listen           # explicit microphone activation
tim voice --overlay --electron C:\path\to\electron.exe
```

The packaged Windows adapter uses installed System.Speech for local dictation;
no audio is sent to a cloud transcriber. It supports the Windows **default**
recording device only; select another default in Windows settings yourself.
`--language CULTURE` selects an installed recognition language. Missing language,
permission or device produces Error/Unavailable, never a fake Listening state.
Other platforms need an explicitly configured trusted local `--adapter PATH`.
Adapter protocol: `--devices` outputs metadata; normal execution emits bounded
JSON lines `{type:"ready"}`, `{type:"transcript",id,final:true,text,confidence}`
or `{type:"error",message}`. `TIM_VOICE_DEVICE`/`TIM_VOICE_LANGUAGE` are forwarded.
No runtime, microphone permission or language pack is silently installed.

Only confident final transcripts beginning with “TIM ” enter the same typed
planner. Partial/low-confidence/duplicate/ambient transcripts are ignored.
“TIM cancel”, “TIM mute” and “TIM stop” control the session. Muting closes the
capture process; resume through the overlay or terminal `unmute` (a muted
microphone cannot hear a resume command). No TTS is implemented, avoiding a
speech feedback loop. Wake phrases are not speaker authentication. Reviewed
image/package actions require an exact pending approval code; listening alone
never grants mutation authority. Listener takeover and generated scripts retain
their terminal/source-review workflows. Voice request transcripts may go to the
selected cloud model; audio, desktop screenshots and local output do not.

Background voice never injects keys/mouse events, activates windows or restores
focus. Output remains in its own console. Optional Electron overlay controls
Mute/Listen/Stop/Hide and reflects real adapter state via an authenticated
loopback-only, bounded-message channel. It uses `focusable:false` and
`showInactive()`, has no remote content/Node renderer access, and requests no
browser permissions. Hiding it does not mute; type `show` in the voice terminal
to reopen. Electron is optional and is not included in the standalone CLI.
Native hidden-window rendering was checked; visible control-click/focus behavior
and live microphone accuracy still require explicit user testing. Other desktop
platforms' focus policies are not claimed verified.

## Explicit desktop control boundary

`tim control --capabilities` reports the current disabled/native-adapter status.
A bounded Windows adapter is compiled with the existing .NET Framework and included in Windows-built packages. macOS/Linux have optional semantic AX/AT-SPI adapters with dependencies and native validation still outstanding; see PLATFORM-SUPPORT.md. Windows supports an already-open target PID, focus, target-relative click, Unicode typing and key chords, with a nonactivating Stop indicator. Native input/hook behavior is **not exercised on the user desktop**; this is not verified arbitrary-app automation. iMovie/music-production tasks are not claimed tested.

`tim control --plan REVIEWED_JSON` on Windows, or
`tim control --adapter ABSOLUTE_EXECUTABLE --plan REVIEWED_JSON` with another trusted adapter presents the task,
PID and bounded steps, requires a fresh exact token, then confirms each step.
The adapter must declare native emergency-stop and manual-input interruption
support; otherwise control is refused. Plans allow observe/focus/click/type/key/
wait only, at most 20 steps/60 seconds, with target PID/window-handle checks and verification after each step. The Windows adapter verifies window presence/foreground, not completion of the requested application task; the user must verify semantic results. Errors, cancellation, target changes and interruptions revoke approval
and call releaseAll. Native permission changes are never automatic. Background
voice cannot grant takeover; launch the explicit terminal review separately.

Adapter JSON-line RPC methods are capabilities/observe/act/verify/releaseAll;
responses use `{id,result}` or `{id,error}`. EmergencyStop/manualInput events
revoke authority. Observations remain local; no screenshot/model upload is
implemented. Target-relative coordinates and permission reporting are the
adapter's responsibility. Sensitive messages/purchases/deletion/credentials and
security settings require a separate specific review, not generic takeover.

## Tor routing and prerequisites

```powershell
tim --route tor --socks 127.0.0.1:9050 "get images at https://example.com/gallery"
tim --route direct "get images at https://example.com/gallery"
tim dependencies list
tim dependencies tor
tim dependencies tor --download --destination C:\Users\me\Downloads\TIM-Prerequisites
tim dependencies node --version v24.22.2 --download --destination C:\Users\me\Downloads\TIM-Prerequisites
tim silent
```

Tor mode uses an existing loopback SOCKS service. It never starts/installs Tor,
changes system proxies or falls back to direct networking. Only the built-in
page/image downloader is covered, with local model planning; cloud providers,
external tools and package managers are blocked as unsupported in this mode.
The image review/status identifies Direct/Tor. SOCKS failures leave it unavailable.
No actual Tor connection or onion visit was used in development.

The prerequisite catalog distinguishes the **Tor client/expert bundle** needed
for SOCKS from Tor Browser. It resolves supported platform/architecture links
from official vendor metadata, shows license/purpose/version/verification and
requires a separate download-only confirmation plus destination. Tor signatures
are downloaded beside the archive but **not automatically authenticated**;
verify them before installing. Node archives are checked against official HTTPS
SHA-256 metadata; signer authentication remains a separate step. Unknown sizes
are reported as unknown until transfer metadata arrives. Unsupported or ambiguous
metadata yields the official page/manual instructions. No model-provided binary
URL, execution, elevation, service startup or firewall change is accepted.

**Silent Mode does not guarantee anonymity.** Whole-machine lockdown is
preflight/design only; see [SILENT-MODE.md](SILENT-MODE.md). Logins, identifying
content, fingerprinting and traffic outside covered TIM operations remain risks.

Implementation references: [System.Speech](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine),
[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window),
[Tor SOCKS specification](https://spec.torproject.org/socks-extensions.html),
[official Tor client downloads](https://download.torproject.org/tor/).

## Expanded-feature acceptance and remaining limits

| Command | Implemented scope | Verification / limit |
| --- | --- | --- |
| `tim "check port 999"` | Configured model selects validated local TCP/UDP inspection; displays actual local tool output. | Mock HTTP planner to real localhost fixture tested. No external scan or payload upload. |
| `tim "get images at https://example.com/gallery"` | One HTML page, src/srcset/lazy attributes; reviewed new destination, bounded downloads and manifest. | Synthetic HTTP fixtures tested. No JS, CSS backgrounds, authentication or site crawl. |
| `tim dependencies list` / `tim dependencies tor` | Required/optional official prerequisite catalog and supported OS/architecture metadata. | Ambiguous assets yield manual guidance. Catalog listing is offline; metadata resolution uses public HTTPS. |
| `tim dependencies node --version VERSION --download --destination ABS_PATH` | Download-only confirmation, checksum validation, no overwrite/install/start. | Fixture metadata/downloads tested; Tor signatures require separate authentication. |
| `tim --route tor --socks 127.0.0.1:9050 "get images at URL"` | Downloader and redirects/assets over existing SOCKS; remote DNS via Tor RESOLVE; v3 onion support; fail closed. | Mock SOCKS tested, no real Tor connection. Requires local model; cloud providers and unrelated tool/package routes blocked. |
| `tim voice` / `tim voice --listen` | Muted startup or explicit listening; wake phrase, final/confident transcripts, mute/cancel/stop and pending approval codes. | Subprocess fixture tested. Windows default recording device only; live mic untested. Other platforms require adapter. |
| `tim voice --overlay --electron ABS_PATH` | Hood overlay, real state and mute/listen/stop/hide over authenticated local IPC. | Hidden native rendering checked; visible click/focus behavior untested. No background input injection. |
| `tim control --plan REVIEWED_JSON` | Target PID, task token, per-step approval, bounded observe/act/verify, interruption contract and input release. | Subprocess RPC fixture tested; Windows UIA observation/cancellation passed in an isolated live fixture; input attempt stopped at Foreground unavailable. Positive native input remains unverified. |
| `tim silent` | Read-only warning and design/preflight status. | No whole-host Tor/firewall/DNS/IPv6/routing changes implemented. |

Desktop targets are re-observed after step approval. Native input is bound to the
approved window handle and stops if foreground focus changes during input.

Desktop natural-language requests now open a semantic review workflow. See [PLATFORM-SUPPORT.md](PLATFORM-SUPPORT.md) for the model-assisted loop, optional native adapters and precise unverified limits.

CLI entry points are exercised for routing and noninteractive refusal. Desktop
command tests use a harmless JSON-line subprocess, including declined approval;
voice command tests use a capture-event subprocess with no audio. These do not
verify live OS input, microphone accuracy, or arbitrary-app success.

## Final review checklist

- [x] Terminal minimum is 80 columns and 16 rows. Below it, TIM shows measured/required size, preserves mounted draft/cursor/session/job state, blocks typing/submission/approval, and keeps Esc cancellation and Ctrl+Q/Ctrl+C available. Resizing restores the existing view. TIM never resizes the OS window or changes fonts. Extremely tiny views show only what fits; escape/quit remain active.
- [x] Enter submits; Backspace/Delete, grapheme editing, multiline paste and resize preserve input.
- [x] Natural-language fallback routes typed validated actions; local port output, bounded image downloads, toolbox recall and dependency offers have fixture coverage.
- [x] Opt-in voice/overlay and reviewed desktop plans have explicit approval boundaries. No arbitrary-app semantic automation or verified live microphone/native input claim.
- [x] Tor coverage is limited to built-in fetch transport; unsupported routes fail closed. Silent Mode is preflight/design only and does not guarantee anonymity.
- [x] Standalone user installers, source guide and local package are included. Native macOS/Linux and visible overlay/focus testing remain outstanding.

Noninteractive help/version and safe refusal paths do not require a 80-column terminal.

## Model-assisted desktop and decorative animation

Run tim control --task "REQUEST" --target-pid PID --adapter native, or enter a natural-language request in the TUI. A trusted custom semantic adapter can be selected by absolute path. The loop observes, proposes typed actions, obtains exact approvals, executes and checks a fresh semantic predicate. Each cloud observation is separately reviewed before transmission. Background voice supplies an explicit foreground handoff, never automatic takeover. [Platform matrix and live test plan](PLATFORM-SUPPORT.md) distinguish compiled/mocked code from native proof.


Portable voice uses tim voice --portable with installed sounddevice/Vosk and a user-selected local model directory. The command tim silent plan --platform win32|darwin|linux [--snapshot FILE] emits an inactive plan only; privileged execution and automatic host lockdown are disabled.

### Responsive welcome artwork



## Optional Node prerequisite bootstrap

The distribution includes bootstrap-node.ps1 (Windows) and bootstrap-node.sh (macOS/Linux). Choose an explicit Node 24+ version from https://nodejs.org/en/download and an absolute NEW user directory. Run with -Plan or --plan first to inspect exact official source and destination without network access. Execution requires typing install; it downloads only from nodejs.org, verifies the archive against official HTTPS SHA-256 metadata, and extracts into that new directory. It does not independently authenticate the release signer, change PATH/profiles, elevate, install TIM, or execute the downloaded runtime. Use the resulting node.exe/bin/node explicitly with installer.mjs; the TIM launcher records that runtime path. Keep the runtime directory in place.

Windows: .\bootstrap-node.ps1 -Version VERSION -Destination ABSOLUTE_NEW_DIRECTORY -Plan. This script respects PowerShell policy; if blocked, use the official Node installer manually. No policy-bypass wrapper is supplied. macOS/Linux: sh ./bootstrap-node.sh VERSION ABSOLUTE_NEW_DIRECTORY --plan. Remove the plan flag only when ready for the reviewed download/extraction. Native macOS/Linux bootstrap remains unverified.

Silent Mode now also exports a test-only Linux namespace nftables/Tor policy: tim silent policy --platform linux --namespace tim-lab --tor-uid 990 --app-uid 1000. It is proxy-only within that namespace; no host executor or --apply exists. See SILENT-MODE.md for blocked traffic, lifecycle tests and pending native validation.

Offline detached signatures can now be checked with tim dependencies verify --file ABS_ARCHIVE --signature ABS_ASC --keyring ABS_TRUSTED_KEYRING --fingerprint FULL_40_HEX_FINGERPRINT. Requires already-installed gpgv; no keys are fetched/imported and no verifier is installed automatically. Obtain the exact signer fingerprint independently from the correct vendor/product documentation. Verification uses an isolated temporary keyring home and rejects fingerprint mismatch, expired signature timestamps and any error/revocation status reported by the verifier. gpgv trusts supplied keys and does not independently establish their current expiry/revocation or vendor ownership; keep that trust anchor independently verified and current. Success is a cryptographic signature check against that selected anchor, not vendor certification. Tor bundle downloads remain unverified until this separate check succeeds.

TIM built-in Tor downloads now use fresh RFC 1929 SOCKS authentication values per download operation, shared by its remote DNS, redirects and assets, then discarded. The Tor service must support username/password negotiation and keep IsolateSOCKSAuth enabled. An endpoint offering only no-auth is refused without downgrade. Mock protocol tests verify grouping/separation and refusal; no live circuit-isolation claim is made. These generated values are isolation labels, not account credentials, and are not written to the manifest.

The full welcome scene shares one diagonal light sweep (about five seconds per cycle), traveling across the character, the green signal background and both TIM/STUDIO wordmarks. It lights foreground and background colors in the same screen coordinates, with no glyph substitutions or face illumination. Black cutouts and letter contours stay dark, and captions remain steady. It continues while idle or typing; --no-animation, TIM_REDUCED_MOTION=1 and NO_COLOR disable it. Compact tall windows use content-driven hero spacing and shorter captions.

Supported terminal minimum: 80 columns by 16 rows. Welcome art remains visible at every supported width. At 80–99 columns, tall screens stack the 44-column profile with the 48-column block logo; 24-row screens retain that profile beside a narrower TIM/STUDIO wordmark. Optional panels/captions yield before input. At extremely short heights (16–22 rows, depending on draft height), reduced-detail 5- or 9-row profiles preserve the silhouette beside a small block TIM. This cannot retain the full portrait detail at those physical dimensions. Below 80 columns or 16 rows, the size guard preserves state and cancellation. Active tasks still prioritize their output view.

Compact typography uses an 11-row block TIM over a 7-row uppercase STUDIO, separated by one blank row; captions use normal word spacing. Short windows select narrower block lettering so art and input remain visible. `TIM_ASCII=1` substitutes printable characters for the block and outline glyphs while preserving dimensions. Monochrome output also uses a tonal ASCII portrait. Wordmark geometry is cached at its four sizes; the composed scene uses the existing color-only shimmer timer and a bounded frame cache.

The approved glitch-hood artwork is stored in `cli/assets/hacker-glitch.png`. Its checked-in terminal data (`cli/assets/hacker-glitch.mjs`) contains seven sizes, from 69 columns by 29 rows to 16 columns by 5 rows. Standard Unicode quadrant blocks fit four image samples to two colors per terminal cell, doubling horizontal sampling over the original half-block rendering. A 29-shade green palette preserves more of the folds while retaining the wordmark's shared lime colors. The scene compositor extends the signal behind the lettering and keeps the face and dark cloth opaque. The CLI loads only precomputed cell grids; no image download, browser or terminal graphics extension is needed at runtime. Terminal cells still limit detail compared with the original PNG; use `TIM_ASCII=1` if the terminal font cannot display quadrant blocks correctly.

Portrait frame caching is bounded to the seven sizes, color/ASCII forms and 32 animation frames plus the static frame. The composed scene retains only the current viewport and one animation cycle, replacing that cache on resize. To regenerate after replacing the source artwork, run `node scripts/build-terminal-art.mjs` with Playwright's Chromium installed (the script uses installed Edge on Windows). The converter's conservative silhouette outline is specific to the approved source and must be reviewed if that source changes.

### Multiple terminal windows

Run `tim` normally in each window. Compatible CLI builds sharing the same data directory attach to one authenticated loopback backend and create independent conversations. The helper owns the exclusive writer lock; closing one window releases only its lease. The last window closes the helper after a short grace period. A crashed client lease expires after approximately 45 seconds. No PID read from discovery is terminated during recovery. Suspended/disconnected clients may need to restart after lease expiry.

Discovery records are private files with random credentials and a protocol/source-build identity. Changed builds or conflicting model-library selections fail clearly; close old windows normally before upgrading. Old pre-sharing CLI locks cannot be safely attached automatically: close that older CLI once, then start the updated CLI in multiple windows. A stale writer lock is recovered only under the startup gate after its PID is proven absent. Reused/live/permission-unknown PIDs, malformed records and ambiguous startup guards are preserved rather than guessed away. An abandoned `cli-start.lock` requires owner investigation; TIM does not automatically delete it.

`--data-dir` still selects an isolated backend/data set. `--url` remains an explicit attachment to an independently managed server and does not stop that server. To use automatic authentication/leases for TIM-managed helpers, omit `--url`. Sessions and model resources share one backend, so conversation isolation does not mean separate model memory or simultaneous GPU inference. No arbitrary number of windows is guaranteed beyond machine resources.

Mac after pulling: install Node.js 24+ with npm, run `npm ci`, then `npm run build`. Run `node cli/index.mjs` in each terminal for the repository version. For a user-level installation, run `npm run pack:cli`, then `sh artifacts/tim-studio-installer/install-tim.sh` and follow its review prompts. Native macOS multi-window/installer behavior has not been verified on this Windows host; optional speech/desktop-control dependencies and OS permissions remain separate from the terminal CLI.
