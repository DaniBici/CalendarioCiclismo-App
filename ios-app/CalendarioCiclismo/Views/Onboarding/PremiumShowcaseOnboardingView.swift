import SwiftUI

/// Anuncio único de 4.3 para instalaciones nuevas y actualizaciones desde 4.2.6.
struct PremiumShowcaseOnboardingView: View {
    @State private var premium = PremiumService.shared
    @Environment(\.openURL) private var openURL
    let isNewInstallation: Bool
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            VStack(spacing: 0) {
                VStack(spacing: 20) {
                    Image("SupportIconFriend")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 72, height: 72)
                        .accessibilityHidden(true)

                    VStack(spacing: 10) {
                        Text(LocaleService.t("Gratis y sin anuncios para todos", "Free and ad-free for everyone"))
                            .font(.title.bold())
                            .multilineTextAlignment(.center)
                        Text(subtitle)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        featureRow("chevron.left.forwardslash.chevron.right", LocaleService.t(
                            "Código abierto y cuentas públicas", "Open source with public accounts"
                        ))
                        featureRow("sparkles", secondBenefit)
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                    if !isNewInstallation {
                        Button(LocaleService.t("Conoce el cambio", "Learn about the change")) {
                            openURL(explanationURL)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .frame(maxHeight: .infinity)

                bottomButtons
            }
        }
        .accessibilityElement(children: .contain)
        .onAppear {
            AnalyticsService.shared.logEvent("onboarding_view", parameters: [
                "onboarding_step": "premium_showcase",
            ])
            AccessibilityAnnouncement.screenChanged()
        }
    }

    private var bottomButtons: some View {
        VStack(spacing: 10) {
            Divider().padding(.bottom, 4)
            Button { primaryAction() } label: {
                Text(primaryTitle)
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 56)
            }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal, 20)

            if shouldShowSecondaryButton {
                Button(secondaryTitle) { secondaryAction() }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 36)
            } else {
                Spacer().frame(height: 36)
            }
        }
        .background(Color(.systemBackground))
    }

    private var primaryTitle: String {
        if premium.isLegacyPremiumActive || premium.isSubscribed || !premium.hasRefreshedPurchaseState {
            return LocaleService.t("Continuar", "Continue")
        }
        return LocaleService.t("Ver formas de apoyar", "View support options")
    }

    private var secondaryTitle: String {
        if premium.isSubscribed {
            return LocaleService.t("Gestionar suscripción", "Manage subscription")
        }
        if !isNewInstallation && (premium.isLegacyPremiumActive || !premium.hasRefreshedPurchaseState) {
            return LocaleService.t("Conoce el cambio", "Learn about the change")
        }
        return LocaleService.t("Continuar", "Continue")
    }

    private func primaryAction() {
        if premium.isLegacyPremiumActive || premium.isSubscribed || !premium.hasRefreshedPurchaseState {
            finish("continue")
        } else {
            finish("open_support") { PremiumService.shared.presentPaywall(.general) }
        }
    }

    private func secondaryAction() {
        if premium.isSubscribed {
            finish("manage_subscription") { premium.cancelSubscription() }
        } else if !isNewInstallation && (premium.isLegacyPremiumActive || !premium.hasRefreshedPurchaseState) {
            openURL(explanationURL)
        } else {
            finish(premium.isFounder ? "continue_founder" : "continue_free")
        }
    }

    private var subtitle: String {
        if isNewInstallation {
            return LocaleService.t(
                "Apoya los costes de mantenimiento de este proyecto, hecho por puro amor al ciclismo. Todas las funciones son gratuitas.",
                "Support the maintenance costs of this project, made purely for the love of cycling. Every feature is free."
            )
        }
        return LocaleService.t(
            "La publicidad desaparece de forma definitiva. Todas las funciones siguen siendo gratuitas y el apoyo pasa a ser voluntario.",
            "Advertising is gone for good. Every feature remains free, and support is now voluntary."
        )
    }

    private var secondBenefit: String {
        if isNewInstallation {
            return LocaleService.t(
                "Hecho por un profesional con dos décadas de experiencia en ciclismo",
                "Made by a professional with two decades of experience in cycling"
            )
        }
        return LocaleService.t(
            "Quien tuvo Premium recibe el icono Fundador",
            "Previous Premium users receive the Founder icon"
        )
    }

    private var shouldShowSecondaryButton: Bool {
        !isNewInstallation || premium.isSubscribed || (premium.hasRefreshedPurchaseState && !premium.isLegacyPremiumActive)
    }

    private func featureRow(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)
                .accessibilityHidden(true)
            Text(text).font(.subheadline)
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }

    private func finish(_ action: String, then next: (() -> Void)? = nil) {
        UserDefaults.standard.set(true, forKey: "support_intro_v4_3_done")
        AnalyticsService.shared.logEvent("onboarding_action", parameters: [
            "onboarding_step": "premium_showcase",
            "action": action,
        ])
        next?()
        onDismiss()
    }

    private var explanationURL: URL {
        URL(string: LocaleService.isEnglish
            ? "https://www.calendariociclismo.app/en/support/"
            : "https://www.calendariociclismo.app/apoyar/")!
    }
}
