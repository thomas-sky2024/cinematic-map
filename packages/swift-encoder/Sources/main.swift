import Foundation
import ArgumentParser

// ── Camera params received from Rust via stdin ────────────────────────────
struct CameraParams: Codable {
    let frame: Int
    let time: Double
    let lat: Double
    let lng: Double
    let zoom: Double
    let pitch: Double
    let bearing: Double
}

// ── Progress sent back to Rust via stderr ─────────────────────────────────
struct Progress: Codable {
    let encoded: Int
    let total: Int
    let fps: Double
    let stage: String
}

func sendProgress(_ p: Progress) {
    if let data = try? JSONEncoder().encode(p),
       let str = String(data: data, encoding: .utf8) {
        fputs(str + "\n", stderr)
    }
}

// ── Main CLI entry ────────────────────────────────────────────────────────
@main
struct MapCapture: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "map-capture",
        abstract: "Cinematic Map frame capture + encode (M1 hardware accelerated)"
    )

    @Option(name: .long, help: "Output .mp4 file path")
    var output: String = "/tmp/output.mp4"

    @Option(name: .long, help: "Frames per second")
    var fps: Int = 30

    @Option(name: .long, help: "Resolution: 1080p or 4K")
    var resolution: String = "1080p"

    mutating func run() async throws {
        fputs("[swift-encoder] Starting. Output: \(output) FPS: \(fps) Res: \(resolution)\n", stderr)

        let decoder = JSONDecoder()
        var frameCount = 0
        let startTime = Date()

        // Read camera params from stdin (JSON Lines, one per frame)
        // Rust writes these, we read and process each
        for try await line in FileHandle.standardInput.bytes.lines {
            guard !line.isEmpty,
                  let data = line.data(using: .utf8),
                  let camera = try? decoder.decode(CameraParams.self, from: data)
            else { continue }

            frameCount += 1

            // Week 1: just log progress — real WKWebView capture comes in week 3
            // This lets the Tauri ↔ Swift IPC pipe be tested end-to-end now.
            fputs("[swift-encoder] Frame \(camera.frame): lat=\(camera.lat) zoom=\(camera.zoom)\n", stderr)

            // Send progress back to Rust every 10 frames
            if frameCount % 10 == 0 {
                let elapsed = Date().timeIntervalSince(startTime)
                let currentFps = elapsed > 0 ? Double(frameCount) / elapsed : 0
                sendProgress(Progress(
                    encoded: frameCount,
                    total: -1, // Rust knows the total
                    fps: currentFps,
                    stage: "capturing"
                ))
            }

            // Simulate work so the pipeline can be tested
            try await Task.sleep(nanoseconds: 10_000_000) // 10ms per frame
        }

        fputs("[swift-encoder] Done. \(frameCount) frames processed.\n", stderr)
        sendProgress(Progress(encoded: frameCount, total: frameCount, fps: 0, stage: "done"))

        // TODO Week 3: Replace above loop with:
        // 1. Setup WKWebView with MapLibre
        // 2. For each camera: jumpTo, wait idle, takeSnapshot
        // 3. Metal post-process (vignette, color grade)
        // 4. VideoToolbox HEVC hardware encode → output file
    }
}

// ── AsyncBytes line iterator helper ───────────────────────────────────────
// Backport for reading stdin line-by-line asynchronously
extension FileHandle {
    var bytes: AsyncBytes {
        AsyncBytes(fileHandle: self)
    }

    struct AsyncBytes: AsyncSequence {
        typealias Element = String
        let fileHandle: FileHandle

        struct AsyncIterator: AsyncIteratorProtocol {
            let fileHandle: FileHandle
            var buffer = Data()

            mutating func next() async -> String? {
                while true {
                    if let range = buffer.range(of: Data([0x0A])) { // newline
                        let line = String(data: buffer[..<range.lowerBound], encoding: .utf8) ?? ""
                        buffer.removeSubrange(...range.lowerBound)
                        return line
                    }
                    let chunk = fileHandle.availableData
                    if chunk.isEmpty { 
                        // Flush remaining buffer on EOF
                        if !buffer.isEmpty {
                            let last = String(data: buffer, encoding: .utf8) ?? ""
                            buffer = Data()
                            return last.isEmpty ? nil : last
                        }
                        return nil
                    }
                    buffer.append(chunk)
                }
            }
        }

        func makeAsyncIterator() -> AsyncIterator {
            AsyncIterator(fileHandle: fileHandle)
        }
    }
}
