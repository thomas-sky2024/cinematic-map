// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "map-capture",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "map-capture", targets: ["map-capture"]),
    ],
    dependencies: [
        .package(
            url: "https://github.com/apple/swift-argument-parser",
            from: "1.3.0"
        ),
        .package(
            url: "https://github.com/fonok3/maplibre-macos-distribution.git",
            from: "6.0.0"
        ),
    ],
    targets: [
        .executableTarget(
            name: "map-capture",
            dependencies: [
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
                .product(name: "MapLibre", package: "maplibre-macos-distribution"),
            ],
            path: "Sources",
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-ObjC"])
            ]
        ),
    ]
)
