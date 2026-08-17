import XCTest
@testable import CalendarioCiclismo

@MainActor
final class PremiumServiceTests: XCTestCase {

    override func setUp() async throws {
        try await super.setUp()
        // Resetear estado del singleton al empezar cada test.
        PremiumService.shared.dismissPaywall()
        PremiumService.shared._debugSetSubscribed(false)
    }

    override func tearDown() async throws {
        // Dejar el singleton en estado limpio para no contaminar otros tests.
        PremiumService.shared.dismissPaywall()
        PremiumService.shared._debugSetSubscribed(false)
        try await super.tearDown()
    }

    // MARK: - PaywallSource

    func test_paywallSource_allCases_contractoConUI() {
        let expected: Set<String> = [
            "region", "notifications", "raceCards", "raceNotifications", "general",
        ]
        let actual = Set(PremiumService.PaywallSource.allCases.map { $0.rawValue })
        XCTAssertEqual(actual, expected, "Las sources deben coincidir con los CTAs cableados en la app")
    }

    func test_paywallSource_idMatchesRawValue() {
        for source in PremiumService.PaywallSource.allCases {
            XCTAssertEqual(source.id, source.rawValue)
        }
    }

    // MARK: - PremiumPlan

    func test_premiumPlan_hasMonthlyAndYearly() {
        let actual = Set(PremiumService.PremiumPlan.allCases.map { $0.rawValue })
        XCTAssertEqual(actual, ["monthly", "yearly"])
    }

    // MARK: - isSubscribed

    func test_default_isNotSubscribed_afterReset() {
        // setUp ya llamó _debugSetSubscribed(false).
        XCTAssertFalse(PremiumService.shared.isSubscribed)
    }

    func test_debugSetTrue_persistsFlag() {
        PremiumService.shared._debugSetSubscribed(true)
        XCTAssertTrue(PremiumService.shared.isSubscribed)
    }

    func test_debugSetFalse_clearsFlag() {
        PremiumService.shared._debugSetSubscribed(true)
        PremiumService.shared._debugSetSubscribed(false)
        XCTAssertFalse(PremiumService.shared.isSubscribed)
    }

    func test_debugToggle_flipsFlag() {
        let initial = PremiumService.shared.isSubscribed
        PremiumService.shared._debugToggle()
        XCTAssertNotEqual(PremiumService.shared.isSubscribed, initial)
        PremiumService.shared._debugToggle()
        XCTAssertEqual(PremiumService.shared.isSubscribed, initial)
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

    // MARK: - Paywall presentation

    func test_presentPaywall_setsPendingSource() {
        XCTAssertNil(PremiumService.shared.pendingPaywallSource)
        PremiumService.shared.presentPaywall(.region)
        XCTAssertEqual(PremiumService.shared.pendingPaywallSource, .region)
    }

    func test_presentPaywall_overwritesPreviousSource() {
        PremiumService.shared.presentPaywall(.region)
        PremiumService.shared.presentPaywall(.notifications)
        XCTAssertEqual(PremiumService.shared.pendingPaywallSource, .notifications)
    }

    func test_dismissPaywall_clearsPendingSource() {
        PremiumService.shared.presentPaywall(.general)
        PremiumService.shared.dismissPaywall()
        XCTAssertNil(PremiumService.shared.pendingPaywallSource)
    }

    // MARK: - Compra (Debug)

    func test_subscribe_inDebug_activatesFlag() {
        // En Debug, `subscribe(plan:)` activa isSubscribed directamente para
        // permitir probar la UI Premium sin SDK.
        XCTAssertFalse(PremiumService.shared.isSubscribed)
        PremiumService.shared.subscribe(plan: .yearly)
        XCTAssertTrue(PremiumService.shared.isSubscribed)
    }

    func test_cancelSubscription_inDebug_deactivatesFlag() {
        PremiumService.shared._debugSetSubscribed(true)
        PremiumService.shared.cancelSubscription()
        XCTAssertFalse(PremiumService.shared.isSubscribed)
    }

    func test_restorePurchases_async_withoutEntitlements_returnsFalse() async {
        // Fase 6: sin sandbox configurado ni entitlements activos, devuelve false.
        let result = await PremiumService.shared.restorePurchases()
        XCTAssertFalse(result)
    }
}
