import SwiftUI

/// Pantalla one-shot de selección de idioma: primer paso del onboarding tanto
/// para instalaciones nuevas como para actualizaciones desde 2.0.x — controlada
/// por `LocaleService.hasShownLanguageAnnouncement`. El usuario elige idioma sin
/// coste (el inglés dejó de ser Premium en 2.1).
///
/// Usuarios que ya tenían inglés activado en 2.0 (Premium) saltan esta
/// pantalla automáticamente (migración en `LocaleService.init`).
struct LanguageAnnouncementOnboardingView: View {
    @State private var localeService = LocaleService.shared
    @State private var isAnimating = false
    @ScaledMetric(relativeTo: .largeTitle) private var iconSize: CGFloat = 72
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            GeometryReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        Spacer(minLength: 32)

                Image(systemName: "globe")
                    .font(.system(size: iconSize))
                    .foregroundStyle(.secondary)
                    .symbolEffect(.bounce, value: isAnimating)
                    .accessibilityHidden(true)
                    .padding(.bottom, 20)

                Text(localeService.t(
                    "Elige tu idioma",
                    "Choose your language"
                ))
                .ccFont(.s28, weight: .bold)
                .multilineTextAlignment(.center)
                .padding(.bottom, 32)

                        Spacer(minLength: 32)

                        VStack(spacing: 12) {
                    Button {
                        choose(.spanish)
                    } label: {
                        HStack(spacing: 10) {
                            // Bandera como imagen SVG (no emoji): dentro de un
                            // botón `.borderedProminent` el emoji se aplana al
                            // color de primer plano y se ve "roto" (monocromo).
                            CountryFlag(countryCode: "es", width: 26)
                                .accessibilityHidden(true)
                            Text("Continuar en español")
                                .ccFont(.s16, weight: .semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.accentColor)
                    .buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))
                    .accessibilityHint("Mantiene la app en español.")
                    .accessibilityInputLabels(["Español", "Continuar en español"])

                    Button {
                        choose(.english)
                    } label: {
                        HStack(spacing: 10) {
                            CountryFlag(countryCode: "gb", width: 26)
                                .accessibilityHidden(true)
                            Text("Switch to English")
                                .ccFont(.s14)
                        }
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .accessibilityHint("Switches the app to English.")
                    .accessibilityInputLabels(["English", "Switch to English"])
                        }
                        .padding(.horizontal, 32)
                        .padding(.bottom, 32)
                    }
                    .frame(minHeight: proxy.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        .accessibilityElement(children: .contain)
        .onAppear {
            AnalyticsService.shared.logEvent("onboarding_view", parameters: [
                "onboarding_step": "language_announcement",
            ])
            AccessibilityAnnouncement.screenChanged()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                isAnimating = true
            }
        }
    }

    private func choose(_ locale: LocaleService.AppLocale) {
        localeService.setLocale(locale)
        localeService.markLanguageAnnouncementShown()
        AnalyticsService.shared.logEvent("onboarding_action", parameters: [
            "onboarding_step": "language_announcement",
            "action": locale.rawValue,
        ])
        AccessibilityAnnouncement.announce("Idioma: \(locale.label)")
        onDismiss()
    }
}
