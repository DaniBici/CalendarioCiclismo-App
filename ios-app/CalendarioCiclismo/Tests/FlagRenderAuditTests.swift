import XCTest
import UIKit

/// Harness de auditoría del renderizado de banderas (CoreSVG del asset catalog).
///
/// NO corre en CI: solo se activa si existe `/tmp/flag-audit/names.json` (lo
/// escribe `scripts/flags/audit-ios-flags.sh` antes de lanzar la suite). Vuelca
/// cada `Flags/<code>` renderizada por el motor SVG real de iOS a
/// `/tmp/flag-audit/ios/<code>.png`, para hacer pixel-diff contra el render
/// canónico (cairosvg sobre flag-icons 7.2.3, que es lo que ven web/Android).
final class FlagRenderAuditTests: XCTestCase {

    func testDumpFlagRenders() throws {
        let namesURL = URL(fileURLWithPath: "/tmp/flag-audit/names.json")
        guard let data = try? Data(contentsOf: namesURL) else {
            throw XCTSkip("Harness manual: falta /tmp/flag-audit/names.json")
        }
        let names = try JSONDecoder().decode([String].self, from: data)
        XCTAssertFalse(names.isEmpty)

        let outDir = URL(fileURLWithPath: "/tmp/flag-audit/ios", isDirectory: true)
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

        // 480×360 px reales (escala 1): proporción 4:3 del set, resolución de
        // sobra para cazar errores de geometría sin depender del scale factor.
        let size = CGSize(width: 480, height: 360)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false

        var missing: [String] = []
        for code in names {
            guard let image = UIImage(named: "Flags/\(code)") else {
                missing.append(code)
                continue
            }
            let renderer = UIGraphicsImageRenderer(size: size, format: format)
            let png = renderer.pngData { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
            try png.write(to: outDir.appendingPathComponent("\(code).png"))
        }
        XCTAssertEqual(missing, [], "Banderas sin asset en el catálogo: \(missing)")
    }
}
