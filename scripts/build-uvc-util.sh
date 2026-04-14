#!/bin/bash
# Build uvc-util from source for macOS UVC camera control.
# Requires Xcode command-line tools: xcode-select --install
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_DIR/backend/bin"
BUILD_DIR="/tmp/uvc-util-build"

echo "Building uvc-util..."

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$BIN_DIR"

# Clone
git clone --depth 1 https://github.com/jtfrey/uvc-util.git "$BUILD_DIR"

# Compile
cd "$BUILD_DIR"
gcc -o uvc-util -framework IOKit -framework Foundation \
    UVCController.m UVCType.m UVCValue.m main.m \
    -I. 2>&1

# Install
cp uvc-util "$BIN_DIR/uvc-util"
chmod +x "$BIN_DIR/uvc-util"

# Clean up
rm -rf "$BUILD_DIR"

echo "uvc-util installed to $BIN_DIR/uvc-util"
echo "Test with: $BIN_DIR/uvc-util -l"
