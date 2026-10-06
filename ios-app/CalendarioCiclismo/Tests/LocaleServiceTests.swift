import XCTest
@testable import CalendarioCiclismo

@MainActor
final class LocaleServiceTests: XCTestCase {

    /// Estado previo que `setLocale` modifica: `app_locale` y `AppleLanguages`
    /// del dominio de la app, y el idioma publicado por el singleton.
    private var originalLocaleRaw: String?
    private var originalAppleLanguages: [String]?
    private var originalCurrent: LocaleService.AppLocale = .spanish

    override func setUp() async throws {
        try await super.setUp()
        originalLocaleRaw = UserDefaults.standard.string(forKey: "app_locale")
        originalAppleLanguages = Self.appDomainAppleLanguages()
        originalCurrent = LocaleService.shared.current
    }

    override func tearDown() async throws {
        LocaleService.shared.setLocale(originalCurrent)
        let defaults = UserDefaults.standard
        if let raw = originalLocaleRaw {
            defaults.set(raw, forKey: "app_locale")
        } else {
            defaults.removeObject(forKey: "app_locale")
        }
        if let languages = originalAppleLanguages {
            defaults.set(languages, forKey: "AppleLanguages")
        } else {
            defaults.removeObject(forKey: "AppleLanguages")
        }
        try await super.tearDown()
    }

    /// `AppleLanguages` persistido en el dominio de la app, sin el heredado del
    /// dominio global del sistema.
    private static func appDomainAppleLanguages() -> [String]? {
        guard let domain = Bundle.main.bundleIdentifier else { return nil }
        return UserDefaults.standard.persistentDomain(forName: domain)?["AppleLanguages"] as? [String]
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
