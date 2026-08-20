// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CalendarioCiclismo",
    platforms: [.iOS(.v18)],
    dependencies: [
        .package(url: "https://github.com/supabase/supabase-swift.git", from: "2.0.0"),
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", from: "11.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "CalendarioCiclismo",
            dependencies: [
                .product(name: "Supabase", package: "supabase-swift"),
                .product(name: "FirebaseAnalytics", package: "firebase-ios-sdk"),
            ],
            path: "CalendarioCiclismo",
            exclude: ["Tests"]
        ),
        .testTarget(
            name: "CalendarioCiclismoTests",
            dependencies: ["CalendarioCiclismo"],
            path: "CalendarioCiclismo/Tests"
        ),
    ]
)
