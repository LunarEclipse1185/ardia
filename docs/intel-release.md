# Experimental Intel build

This fork's first Intel build is based on Ardia 0.2.44-nightly.4 and Chromium 156.0.8078.79, with Helium 0.20.3
and helium-macos 0.20.3.1. It is not an upstream stable or nightly release.

## New

- **Intel Macs can run Ardia.** The app and ArdiaCore framework are built for x86_64. The owner verified normal
  browsing on a MacBook Pro with macOS 15.7.9; a hidden smoke check also loaded a page and executed JavaScript.
- **Personal builds no longer require the upstream signing team.** `scripts/agent/build-app --adhoc` removes
  shared keychain entitlements, signs embedded frameworks, and turns off hardened runtime only for that build.

## Limitations

- The app is ad-hoc signed, not signed with Developer ID or notarized. Gatekeeper may block its first launch;
  after verifying the download and its checksum, use System Settings > Privacy & Security > Open Anyway.
- Hardened runtime is off. This is a development build with fewer runtime protections than an official release.
- Shared passkey and payment keychain groups are omitted. Those features are not supported in this build.
- Only macOS 15.7.9 on one Intel Mac has been exercised. Other Intel Macs and macOS versions are not verified.
- Packaged fork builds disable the upstream Sparkle feed rather than offer incompatible Apple Silicon updates.
  Updates are manual. The original test download predates this packaging change.

## Files to publish

- An Intel app ZIP, containing the corrected, ad-hoc signed app.
- The matching x86_64 `Chromium Framework.framework` archive, for building this fork without recompiling Chromium.
- `SHA256SUMS`, release notes, and build provenance identifying the exact app and engine source commits.
- The corresponding Ardia source archive, pinned Helium source archives, and bundled uBlock Origin source.

Prepare these with `scripts/release/prepare-intel.sh`; its help lists the arguments. Preparation publishes nothing,
does not use the upstream release pipeline, and does not update an appcast or deploy ardia.dev.

## Build

With a matching Intel ArdiaCore framework available:

```bash
TARGET_CPU=x64 ARDIACORE_FRAMEWORK="/path/to/Chromium Framework.framework" \
  scripts/agent/build-app --as intel --config Release --adhoc
```

The normal build without `--adhoc` retains its original signing settings. The prebuilt engine must match this
checkout's engine sources; an unmodified Chromium framework is not compatible.
