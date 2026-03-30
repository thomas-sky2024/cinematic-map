/**
 * map-capture — Cinematic Map Swift encoder
 *
 * FIXED bugs from previous version:
 *   ❌ CGWindowListCreateImage   → ✅ WKWebView.takeSnapshot()
 *      (CGWindowListCreateImage needs Screen Recording permission, can't read
 *       WebGL pixels through the sandbox, and causes the red fullscreen window)
 *   ❌ waitForIdle() never called → ✅ called before every snapshot
 *   ❌ ?key= always appended     → ✅ smart URL construction (no double-key)
 *   ❌ Window at (0,0) floating  → ✅ off-screen at negative coords, alpha=1
 *   ❌ 100ms fixed sleep         → ✅ callAsyncJavaScript awaits idle Promise
 */

import Foundation
import ArgumentParser
import CoreImage
import VideoToolbox
import CoreMedia
import CoreVideo
import AVFoundation
import WebKit
import AppKit

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Types
// ─────────────────────────────────────────────────────────────────────────────

struct CameraParams: Codable {
    let frame: Int; let time: Double
    let lat: Double; let lng: Double
    let zoom: Double; let pitch: Double; let bearing: Double
}

struct Progress: Codable {
    let encoded: Int; let total: Int; let fps: Double; let stage: String
    var error: String?
}

func sendProgress(_ p: Progress) {
    if let data = try? JSONEncoder().encode(p), let str = String(data: data, encoding: .utf8) {
        fputs(str + "\n", stderr)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Style URL helper
// ─────────────────────────────────────────────────────────────────────────────

func resolveStyleURL(_ styleURL: String, token: String) -> String {
    // CARTO and other free styles don't need a token — don't append key=
    let needsToken = styleURL.contains("maptiler.com") || styleURL.contains("mapbox.com")

    guard needsToken, !token.isEmpty else { return styleURL }

    // Already has key= → don't add again
    if styleURL.contains("key=") { return styleURL }

    let sep = styleURL.contains("?") ? "&" : "?"
    return "\(styleURL)\(sep)key=\(token)"
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Post-process (CoreImage + Metal)
// ─────────────────────────────────────────────────────────────────────────────

final class MetalPostProcess {
    private let context: CIContext = {
        if let dev = MTLCreateSystemDefaultDevice() {
            return CIContext(mtlDevice: dev, options: [.workingColorSpace: NSNull()])
        }
        return CIContext()
    }()

    func process(cgImage: CGImage) -> CVPixelBuffer? {
        var img = CIImage(cgImage: cgImage)

        img = img.applyingFilter("CIVignette",        parameters: [kCIInputIntensityKey: 0.5,  kCIInputRadiusKey: 1.0])
        img = img.applyingFilter("CIColorControls",   parameters: [kCIInputSaturationKey: 1.1, kCIInputBrightnessKey: -0.02, kCIInputContrastKey: 1.04])
        img = img.applyingFilter("CITemperatureAndTint", parameters: ["inputNeutral": CIVector(x:6500,y:0), "inputTargetNeutral": CIVector(x:5700,y:0)])

        let attrs: [String: Any] = [
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
        ]
        var pb: CVPixelBuffer?
        CVPixelBufferCreate(nil, cgImage.width, cgImage.height, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pb)
        guard let out = pb else { return nil }
        context.render(img, to: out)
        return out
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - HEVC encoder
// ─────────────────────────────────────────────────────────────────────────────

final class HEVCEncoder {
    private var session: VTCompressionSession?
    private let width: Int32; private let height: Int32; private let fps: Int
    private(set) var sampleBuffers: [CMSampleBuffer] = []
    private let lock = NSLock()

    init(width: Int, height: Int, fps: Int) {
        self.width = Int32(width); self.height = Int32(height); self.fps = fps
    }

    func setup() throws {
        let spec: [String: Any] = [
            kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder as String: true,
            kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder as String: false,
        ]
        let st = VTCompressionSessionCreate(allocator: nil, width: width, height: height,
            codecType: kCMVideoCodecType_HEVC, encoderSpecification: spec as CFDictionary,
            imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: nil, refcon: nil, compressionSessionOut: &session)
        guard st == noErr, let s = session else { throw EncErr.setup(st) }

        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_RealTime,               value: kCFBooleanFalse)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_ProfileLevel,            value: kVTProfileLevel_HEVC_Main_AutoLevel)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AverageBitRate,          value: (width > 2000 ? 40_000_000 : 12_000_000) as CFTypeRef)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AllowFrameReordering,    value: kCFBooleanTrue)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_MaxKeyFrameInterval,     value: fps * 2 as CFTypeRef)
        VTCompressionSessionPrepareToEncodeFrames(s)
    }

    func encodeFrame(_ pb: CVPixelBuffer, frameIndex: Int) {
        guard let s = session else { return }
        let pts = CMTimeMake(value: Int64(frameIndex), timescale: Int32(fps))
        let dur = CMTimeMake(value: 1, timescale: Int32(fps))
        var fl = VTEncodeInfoFlags()
        VTCompressionSessionEncodeFrame(s, imageBuffer: pb,
            presentationTimeStamp: pts, duration: dur,
            frameProperties: nil, infoFlagsOut: &fl) { [weak self] sts, _, sb in
                guard sts == noErr, let sb else { return }
                self?.lock.lock(); self?.sampleBuffers.append(sb); self?.lock.unlock()
        }
    }

    func flush() { if let s = session { VTCompressionSessionCompleteFrames(s, untilPresentationTimeStamp: .invalid) } }

    func writeToFile(_ url: URL) throws {
        guard let first = sampleBuffers.first,
              let fmt   = CMSampleBufferGetFormatDescription(first) else {
            throw EncErr.write("No frames encoded")
        }
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input  = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: fmt)
        input.expectsMediaDataInRealTime = false
        guard writer.canAdd(input) else { throw EncErr.write("Cannot add input") }
        writer.add(input)
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)

        let sem = DispatchSemaphore(value: 0)
        input.requestMediaDataWhenReady(on: DispatchQueue(label: "hevc.write")) {
            for sb in self.sampleBuffers {
                while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.001) }
                input.append(sb)
            }
            input.markAsFinished(); sem.signal()
        }
        sem.wait()

        let dg = DispatchGroup(); dg.enter()
        writer.finishWriting { dg.leave() }; dg.wait()

        if writer.status != .completed {
            throw writer.error ?? EncErr.write("AVAssetWriter status \(writer.status.rawValue)")
        }
    }

    func teardown() { if let s = session { VTCompressionSessionInvalidate(s) }; session = nil }
}

enum EncErr: LocalizedError {
    case setup(OSStatus), write(String)
    var errorDescription: String? {
        switch self { case .setup(let s): return "VT setup failed: \(s)"; case .write(let m): return m }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - WKWebView capture (takeSnapshot — NOT CGWindowListCreateImage)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ONLY correct way to capture WebGL (MapLibre) content from WKWebView:
 *   WKWebView.takeSnapshot(with:completionHandler:)
 *
 * Why NOT CGWindowListCreateImage:
 *   - Requires Screen Recording entitlement / user permission
 *   - macOS security sandbox blocks reading WebGL pixel data via screen capture
 *   - Forces the window to be VISIBLE on screen (causing the red/black fullscreen)
 *   - Does not work headlessly
 *
 * Why NOT evaluateJavaScript for waiting idle:
 *   - Its callback fires when the Promise OBJECT is created, not when it resolves
 *   - Use callAsyncJavaScript instead — it properly awaits Promise resolution
 */
@MainActor
final class MapWebCapture: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    private let webView: WKWebView
    private let width, height: Int
    private var mapLoaded = false
    private var loadCont: CheckedContinuation<Void, Never>?

    init(width: Int, height: Int, styleURL: String, mapToken: String) {
        _ = NSApplication.shared
        self.width = width; self.height = height

        let config = WKWebViewConfiguration()
        let prefs  = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        // Message handlers: mapLoaded (load signal) + mapConsole (JS log forwarding)
        let handler = MessageProxy()
        config.userContentController.add(handler, name: "mapLoaded")
        config.userContentController.add(handler, name: "mapConsole")

        let frame  = CGRect(x: 0, y: 0, width: width, height: height)
        let web    = WKWebView(frame: frame, configuration: config)
        self.webView = web

        super.init()

        handler.target = self
        web.navigationDelegate = self

        // ✅ Off-screen window at NEGATIVE coordinates.
        //    - alpha = 1.0 (required for WebGL GPU context to stay active)
        //    - .borderless + NO level override → stays behind everything
        //    - NOT makeKeyAndOrderFront — that steals focus AND puts it on screen
        //    - orderBack(nil) ensures it's in the WindowServer compositor tree
        //      (necessary for WKWebView to render) without being visible
        let win = NSWindow(
            contentRect: CGRect(x: -(width + 100), y: -(height + 100),
                                width: width, height: height),
            styleMask: .borderless, backing: .buffered, defer: false
        )
        win.contentView    = web
        win.backgroundColor = .black
        win.isOpaque       = true
        win.alphaValue     = 1.0
        win.orderBack(nil)   // ← in compositor tree but NOT visible to user

        // Build HTML with the corrected style URL
        let resolvedStyle = resolveStyleURL(styleURL, token: mapToken)
        fputs("[swift-encoder] Style URL: \(resolvedStyle)\n", stderr)
        web.loadHTMLString(buildMapHTML(style: resolvedStyle, width: width, height: height),
                           baseURL: nil)
    }

    // ── WKScriptMessageHandler ────────────────────────────────────────────────
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "mapConsole":
            if let s = message.body as? String { fputs("[js] \(s)\n", stderr) }
        case "mapLoaded":
            fputs("[swift-encoder] ✅ MapLibre 'load' received\n", stderr)
            // Extra settle time: allow initial tiles to rasterise after load fires
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_200_000_000) // 1.2s
                self.mapLoaded = true
                self.loadCont?.resume(); self.loadCont = nil
            }
        default: break
        }
    }

    // ── Navigation delegate fallbacks ─────────────────────────────────────────
    nonisolated func webView(_ wv: WKWebView, didFinish _: WKNavigation!) {
        fputs("[swift-encoder] HTML loaded (waiting for MapLibre load event)\n", stderr)
    }
    nonisolated func webView(_ wv: WKWebView, didFail _: WKNavigation!, withError e: Error) {
        fputs("[swift-encoder] ⚠️ Navigation failed: \(e)\n", stderr)
        Task { @MainActor in self.mapLoaded = true; self.loadCont?.resume(); self.loadCont = nil }
    }
    nonisolated func webView(_ wv: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError e: Error) {
        fputs("[swift-encoder] ⚠️ Provisional nav failed: \(e)\n", stderr)
        Task { @MainActor in self.mapLoaded = true; self.loadCont?.resume(); self.loadCont = nil }
    }

    // ── Wait for MapLibre 'load' ──────────────────────────────────────────────
    func waitForLoad() async {
        guard !mapLoaded else { return }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            self.loadCont = c
        }
    }

    // ── Capture one frame via WKWebView.takeSnapshot ──────────────────────────
    func captureFrame(camera: CameraParams) async -> CGImage? {
        guard mapLoaded else { return nil }

        // 1. Jump camera
        let jumpJS = """
        if (window.__map) {
            window.__map.jumpTo({
                center:  [\(camera.lng), \(camera.lat)],
                zoom:    \(camera.zoom),
                pitch:   \(camera.pitch),
                bearing: \(camera.bearing)
            });
        }
        """
        // jumpTo is synchronous JS — evaluateJavaScript is sufficient
        webView.evaluateJavaScript(jumpJS, completionHandler: nil)

        // 2. ✅ Wait for idle — callAsyncJavaScript ACTUALLY awaits Promise.resolve()
        //    (evaluateJavaScript fires callback when Promise *object* is created → wrong)
        let idleJS = """
        return new Promise(function(resolve) {
            if (!window.__map) { resolve('no_map'); return; }
            if (!window.__map.loaded()) { resolve('not_loaded'); return; }
            if (window.__map.areTilesLoaded()) { resolve('ready'); return; }
            window.__map.once('idle', function() { resolve('idle'); });
            setTimeout(function() { resolve('timeout'); }, 4000);
        });
        """
        let idleResult: Any? = try? await webView.callAsyncJavaScript(idleJS, arguments: [:], in: nil, in: .page)
        let idleStr = idleResult.map { "\($0)" } ?? "nil"
        fputs("[swift-encoder] idle: \(idleStr)\n", stderr)

        // 3. GPU flush buffer — Metal needs time to composite WebGL → bitmap
        try? await Task.sleep(nanoseconds: 150_000_000) // 150ms

        // 4. ✅ WKWebView.takeSnapshot — the correct API for WebGL pixel readback
        //    Does NOT need Screen Recording permission.
        //    Works off-screen with the window in the compositor tree.
        let snapCfg = WKSnapshotConfiguration()
        snapCfg.rect         = CGRect(x: 0, y: 0, width: width, height: height)
        snapCfg.snapshotWidth = NSNumber(value: width)

        return await withCheckedContinuation { cont in
            webView.takeSnapshot(with: snapCfg) { image, error in
                if let err = error { fputs("[swift-encoder] snapshot error: \(err)\n", stderr) }
                let cg = image?.cgImage(forProposedRect: nil, context: nil, hints: nil)
                if cg == nil { fputs("[swift-encoder] ⚠️ nil CGImage from snapshot\n", stderr) }
                cont.resume(returning: cg)
            }
        }
    }
}

// ── Weak proxy to avoid WKUserContentController retain cycle ─────────────────
class MessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(u, didReceive: m)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - HTML template
// ─────────────────────────────────────────────────────────────────────────────

func buildMapHTML(style: String, width: Int, height: Int) -> String {
    return """
    <!DOCTYPE html>
    <html><head>
    <meta charset="utf-8"/>
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.0/dist/maplibre-gl.css"/>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      html, body, #map { width:\(width)px; height:\(height)px; overflow:hidden; background:#000; }
    </style>
    </head>
    <body><div id="map"></div>
    <script src="https://unpkg.com/maplibre-gl@4.7.0/dist/maplibre-gl.js"></script>
    <script>
    // Forward console to Swift for debugging
    ['log','warn','error'].forEach(function(m) {
        var orig = console[m];
        console[m] = function() {
            var msg = Array.prototype.slice.call(arguments).join(' ');
            orig.apply(console, arguments);
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mapConsole)
                window.webkit.messageHandlers.mapConsole.postMessage('[' + m.toUpperCase() + '] ' + msg);
        };
    });

    try {
        window.__map = new maplibregl.Map({
            container:            'map',
            style:                '\(style)',
            center:               [108.05, 12.66],
            zoom:                 5,
            antialias:            true,
            fadeDuration:         0,
            interactive:          false,
            attributionControl:   false,
            renderWorldCopies:    false,
            preserveDrawingBuffer: true,   // required for WebGL pixel readback via snapshot
        });

        window.__map.on('load', function() {
            console.log('MapLibre load fired');
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mapLoaded)
                window.webkit.messageHandlers.mapLoaded.postMessage('loaded');
        });

        window.__map.on('error', function(e) {
            console.error('Map error: ' + (e.error ? e.error.message : JSON.stringify(e)));
        });
    } catch(e) {
        console.error('MapLibre init crash: ' + e.message);
    }
    </script>
    </body></html>
    """
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Main CLI
// ─────────────────────────────────────────────────────────────────────────────

@main
struct MapCapture: AsyncParsableCommand {
    @Option(name: .long) var output:     String = "/tmp/cinematic-output.mp4"
    @Option(name: .long) var fps:        Int    = 30
    @Option(name: .long) var resolution: String = "1080p"
    @Option(name: .long) var styleUrl:   String = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
    @Option(name: .long) var mapToken:   String = ""

    mutating func run() async throws {
        let (width, height) = resolution == "4K" ? (3840, 2160) : (1920, 1080)
        fputs("[swift-encoder] Starting \(width)×\(height) @ \(fps)fps\n", stderr)

        // Read camera params from stdin
        var cameras: [CameraParams] = []
        if let raw = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) {
            for line in raw.components(separatedBy: .newlines) where !line.isEmpty {
                if let d = line.data(using: .utf8), let c = try? JSONDecoder().decode(CameraParams.self, from: d) {
                    cameras.append(c)
                }
            }
        }
        let total = cameras.count
        fputs("[swift-encoder] \(total) frames received\n", stderr)
        guard total > 0 else {
            fputs("[swift-encoder] No frames — exiting\n", stderr)
            return
        }

        sendProgress(Progress(encoded: 0, total: total, fps: 0, stage: "capturing"))

        let encoder  = HEVCEncoder(width: width, height: height, fps: fps)
        try encoder.setup()
        let postProc = MetalPostProcess()

        // Init WKWebView (must run on MainActor)
        let capturer = await MapWebCapture(width: width, height: height,
                                           styleURL: styleUrl, mapToken: mapToken)

        fputs("[swift-encoder] Waiting for MapLibre load…\n", stderr)

        // Load timeout: 20s max
        await withTaskGroup(of: Void.self) { g in
            g.addTask { await capturer.waitForLoad() }
            g.addTask {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                fputs("[swift-encoder] ⚠️ Load timeout — proceeding anyway\n", stderr)
            }
            await g.next(); g.cancelAll()
        }

        fputs("[swift-encoder] Capturing frames…\n", stderr)

        let t0 = Date()
        var encoded = 0

        for (i, cam) in cameras.enumerated() {
            guard let cg = await capturer.captureFrame(camera: cam) else {
                fputs("[swift-encoder] ⚠️ nil snapshot frame \(i)\n", stderr)
                continue
            }
            guard let pb = postProc.process(cgImage: cg) else {
                fputs("[swift-encoder] ⚠️ post-process failed frame \(i)\n", stderr)
                continue
            }
            encoder.encodeFrame(pb, frameIndex: i)
            encoded += 1

            if encoded % 10 == 0 {
                let elapsed = Date().timeIntervalSince(t0)
                sendProgress(Progress(encoded: encoded, total: total,
                                      fps: elapsed > 0 ? Double(encoded)/elapsed : 0,
                                      stage: "encoding"))
            }
        }

        sendProgress(Progress(encoded: encoded, total: total, fps: 0, stage: "postprocess"))
        encoder.flush()

        let url = URL(fileURLWithPath: output)
        try? FileManager.default.removeItem(at: url)
        try encoder.writeToFile(url)
        encoder.teardown()

        let elapsed = Date().timeIntervalSince(t0)
        fputs("[swift-encoder] ✅ Done. \(encoded)/\(total) frames in \(String(format:"%.1f",elapsed))s\n", stderr)
        sendProgress(Progress(encoded: encoded, total: total,
                              fps: elapsed > 0 ? Double(encoded)/elapsed : 0, stage: "done"))
    }
}