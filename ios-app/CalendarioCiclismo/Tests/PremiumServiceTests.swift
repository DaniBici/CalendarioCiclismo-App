import XCTest
@testable import CalendarioCiclismo

@MainActor
final class PremiumServiceTests: XCTestCase {

    override func setUp() async throws {
        try await super.setUp()
        // Resetear estado del singleton al empezar cada test.
        PremiumService.shared.dismissSupport()
        PremiumService.shared._debugSetSubscribed(false)
        PremiumService.shared._debugSetLegacyPremiumActive(false)
    }

    override func tearDown() async throws {
        // Dejar el singleton en estado limpio para no contaminar otros tests.
        PremiumService.shared.dismissSupport()
        PremiumService.shared._debugSetSubscribed(false)
        PremiumService.shared._debugSetLegacyPremiumActive(false)
        try await super.tearDown()
    }

    // MARK: - Funciones gratuitas

    /// Las features liberadas al plan gratuito están SIEMPRE desbloqueadas,
    /// con independencia del estado de suscripción (política de pricing: lo que
    /// ya era gratis sigue gratis). Si esto falla, algún gate volvería a cobrar
    /// por una feature que era gratuita.
    func test_featuresUnlocked_isAlwaysTrue_regardlessOfSubscription() {
        PremiumService.shared._debugSetSubscribed(false)
        XCTAssertTrue(PremiumService.shared.featuresUnlocked)
        PremiumService.shared._debugSetSubscribed(true)
        XCTAssertTrue(PremiumService.shared.featuresUnlocked)
    }

    func test_productIDs_match43StoreContract() {
        XCTAssertEqual(PremiumService.monthlyProductID, "app.calendariociclismo.amigo.mensual")
        XCTAssertEqual(PremiumService.yearlyProductID, "app.calendariociclismo.amigo.anual")
        XCTAssertEqual(Set(PremiumService.contributionProductIDs), [
            "app.calendariociclismo.aportacion.299",
            "app.calendariociclismo.aportacion.599",
            "app.calendariociclismo.aportacion.1199",
        ])
        XCTAssertEqual(Set(PremiumService.legacyProductIDs), [
            "app.calendariociclismo.premium.mensual",
            "app.calendariociclismo.premium.anual",
        ])
    }

    // MARK: - Aviso de apoyo tras el uso

    /// Quien pagó Premium y lo tiene vigente no recibe el aviso de apoyo: la
    /// pantalla de contenido ni siquiera suma al contador de la campaña.
    func test_contributionPrompt_skipsActiveLegacyPremium() {
        let key = "contribution_prompt_v4_2_4_content_views"
        let defaults = UserDefaults.standard
        let saved = defaults.object(forKey: key)
        defer { defaults.set(saved, forKey: key) }
        defaults.set(5, forKey: key)

        PremiumService.shared._debugSetLegacyPremiumActive(true)
        ContributionPromptService.shared.recordContentScreenView("race_detail")
        XCTAssertEqual(defaults.integer(forKey: key), 5)

        PremiumService.shared._debugSetLegacyPremiumActive(false)
        ContributionPromptService.shared.recordContentScreenView("race_detail")
        XCTAssertEqual(defaults.integer(forKey: key), 6)
    }
}
