import SwiftUI

/// Onboarding "sin anuncios" — pantalla única, último paso del flujo, que ofrece
/// la suscripción cuyo ÚNICO valor es quitar los anuncios (todas las antiguas
/// features Premium se liberaron al plan gratuito, commit `ea0674292da`).
///
/// Flujo resultante: Language → Notifications → Offline → **esta pantalla** → Done.
struct PremiumShowcaseOnboardingView: View {
    @State private var premium = PremiumService.shared
    @State private var isAnimating = false
    let onDismiss: () -> Void

    // MARK: - Body

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()

            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 24) {
                        headerSection
                            .padding(.top, 56)
                        benefitsCard
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
                }

                bottomButtons
            }
        }
        .accessibilityElement(children: .contain)
        .onAppear {
            AnalyticsService.shared.logEvent("onboarding_view", parameters: [
                "onboarding_step": "premium_showcase",
            ])
            AccessibilityAnnouncement.screenChanged()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                isAnimating = true
            }
        }
        .onChange(of: premium.isSubscribed) { _, subscribed in
            guard subscribed else { return }
            markDone()
            onDismiss()
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "calendar")
                    .font(.system(size: 44))
                    .symbolEffect(.bounce, value: isAnimating)
                Image(systemName: "bicycle")
                    .font(.system(size: 44))
                    .symbolEffect(.bounce, value: isAnimating)
            }
            .foregroundStyle(LinearGradient(
                colors: [.yellow, .orange],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ))
            .accessibilityHidden(true)

            Text(LocaleService.t("Sin anuncios, independiente", "Ad-free and independent"))
                .font(.title)
                .fontWeight(.bold)
                .multilineTextAlignment(.center)

            Text(LocaleService.t(
                "Quita todos los anuncios y disfruta de una app más limpia y rápida. No es un negocio: la suscripción solo ayuda a cubrir el coste de mantener el proyecto, que seguirá siendo gratis para todos.",
                "Remove every ad and enjoy a cleaner, faster app. It's not a business: the subscription only helps cover the cost of running the project, which will stay free for everyone."
            ))
            .font(.body)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 12)
    }

    // MARK: - Benefits

    private var benefitsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            featureRow(icon: "hand.raised.slash",
                       text: LocaleService.t("Sin anuncios en ninguna pantalla", "No ads on any screen"))
            featureRow(icon: "bolt.fill",
                       text: LocaleService.t("Una experiencia más limpia y rápida", "A cleaner, faster experience"))
            featureRow(icon: "heart.fill",
                       text: LocaleService.t("Ayuda a cubrir el coste de los servidores y el mantenimiento",
                                             "Helps cover the cost of the servers and upkeep"))
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    // MARK: - Bottom buttons (fijos, fuera del scroll)

    private var bottomButtons: some View {
        VStack(spacing: 12) {
            Divider()
                .padding(.bottom, 4)

            Button {
                markDone()
                AnalyticsService.shared.logEvent("onboarding_action", parameters: [
                    "onboarding_step": "premium_showcase",
                    "action": "try_premium",
                ])
                PremiumService.shared.presentPaywall(.general)
                onDismiss()
            } label: {
                Text(LocaleService.t("Probar 7 días gratis", "Try 7 days free"))
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.accentColor)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal, 32)
            .accessibilityHint(LocaleService.t(
                "Inicia la prueba gratuita de 7 días sin anuncios.",
                "Start the 7-day free ad-free trial."
            ))

            Button {
                markDone()
                AnalyticsService.shared.logEvent("onboarding_action", parameters: [
                    "onboarding_step": "premium_showcase",
                    "action": "continue_free",
                ])
                onDismiss()
            } label: {
                Text(LocaleService.t("Continuar con anuncios", "Continue with ads"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .accessibilityHint(LocaleService.t(
                "Cerrar y usar la app gratis con anuncios.",
                "Close and use the app for free with ads."
            ))

            Text(LocaleService.t(
                "Cancela cuando quieras desde Ajustes → Apple ID",
                "Cancel anytime from Settings → Apple ID"
            ))
            .font(.caption)
            .foregroundStyle(.tertiary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 32)
            .padding(.bottom, 48)
        }
        .background(Color(.systemBackground))
    }

    // MARK: - Reusable sub-views

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

    // MARK: - Helpers

    private func markDone() {
        // Marca el gate vivo de esta pantalla. Los flags legacy `ads_intro_done`
        // (2.3) y `premium_showcase_done` (2.0) se retiraron el 2026-07-19 (ya
        // saturados a `true` en el parque, no los lee nadie).
        UserDefaults.standard.set(true, forKey: "ads_intro_v4_done")
    }
}
