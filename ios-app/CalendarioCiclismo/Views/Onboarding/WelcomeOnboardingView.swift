import SwiftUI

/// Pasos de la bienvenida. El primero sin completar es el que espera
/// respuesta; `done` indica que la bienvenida no se muestra.
///
/// Cada paso conserva su marca de persistencia anterior, de modo que quien
/// dejó la bienvenida a medias la retoma en su paso:
/// - `language`: `LocaleService.hasShownLanguageAnnouncement`. Quien ya usaba
///   la app en inglés lo tiene completado (migración en `LocaleService.init`).
/// - `notifications`: `NotificationManager.hasCompletedOnboarding`.
/// - `support`: `support_intro_v4_3_1_done`.
enum WelcomeStep: Int, Comparable {
    case language
    case notifications
    case support
    case done

    static let supportDoneKey = "support_intro_v4_3_1_done"

    static func < (lhs: WelcomeStep, rhs: WelcomeStep) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    @MainActor
    static func firstPending() -> WelcomeStep {
        if !LocaleService.shared.hasShownLanguageAnnouncement { return .language }
        if !NotificationManager.shared.hasCompletedOnboarding { return .notifications }
        if !UserDefaults.standard.bool(forKey: supportDoneKey) { return .support }
        return .done
    }
}

/// Posición de la marca en el arranque. La imagen `LaunchLogo` mide
/// 100 × 212 pt con los símbolos centrados en sus 100 pt superiores: el sistema
/// la centra en la pantalla de lanzamiento y los símbolos quedan 56 pt por
/// encima del centro, de modo que símbolos, nombre y lema forman un bloque
/// centrado. `SplashView` y la bienvenida la dibujan en el mismo punto.
enum LaunchBrandLayout {
    static let logoSize = CGSize(width: 100, height: 212)
    /// Distancia del centro de los símbolos al centro de la pantalla.
    static let markLift: CGFloat = 56
    /// Distancia del centro de los símbolos al centro del bloque de texto.
    static let textDrop: CGFloat = 98
    /// Altura del perfil anclado al borde inferior.
    static let profileHeight: CGFloat = 230

    static let titleColor = Color(light: "1f2937", dark: "f2f3f5")
    static let taglineColor = Color(light: "536174", dark: "a9adb5")
}

/// Bienvenida única de la app: idioma, notificaciones y apoyo al proyecto en
/// una sola pantalla. Los pasos aparecen de uno en uno, cada uno al responder
/// el anterior, y el botón de entrada solo se muestra con el tercero.
///
/// La vista hace también de pantalla de arranque: empieza con la marca y el
/// perfil donde los deja la pantalla de lanzamiento del sistema y los sube a
/// su sitio antes de mostrar el primer paso.
struct WelcomeOnboardingView: View {
    @State private var localeService = LocaleService.shared
    @State private var notifications = NotificationManager.shared
    @State private var premium = PremiumService.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    /// Paso que espera respuesta.
    @State private var step = WelcomeStep.firstPending()
    /// Marca y perfil en la posición del arranque.
    @State private var isLaunchLayout = true
    /// Los pasos se muestran al terminar la subida.
    @State private var showsSteps = false
    @State private var textOpacity: Double = 0
    @State private var markFrame: CGRect?
    @State private var textFrame: CGRect?
    @State private var profileFrame: CGRect?
    @State private var notificationsOn = NotificationManager.shared.isSubscribed
    @State private var isRequestingPermission = false
    /// Fundido de salida hacia la pestaña inicial.
    @State private var isClosing = false

    let onFinish: () -> Void

    private static let profileHeight: CGFloat = 146
    private static let closeDuration: Double = 0.6
    private static let compactProfileHeight: CGFloat = 104

    var body: some View {
        GeometryReader { proxy in
            let insets = proxy.safeAreaInsets
            let screenHeight = proxy.size.height + insets.top + insets.bottom
            ZStack {
                AppTheme.background
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 0) {
                        header(screenHeight: screenHeight, topInset: insets.top, horizontalInsets: (insets.leading, insets.trailing))

                        if showsSteps {
                            steps
                                .frame(maxWidth: AdaptiveLayoutPolicy.onboardingWidth)
                        }

                        Spacer(minLength: 24)

                        if showsSteps, step == .support {
                            footer
                                .frame(maxWidth: AdaptiveLayoutPolicy.onboardingWidth)
                                .transition(Self.stepTransition)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollDisabled(isLaunchLayout)
                // En el arranque el perfil se dibuja hasta el borde físico.
                .scrollClipDisabled()
            }
        }
        // El fundido de salida vive en la vista: un cambio de estado de `App`
        // no anima la retirada de una vista de la escena.
        .opacity(isClosing ? 0 : 1)
        .allowsHitTesting(!isClosing)
        .accessibilityElement(children: .contain)
        .task { await playLaunch() }
    }

    // MARK: - Cabecera

    private func header(screenHeight: CGFloat, topInset: CGFloat, horizontalInsets: (leading: CGFloat, trailing: CGFloat)) -> some View {
        let markCenter = screenHeight / 2 - LaunchBrandLayout.markLift
        let finalProfileHeight = screenHeight < 700 ? Self.compactProfileHeight : Self.profileHeight
        // Hasta medir, la posición final de los símbolos se deduce del área
        // segura: el primer fotograma coincide con la pantalla de lanzamiento.
        let markOffset = markCenter - (markFrame?.midY ?? topInset + 50)
        let textOffset = markCenter + LaunchBrandLayout.textDrop - (textFrame?.midY ?? 0)
        let profileOffset = screenHeight - LaunchBrandLayout.profileHeight - (profileFrame?.minY ?? 0)

        return VStack(spacing: 0) {
            Image("LaunchLogo")
                .resizable()
                .scaledToFit()
                .frame(width: LaunchBrandLayout.logoSize.width, height: LaunchBrandLayout.logoSize.height)
                .frame(width: 100, height: 100, alignment: .top)
                .accessibilityHidden(true)
                .offset(y: isLaunchLayout ? markOffset : 0)
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { markFrame = $0 }

            VStack(spacing: 6) {
                Text("Calendario Ciclismo")
                    .ccFont(.s28, weight: .bold)
                    .foregroundStyle(LaunchBrandLayout.titleColor)
                Text(tr("Ciclismo, al instante.", "Cycling, instantly."))
                    .ccFont(.s16)
                    .foregroundStyle(LaunchBrandLayout.taglineColor)
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .opacity(textFrame == nil ? 0 : textOpacity)
            .offset(y: isLaunchLayout ? textOffset : 0)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { textFrame = $0 }
            // Los símbolos ocupan el centro de un cuadro de 100 pt.
            .padding(.top, -21)

            // El hueco conserva la altura final: el perfil del arranque, más
            // alto, lo desborda sin mover los pasos.
            Color.clear
                .frame(height: finalProfileHeight)
                .overlay(alignment: .top) {
                    AnimatedRouteProfile(
                        lineColor: AppTheme.brandAccent,
                        fillColor: AppTheme.brandAccent.opacity(0.18),
                        baseOpacity: 0
                    )
                    .frame(height: isLaunchLayout ? LaunchBrandLayout.profileHeight : finalProfileHeight)
                    .opacity(profileFrame == nil ? 0 : 1)
                    .offset(y: isLaunchLayout ? profileOffset : 0)
                    // De borde a borde también con márgenes laterales de
                    // seguridad (pantalla interior del iPhone Duo en
                    // horizontal): sin esto el perfil acaba antes del borde.
                    .padding(.leading, -horizontalInsets.leading)
                    .padding(.trailing, -horizontalInsets.trailing)
                }
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { profileFrame = $0 }
                .padding(.top, 6)
        }
    }

    // MARK: - Pasos

    private static let stepTransition: AnyTransition = .opacity.combined(with: .offset(y: 12))

    private var steps: some View {
        VStack(spacing: 12) {
            languageCard
                .transition(Self.stepTransition)
            if step >= .notifications {
                notificationsCard
                    .transition(Self.stepTransition)
            }
            if step >= .support {
                supportCard
                    .transition(Self.stepTransition)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
    }

    private var languageCard: some View {
        let pending = step == .language
        return stepCard {
            HStack(spacing: 12) {
                stepIcon("globe")
                // Sin idioma elegido, el rótulo va en los dos.
                Text(pending ? "Idioma / Language" : localeService.t("Idioma", "Language"))
                    .ccFont(.s14, weight: .semibold)
                Spacer(minLength: 0)
                if !pending {
                    Picker(localeService.t("Idioma", "Language"), selection: Binding(
                        get: { localeService.current },
                        set: { option in
                            guard option != localeService.current else { return }
                            localeService.setLocale(option)
                            Haptics.play(.selection)
                            AccessibilityAnnouncement.announce("Idioma: \(option.label)")
                            Task { await notifications.healSubscriptionIfNeeded() }
                        }
                    )) {
                        ForEach(LocaleService.AppLocale.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                    .transition(.opacity)
                }
            }
            if pending {
                HStack(spacing: 8) {
                    // Los dos idiomas con el mismo peso: ninguno se destaca.
                    choiceButton("Español", prominent: true) {
                        chooseLanguage(.spanish)
                    }
                    .accessibilityHint("Mantiene la app en español.")
                    choiceButton("English", prominent: true) {
                        chooseLanguage(.english)
                    }
                    .accessibilityHint("Switches the app to English.")
                }
            }
        }
    }

    private var notificationsCard: some View {
        let pending = step == .notifications
        return stepCard {
            HStack(spacing: 12) {
                stepIcon("bell")
                VStack(alignment: .leading, spacing: 2) {
                    Text(tr("Notificaciones", "Notifications"))
                        .ccFont(.s14, weight: .semibold)
                    Text(tr("Solo grandes citas y novedades", "Only major races and updates"))
                        .ccFont(.s12)
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 0)
                if !pending {
                    Toggle(tr("Notificaciones", "Notifications"), isOn: Binding(
                        get: { notificationsOn },
                        set: { setNotifications($0) }
                    ))
                    .labelsHidden()
                    .tint(Color.accentColor)
                    .disabled(isRequestingPermission)
                    .transition(.opacity)
                }
            }
            if pending {
                HStack(spacing: 8) {
                    choiceButton(tr("Activar", "Turn on"), prominent: true) {
                        answerNotifications(enable: true)
                    }
                    .accessibilityIdentifier(AccessibilityID.onboardingEnableButton)
                    .accessibilityInputLabels([tr("Activar notificaciones", "Turn on notifications"), tr("Activar", "Turn on")])
                    choiceButton(tr("Ahora no", "Not now"), prominent: false) {
                        answerNotifications(enable: false)
                    }
                    .accessibilityIdentifier(AccessibilityID.onboardingSkipButton)
                }
                .disabled(isRequestingPermission)
            }
        }
    }

    private var supportCard: some View {
        stepCard {
            HStack(alignment: .top, spacing: 12) {
                stepIcon("heart", tint: Color.accentColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text(supportTitle)
                        .ccFont(.s14, weight: .semibold)
                    Text(supportBody)
                        .ccFont(.s12)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    // Amigo solo se ofrece tras la primera comprobación de
                    // compras, y nunca a quien ya lo tiene activo.
                    if !premium.isSubscribed, premium.hasRefreshedPurchaseState {
                        choiceButton(supportActionTitle, prominent: false, filledInDark: true) {
                            logAction(step: "premium_showcase", action: premium.legacyPremiumEntitlementActive
                                ? "open_contributions" : "open_support")
                            premium.presentSupport()
                        }
                        .padding(.top, 10)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private var footer: some View {
        VStack(spacing: 14) {
            Button {
                finish()
            } label: {
                Text(tr("Abrir Calendario Ciclismo", "Open Calendario Ciclismo"))
                    .ccFont(.s16, weight: .semibold)
                    .foregroundStyle(AppTheme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.accentColor)
            .buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))

            Text(tr("Todo se puede cambiar después en Ajustes.", "You can change everything later in Settings."))
                .ccFont(.s12)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        // Mismo margen lateral que las tarjetas de los pasos: el botón queda
        // alineado con sus bordes.
        .padding(.horizontal, 20)
        .padding(.bottom, 32)
    }

    // MARK: - Piezas

    private func stepCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) { content() }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .ccCardSurface()
    }

    private func stepIcon(_ name: String, tint: Color = .secondary) -> some View {
        Image(systemName: name)
            .font(.title3)
            .foregroundStyle(tint)
            .frame(width: 28)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private func choiceButton(
        _ title: String,
        prominent: Bool,
        filledInDark: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        let label = Text(title)
            .ccFont(.s14, weight: .semibold)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 3)
        // El botón de apoyo lleva en oscuro el relleno del botón de entrada:
        // allí el acento atenuado pierde contraste. «Ahora no» queda siempre
        // un nivel por debajo de «Activar».
        if prominent || (filledInDark && colorScheme == .dark) {
            Button(action: action) { label.foregroundStyle(AppTheme.onAccent) }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)
                .buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))
        } else {
            Button(action: action) { label }
                .buttonStyle(.bordered)
                .tint(Color.accentColor)
                .buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))
        }
    }

    // MARK: - Textos

    /// Hasta que se elige idioma, la bienvenida habla el del dispositivo.
    private func tr(_ es: String, _ en: String) -> String {
        if step == .language {
            return LocaleService.isDeviceNonSpanish ? en : es
        }
        return localeService.t(es, en)
    }

    private var supportTitle: String {
        premium.isSubscribed
            ? tr("Gracias por apoyar el proyecto", "Thank you for supporting the project")
            : tr("Apoya el proyecto", "Support the project")
    }

    private var supportBody: String {
        premium.isSubscribed
            ? tr(
                "Tu apoyo como Amigo ayuda a cubrir servidores, herramientas y mantenimiento.",
                "Your support as a Friend helps cover servers, tools and maintenance."
            )
            : tr(
                "Gratis, sin anuncios y de código abierto. Si te resulta útil, puedes ayudar a cubrir sus costes. Es voluntario.",
                "Free, ad-free and open source. If you find it useful, you can help cover its costs voluntarily."
            )
    }

    private var supportActionTitle: String {
        premium.legacyPremiumEntitlementActive
            ? tr("Ver aportaciones puntuales", "View one-time contributions")
            : tr("Ver formas de apoyar", "View support options")
    }

    // MARK: - Acciones

    /// Mantiene la posición del arranque, sube la marca y el perfil y muestra
    /// el paso pendiente. Con movimiento reducido no hay desplazamiento.
    private func playLaunch() async {
        guard isLaunchLayout else { return }
        if reduceMotion {
            textOpacity = 1
            isLaunchLayout = false
        } else {
            withAnimation(.easeOut(duration: 0.25)) { textOpacity = 1 }
            try? await Task.sleep(for: .seconds(0.9))
            withAnimation(.easeInOut(duration: 0.85)) { isLaunchLayout = false }
            try? await Task.sleep(for: .seconds(0.8))
        }
        setShown { showsSteps = true }
        logView(step)
        AccessibilityAnnouncement.screenChanged()
    }

    private func chooseLanguage(_ locale: LocaleService.AppLocale) {
        Haptics.play(.selection)
        localeService.setLocale(locale)
        localeService.markLanguageAnnouncementShown()
        logAction(step: "language_announcement", action: locale.rawValue)
        AccessibilityAnnouncement.announce("Idioma: \(locale.label)")
        advance()
    }

    private func answerNotifications(enable: Bool) {
        guard !isRequestingPermission else { return }
        if enable {
            isRequestingPermission = true
            Task {
                await notifications.subscribe()
                notificationsOn = notifications.isSubscribed
                isRequestingPermission = false
                if notificationsOn { Haptics.play(.success) }
                completeNotifications(action: "accepted")
            }
        } else {
            completeNotifications(action: "skipped")
        }
    }

    private func completeNotifications(action: String) {
        notifications.hasCompletedOnboarding = true
        logAction(step: "notifications", action: action)
        advance()
    }

    private func setNotifications(_ enabled: Bool) {
        notificationsOn = enabled
        isRequestingPermission = true
        Task {
            if enabled {
                await notifications.subscribe()
            } else {
                await notifications.unsubscribe()
            }
            // Sin permiso del sistema el interruptor vuelve a apagado.
            notificationsOn = notifications.isSubscribed
            isRequestingPermission = false
            Haptics.play(notificationsOn ? .success : .toggle)
        }
    }

    private func advance() {
        let next = WelcomeStep.firstPending()
        setShown { step = next }
        logView(next)
    }

    private func finish() {
        Haptics.play(.primaryAction)
        UserDefaults.standard.set(true, forKey: WelcomeStep.supportDoneKey)
        let action = premium.isSubscribed ? "continue" : premium.isFounder ? "continue_founder" : "continue_free"
        logAction(step: "premium_showcase", action: action)
        AccessibilityAnnouncement.announce(tr("Entrando en la aplicación.", "Opening the app."))
        guard !reduceMotion else {
            onFinish()
            return
        }
        withAnimation(.easeInOut(duration: Self.closeDuration)) { isClosing = true }
        Task {
            try? await Task.sleep(for: .seconds(Self.closeDuration))
            onFinish()
        }
    }

    private func setShown(_ change: () -> Void) {
        if reduceMotion {
            change()
        } else {
            withAnimation(.easeOut(duration: 0.45), change)
        }
    }

    // MARK: - Analítica

    private func logView(_ step: WelcomeStep) {
        guard let name = Self.analyticsName(step) else { return }
        AnalyticsService.shared.logEvent("onboarding_view", parameters: ["onboarding_step": name])
    }

    private func logAction(step: String, action: String) {
        AnalyticsService.shared.logEvent("onboarding_action", parameters: [
            "onboarding_step": step,
            "action": action,
        ])
    }

    /// Nombres de paso anteriores a la bienvenida única, para no partir las
    /// series de GA4.
    private static func analyticsName(_ step: WelcomeStep) -> String? {
        switch step {
        case .language: "language_announcement"
        case .notifications: "notifications"
        case .support: "premium_showcase"
        case .done: nil
        }
    }
}
