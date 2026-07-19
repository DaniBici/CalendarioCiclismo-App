import XCTest
@testable import CalendarioCiclismo

@MainActor
final class LocaleServiceTests: XCTestCase {

    /// Backup del valor original para no contaminar otros tests.
    private var originalLocaleRaw: String?

    override func setUp() {
        super.setUp()
        originalLocaleRaw = UserDefaults.standard.string(forKey: "app_locale")
    }

    override func tearDown() {
        if let raw = originalLocaleRaw {
            UserDefaults.standard.set(raw, forKey: "app_locale")
        } else {
            UserDefaults.standard.removeObject(forKey: "app_locale")
        }
        super.tearDown()
    }

    func testRawValuesSonISO639_1() {
        XCTAssertEqual(LocaleService.AppLocale.spanish.rawValue, "es")
        XCTAssertEqual(LocaleService.AppLocale.english.rawValue, "en")
    }

    func testLocaleProducesIdentifierCorrecto() {
        XCTAssertEqual(LocaleService.AppLocale.spanish.locale.identifier, "es")
        XCTAssertEqual(LocaleService.AppLocale.english.locale.identifier, "en")
    }

    func testLabelEnIdiomaNativo() {
        // Los labels se muestran siempre en su idioma original.
        XCTAssertEqual(LocaleService.AppLocale.spanish.label, "Español")
        XCTAssertEqual(LocaleService.AppLocale.english.label, "English")
    }

    func testSetLocalePersisteUserDefaults() {
        let service = LocaleService.shared
        service.setLocale(.english)
        XCTAssertEqual(UserDefaults.standard.string(forKey: "app_locale"), "en")
        XCTAssertEqual(service.current, .english)

        service.setLocale(.spanish)
        XCTAssertEqual(UserDefaults.standard.string(forKey: "app_locale"), "es")
        XCTAssertEqual(service.current, .spanish)
    }

    func testSetLocaleActualizaAppleLanguages() {
        // AppleLanguages es la key que usa UIKit/SwiftUI para resolver el bundle.
        let service = LocaleService.shared
        service.setLocale(.english)
        let langs = UserDefaults.standard.array(forKey: "AppleLanguages") as? [String]
        XCTAssertEqual(langs?.first, "en")
    }
}
