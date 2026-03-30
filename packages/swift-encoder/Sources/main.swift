/**
 * swift-encoder-render — Unified MapLibre Native Renderer & HEVC Encoder
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

// MARK: - MapLibre CLI Compatibility Swizzles

extension Bundle {
    static let swizzleForCLI: Void = {
        let idOriginal = class_getInstanceMethod(Bundle.self, #selector(getter: Bundle.bundleIdentifier))
        let idSwizzled = class_getInstanceMethod(Bundle.self, #selector(getter: Bundle.mock_bundleIdentifier))
        if let id1 = idOriginal, let id2 = idSwizzled { 
             method_exchangeImplementations(id1, id2) 
        }
        
        let fwOriginal = class_getClassMethod(Bundle.self, NSSelectorFromString("mgl_frameworkBundle"))
        let fwSwizzled = class_getClassMethod(Bundle.self, #selector(Bundle.mock_frameworkBundle))
        if let fw1 = fwOriginal, let fw2 = fwSwizzled { 
            method_exchangeImplementations(fw1, fw2) 
        }
    }()
    @objc var mock_bundleIdentifier: String? { self == Bundle.main ? "com.cinematic.map.capture" : self.mock_bundleIdentifier }
    @objc static func mock_frameworkBundle() -> Bundle {
        let exeDir = Bundle.main.bundleURL.deletingLastPathComponent(); if let b = Bundle(url: exeDir.appendingPathComponent("MapLibre.framework")) { return b }
        for b in Bundle.allFrameworks { if b.bundleIdentifier?.contains("maplibre") == true || b.bundleIdentifier?.contains("mapbox") == true { return b } }
        return Bundle.main
    }
}

// MARK: - Models (Aligned with Rust)

struct Progress: Codable {
    let encoded: Int; let total: Int; let fps: Double; let stage: String
}

struct Keyframe: Codable {
    let id: String; let label: String
    let time, lat, lng, zoom, pitch, bearing: Double
}

struct RenderConfig: Codable {
    let style: String; let points: [Keyframe]
    let duration: Double; let fps, width, height: Int
}

func sendProgress(_ p: Progress) {
    if let data = try? JSONEncoder().encode(p), let str = String(data: data, encoding: .utf8) { 
        fputs(str + "\n", stderr) 
        fflush(stderr)
    }
}

// MARK: - Math

struct Interpolator {
    static func easeInOutCubic(_ t: Double) -> Double { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }
    static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }
    static func lerpAngle(_ a: Double, _ b: Double, _ t: Double) -> Double {
        var d = b - a; while d < -180 { d += 360 }; while d > 180 { d -= 360 }; return a + d * t
    }
    static func arcZoom(start: Double, end: Double, progress: Double, arcFactor: Double = 0.3) -> Double {
        let base = lerp(start, end, progress)
        let dip = 4 * progress * (1 - progress) * abs(end - start) * arcFactor
        return base - dip
    }
}

// MARK: - Encoder logic

final class HEVCEncoder {
    private var session: VTCompressionSession?
    private let width, height, fps: Int32; private(set) var sampleBuffers: [CMSampleBuffer] = []; private let lock = NSLock()
    init(width: Int, height: Int, fps: Int) { self.width = Int32(width); self.height = Int32(height); self.fps = Int32(fps) }
    func setup() throws {
        let st = VTCompressionSessionCreate(allocator: nil, width: width, height: height, codecType: kCMVideoCodecType_HEVC, encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil, outputCallback: nil, refcon: nil, compressionSessionOut: &session)
        guard st == noErr, let s = session else { throw NSError(domain: "VT", code: Int(st)) }
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanFalse)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AverageBitRate, value: 50_000_000 as CFNumber) // High quality
        VTCompressionSessionPrepareToEncodeFrames(s)
    }
    func encodeFrame(_ pb: CVPixelBuffer, frameIndex: Int) {
        guard let s = session else { return }
        let pts = CMTimeMake(value: Int64(frameIndex), timescale: fps)
        VTCompressionSessionEncodeFrame(s, imageBuffer: pb, presentationTimeStamp: pts, duration: CMTimeMake(value: 1, timescale: fps), frameProperties: nil, infoFlagsOut: nil) { [weak self] sts, _, sb in
            guard sts == noErr, let sb else { return }
            self?.lock.lock(); self?.sampleBuffers.append(sb); self?.lock.unlock()
        }
    }
    func flush() { if let s = session { VTCompressionSessionCompleteFrames(s, untilPresentationTimeStamp: .invalid) } }
    func writeToFile(_ url: URL) throws {
        if sampleBuffers.isEmpty { throw NSError(domain: "AVWriter", code: -1, userInfo: [NSLocalizedDescriptionKey: "No frames captured"]) }
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: CMSampleBufferGetFormatDescription(sampleBuffers[0]))
        writer.add(input); writer.startWriting(); writer.startSession(atSourceTime: .zero)
        for sb in sampleBuffers {
            while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.01) }
            input.append(sb)
        }
        input.markAsFinished()
        let sem = DispatchSemaphore(value: 0)
        writer.finishWriting { sem.signal() }
        sem.wait()
    }
}

// MARK: - Renderer logic

@MainActor
class MapRenderer: NSObject, MLNMapViewDelegate {
    let mglView: MLNMapView; let window: NSWindow; private var mapLoaded = false
    init(width: Int, height: Int) {
        let f = NSRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height))
        window = NSWindow(contentRect: f, styleMask: .borderless, backing: .buffered, defer: false)
        mglView = MLNMapView(frame: f); window.contentView = mglView; super.init(); mglView.delegate = self
        mglView.wantsLayer = true
        window.isReleasedWhenClosed = false; window.orderFrontRegardless()
    }
    func loadStyle(_ url: URL) async {
        fputs("[swift-render] 📡 Loading style and tiles...\n", stderr)
        mglView.styleURL = url; let start = Date()
        while !mapLoaded { 
            if Date().timeIntervalSince(start) > 90 { 
                fputs("[swift-render] ⚠️ Timeout loading map tiles (90s). Proceeding anyway...\n", stderr)
                break 
            }
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 1.0)) 
            fputs("[swift-render] ... (waiting for tiles)\n", stderr)
            fflush(stderr)
        }
        if mapLoaded { fputs("[swift-render] ✅ Map and tiles loaded\n", stderr) }
    }
    func mapViewDidFinishLoadingMap(_ mapView: MLNMapView) { mapLoaded = true }
    func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
        fputs("[swift-render] ❌ Map load failed: \(error.localizedDescription)\n", stderr)
    }

    private func zoomToAltitude(_ zoom: Double, latitude: Double) -> Double {
        return 40000000.0 / pow(2, zoom)
    }

    func updateCamera(lat: Double, lng: Double, zoom: Double, pitch: Double, bearing: Double) {
        let cam = MLNMapCamera()
        cam.centerCoordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        cam.altitude = zoomToAltitude(zoom, latitude: lat)
        cam.heading = bearing
        cam.pitch = CGFloat(pitch)
        mglView.setCamera(cam, animated: false)
    }
    func renderFrame() -> CVPixelBuffer? {
        // Force display and pump the loop multiple times to ensure Metal draw is complete
        mglView.display(); RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))
        mglView.display(); RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))
        
        guard let b = mglView.bitmapImageRepForCachingDisplay(in: mglView.bounds) else { return nil }
        mglView.cacheDisplay(in: mglView.bounds, to: b)
        
        var pb: CVPixelBuffer?
        CVPixelBufferCreate(nil, Int(b.pixelsWide), Int(b.pixelsHigh), kCVPixelFormatType_32BGRA, nil, &pb)
        if let pb = pb {
            CVPixelBufferLockBaseAddress(pb, []); let dest = CVPixelBufferGetBaseAddress(pb)
            let context = CGContext(data: dest, width: Int(b.pixelsWide), height: Int(b.pixelsHigh), bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pb), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
            if let cg = b.cgImage { context?.draw(cg, in: CGRect(x: 0, y: 0, width: b.size.width, height: b.size.height)) }
            CVPixelBufferUnlockBaseAddress(pb, [])
        }
        return pb
    }
}

// MARK: - Entry point

@main
struct MapCapture: AsyncParsableCommand {
    @Option var config: String = ""; @Option var output: String = "output.mp4"
    @Option var width: Int = 1920; @Option var height: Int = 1080; @Option var fps: Int = 30
    @Option var duration: Double = 10.0; @Option var style: String = "https://demotiles.maplibre.org/style.json"

    @MainActor
    func run() async throws {
        _ = Bundle.swizzleForCLI; _ = NSApplication.shared
        
        let fm = FileManager.default
        let appSup = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dbPath = appSup.appendingPathComponent("com.cinematic.map.capture", isDirectory: true)
        try? fm.createDirectory(atPath: dbPath.path, withIntermediateDirectories: true)
        
        UserDefaults.standard.set(dbPath.path, forKey: "MGLOfflineStorageDatabasePath")
        UserDefaults.standard.set(false, forKey: "MGLMapboxMetricsEnabled")

        var (sUrl, w, h, f, d, pts) = (style, width, height, fps, duration, [Keyframe]())
        if let data = config.data(using: .utf8), let cfg = try? JSONDecoder().decode(RenderConfig.self, from: data) {
            (sUrl, w, h, f, d, pts) = (cfg.style, cfg.width, cfg.height, cfg.fps, cfg.duration, cfg.points)
        }
        
        fputs("[swift-render] 🌍 Starting native render \(w)x\(h) @ \(f)fps\n", stderr)
        let enc = HEVCEncoder(width: w, height: h, fps: f); try enc.setup()
        let ren = MapRenderer(width: w, height: h)
        await ren.loadStyle(URL(string: sUrl)!)
        
        let total = Int(d * Double(f)); let t0 = Date()
        fputs("[swift-render] 🎞️ Beginning frame-by-frame capture (\(total) frames)\n", stderr)
        
        for i in 0..<total {
            let t = (Double(i) / Double(total)) * d
            let k = interpolate(t, pts, d)
            ren.updateCamera(lat: k.lat, lng: k.lng, zoom: k.zoom, pitch: k.pitch, bearing: k.bearing)
            if let pb = ren.renderFrame() { 
                enc.encodeFrame(pb, frameIndex: i) 
            }
            sendProgress(Progress(encoded: i + 1, total: total, fps: Double(i + 1)/Date().timeIntervalSince(t0), stage: "rendering"))
        }
        
        fputs("[swift-render] 💾 Flushing...\n", stderr)
        enc.flush()
        try? fm.removeItem(at: URL(fileURLWithPath: output))
        try enc.writeToFile(URL(fileURLWithPath: output))
        fputs("[swift-render] ✅ Video saved: \(output)\n", stderr)
        Darwin.exit(0)
    }

    private func interpolate(_ t: Double, _ pts: [Keyframe], _ d: Double) -> Keyframe {
        if pts.isEmpty { return Keyframe(id: "", label: "", time: t, lat: 0, lng: 0, zoom: 0, pitch: 0, bearing: 0) }
        if pts.count == 1 { return pts[0] }
        var p0 = pts[0], p1 = pts.last!
        for j in 0..<pts.count-1 { if t >= pts[j].time && t <= pts[j+1].time { p0 = pts[j]; p1 = pts[j+1]; break } }
        let segDur = max(0.001, p1.time - p0.time)
        let prog = Interpolator.easeInOutCubic((t - p0.time) / segDur)
        return Keyframe(
            id: p0.id, label: p0.label, time: t,
            lat: Interpolator.lerp(p0.lat, p1.lat, prog),
            lng: Interpolator.lerp(p0.lng, p1.lng, prog),
            zoom: Interpolator.arcZoom(start: p0.zoom, end: p1.zoom, progress: prog),
            pitch: Interpolator.lerp(p0.pitch, p1.pitch, prog),
            bearing: Interpolator.lerpAngle(p0.bearing, p1.bearing, prog)
        )
    }
}