#!/usr/bin/env bash
set -e

echo "=================================================="
echo "   🚀 GEN HUB v1 — AUTO TUI ONE-LINE INSTALLER   "
echo "=================================================="

BIN_DIR="./bin"
mkdir -p "$BIN_DIR"

if [ ! -f "$BIN_DIR/gen-hub" ]; then
    echo "[1/2] 📥 Generating Gen Hub executable binary..."
    if command -v podman >/dev/null 2>&1; then
        podman run --rm -e GOTOOLCHAIN=auto -v "$(pwd):/app" -w /app golang:1.24 go build -o bin/gen-hub main.go
    elif command -v go >/dev/null 2>&1; then
        go build -o bin/gen-hub main.go
    else
        echo "Error: Neither podman nor go is installed."
        exit 1
    fi
fi

echo "[2/2] 🚀 Starting Interactive TUI Installer Wizard..."
chmod +x "$BIN_DIR/gen-hub"
"$BIN_DIR/gen-hub" install "$@"
