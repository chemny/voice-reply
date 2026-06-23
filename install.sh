#!/usr/bin/env bash
# Voice Reply bootstrap installer.
set -euo pipefail

REPO_URL="${VOICE_REPLY_REPO_URL:-https://github.com/chemny/voice-reply.git}"
INSTALL_DIR="${VOICE_REPLY_INSTALL_DIR:-$HOME/.agents/skills/voice-reply}"

echo "Voice Reply installer"
echo "  install dir: $INSTALL_DIR"
echo

command -v git >/dev/null || { echo "ERROR: git is required."; exit 1; }
command -v bash >/dev/null || { echo "ERROR: bash is required."; exit 1; }

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating existing installation..."
  git -C "$INSTALL_DIR" pull --ff-only
elif [ -e "$INSTALL_DIR" ]; then
  echo "ERROR: $INSTALL_DIR already exists but is not a Git checkout."
  echo "Set VOICE_REPLY_INSTALL_DIR to another folder and rerun."
  exit 1
else
  echo "Cloning Voice Reply..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

echo
exec bash "$INSTALL_DIR/setup.sh"
