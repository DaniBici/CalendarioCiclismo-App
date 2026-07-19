import SwiftUI
import StoreKit

/// Pantalla de paywall — Fase 6.
///
/// Muestra precios reales desde `PremiumService.products` (StoreKit 2) con
/// fallback a valores hardcoded mientras los productos se cargan o si no hay red.
/// El botón de compra y el de restaurar muestran un spinner durante la transacción.
/// La paywall se cierra automáticamente cuando `isSubscribed` pasa a `true`.
struct PaywallView: View {
    let source: PremiumService.PaywallSource
    let onDismiss: () -> Void

    @State private var selectedPlan: PremiumService.PremiumPlan = .yearly
    @State private var showAlert = false
    @State private var alertMessage = ""
    @State private var premium = PremiumService.shared

    private let privacyURL = URL(string: "https://www.calendariociclismo.app/privacidad.html")!
    private let termsURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                header
                features
                planSelector
                primaryCTA
                secondaryActions
                footer
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 32)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemBackground))
        .overlay(alignment: .topTrailing) {
            Button {
                Haptics.play(.selection)
                onDismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .padding(16)
            }
            .disabled(premium.isPurchasing)
            .accessibilityLabel(LocaleService.t("Cerrar", "Close"))
        }
        .alert("Premium", isPresented: $showAlert) {
            Button(LocaleService.t("Aceptar", "OK"), role: .cancel) {}
        } message: {
            Text(alertMessage)
        }
        .onChange(of: premium.purchaseError) { _, error in
            if let error {
                alertMessage = error
                showAlert = true
            }
        }
        .onChange(of: premium.isSubscribed) { _, subscribed in
            // Si el cambio viene de un canjeo de código, NO cerramos la paywall:
            // el sheet UIKit de App Store sigue presentado encima y un dismiss
            // aquí dejaría la jerarquía de ventanas corrupta (las vistas de
            // fondo aparecen recortadas tras pulsar "Done"). El usuario cerrará
            // la paywall él mismo con la X cuando vuelva.
            if subscribed && !premium.isRedeemingCode { onDismiss() }
        }
        .onDisappear {
            premium.clearRedemptionFlag()
        }
    }

    // MARK: - Header

    @ViewBuilder
    private var header: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "calendar")
                    .font(.system(size: 44))
                Image(systemName: "bicycle")
                    .font(.system(size: 44))
            }
            .foregroundStyle(LinearGradient(
                colors: [Color.yellow, Color.orange],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ))
            .accessibilityHidden(true)

            Text(headerTitle)
                .font(.title)
                .fontWeight(.bold)
                .multilineTextAlignment(.center)

            Text(headerSubtitle)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    // Todas las features que antes eran Premium se liberaron al plan gratuito.
    // El único valor de la suscripción ahora es quitar los anuncios, así que el
    // copy es único (ya no depende de `source`).
    private var headerTitle: String {
        LocaleService.t("Disfruta sin anuncios", "Enjoy ad-free")
    }

    private var headerSubtitle: String {
        LocaleService.t(
            "Quita todos los anuncios de la app. Todo el calendario sigue siendo gratuito: ninguna función depende de la suscripción.",
            "Remove all ads from the app. The whole calendar stays free: no feature depends on the subscription."
        )
    }

    // MARK: - Features

    @ViewBuilder
    private var features: some View {
        VStack(alignment: .leading, spacing: 14) {
            featureRow(icon: "hand.raised.slash", text: LocaleService.t("Sin anuncios en ninguna pantalla", "No ads on any screen"))
            featureRow(icon: "bolt.fill", text: LocaleService.t("Una experiencia más limpia y rápida", "A cleaner, faster experience"))
            featureRow(icon: "heart.fill", text: LocaleService.t("Ayuda a cubrir los costes de un proyecto independiente",
                                                                 "Help cover the costs of an independent project"))
        }
        .padding(20)
        .background(AppTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func featureRow(icon: String, text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline)
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Plan selector

    @ViewBuilder
    private var planSelector: some View {
        VStack(spacing: 12) {
            planCard(
                .yearly,
                price: yearlyDisplayPrice,
                period: LocaleService.t("al año", "per year"),
                subtitle: yearlySubtitle,
                badge: LocaleService.t("MEJOR OFERTA", "BEST VALUE")
            )
            planCard(
                .monthly,
                price: monthlyDisplayPrice,
                period: LocaleService.t("al mes", "per month"),
                subtitle: LocaleService.t("Cancela cuando quieras", "Cancel anytime"),
                badge: nil
            )
        }
    }

    private var monthlyDisplayPrice: String {
        product(for: .monthly)?.displayPrice ?? "2,99 €"
    }

    private var yearlyDisplayPrice: String {
        product(for: .yearly)?.displayPrice ?? "17,99 €"
    }

    private var yearlySubtitle: String {
        guard let yearly = product(for: .yearly), let monthly = product(for: .monthly) else {
            return LocaleService.t("1,50 €/mes · ahorra un 50%", "€1.50/month · save 50%")
        }
        let currencyCode = yearly.priceFormatStyle.currencyCode
        let monthlyEquivPrice: Decimal = yearly.price / 12
        let monthlyEquiv = monthlyEquivPrice.formatted(.currency(code: currencyCode))
        let monthlyYearTotal: Decimal = monthly.price * 12
        let diff: Decimal = monthlyYearTotal - yearly.price
        let ratio: Decimal = diff / monthlyYearTotal
        let savingPercent = NSDecimalNumber(decimal: ratio * 100).intValue
        return LocaleService.t(
            "\(monthlyEquiv)/mes · ahorra un \(savingPercent)%",
            "\(monthlyEquiv)/month · save \(savingPercent)%"
        )
    }

    private func product(for plan: PremiumService.PremiumPlan) -> Product? {
        let id = plan == .yearly ? PremiumService.yearlyProductID : PremiumService.monthlyProductID
        return premium.products.first(where: { $0.id == id })
    }

    private func planCard(
        _ plan: PremiumService.PremiumPlan,
        price: String,
        period: String,
        subtitle: String,
        badge: String?
    ) -> some View {
        let isSelected = selectedPlan == plan
        return Button {
            Haptics.play(.selection)
            selectedPlan = plan
        } label: {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                    .font(.title2)
                    .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(price)
                            .font(.title3)
                            .fontWeight(.bold)
                        Text(period)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let badge {
                            Text(badge)
                                .font(.caption2)
                                .fontWeight(.bold)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.accentColor)
                                .foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                        }
                    }
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(16)
            .background(AppTheme.cardBackground)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.accentColor : .clear, lineWidth: 2)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(premium.isPurchasing)
        .accessibilityLabel("\(price) \(period). \(subtitle).")
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : [.isButton])
    }

    // MARK: - Primary CTA

    @ViewBuilder
    private var primaryCTA: some View {
        let afterPrice = selectedPlan == .yearly
            ? LocaleService.t("\(yearlyDisplayPrice)/año", "\(yearlyDisplayPrice)/year")
            : LocaleService.t("\(monthlyDisplayPrice)/mes", "\(monthlyDisplayPrice)/month")

        VStack(spacing: 6) {
            Button {
                guard !premium.isPurchasing else { return }
                Haptics.play(.primaryAction)
                premium.subscribe(plan: selectedPlan)
                #if DEBUG
                // En Debug subscribe() activa el flag directamente → onChange cerrará la sheet.
                #endif
            } label: {
                Group {
                    if premium.isPurchasing {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(.white)
                    } else {
                        Text(LocaleService.t("Probar 7 días gratis", "Try 7 days free"))
                            .font(.headline)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.accentColor)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .disabled(premium.isPurchasing)
            .accessibilityHint(LocaleService.t("Inicia la prueba gratuita de 7 días.", "Start the 7-day free trial."))

            Text(LocaleService.t(
                "Después \(afterPrice). Cancela cuando quieras.",
                "Then \(afterPrice). Cancel anytime."
            ))
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: - Secondary actions

    @ViewBuilder
    private var secondaryActions: some View {
        HStack(spacing: 24) {
            Spacer()
            Button {
                guard !premium.isPurchasing else { return }
                Haptics.play(.selection)
                Task {
                    let restored = await premium.restorePurchases()
                    if !restored {
                        alertMessage = LocaleService.t(
                            "No encontramos compras previas en este Apple ID.",
                            "We couldn't find any previous purchases on this Apple ID."
                        )
                        showAlert = true
                    }
                    // Si restored == true, onChange(isSubscribed) cerrará la sheet.
                }
            } label: {
                Text(LocaleService.t("Restaurar compras", "Restore purchases"))
                    .font(.subheadline)
            }
            .disabled(premium.isPurchasing)

            Button {
                guard !premium.isPurchasing else { return }
                Haptics.play(.selection)
                premium.presentCodeRedemption()
            } label: {
                Text(LocaleService.t("Canjear código", "Redeem code"))
                    .font(.subheadline)
            }
            .disabled(premium.isPurchasing)
            Spacer()
        }
    }

    // MARK: - Footer

    @ViewBuilder
    private var footer: some View {
        VStack(spacing: 8) {
            // Nota "no busca beneficio": el proyecto no es un negocio y la
            // suscripción solo cubre costes (ver política de pricing en CLAUDE.md).
            Text(LocaleService.t(
                "Calendario Ciclismo no es un negocio. Lo hace una sola persona y no busca beneficio: los anuncios y las suscripciones están para cubrir los servidores y el mantenimiento que lo sostienen.",
                "Calendario Ciclismo is not a business. It is made by one person and does not seek profit: the ads and subscriptions are there to cover the servers and upkeep that keep it running."
            ))
            .font(.caption2)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)

            Text(LocaleService.t(
                "La suscripción se renueva automáticamente al precio indicado. Puedes cancelarla en Ajustes → Apple ID → Suscripciones al menos 24 h antes del final del periodo.",
                "The subscription renews automatically at the price shown. You can cancel it in Settings → Apple ID → Subscriptions at least 24 h before the end of the period."
            ))
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)

            HStack(spacing: 16) {
                Link(LocaleService.t("Política de privacidad", "Privacy policy"), destination: privacyURL)
                Link(LocaleService.t("Términos", "Terms"), destination: termsURL)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
    }
}
