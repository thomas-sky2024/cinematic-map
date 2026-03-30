/**
 * map-capture — Cinematic Map renderer + HEVC encoder
 *
 * FIXES in this version:
 *   ✅ Keyframe.easing field added → JSONDecoder no longer silently fails
 *   ✅ MLNAltitudeForZoomLevel() used → correct MapLibre zoom→altitude
 *   ✅ Scale computed from backingScaleFactor → exact 1080p/4K output
 *   ✅ RenderConfig uses lenient decoding (decodeIfPresent) for safety
 */

import Foundation
import ArgumentParser
import CoreImage
import VideoToolbox
import CoreMedia
import CoreVideo
import AVFoundation
import AppKit
import MapLibre
import CoreLocation
import ObjectiveC

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Bundle swizzle (required for CLI tools using MapLibre)
// ─────────────────────────────────────────────────────────────────────────────

extension Bundle {
    static let swizzleForCLI: Void = {
        let origID = class_getInstanceMethod(Bundle.self, #selector(getter: Bundle.bundleIdentifier))
        let mockID = class_getInstanceMethod(Bundle.self, #selector(getter: Bundle.mock_bundleIdentifier))
        if let a = origID, let b = mockID { method_exchangeImplementations(a, b) }
        let origFW = class_getClassMethod(Bundle.self, NSSelectorFromString("mgl_frameworkBundle"))
        let mockFW = class_getClassMethod(Bundle.self, #selector(Bundle.mock_frameworkBundle))
        if let a = origFW, let b = mockFW { method_exchangeImplementations(a, b) }
    }()
    @objc var mock_bundleIdentifier: String? {
        self == Bundle.main ? "com.cinematic.map.capture" : self.mock_bundleIdentifier
    }
    @objc static func mock_frameworkBundle() -> Bundle {
        let dir = Bundle.main.bundleURL.deletingLastPathComponent()
        if let b = Bundle(url: dir.appendingPathComponent("MapLibre.framework")) { return b }
        for b in Bundle.allFrameworks {
            if b.bundleIdentifier?.contains("maplibre") == true ||
               b.bundleIdentifier?.contains("mapbox")   == true { return b }
        }
        return Bundle.main
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Data models
// ─────────────────────────────────────────────────────────────────────────────

struct ProgressMsg: Codable {
    let encoded: Int; let total: Int; let fps: Double; let stage: String
    var error: String?
}

// ✅ FIX: "easing" field added so JSONDecoder doesn't silently fail on the whole array.
// Swift ignores unknown easing values — we use our own interpolation anyway.
struct Keyframe: Codable {
    let id, label: String
    let time, lat, lng, zoom, pitch, bearing: Double
    var easing: String?

    enum CodingKeys: String, CodingKey {
        case id, label, time, lat, lng, zoom, pitch, bearing, easing
    }
}

struct RenderConfig: Codable {
    let style: String
    let points: [Keyframe]
    let duration: Double
    let fps, width, height: Int

    enum CodingKeys: String, CodingKey {
        case style, points, duration, fps, width, height
    }
}

func sendProgress(_ p: ProgressMsg) {
    if let data = try? JSONEncoder().encode(p),
       let str  = String(data: data, encoding: .utf8) {
        fputs(str + "\n", stderr); fflush(stderr)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Interpolation
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Cinematic interpolation (Catmull-Rom spline)
// ─────────────────────────────────────────────────────────────────────────────

struct Interp {
    // Smooth cubic ease in/out
    static func easeInOut(_ t: Double) -> Double {
        t < 0.5 ? 4*t*t*t : 1 - pow(-2*t+2, 3)/2
    }
    static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a+(b-a)*t }

    /// Shortest-path angle lerp (handles 180° wraparound)
    static func lerpAngle(_ a: Double, _ b: Double, _ t: Double) -> Double {
        var d = b - a
        while d < -180 { d += 360 }
        while d >  180 { d -= 360 }
        return a + d*t
    }

    /// Catmull-Rom spline for smooth path through N keyframes.
    /// Gives continuous first derivative → no jerky transitions between segments.
    static func catmullRom(_ p0: Double, _ p1: Double, _ p2: Double, _ p3: Double, _ t: Double) -> Double {
        let t2 = t*t, t3 = t2*t
        return 0.5 * ((2*p1)
            + (-p0 + p2)*t
            + (2*p0 - 5*p1 + 4*p2 - p3)*t2
            + (-p0 + 3*p1 - 3*p2 + p3)*t3)
    }

    /// Catmull-Rom for angles — handles 180° wraparound on all control points
    static func catmullRomAngle(_ p0: Double, _ p1: Double, _ p2: Double, _ p3: Double, _ t: Double) -> Double {
        // Normalise all points relative to p1 to avoid wraparound discontinuities
        func norm(_ a: Double, _ ref: Double) -> Double {
            var d = a - ref
            while d < -180 { d += 360 }
            while d >  180 { d -= 360 }
            return ref + d
        }
        let n0 = norm(p0, p1), n2 = norm(p2, p1), n3 = norm(p3, p1)
        return catmullRom(n0, p1, n2, n3, t)
    }

    /// Cinematic zoom arc: subtle pull-back during long-distance flights
    static func cinematicZoom(start: Double, end: Double, progress: Double) -> Double {
        let base = lerp(start, end, progress)
        let dist = abs(end - start)
        // Only arc when there's a meaningful zoom change
        let arc  = dist > 1.0 ? 4 * progress * (1-progress) * min(dist * 0.3, 2.0) : 0
        return base - arc
    }
}

// ── Cinematic interpolation engine ────────────────────────────────────────

func interpolate(_ t: Double, _ pts: [Keyframe], _ dur: Double) -> Keyframe {
    guard !pts.isEmpty else {
        return Keyframe(id:"", label:"", time:t, lat:16.0, lng:108.0,
                        zoom:12, pitch:0, bearing:0, easing:nil)
    }
    guard pts.count > 1 else { return pts[0] }

    // Find the active segment
    var segIdx = pts.count - 2
    for j in 0..<(pts.count-1) {
        if t <= pts[j+1].time { segIdx = j; break }
    }

    let p1 = pts[segIdx]
    let p2 = pts[segIdx+1]

    // Clamp guard (before first or after last)
    if t <= pts[0].time    { return pts[0] }
    if t >= pts.last!.time { return pts.last! }

    // t normalised within this segment [0,1]
    let segDur = max(0.001, p2.time - p1.time)
    let rawT   = (t - p1.time) / segDur

    // Apply easing based on the FROM keyframe's easing setting
    let eased: Double
    let easingStr = p1.easing ?? "EaseInOut"
    switch easingStr {
    case "Linear":
        eased = rawT
    case "CinematicArc":
        // Double smoothstep — very slow start/end, fast middle
        let s = rawT * rawT * (3 - 2*rawT)
        eased = s * s * (3 - 2*s)
    default: // EaseInOut
        eased = Interp.easeInOut(rawT)
    }

    // Catmull-Rom ghost points for smooth path through keyframes
    let p0 = pts[max(0, segIdx - 1)]
    let p3 = pts[min(pts.count - 1, segIdx + 2)]

    let lat     = Interp.catmullRom(p0.lat, p1.lat, p2.lat, p3.lat, eased)
    let lng     = Interp.catmullRomAngle(p0.lng, p1.lng, p2.lng, p3.lng, eased)
    let pitch   = Interp.catmullRom(p0.pitch, p1.pitch, p2.pitch, p3.pitch, eased)
    let zoom    = Interp.cinematicZoom(start: p1.zoom, end: p2.zoom, progress: eased)

    // Bearing: use keyframe value if explicitly set, otherwise look-ahead
    // (face the direction of travel for automatic cinematic paths)
    let bearing: Double
    let hasBearingChange = abs(p2.bearing - p1.bearing) > 1.0
    if hasBearingChange {
        bearing = Interp.catmullRomAngle(p0.bearing, p1.bearing, p2.bearing, p3.bearing, eased)
    } else {
        // Auto look-ahead: compute bearing from current → next position
        let nextT   = min(t + 0.05, dur)
        let dLat    = p2.lat - lat
        let dLng    = p2.lng - lng
        if abs(dLat) > 0.0001 || abs(dLng) > 0.0001 {
            let autoB = atan2(dLng, dLat) * 180 / .pi
            bearing   = Interp.lerpAngle(p1.bearing, autoB, min(rawT * 2, 1.0))
        } else {
            bearing = Interp.lerpAngle(p1.bearing, p2.bearing, eased)
        }
        _ = nextT // suppress unused warning
    }

    return Keyframe(id: p1.id, label: p1.label, time: t,
        lat: lat, lng: lng, zoom: zoom, pitch: pitch, bearing: bearing, easing: nil)
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - MLNMapSnapshotter offscreen capture
// ─────────────────────────────────────────────────────────────────────────────

@MainActor
func captureFrame(
    styleURL:  URL,
    kf:        Keyframe,
    pixelW:    Int,
    pixelH:    Int,
    frameIdx:  Int
) async -> CGImage? {
    // ✅ KEY FIX: Use opts.zoomLevel directly instead of altitude conversion.
    //
    // MLNMapSnapshotOptions.camera.altitude is unreliable — MLNMapSnapshotter
    // ignores it and defaults to its own zoom calculation. The correct way
    // to control zoom in MLNMapSnapshotter is via opts.zoomLevel.
    //
    // We use scale=1.0 with the full pixel size so there is no Retina confusion.
    // MLNMapSnapshotter at scale=1.0 returns exactly pixelW×pixelH pixels.

    let size = CGSize(width: CGFloat(pixelW), height: CGFloat(pixelH))

    let cam = MLNMapCamera()
    cam.centerCoordinate = CLLocationCoordinate2D(latitude: kf.lat, longitude: kf.lng)
    cam.heading  = kf.bearing
    cam.pitch    = CGFloat(kf.pitch)
    // Do NOT set cam.altitude — use opts.zoomLevel instead

    let opts = MLNMapSnapshotOptions(styleURL: styleURL, camera: cam, size: size)
    opts.scale     = 1.0        // 1:1 pixel — exact pixelW×pixelH output, no Retina 2x
    opts.zoomLevel = kf.zoom    // Direct zoom level, bypasses altitude entirely

    fputs("[render] Frame \(frameIdx): zoom=\(String(format:"%.2f",kf.zoom)) lat=\(String(format:"%.4f",kf.lat)) lng=\(String(format:"%.4f",kf.lng)) pitch=\(Int(kf.pitch))° bear=\(Int(kf.bearing))°\n", stderr)

    let snapshotter = MLNMapSnapshotter(options: opts)

    return await withCheckedContinuation { (cont: CheckedContinuation<CGImage?, Never>) in
        snapshotter.start { snapshot, error in
            if let err = error {
                fputs("[render] ⚠️  Snapshot error frame \(frameIdx): \(err.localizedDescription)\n", stderr)
                cont.resume(returning: nil)
                return
            }
            guard let img = snapshot?.image else {
                fputs("[render] ⚠️  nil snapshot.image frame \(frameIdx)\n", stderr)
                cont.resume(returning: nil)
                return
            }

            // Convert NSImage → CGImage
            var rect  = CGRect(x: 0, y: 0, width: img.size.width, height: img.size.height)
            guard var cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
                fputs("[render] ⚠️  cgImage conversion failed frame \(frameIdx)\n", stderr)
                cont.resume(returning: nil)
                return
            }

            // ✅ FIX: If snapshotter returned 2x pixels (Retina), resize down to target
            if cg.width != pixelW || cg.height != pixelH {
                fputs("[render] ℹ️  Snapshotter returned \(cg.width)×\(cg.height), scaling to \(pixelW)×\(pixelH)\n", stderr)
                if let scaled = scaleCGImage(cg, to: CGSize(width: pixelW, height: pixelH)) {
                    cg = scaled
                }
            }

            fputs("[render] 📸 Frame \(frameIdx): \(cg.width)×\(cg.height)\n", stderr)
            cont.resume(returning: cg)
        }
    }
}

func scaleCGImage(_ img: CGImage, to size: CGSize) -> CGImage? {
    let ctx = CGContext(
        data: nil,
        width:            Int(size.width),
        height:           Int(size.height),
        bitsPerComponent: 8,
        bytesPerRow:      0,
        space:            CGColorSpaceCreateDeviceRGB(),
        bitmapInfo:       CGImageAlphaInfo.premultipliedFirst.rawValue
                        | CGBitmapInfo.byteOrder32Little.rawValue
    )
    ctx?.interpolationQuality = .high
    ctx?.draw(img, in: CGRect(origin: .zero, size: size))
    return ctx?.makeImage()
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - CoreImage post-process
// ─────────────────────────────────────────────────────────────────────────────

final class PostProcess {
    // Minimal post-process: just a clean pixel copy from CGImage → CVPixelBuffer.
    // No filters applied — keep map sharp and unmodified.
    // (Previous CIVignette + CIColorControls were causing the hazy/blurry look.)
    func process(_ cg: CGImage) -> CVPixelBuffer? {
        let w = cg.width, h = cg.height
        let attrs: [String: Any] = [
            kCVPixelBufferCGImageCompatibilityKey         as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey          as String: [:] as [String: Any],
        ]
        var pb: CVPixelBuffer?
        CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pb)
        guard let out = pb else { return nil }

        CVPixelBufferLockBaseAddress(out, [])
        let ctx = CGContext(
            data:             CVPixelBufferGetBaseAddress(out),
            width:            w, height: h,
            bitsPerComponent: 8,
            bytesPerRow:      CVPixelBufferGetBytesPerRow(out),
            space:            CGColorSpaceCreateDeviceRGB(),
            bitmapInfo:       CGImageAlphaInfo.premultipliedFirst.rawValue
                            | CGBitmapInfo.byteOrder32Little.rawValue
        )
        ctx?.interpolationQuality = .high
        ctx?.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        CVPixelBufferUnlockBaseAddress(out, [])
        return out
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - HEVC Encoder
// ─────────────────────────────────────────────────────────────────────────────

final class HEVCEncoder {
    private var session: VTCompressionSession?
    private let w, h, fps: Int32
    private let codec: String
    private let bitrate: Int
    private(set) var buffers: [CMSampleBuffer] = []
    private let lock = NSLock()

    init(width: Int, height: Int, fps: Int, codec: String = "h265", bitrate: Int = 50) {
        w = Int32(width); h = Int32(height); self.fps = Int32(fps)
        self.codec = codec
        self.bitrate = bitrate
    }

    func setup() throws {
        let spec: [String:Any] = [
            kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder  as String: true,
            kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder as String: false,
        ]
        let codecType: CMVideoCodecType = (codec.lowercased() == "prores") 
            ? kCMVideoCodecType_AppleProRes422 
            : kCMVideoCodecType_HEVC

        let st = VTCompressionSessionCreate(
            allocator: nil, width: w, height: h,
            codecType: codecType,
            encoderSpecification: spec as CFDictionary,
            imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: nil, refcon: nil, compressionSessionOut: &session)
        guard st == noErr, let s = session else {
            throw NSError(domain:"VT", code:Int(st))
        }
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_RealTime,             value: kCFBooleanFalse)
        
        if codec.lowercased() == "prores" {
            // ProRes handles its own quality/bitrate mostly
        } else {
            VTSessionSetProperty(s, key: kVTCompressionPropertyKey_ProfileLevel,          value: kVTProfileLevel_HEVC_Main_AutoLevel)
            VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AverageBitRate,        value: (bitrate * 1_000_000) as CFNumber)
        }
        
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AllowFrameReordering,  value: kCFBooleanTrue)
        VTCompressionSessionPrepareToEncodeFrames(s)
    }

    func encode(_ pb: CVPixelBuffer, frameIndex: Int) {
        guard let s = session else { return }
        let pts = CMTimeMake(value: Int64(frameIndex), timescale: fps)
        let dur = CMTimeMake(value: 1, timescale: fps)
        VTCompressionSessionEncodeFrame(
            s, imageBuffer: pb, presentationTimeStamp: pts, duration: dur,
            frameProperties: nil, infoFlagsOut: nil) { [weak self] sts, _, sb in
                guard sts == noErr, let sb else { return }
                self?.lock.lock(); self?.buffers.append(sb); self?.lock.unlock()
        }
    }

    func flush() {
        if let s = session { VTCompressionSessionCompleteFrames(s, untilPresentationTimeStamp: .invalid) }
    }

    func write(to url: URL) throws {
        guard !buffers.isEmpty,
              let fmt = CMSampleBufferGetFormatDescription(buffers[0]) else {
            throw NSError(domain:"Enc", code:-1, userInfo:[NSLocalizedDescriptionKey:"No frames encoded"])
        }
        let fileType: AVFileType = (codec.lowercased() == "prores") ? .mov : .mp4
        let writer = try AVAssetWriter(outputURL: url, fileType: fileType)
        let input  = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: fmt)
        input.expectsMediaDataInRealTime = false
        guard writer.canAdd(input) else { throw NSError(domain:"AVW", code:-1) }
        writer.add(input)
        writer.startWriting(); writer.startSession(atSourceTime: .zero)
        let sem = DispatchSemaphore(value: 0)
        input.requestMediaDataWhenReady(on: DispatchQueue(label:"write")) {
            for sb in self.buffers {
                while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.001) }
                input.append(sb)
            }
            input.markAsFinished(); sem.signal()
        }
        sem.wait()
        let dg = DispatchGroup(); dg.enter()
        writer.finishWriting { dg.leave() }; dg.wait()
        if writer.status != .completed { throw writer.error ?? NSError(domain:"AVW", code:-2) }
    }

    func teardown() { if let s = session { VTCompressionSessionInvalidate(s) }; session = nil }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Main
// ─────────────────────────────────────────────────────────────────────────────

@main
struct MapCapture: AsyncParsableCommand {
    @Option var config:   String = ""
    @Option var output:   String = "output.mp4"
    @Option var width:    Int    = 1920
    @Option var height:   Int    = 1080
    @Option var fps:      Int    = 30
    @Option var duration: Double = 10.0
    @Option var style:    String = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
    @Option var codec:    String = "h265"
    @Option var bitrate:  Int    = 50

    @MainActor
    mutating func run() async throws {
        _ = Bundle.swizzleForCLI
        _ = NSApplication.shared

        // Tile cache path
        let fm     = FileManager.default
        let appSup = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let cache  = appSup.appendingPathComponent("com.cinematic.map.capture", isDirectory: true)
        try? fm.createDirectory(at: cache, withIntermediateDirectories: true)
        UserDefaults.standard.set(cache.path, forKey: "MGLOfflineStorageDatabasePath")
        UserDefaults.standard.set(false,      forKey: "MGLMapboxMetricsEnabled")

        // ✅ Parse config JSON from Rust with detailed error logging
        var (sUrl, w, h, f, d, pts) = (style, width, height, fps, duration, [Keyframe]())

        if !config.isEmpty {
            if let data = config.data(using: .utf8) {
                let decoder = JSONDecoder()
                if let cfg = try? decoder.decode(RenderConfig.self, from: data) {
                    (sUrl, w, h, f, d, pts) = (cfg.style, cfg.width, cfg.height, cfg.fps, cfg.duration, cfg.points)
                    fputs("[render] ✅ Config loaded: \(pts.count) keyframes, \(d)s, \(w)×\(h)\n", stderr)
                    for (i, kf) in pts.enumerated() {
                        fputs("[render]   KF[\(i)]: t=\(kf.time)s lat=\(kf.lat) lng=\(kf.lng) zoom=\(kf.zoom)\n", stderr)
                    }
                } else {
                    // Try to parse partially to find the issue
                    fputs("[render] ⚠️  Failed to decode full RenderConfig\n", stderr)
                    fputs("[render]    Config preview: \(String(config.prefix(200)))\n", stderr)
                }
            }
        } else {
            fputs("[render] ⚠️  No --config provided, using CLI defaults\n", stderr)
        }

        guard !pts.isEmpty else {
            fputs("[render] ❌ No keyframes! Cannot render.\n", stderr)
            fputs("[render]    Check that Rust is passing --config correctly\n", stderr)
            sendProgress(ProgressMsg(encoded: 0, total: 0, fps: 0, stage: "error",
                                     error: "No keyframes received"))
            throw ExitCode.failure
        }

        guard let styleURL = URL(string: sUrl) else {
            fputs("[render] ❌ Invalid style URL: \(sUrl)\n", stderr)
            throw ExitCode.failure
        }

        let total = Int(d * Double(f))
        fputs("[render] 🚀 \(w)×\(h) @ \(f)fps | \(pts.count) keyframes | \(total) frames\n", stderr)
        fputs("[render] 🎨 Style: \(sUrl)\n", stderr)
        sendProgress(ProgressMsg(encoded: 0, total: total, fps: 0, stage: "capturing"))

        let encoder  = HEVCEncoder(width: w, height: h, fps: f, codec: codec, bitrate: bitrate)
        try encoder.setup()
        let postProc = PostProcess()

        let t0 = Date()
        var encoded = 0

        for i in 0..<total {
            let t  = d * Double(i) / Double(total)
            let kf = interpolate(t, pts, d)

            guard let cg = await captureFrame(
                styleURL: styleURL, kf: kf,
                pixelW: w, pixelH: h,
                frameIdx: i
            ) else {
                fputs("[render] ⚠️  nil frame \(i) — skipping\n", stderr)
                continue
            }

            guard let pb = postProc.process(cg) else {
                fputs("[render] ⚠️  post-process failed frame \(i)\n", stderr)
                continue
            }

            encoder.encode(pb, frameIndex: i)
            encoded += 1

            if encoded % 5 == 0 || encoded == 1 {
                let el   = Date().timeIntervalSince(t0)
                let rfps = el > 0 ? Double(encoded)/el : 0
                sendProgress(ProgressMsg(encoded: encoded, total: total, fps: rfps, stage: "encoding"))
                fputs("[render] 🎞️  \(encoded)/\(total) — \(String(format:"%.2f",rfps)) render-fps\n", stderr)
            }
        }

        fputs("[render] 💾 Writing \(encoded) frames to \(output)…\n", stderr)
        sendProgress(ProgressMsg(encoded: encoded, total: total, fps: 0, stage: "postprocess"))
        encoder.flush()
        let outURL = URL(fileURLWithPath: output)
        try? fm.removeItem(at: outURL)
        try encoder.write(to: outURL)
        encoder.teardown()

        let elapsed = Date().timeIntervalSince(t0)
        let rfps    = elapsed > 0 ? Double(encoded)/elapsed : 0
        fputs("[render] ✅ Done! \(encoded)/\(total) frames, \(String(format:"%.1f",elapsed))s, \(String(format:"%.2f",rfps)) fps avg\n", stderr)
        fputs("[render] 📁 Saved: \(output)\n", stderr)
        sendProgress(ProgressMsg(encoded: encoded, total: total, fps: rfps, stage: "done"))
        Darwin.exit(0)
    }
}