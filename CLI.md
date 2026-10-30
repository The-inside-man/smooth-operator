# TIM Studio CLI — usage and limits

TIM is a full-screen terminal application with responsive ASCII branding, multiline input, streaming output and keyboard navigation. It requires Node.js 24 or newer. It does not require the graphical frontend, Electron, a browser or a manually started server.

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
tim --data-dir DIRECTORY --library MODEL_LIBRARY_DIRECTORY
tim --url http://127.0.0.1:PORT
```

Normal startup owns an ephemeral loopback-only backend and closes it on exit. `--url` attaches to an existing backend without stopping it. Concurrent owned instances cannot share a data directory. After a crash, inspect a stale `cli.lock` before manually removing it. Models are not downloaded or run on startup. Missing models produce setup guidance; `--demo` is sample data. Noninteractive use prints guidance and never silently approves an action.

Ctrl+S sends; Enter inserts a newline; Esc cancels; Ctrl+Q quits. `/help`, `/models`, `/model N`, `/agent N`, `/sessions` and `/tools` expose controls. `NO_COLOR=1` disables color; `TIM_ASCII=1` selects ASCII borders. The enlarged hero subtitle uses bold, tracked terminal cells, not independent font scaling.

## Tools and package managers

`tim --tools` discovers installed utilities without starting a model. Type to search, Tab to change category, arrows to select, and Enter to edit arguments. Review the executable, literal argv, targets and working directory; Ctrl+S launches once. Esc cancels the owned process tree. Output is sanitized and bounded; ordinary runs have a 60-second limit, package operations up to five minutes. Child stdin is closed. Interactive terminal applications are unsupported.

Registry utilities include Node, Git, curl, ping, dig, whois, nmap, tcpdump, TShark, OpenSSL, ip and ss where available. Discovery is platform-filtered PATH inspection, not a complete machine inventory. Windows script shims are unsupported except npm's known JavaScript entry point. No automatic elevation, firewall changes or blanket yes/accept flags are added. General utility argv validation is structural, not a semantic allowlist of every option: review targets and effects.

```sh
tim install "the tool I need"
tim install typescript --manager npm
```

Natural-language planning uses the loaded model, otherwise the configured main chat model, through existing sessions/jobs/SSE and model services. Only validated structured intent is accepted. Explicit manager plus exact package ID bypasses inference. The planner verifies actual metadata for npm, APT and Homebrew formulae. It selects a uniquely verified compatible candidate; multiple verified alternatives require a manager choice. Unrelated package environments do not automatically create ambiguity. npm/APT pin the observed version; Homebrew displays the candidate but does not pin it.

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

Preview images rasterize actual Ink output with ANSI colors. They are not native-terminal screenshots. Panel/frame borders use bright phosphor-green double lines (ASCII fallback available), with a distinct brighter composer border and amber sending state. The approved wordmark and hoodie remain unchanged; the amber prompt includes the leading `>`.
