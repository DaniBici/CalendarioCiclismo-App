import Foundation
import StoreKit
import SwiftUI

/// Servicio centralizado del estado Premium de la app.
///
/// **Fase 6 (actual):** StoreKit 2. `subscribe(plan:)` lanza la compra real
/// contra App Store (sandbox en Debug). `restorePurchases()` sincroniza con
/// `AppStore.sync()` y verifica `Transaction.currentEntitlements`. Un Task
/// escucha `Transaction.updates` en segundo plano para cubrir renovaciones,
/// revocaciones y compras Ask to Buy.
///
/// **Product IDs** — TODO: crear estos dos productos de tipo "Auto-Renewable
/// Subscription" en App Store Connect antes de la publicación en App Store.
/// Los IDs son los valores de `monthlyProductID` / `yearlyProductID` de abajo.
///
/// **PREMIUM_TEST_BUILD** — quitar el flag de `SWIFT_ACTIVE_COMPILATION_CONDITIONS`
/// (Debug y Release) antes de enviar a App Store. En Fase 6 ya no hace falta:
/// la forma de probar es el toggle DEBUG o el sandbox de StoreKit.
@MainActor @Observable
final class PremiumService {
    static let shared = PremiumService()

    // TODO: crear en App Store Connect → Funcionalidades → Compras integradas
    static let monthlyProductID = "app.calendariociclismo.premium.mensual"
    static let yearlyProductID  = "app.calendariociclismo.premium.anual"

    /// Origen del CTA que disparó el paywall. Determina el copy de `PaywallView`.
    enum PaywallSource: String, Identifiable, CaseIterable {
        case region
        case notifications
        case raceCards
        case raceNotifications
        case general

        var id: String { rawValue }
    }

    /// Plan de suscripción. Los precios reales vienen de `products` (StoreKit).
    enum PremiumPlan: String, Identifiable, CaseIterable {
        case monthly
        case yearly

        var id: String { rawValue }
    }

    private static let subscribedKey = "premium_subscribed"

    private(set) var isSubscribed: Bool
    var pendingPaywallSource: PaywallSource?

    /// Las features que en su día fueron Premium se liberaron al plan gratuito
    /// (commit `ea0674292da`) y son gratis para siempre — política de pricing
    /// del CLAUDE.md ("lo que ya era gratis sigue gratis"). Los gates de feature
    /// (mini-perfil, badge de inscritos, notificaciones enriquecidas, regiones,
    /// seguimiento de carreras) leen ESTA constante, NUNCA `isSubscribed`.
    /// Mantenerla desacoplada permite que `isSubscribed` recupere su único
    /// significado real: la suscripción quita los anuncios.
    let featuresUnlocked = true

    /// Único significado de la suscripción a partir del modelo con anuncios:
    /// suscrito → sin anuncios. Es el "AdGate" que consulta la capa de ads
    /// antes de inicializar el SDK / mostrar unidades.
    var shouldShowAds: Bool { !isSubscribed }

    /// Productos cargados desde App Store. Vacío hasta que `loadProducts()` los cargue.
    /// Ordenados de menor a mayor precio (monthly → yearly).
    private(set) var products: [Product] = []

    /// `true` mientras hay una transacción en curso (compra o restore).
    private(set) var isPurchasing: Bool = false

    /// Mensaje de error de la última operación fallida. `PaywallView` lo observa.
    private(set) var purchaseError: String?

    /// `true` mientras hay un sheet nativo de canjeo de código presentado. Lo
    /// monta UIKit directamente sobre la `UIWindowScene` (fuera del árbol
    /// SwiftUI), por lo que SwiftUI no se entera de su ciclo de vida. La
    /// paywall observa este flag para NO auto-cerrarse cuando `isSubscribed`
    /// pasa a `true` durante el canjeo — si la cerrase, iOS quedaría con la
    /// jerarquía de ventanas desincronizada y las vistas por debajo se
    /// dibujan recortadas tras pulsar "Done".
    private(set) var isRedeemingCode: Bool = false

    private var updatesTask: Task<Void, Never>?

    private init() {
        self.isSubscribed = UserDefaults.standard.bool(forKey: Self.subscribedKey)

        // Escuchar Transaction.updates para renovaciones/revocaciones en tiempo real.
        updatesTask = Task { [weak self] in
            await self?.listenForTransactions()
        }
        // Verificar entitlements actuales al arrancar (cubre cambios mientras
        // la app estaba cerrada y no llegó ningún Transaction.update).
        Task { await verifyCurrentEntitlements() }
    }

    // MARK: - Productos

    /// Carga los productos de App Store. Llamado al abrir la paywall.
    /// Falla silenciosamente si no hay red o los IDs aún no existen en ASC.
    func loadProducts() async {
        do {
            let loaded = try await Product.products(for: [Self.monthlyProductID, Self.yearlyProductID])
            products = loaded.sorted { $0.price < $1.price }
        } catch {
            // La paywall muestra precios hardcoded como fallback.
        }
    }

    // MARK: - Paywall

    func presentPaywall(_ source: PaywallSource) {
        Haptics.play(.primaryAction)
        pendingPaywallSource = source
        AnalyticsService.shared.logEvent("paywall_view", parameters: [
            "source": source.rawValue,
        ])
        Task { await loadProducts() }
    }

    func dismissPaywall() {
        pendingPaywallSource = nil
        purchaseError = nil
    }

    // MARK: - Compra

    func subscribe(plan: PremiumPlan) {
        AnalyticsService.shared.logEvent("paywall_subscribe_tap", parameters: [
            "plan": plan.rawValue,
            "source": pendingPaywallSource?.rawValue ?? "unknown",
        ])
        #if DEBUG
        // Builds Debug: activación directa para testing sin StoreKit sandbox.
        setSubscribed(true)
        #else
        Task { await performPurchase(plan: plan) }
        #endif
    }

    private func performPurchase(plan: PremiumPlan) async {
        let targetID = plan == .yearly ? Self.yearlyProductID : Self.monthlyProductID
        if products.isEmpty { await loadProducts() }
        guard let product = products.first(where: { $0.id == targetID }) else {
            purchaseError = "No se pudo cargar el producto. Inténtalo de nuevo."
            return
        }

        isPurchasing = true
        purchaseError = nil
        defer { isPurchasing = false }

        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                setSubscribed(true)
                await transaction.finish()
                AnalyticsService.shared.logEvent("purchase_success", parameters: [
                    "plan": plan.rawValue,
                    "product_id": product.id,
                ])
            case .userCancelled:
                break
            case .pending:
                // Ask to Buy u otro flujo externo — esperamos Transaction.updates.
                break
            @unknown default:
                break
            }
        } catch {
            purchaseError = "No se pudo completar la compra. Inténtalo de nuevo."
            AnalyticsService.shared.logEvent("purchase_error", parameters: [
                "plan": plan.rawValue,
                "error": error.localizedDescription,
            ])
        }
    }

    // MARK: - Restore

    @discardableResult
    func restorePurchases() async -> Bool {
        AnalyticsService.shared.logEvent("paywall_restore_tap", parameters: [:])
        isPurchasing = true
        defer { isPurchasing = false }

        do {
            try await AppStore.sync()
            var hasActive = false
            for await result in Transaction.currentEntitlements {
                if case .verified(let tx) = result,
                   [Self.monthlyProductID, Self.yearlyProductID].contains(tx.productID),
                   tx.revocationDate == nil {
                    hasActive = true
                    await tx.finish()
                }
            }
            setSubscribed(hasActive)
            if hasActive {
                AnalyticsService.shared.logEvent("restore_success", parameters: [:])
            }
            return hasActive
        } catch {
            return false
        }
    }

    // MARK: - Canjear código

    /// Abre el sheet nativo de App Store para introducir un código (offer code
    /// o promo code). Apple gestiona la validación y, si es válido, dispara
    /// `Transaction.updates` que actualiza `isSubscribed` automáticamente.
    func presentCodeRedemption() {
        AnalyticsService.shared.logEvent("paywall_redeem_code_tap", parameters: [
            "source": pendingPaywallSource?.rawValue ?? "settings",
        ])
        // Marcamos canje en curso para que la paywall NO se auto-cierre cuando
        // `Transaction.updates` ponga `isSubscribed = true`. Si cerrase, iOS
        // dejaría el sheet UIKit del App Store huérfano y la jerarquía de
        // ventanas quedaría con safe-area/clipping corrupto, recortando las
        // vistas de fondo (Hoy/Mes/Temporada).
        isRedeemingCode = true
        #if DEBUG
        // En Debug no hay App Store real — simulamos un canjeo activando el flag.
        // Bajamos `isRedeemingCode` inmediatamente porque no hay sheet UIKit
        // huérfano del que protegerse; queremos que la paywall se auto-cierre
        // con normalidad cuando `isSubscribed` cambie a true.
        isRedeemingCode = false
        setSubscribed(true)
        #else
        if #available(iOS 16.0, *),
           let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })
        {
            Task { [weak self] in
                try? await AppStore.presentOfferCodeRedeemSheet(in: scene)
                // Tras cerrar el sheet de App Store (UIKit montado fuera del
                // árbol SwiftUI), la jerarquía de ventanas puede quedar con
                // safe-area corrupta. Forzar relayout del root window evita
                // que las vistas de fondo (Hoy/Mes/Temporada) se dibujen
                // recortadas. Esperamos un frame para que iOS termine de
                // desmontar el sheet antes de invalidar el layout.
                try? await Task.sleep(for: .milliseconds(100))
                await MainActor.run {
                    self?.invalidateRootLayout()
                    self?.isRedeemingCode = false
                }
            }
        } else {
            isRedeemingCode = false
        }
        #endif
    }

    /// Limpia el flag de canje en curso. La paywall lo llama en su `onDismiss`
    /// (cuando el usuario cierra manualmente la sheet con la X), garantizando
    /// que las próximas compras vuelvan a comportarse con auto-dismiss normal.
    func clearRedemptionFlag() {
        isRedeemingCode = false
    }

    /// Fuerza un relayout completo del root window. Workaround para el bug
    /// de safe-area corrupta tras cerrar el sheet nativo de App Store (canjeo
    /// de código). Sin esto, las vistas de fondo aparecen recortadas a media
    /// pantalla en iOS 17/18.
    private func invalidateRootLayout() {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                window.setNeedsLayout()
                window.layoutIfNeeded()
                window.rootViewController?.view.setNeedsLayout()
                window.rootViewController?.view.layoutIfNeeded()
            }
        }
    }

    // MARK: - Cancel

    func cancelSubscription() {
        #if DEBUG
        setSubscribed(false)
        #else
        if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
            UIApplication.shared.open(url)
        }
        #endif
    }

    // MARK: - Verificación al arrancar

    private func verifyCurrentEntitlements() async {
        var hasActive = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let tx) = result,
               [Self.monthlyProductID, Self.yearlyProductID].contains(tx.productID),
               tx.revocationDate == nil {
                hasActive = true
            }
        }
        if hasActive != isSubscribed {
            setSubscribed(hasActive)
        }
    }

    // MARK: - Transaction updates (segundo plano)

    private func listenForTransactions() async {
        for await result in Transaction.updates {
            do {
                let tx = try checkVerified(result)
                let isOurs = [Self.monthlyProductID, Self.yearlyProductID].contains(tx.productID)
                if isOurs {
                    setSubscribed(tx.revocationDate == nil)
                }
                await tx.finish()
            } catch {
                // Transacción no verificada — ignorar.
            }
        }
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified: throw PurchaseError.failedVerification
        case .verified(let safe): return safe
        }
    }

    private enum PurchaseError: Error {
        case failedVerification
    }

    // MARK: - Debug helpers

    #if DEBUG
    func _debugToggle() { setSubscribed(!isSubscribed) }
    func _debugSetSubscribed(_ value: Bool) { setSubscribed(value) }
    #endif

    // MARK: - Persistencia

    private func setSubscribed(_ value: Bool) {
        let wasSubscribed = isSubscribed
        UserDefaults.standard.set(value, forKey: Self.subscribedKey)
        isSubscribed = value
        if value && !wasSubscribed {
            applyDefaultRaceFollowPresetOnPremiumActivation()
        }
    }

    /// Al activarse Premium por primera vez, si el modo de seguimiento sigue en
    /// el default `.followAll`, lo cambiamos a `.followRaces` ("Selectas") para
    /// evitar que el usuario reciba notificaciones de TODAS las carreras nada
    /// más suscribirse. Respetamos la lista existente de `followedRaceIds`: si
    /// está vacía, el usuario recibirá cero notificaciones hasta que siga una
    /// carrera manualmente. No tocamos los modos `.followRaces`/`.followFilters`
    /// porque indican una elección consciente previa.
    private func applyDefaultRaceFollowPresetOnPremiumActivation() {
        let follow = RaceFollowService.shared
        guard follow.followMode == .followAll else { return }
        follow.setMode(.followRaces)
    }
}
