#!/usr/bin/env bash
# Builds the privileged helper daemon and drops it at the fixed path
# `target/<profile>/hosts-manager-helper` that tauri.conf.json's
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
  built="target/$TAURI_ENV_TARGET_TRIPLE/$profile_dir/hosts-manager-helper"
else
  cargo build $profile_flag -p helper
  built="target/$profile_dir/hosts-manager-helper"
fi

dest="target/$profile_dir/hosts-manager-helper"
mkdir -p "target/$profile_dir"
if [ "$built" != "$dest" ]; then
  cp "$built" "$dest"
fi

# tauri.conf.json's `bundle.resources` always points at the release path,
# and tauri-build validates that the resource exists even for dev builds.
# Keep a copy there during dev so `tauri dev` (debug profile) doesn't fail;
# it's unused at runtime since `locate_helper_binary` finds the debug
# binary next to the running executable first.
if [ "$profile_dir" != "release" ]; then
  mkdir -p target/release
  cp "$dest" target/release/hosts-manager-helper
fi
