# Silent Mode — design and preflight only

**Silent Mode does not guarantee anonymity.**

`tim silent` reports scope and limitations. It does not activate a machine-wide
lockdown. Windows, macOS and Linux whole-host lockdown profiles are unsupported
in this build. No firewall, DNS, IPv6, VPN, route, proxy, service, relay or exit
configuration is changed. Existing workloads, including RI training, remain
outside TIM's authority.

Implemented routing is narrower: explicitly selected `--route tor` uses an
already-running user-configured loopback SOCKS service for the built-in image
page/download operation, including redirects and assets. Clearnet names are
resolved remotely through Tor SOCKS RESOLVE, validated as public addresses, then
pinned for CONNECT. V3 onion names use SOCKS domain addressing without public
DNS. Failures stop; no direct retry. UDP, cloud providers, external tools,
package managers and other applications are not automatically tunneled.

Tor protects applications configured to use it, not all computer traffic.
Account logins, identifying requests/files, browser fingerprinting, compromised
endpoints and traffic correlation can still identify users. A normal browser
with a proxy is not equivalent to Tor Browser. No UI should display “Anonymous.”
The warning above must remain visible before any future activation approval,
in active coverage status and in help.

A future OS profile requires a separate concrete privileged review:

1. Define threat model, OS/version, interfaces, Tor client endpoint, supported
   TCP traffic and explicit non-Tor exceptions. Client use does not authorize a
   relay or exit node.
2. Inventory current rules, routes and DNS without changing them; identify
   remote-session lockout and application/workload impacts. Require local
   recovery access before a network-disrupting plan can be approved.
3. Present exact reversible OS commands, saved configuration, ownership markers,
   verification probes and rollback procedure. No model-generated shell plan
   may execute merely because its text was approved generically.
4. Bind approval to the exact profile, host and session. Elevation/permissions
   must be user-granted. Do not disable existing protections or install a
   runtime/service implicitly.
5. Verify covered traffic, DNS, unsupported UDP/IPv6 paths and crash/reboot
   recovery with isolated OS tests first. Failure must not reopen direct
   internet automatically. Explicit exit restores only the approved saved
   configuration; recovery must also work without network access.

Official references:
- https://support.torproject.org/tor-browser/security/using-tb-safely/
- https://support.torproject.org/tor-browser/security/using-tor-with-other-browsers/
- https://spec.torproject.org/socks-extensions.html
- https://www.whonix.org/wiki/Technical_Introduction
- https://tails.net/doc/about/warnings/index.en.html
- https://support.torproject.org/about-tor/alt-design/make-every-user-a-relay/

Whonix gateway/workstation separation and Tails are distinct OS designs, not
protections TIM can claim for an ordinary host or VM guest. No universal Tor
“all restrictions” compliance or anonymity guarantee is asserted.

## Test-only Linux namespace policy milestone

Run tim silent policy --platform linux --namespace tim-lab --tor-uid 990 --app-uid 1000 to inspect a concrete nftables deny-by-default policy and Tor client configuration. This command prints JSON only. There is no --apply option or host executor. Windows/macOS remain separate unsupported enforcement paths.

This deliberately narrower first policy requires a fresh dedicated Linux network namespace with separate unprivileged Tor/application identities. Only application TCP to loopback SOCKS and Tor-owned public IPv4 TCP egress are allowed; direct DNS, UDP/QUIC, IPv6, other local services and other UIDs are dropped. Applications must use SOCKS5 remote DNS. It does not transparently redirect arbitrary application traffic. The host and other namespaces are outside coverage. Privileged applications/capabilities and shared namespaces are unsupported.

SafeSocks rejects unsafe requests; TestSocks is an opt-in diagnostic because logs can reveal destinations. Neither is a firewall. Distinct SOCKS authentication is required for application/session isolation; the policy does not infer identities or claim browser fingerprint resistance. Use Tor Browser for browser privacy. Current TIM remote-resolve then numeric-IP CONNECT requires separate SafeSocks compatibility validation before combination with this profile.

The isolated adapter harness verifies ordering and failure behavior: seal before workload, require every probe, retain/reapply the closed policy on failed probes/cancel/crash, and require explicit exit plus unchanged baseline and stopped workload before removing owned objects. Fixture success is never reported as kernel or host protection. Real Linux nft/Tor syntax and packet tests are still required. This Windows host has no installed WSL; no Linux VM, firewall or Tor service was installed or run.

Required native validation: startup before Tor readiness; direct TCP/UDP/IPv4/IPv6/DNS; Tor crash/restart; network changes; helper/unknown UID attempts; loopback bypass; parent-process crash; concurrent-policy changes; explicit rollback with a local console. An exit-IP check alone is insufficient. No automatic direct-network recovery is permitted.

Sources: https://support.torproject.org/little-t-tor/troubleshooting/check-for-leaks/ ; https://support.torproject.org/about-tor/using-and-sharing/torifying/ ; https://spec.torproject.org/path-spec/stream-isolation.html ; https://manpages.debian.org/trixie/tor/tor.1.en.html . The Linux namespace design is TIM's proposed isolation boundary, not Tor certification.

TIM built-in Tor downloads now use fresh RFC 1929 SOCKS authentication values per download operation, shared by its remote DNS, redirects and assets, then discarded. The Tor service must support username/password negotiation and keep IsolateSOCKSAuth enabled. An endpoint offering only no-auth is refused without downgrade. Mock protocol tests verify grouping/separation and refusal; no live circuit-isolation claim is made. These generated values are isolation labels, not account credentials, and are not written to the manifest.


### SafeSocks compatibility review (2026-11-01)

Ordinary SOCKS RESOLVE followed by numeric CONNECT is **not made SafeSocks-compatible by using the same isolation credentials**. The inspected Tor 0.5.0.0-alpha-dev source checks the numeric address as an address-map key; the DNS cache maps hostname to address, not the reverse association. This is a static compatibility finding, not validation against an installed Tor version. See [SOCKS parser](https://tpo.pages.torproject.net/core/doc/tor/proto__socks_8c_source.html), [address map](https://tpo.pages.torproject.net/core/doc/tor/addressmap_8c_source.html), and [RESOLVE specification](https://spec.torproject.org/socks-extensions.html).

TIM retains remote DNS plus public-address validation and pinned CONNECT. Policy rejection stops the request. It does not retry hostname CONNECT, disable SafeSocks, enable DNS caches, manipulate address maps or fall back directly. Hostname CONNECT after a separate validation would permit a second resolution and lose the pinned-address SSRF guarantee. Virtual-address mappings/control APIs are not implemented or claimed as a solution. Consequently the proposed SafeSocks namespace profile is not ready for TIM clearnet downloads. Onion domain CONNECT remains a separate protocol path, with native Tor validation still outstanding.

Lifecycle fixture hardening rechecks target identity and stopped workload after exit approval, rejects modified policies, checks cancellation after probes and reports unknown containment when resealing fails. A future native adapter must hold a namespace lifetime handle, atomically compare identity/empty-workload requirements and replace only its own filter table in one nftables transaction. Repeated table creation or delete-then-add is not an acceptable implementation. JavaScript rechecks alone do not close kernel races. Fresh namespace/no inherited sockets, distinct UIDs, capability removal and prevention of setuid/user-namespace escape remain prerequisites, not protections established by the generated rules. The Tor UID is a trusted egress identity; arbitrary code running under it can bypass SOCKS. No host execution adapter is enabled.
