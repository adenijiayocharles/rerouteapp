#!/usr/bin/env bash
# Builds the privileged helper daemon and drops it at the fixed path
# `target/<profile>/reroute-helper` that tauri.conf.json's
# `bundle.resources` and dev-mode `locate_helper_binary` both expect.
#
# Respects TAURI_ENV_TARGET_TRIPLE / TAURI_ENV_DEBUG, which the Tauri CLI
# sets for beforeDevCommand/beforeBuildCommand, so a cross-compiled
# (e.g. --target x86_64-apple-darwin on an arm64 CI runner) build ends up
# with a helper binary matching the same architecture as the app binary.
#
# The helper daemon is macOS-only (unix sockets + getpeereid), so this is
# a no-op on other platforms.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ "${TAURI_ENV_DEBUG:-false}" = "true" ]; then
  profile_flag=""
  profile_dir="debug"
else
  profile_flag="--release"
  profile_dir="release"
fi

if [ -n "${TAURI_ENV_TARGET_TRIPLE:-}" ]; then
  cargo build $profile_flag -p helper --target "$TAURI_ENV_TARGET_TRIPLE"
  built="target/$TAURI_ENV_TARGET_TRIPLE/$profile_dir/reroute-helper"
else
  cargo build $profile_flag -p helper
  built="target/$profile_dir/reroute-helper"
fi

dest="target/$profile_dir/reroute-helper"
mkdir -p "target/$profile_dir"
if [ "$built" != "$dest" ]; then
  cp "$built" "$dest"
fi

# Tauri's bundler signs the main executable and the outer .app bundle, but
# never touches resource files dropped in Contents/Resources — reroute-helper
# would otherwise ship with cargo's bare ad-hoc signature (no hardened
# runtime, no secure timestamp), which fails notarization once it's staged
# as a bundle resource. Sign it ourselves whenever a Developer ID identity is
# available (set by the release workflow); local dev builds have no identity
# and skip this, same as before.
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  # On CI the cert only lives in APPLE_CERTIFICATE (base64 .p12) — the
  # release workflow's own keychain import happens later, inside
  # tauri-action's signing step, which runs after this beforeBuildCommand.
  # Import it into a throwaway keychain ourselves so codesign can find the
  # identity now. On a dev machine the identity is already in the login
  # keychain and APPLE_CERTIFICATE is unset, so this import is skipped.
  if [ -n "${APPLE_CERTIFICATE:-}" ] && ! security find-identity -v -p codesigning | grep -qF "$APPLE_SIGNING_IDENTITY"; then
    signing_keychain="${RUNNER_TEMP:-$(mktemp -d)}/reroute-helper-signing.keychain-db"
    keychain_password="$(openssl rand -base64 24)"
    cert_path="$(mktemp).p12"
    trap 'rm -f "$cert_path"' EXIT

    echo "$APPLE_CERTIFICATE" | base64 --decode >"$cert_path"
    security create-keychain -p "$keychain_password" "$signing_keychain"
    security set-keychain-settings -lut 21600 "$signing_keychain"
    security unlock-keychain -p "$keychain_password" "$signing_keychain"
    security import "$cert_path" -k "$signing_keychain" -P "${APPLE_CERTIFICATE_PASSWORD:-}" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$signing_keychain"
    security list-keychains -d user -s "$signing_keychain" $(security list-keychains -d user | tr -d '"')
  fi

  codesign --force --options runtime --timestamp -s "$APPLE_SIGNING_IDENTITY" "$dest"
fi

# tauri.conf.json's `bundle.resources` always points at the release path,
# and tauri-build validates that the resource exists even for dev builds.
# Keep a copy there during dev so `tauri dev` (debug profile) doesn't fail;
# it's unused at runtime since `locate_helper_binary` finds the debug
# binary next to the running executable first.
if [ "$profile_dir" != "release" ]; then
  mkdir -p target/release
  cp "$dest" target/release/reroute-helper
fi
