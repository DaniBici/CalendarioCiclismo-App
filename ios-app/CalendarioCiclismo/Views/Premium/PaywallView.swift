import StoreKit
import SwiftUI

/// Pantalla voluntaria de sostenimiento. No bloquea funciones.
struct PaywallView: View {
    let source: PremiumService.PaywallSource
    @Environment(\.dismiss) private var dismiss
    @State private var premium = PremiumService.shared
    @State private var selectedPlan: PremiumService.PremiumPlan = .yearly
    @State private var alertMessage: String?
    @State private var contributionCountAtOpen = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    header
                    guaranteeCard
                    transparencyCard

                    if premium.isLegacyPremiumActive {
                        legacyPremiumCard
                    } else {
                        planSelector
                        subscribeButton
                    }

                    contributionSection
                    restoreButton
                    legalText
                }
                .padding(20)
            }
            .background(Color(.systemBackground).ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        premium.dismissPaywall()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel(LocaleService.t("Cerrar", "Close"))
                }
            }
        }
        .task {
            contributionCountAtOpen = premium.contributionCount
            await premium.loadProducts()
        }
        .onChange(of: premium.isSubscribed) { _, active in
            if active {
                premium.dismissPaywall()
                dismiss()
            }
        }
        .onChange(of: premium.contributionCount) { _, count in
            if count > contributionCountAtOpen {
                contributionCountAtOpen = count
                alertMessage = LocaleService.t(
                    "Gracias por ayudar a sostener Calendario Ciclismo.",
                    "Thank you for helping sustain Calendario Ciclismo."
                )
            }
        }
        .onChange(of: premium.purchaseError) { _, error in
            if let error { alertMessage = error }
        }
        .alert(LocaleService.t("Amigo de Calendario Ciclismo", "Friend of Calendario Ciclismo"),
               isPresented: Binding(
                get: { alertMessage != nil },
                set: { if !$0 { alertMessage = nil } }
               )) {
            Button(LocaleService.t("Aceptar", "OK")) { alertMessage = nil }
        } message: {
            Text(alertMessage ?? "")
        }
        .onDisappear {
            premium.clearRedemptionFlag()
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            Image("SupportIconFriend")
                .resizable()
                .scaledToFit()
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .accessibilityHidden(true)
            Text(LocaleService.t(
                "Hazte Amigo de Calendario Ciclismo",
                "Become a Friend of Calendario Ciclismo"
            ))
            .font(.title2.bold())
            .multilineTextAlignment(.center)
            Text(LocaleService.t(
                "Ayuda voluntariamente a cubrir servidores, herramientas y mantenimiento.",
                "Voluntarily help cover servers, tools and maintenance."
            ))
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
    }

    private var guaranteeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                LocaleService.t("Icono exclusivo mientras seas Amigo", "Exclusive icon while you are a Friend"),
                systemImage: "app.badge"
            )
            Label(
                LocaleService.t("La app completa es gratuita para todos", "The complete app is free for everyone"),
                systemImage: "checkmark.seal.fill"
            )
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .ccCardSurface()
    }

    private var transparencyCard: some View {
        Link(destination: URL(string: "https://www.calendariociclismo.app/abierto.html")!) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(LocaleService.t("Código y cuentas públicas", "Public code and accounts"))
                        .font(.subheadline.bold())
                    Text(LocaleService.t(
                        "Consulta cómo se hace y se sostiene el proyecto.",
                        "See how the project is built and sustained."
                    ))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "arrow.up.right")
            }
            .padding(16)
            .ccCardSurface()
        }
        .buttonStyle(.plain)
    }

    private var legacyPremiumCard: some View {
        VStack(spacing: 8) {
            Image(systemName: "medal.fill")
                .font(.title)
                .foregroundStyle(.orange)
            Text(LocaleService.t("Eres Fundador", "You are a Founder"))
                .font(.headline)
            Text(LocaleService.t(
                "Tu Premium anterior no se convertirá ni volverá a cobrarse. Cuando termine podrás hacerte Amigo si quieres seguir contribuyendo.",
                "Your previous Premium plan will not be converted or charged again. When it ends, you can become a Friend if you wish to continue supporting the project."
            ))
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        .padding(16)
        .ccCardSurface()
    }

    private var planSelector: some View {
        VStack(spacing: 10) {
            planRow(.yearly, fallback: "17,99 €", period: LocaleService.t("al año", "per year"))
            planRow(.monthly, fallback: "2,99 €", period: LocaleService.t("al mes", "per month"))
        }
    }

    private func planRow(
        _ plan: PremiumService.PremiumPlan,
        fallback: String,
        period: String
    ) -> some View {
        Button {
            selectedPlan = plan
        } label: {
            HStack {
                Image(systemName: selectedPlan == plan ? "largecircle.fill.circle" : "circle")
                Text(product(for: plan)?.displayPrice ?? fallback)
                    .font(.headline)
                Text(period)
                    .foregroundStyle(.secondary)
                Spacer()
                if plan == .yearly {
                    Text(LocaleService.t("MEJOR OPCIÓN", "BEST VALUE"))
                        .font(.caption2.bold())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
            }
            .padding(16)
            .ccCardSurface()
        }
        .buttonStyle(.plain)
    }

    private var subscribeButton: some View {
        Button {
            premium.subscribe(plan: selectedPlan)
        } label: {
            HStack {
                if premium.isPurchasing { ProgressView().tint(.white) }
                Text(LocaleService.t("Hacerme amigo", "Become a Friend"))
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
        }
        .buttonStyle(.borderedProminent)
        .disabled(premium.isPurchasing)
    }

    private var contributionSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(LocaleService.t("Aportación puntual", "One-time contribution"))
                .font(.headline)
            Text(LocaleService.t(
                "Sin suscripción y sin ventajas funcionales.",
                "No subscription and no functional advantages."
            ))
            .font(.caption)
            .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                contributionButton(id: PremiumService.contributionSmallID, fallback: "2,99 €")
                contributionButton(id: PremiumService.contributionMediumID, fallback: "5,99 €")
                contributionButton(id: PremiumService.contributionLargeID, fallback: "11,99 €")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func contributionButton(id: String, fallback: String) -> some View {
        Button(product(id: id)?.displayPrice ?? fallback) {
            premium.contribute(productID: id)
        }
        .buttonStyle(.bordered)
        .frame(maxWidth: .infinity)
        .disabled(premium.isPurchasing)
    }

    private var restoreButton: some View {
        Button(LocaleService.t("Restaurar compras", "Restore purchases")) {
            Task {
                let restored = await premium.restorePurchases()
                if !restored {
                    alertMessage = LocaleService.t(
                        "No encontramos compras anteriores en este Apple ID.",
                        "We couldn't find previous purchases on this Apple ID."
                    )
                }
            }
        }
        .font(.subheadline)
    }

    private var legalText: some View {
        Text(LocaleService.t(
            "La membresía se renueva automáticamente al precio indicado hasta que la canceles desde tu cuenta de Apple. Todas las funciones permanecen gratuitas.",
            "The membership renews automatically at the displayed price until you cancel it from your Apple account. All features remain free."
        ))
        .font(.caption2)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }

    private func product(for plan: PremiumService.PremiumPlan) -> Product? {
        product(id: plan == .yearly ? PremiumService.yearlyProductID : PremiumService.monthlyProductID)
    }

    private func product(id: String) -> Product? {
        premium.products.first { $0.id == id }
    }
}
