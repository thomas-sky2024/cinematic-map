#!/usr/bin/env bash
# build-encoder.sh — Build the Swift encoder binary
# Run from repo root: ./scripts/build-encoder.sh
set -euo pipefail

ENCODER_DIR="packages/swift-encoder"
OUT_PATH="$ENCODER_DIR/.build/release/map-capture"

echo "🔨 Building Swift encoder (release)…"
echo "   Requires: macOS 13+, Xcode CLT, Swift 5.9+"

if ! command -v swift &> /dev/null; then
    echo "❌  swift not found. Install Xcode Command Line Tools:"
    echo "    xcode-select --install"
    exit 1
fi

SWIFT_VER=$(swift --version 2>&1 | head -1)
echo "   $SWIFT_VER"

cd "$ENCODER_DIR"
swift build -c release 2>&1 | sed 's/^/   /'

cd - > /dev/null

if [ -f "$OUT_PATH" ]; then
    SIZE=$(du -sh "$OUT_PATH" | cut -f1)
    echo ""
    echo "✅  Encoder built: $OUT_PATH ($SIZE)"
    echo "   Rust will find it automatically when you run 'pnpm tauri dev'"
else
    echo "❌  Build completed but binary not found at $OUT_PATH"
    exit 1
fi
