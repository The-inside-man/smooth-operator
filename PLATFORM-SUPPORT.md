# Native feature support and validation

Code availability is distinct from live validation. No universal application compatibility is claimed.

| Capability | Windows | macOS | Linux |
| --- | --- | --- | --- |
| CLI / 100-column guard | Implemented; terminal and isolated installer tested | Shared code; native host unverified | Shared code; native host unverified |
| Semantic model loop | Mock HTTP model + subprocess application fixture tested | Same portable protocol/loop | Same portable protocol/loop |
| Native observation/action | UIA Value/Invoke compiled; isolated live observation and cancel passed; action stopped with Foreground unavailable before input | PyObjC AX implemented; optional packages, Accessibility/Input Monitoring required; unexecuted | X11 AT-SPI/PyGObject + pynput implemented; optional packages required; unexecuted |
| Arbitrary keyboard/mouse plans | Bounded native adapter compiled, input untested | Semantic AX operations only | Semantic AT-SPI operations only |
| Wayland takeover | N/A | N/A | Unsupported: needs compositor-approved remote desktop portal; no X11 bypass |
| Local voice | System.Speech compiled; portable Vosk option; live mic untested | Portable sounddevice/Vosk source; mic permission/dependencies required; untested | Portable sounddevice/Vosk source; device permissions/dependencies required; untested |
| Optional overlay | Hidden render tested; visible focus/click untested | Electron path; native focus untested | X11 path untested; Wayland disabled |
| Tor fetch | Shared remote-DNS/fail-closed code, mock tested | Same | Same |
| Silent Mode host policy | Inactive Windows plan only | Inactive pf plan only | Inactive nftables/namespace plan only |

## Model-assisted desktop use

A natural-language desktop request opens the review screen. Choose native or an
absolute trusted adapter executable, then enter an already-open target PID. Or:

    tim control --task "Put Hello fixture into the draft" --target-pid PID --adapter native

The configured provider/model is used without fallback. The task, each operation
and final semantic predicate require exact token approval. Native controls are
conservatively classified unclassified; each needs an additional side-effect review.
Known external/destructive/credential/security actions are blocked. Password
controls are omitted. Cloud providers require review of exact accessibility
labels/values before each model request. No screenshots are collected.

The loop is at most eight iterations/two minutes. Target changes, manual input,
emergency stop, lost monitoring or uncertain action outcome stop input. Verification
mismatch can produce a revised plan, but each retry gets fresh review. Completion
means the reviewed predicate matches fresh state; it cannot prove artistic quality
or that an entire song/movie is correct. Canvas-only/inaccessible controls may not work.

Background voice retains the desktop request and supplies the model-assisted
foreground command. It cannot silently approve takeover. Voice-triggered control
currently requires a deliberate terminal/TUI handoff.

## Optional prerequisites

Nothing is installed automatically. Use tim dependencies desktop or
tim dependencies speech-portable for official guidance.

- macOS: Python 3, PyObjC Quartz/Cocoa/AppKit/ApplicationServices and explicit
  Accessibility/Input Monitoring. Screen Recording is not requested because no
  screenshot capture is implemented.
- Linux X11: Python 3, PyGObject/AT-SPI 2, pynput and an accessible application.
  Wayland takeover is refused even if XWayland exists.
- TIM_NATIVE_PYTHON optionally chooses an installed Python interpreter.
- Portable voice: Python 3, sounddevice/PortAudio, vosk and a local model directory
  explicitly chosen through TIM_SPEECH_MODEL. TIM_SPEECH_PYTHON selects Python.
  Run tim voice --portable --devices, then tim voice --portable --device ID.
  Startup is muted; unmute or explicit --listen accesses audio.
  No automatic model download, network audio upload, persistent recording or GPU use.

This development host has no usable Python interpreter (only Windows Store aliases).
Python adapter sources have not been executed or syntax-checked here. macOS/Linux
native validation remains necessary. Missing dependencies/monitoring fail explicitly;
they never return pretend success.

## Narrow live validation approval plan

The recorded Windows fixture check exposed real UIA controls and cancelled before input. A separate approved action attempt stopped at Foreground unavailable; successful editing and physical emergency-stop remain unverified.

Windows: compile scripts/desktop-fixture.cs using the installed .NET compiler.
Only after approval, launch that isolated fixture and note its PID. It has one
draft field and Save button, without files/network access. Authorize observation
and input for that PID only, with a fixture/local model. Check:

1. Declining task approval performs no accessibility observation/input.
2. Draft edits require exact review; a fresh UIA value confirms them.
3. Manual key/mouse activity or Ctrl+Alt+Esc interrupts active control.
4. Target replacement/closure or denied permissions stop without fallback.
5. Mic stays muted; no private app/screenshot data is collected.

Separate approvals are needed for a named microphone, visible overlay focus tests
while typing in a dummy window, and native macOS/Linux host sessions. Dependency
installation and OS permission grants are separate; none was done.

Silent Mode plans are not executable lockdown profiles. They describe prerequisites,
owned policy objects and hash-bound rollback data. Activation is disabled. Isolated
VM tests with local recovery consoles are required before a future exact privileged
change review. Silent Mode does not guarantee anonymity.
