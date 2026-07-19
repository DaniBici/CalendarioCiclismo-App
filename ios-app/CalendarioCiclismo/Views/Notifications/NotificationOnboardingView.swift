import SwiftUI

/// Pantalla de onboarding mostrada la primera vez que el usuario abre la app,
/// ofreciendo suscribirse a las notificaciones push.
struct NotificationOnboardingView: View {
    @State private var manager = NotificationManager.shared
    @State private var isAnimating = false
    @ScaledMetric(relativeTo: .largeTitle) private var iconSize: CGFloat = 64
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Icono animado
                Image(systemName: "bell.badge")
                    .font(.system(size: iconSize))
                    .foregroundStyle(Color.accentColor)
                    .symbolEffect(.bounce, value: isAnimating)
                    .accessibilityHidden(true)
                    .padding(.bottom, 24)

                // Título
                Text("Mantente informado")
                    .font(.title)
                    .fontWeight(.bold)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 12)

                // Descripción
                Text("La app no tiene anuncios y utilizaremos estos avisos solo para notificarte en caso de grandes actualizaciones de contenido o jornadas señaladas del calendario, para que tengas la mejor información a tu disposición. Nada invasivo.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.bottom, 32)

                // Bullets informativos
                VStack(alignment: .leading, spacing: 16) {
                    onboardingBullet(
                        icon: "calendar.badge.clock",
                        text: "Grandes citas del ciclismo"
                    )
                    onboardingBullet(
                        icon: "arrow.triangle.2.circlepath",
                        text: "Actualizaciones de contenido"
                    )
                    onboardingBullet(
                        icon: "hand.raised",
                        text: "Sin spam, solo lo importante"
                    )
                }
                .padding(.horizontal, 48)
                .padding(.bottom, 40)

                Spacer()

                // Botones
                VStack(spacing: 12) {
                    Button {
                        Task {
                            await manager.subscribe()
                            manager.hasCompletedOnboarding = true
                            AnalyticsService.shared.logEvent("onboarding_action", parameters: [
                                "onboarding_step": "notifications",
                                "action": "accepted",
                            ])
                            AccessibilityAnnouncement.announce("Notificaciones activadas. Entrando en la aplicación.")
                            onDismiss()
                        }
                    } label: {
                        Text("Activar notificaciones")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .accessibilityIdentifier(AccessibilityID.onboardingEnableButton)
                    .accessibilityHint("Activa las notificaciones push y accede a la aplicación")
                    .accessibilityInputLabels(["Activar notificaciones", "Activar", "Sí"])

                    Button {
                        manager.hasCompletedOnboarding = true
                        AnalyticsService.shared.logEvent("onboarding_action", parameters: [
                            "onboarding_step": "notifications",
                            "action": "skipped",
                        ])
                        AccessibilityAnnouncement.announce("Entrando en la aplicación.")
                        onDismiss()
                    } label: {
                        Text("Ahora no")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityIdentifier(AccessibilityID.onboardingSkipButton)
                    .accessibilityHint("Omitir y acceder a la aplicación sin activar notificaciones")
                    .accessibilityInputLabels(["Ahora no", "Omitir", "No"])
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 48)
            }
        }
        .accessibilityElement(children: .contain)
        .onAppear {
            AnalyticsService.shared.logEvent("onboarding_view", parameters: [
                "onboarding_step": "notifications",
            ])
            AccessibilityAnnouncement.screenChanged()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                isAnimating = true
            }
        }
    }

    private func onboardingBullet(icon: String, text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.body)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.primary)
        }
        .accessibilityElement(children: .combine)
    }
}
