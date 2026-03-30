#!/bin/zsh

# Cinematic Map Pipe Renderer
# This script connects the wgpu-based map engine (Rust) with the VideoToolbox encoder (Swift)

# 1. Paths to binaries
MAP_ENGINE="./target/release/map-engine"
SWIFT_ENCODER="./packages/swift-encoder/.build/release/map-capture"
OUTPUT_FILE="./cinematic-video.mp4"

# 2. Configuration
WIDTH=1920
HEIGHT=1080
FPS=30
DURATION=4
TOTAL_FRAMES=$((FPS * DURATION))

echo "🚀 Starting Cinematic Map Rendering Pipeline..."
echo "🎨 [1/2] Map Engine: Generating $TOTAL_FRAMES frames of raw animation..."
echo "🎥 [2/2] Swift Encoder: Processing raw BGRA stream to $OUTPUT_FILE..."

# 3. The Pipe
# - map-engine outputs RAW BGRA bytes to stdout
# - map-capture reads RAW BGRA bytes from stdin
$MAP_ENGINE | $SWIFT_ENCODER --output $OUTPUT_FILE --fps $FPS --width $WIDTH --height $HEIGHT --total $TOTAL_FRAMES

if [[ $? -eq 0 ]]; then
    echo "✅ Success! Video saved to: $OUTPUT_FILE"
    # Open the video on Mac
    # open $OUTPUT_FILE
else
    echo "❌ Error: Rendering pipeline failed."
fi
