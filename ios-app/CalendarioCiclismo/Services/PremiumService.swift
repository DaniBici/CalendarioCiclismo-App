import Foundation
import StoreKit
import SwiftUI
import UIKit

/// Servicio de sostenimiento de 4.3.
///
/// El nombre se conserva para mantener compatibilidad con los call sites
/// existentes. Premium ya no se vende: sus transacciones solo sirven para
/// reconocer a Fundador. Las nuevas compras son Amigo o aportaciones puntuales.
@MainActor @Observable
final class PremiumService {
    static let shared = PremiumService()

    static let monthlyProductID = "app.calendariociclismo.amigo.mensual"
    static let yearlyProductID = "app.calendariociclismo.amigo.anual"
    static let contributionSmallID = "app.calendariociclismo.aportacion.299"
    static let contributionMediumID = "app.calendariociclismo.aportacion.599"
    static let contributionLargeID = "app.calendariociclismo.aportacion.1199"

    static let legacyMonthlyProductID = "app.calendariociclismo.premium.mensual"
    static let legacyYearlyProductID = "app.calendariociclismo.premium.anual"

    static let friendProductIDs = [monthlyProductID, yearlyProductID]
    static let contributionProductIDs = [
        contributionSmallID,
        contributionMediumID,
        contributionLargeID,
    ]
    static let legacyProductIDs = [legacyMonthlyProductID, legacyYearlyProductID]

    enum PaywallSource: String, Identifiable, CaseIterable {
        case region, notifications, raceCards, raceNotifications, general
        var id: String { rawValue }
    }

    enum PremiumPlan: String, Identifiable, CaseIterable {
        case monthly, yearly
        var id: String { rawValue }
    }

    enum SupporterIcon: String, Identifiable, CaseIterable {
        case standard, founder, friend
        var id: String { rawValue }
        var alternateIconName: String? {
            switch self {
            case .standard: nil
            case .founder: "AppIconFounder"
            case .friend: "AppIconFriend"
            }
        }
    }

    private static let friendKey = "friend_subscribed"
    private static let legacyActiveKey = "premium_subscribed"
    private static let founderKey = "founder_recognized"
    private static let contributionCountKey = "supporter_contribution_count"
    private static let supporterIconKey = "supporter_icon"
    private static let previousSupporterIconKey = "supporter_icon_previous"

    private(set) var isSubscribed: Bool
    private(set) var isLegacyPremiumActive: Bool
    private(set) var isFounder: Bool
    private(set) var contributionCount: Int
    private(set) var supporterIcon: SupporterIcon
    private(set) var hasRefreshedPurchaseState = false

    let featuresUnlocked = true
    var pendingPaywallSource: PaywallSource?
    private(set) var products: [Product] = []
    private(set) var isPurchasing = false
    private(set) var purchaseError: String?
    private(set) var isRedeemingCode = false
    private var updatesTask: Task<Void, Never>?

    private init() {
        let defaults = UserDefaults.standard
        let storedFriend = defaults.bool(forKey: Self.friendKey)
        let storedLegacy = defaults.bool(forKey: Self.legacyActiveKey)
        isSubscribed = storedFriend
        isLegacyPremiumActive = storedLegacy
        isFounder = defaults.bool(forKey: Self.founderKey) || storedLegacy
        contributionCount = defaults.integer(forKey: Self.contributionCountKey)
        supporterIcon = SupporterIcon(
            rawValue: defaults.string(forKey: Self.supporterIconKey) ?? ""
        ) ?? .standard
        if isFounder { defaults.set(true, forKey: Self.founderKey) }

        updatesTask = Task { [weak self] in
            await self?.listenForTransactions()
        }
        Task { await refreshPurchaseState() }
    }

    func loadProducts() async {
        do {
            let ids = Self.friendProductIDs + Self.contributionProductIDs
            products = try await Product.products(for: ids).sorted { $0.price < $1.price }
        } catch {
            purchaseError = "No se pudieron cargar las opciones de apoyo."
        }
    }

    var friendProducts: [Product] {
        products.filter { Self.friendProductIDs.contains($0.id) }
    }

    var contributionProducts: [Product] {
        products.filter { Self.contributionProductIDs.contains($0.id) }
    }

    func presentPaywall(_ source: PaywallSource) {
        Haptics.play(.primaryAction)
        pendingPaywallSource = source
        AnalyticsService.shared.logEvent("support_view", parameters: ["source": source.rawValue])
        Task { await loadProducts() }
    }

    func dismissPaywall() {
        pendingPaywallSource = nil
        purchaseError = nil
    }

    func subscribe(plan: PremiumPlan) {
        guard !isLegacyPremiumActive else { return }
        let id = plan == .yearly ? Self.yearlyProductID : Self.monthlyProductID
        AnalyticsService.shared.logEvent("support_subscribe_tap", parameters: [
            "plan": plan.rawValue,
            "source": pendingPaywallSource?.rawValue ?? "unknown",
        ])
        #if DEBUG
        setFriendSubscribed(true)
        #else
        Task { await performPurchase(productID: id, kind: .friend(plan)) }
        #endif
    }

    func contribute(productID: String) {
        guard Self.contributionProductIDs.contains(productID) else { return }
        AnalyticsService.shared.logEvent("support_contribution_tap", parameters: [
            "product_id": productID,
        ])
        #if DEBUG
        recordContribution()
        #else
        Task { await performPurchase(productID: productID, kind: .contribution) }
        #endif
    }

    private enum PurchaseKind {
        case friend(PremiumPlan)
        case contribution
    }

    private func performPurchase(productID: String, kind: PurchaseKind) async {
        if products.isEmpty { await loadProducts() }
        guard let product = products.first(where: { $0.id == productID }) else {
            purchaseError = "Esta opción no está disponible ahora mismo."
            return
        }

        isPurchasing = true
        purchaseError = nil
        defer { isPurchasing = false }

        do {
            switch try await product.purchase() {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                switch kind {
                case .friend:
                    setFriendSubscribed(true)
                case .contribution:
                    recordContribution()
                }
                await transaction.finish()
                AnalyticsService.shared.logEvent("support_purchase_success", parameters: [
                    "product_id": product.id,
                ])
            case .userCancelled, .pending:
                break
            @unknown default:
                break
            }
        } catch {
            purchaseError = "No se pudo completar la compra. Inténtalo de nuevo."
            AnalyticsService.shared.logEvent("support_purchase_error", parameters: [
                "product_id": productID,
                "error": error.localizedDescription,
            ])
        }
    }

    @discardableResult
    func restorePurchases() async -> Bool {
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            try await AppStore.sync()
            await refreshPurchaseState()
            return isSubscribed || isLegacyPremiumActive || isFounder
        } catch {
            return false
        }
    }

    private func refreshPurchaseState() async {
        defer { hasRefreshedPurchaseState = true }
        var friendActive = false
        var legacyActive = false

        for await result in Transaction.currentEntitlements {
            guard case .verified(let tx) = result, tx.revocationDate == nil else { continue }
            if Self.friendProductIDs.contains(tx.productID) { friendActive = true }
            if Self.legacyProductIDs.contains(tx.productID) {
                legacyActive = true
                recognizeFounder()
            }
        }

        // StoreKit permite recuperar una compra Premium anterior aunque ya haya
        // vencido; se excluyen las transacciones revocadas.
        for await result in Transaction.all {
            guard case .verified(let tx) = result,
                  Self.legacyProductIDs.contains(tx.productID),
                  tx.revocationDate == nil else { continue }
            recognizeFounder()
            break
        }

        setFriendSubscribed(friendActive)
        setLegacyPremiumActive(legacyActive)
    }

    private func listenForTransactions() async {
        for await result in Transaction.updates {
            do {
                let tx = try checkVerified(result)
                if Self.friendProductIDs.contains(tx.productID) {
                    setFriendSubscribed(tx.revocationDate == nil)
                } else if Self.legacyProductIDs.contains(tx.productID) {
                    if tx.revocationDate == nil { recognizeFounder() }
                    await refreshPurchaseState()
                } else if Self.contributionProductIDs.contains(tx.productID),
                          tx.revocationDate == nil {
                    recordContribution()
                }
                await tx.finish()
            } catch {
                // Las transacciones no verificadas no alteran reconocimientos.
            }
        }
    }

    func presentCodeRedemption() {
        isRedeemingCode = true
        #if DEBUG
        isRedeemingCode = false
        setFriendSubscribed(true)
        #else
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }) else {
            isRedeemingCode = false
            return
        }
        Task { [weak self] in
            try? await AppStore.presentOfferCodeRedeemSheet(in: scene)
            try? await Task.sleep(for: .milliseconds(100))
            self?.isRedeemingCode = false
            await self?.refreshPurchaseState()
        }
        #endif
    }

    func clearRedemptionFlag() {
        isRedeemingCode = false
    }

    func cancelSubscription() {
        #if DEBUG
        setFriendSubscribed(false)
        #else
        if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
            UIApplication.shared.open(url)
        }
        #endif
    }

    func setSupporterIcon(_ icon: SupporterIcon) {
        let allowed = switch icon {
        case .standard: true
        case .founder: isFounder
        case .friend: isSubscribed
        }
        guard allowed, UIApplication.shared.supportsAlternateIcons else { return }
        if icon == .friend, supporterIcon != .friend {
            UserDefaults.standard.set(supporterIcon.rawValue, forKey: Self.previousSupporterIconKey)
        }
        UIApplication.shared.setAlternateIconName(icon.alternateIconName) { [weak self] error in
            guard error == nil else { return }
            Task { @MainActor in
                self?.supporterIcon = icon
                UserDefaults.standard.set(icon.rawValue, forKey: Self.supporterIconKey)
            }
        }
    }

    private func setFriendSubscribed(_ value: Bool) {
        isSubscribed = value
        UserDefaults.standard.set(value, forKey: Self.friendKey)
        if !value && supporterIcon == .friend {
            let previous = SupporterIcon(
                rawValue: UserDefaults.standard.string(forKey: Self.previousSupporterIconKey) ?? ""
            ) ?? .standard
            setSupporterIcon(previous == .founder && isFounder ? .founder : .standard)
        }
    }

    private func setLegacyPremiumActive(_ value: Bool) {
        isLegacyPremiumActive = value
        UserDefaults.standard.set(value, forKey: Self.legacyActiveKey)
        if value { recognizeFounder() }
    }

    private func recognizeFounder() {
        guard !isFounder else { return }
        isFounder = true
        UserDefaults.standard.set(true, forKey: Self.founderKey)
    }

    private func recordContribution() {
        contributionCount += 1
        UserDefaults.standard.set(contributionCount, forKey: Self.contributionCountKey)
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

    #if DEBUG
    func _debugToggle() { setFriendSubscribed(!isSubscribed) }
    func _debugSetSubscribed(_ value: Bool) { setFriendSubscribed(value) }
    func _debugSetFounder(_ value: Bool) {
        isFounder = value
        UserDefaults.standard.set(value, forKey: Self.founderKey)
        if !value && supporterIcon == .founder { setSupporterIcon(.standard) }
    }
    #endif
}
