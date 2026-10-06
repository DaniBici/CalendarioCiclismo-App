import SwiftUI

/// Cintillo "Hoy" — carrusel horizontal de carreras destacadas editado desde panel admin.
/// Aparece encima del selector de días en TodayView.
/// Cada slide puede apuntar a una jornada, startlist u orden de salida.
///
/// Diseño: tarjeta estilo "App Store Today" — superficie con esquinas
/// redondeadas, márgenes laterales y material translúcido. El color de marca
/// de la carrera se usa como ACENTO (barra lateral + tinte muy leve del
/// material), no como fondo a sangre. Las flechas quedan contenidas en los
/// límites laterales y no se muestran indicadores de página adicionales.
struct TodayHighlightsBanner: View {
    /// Navegación a la pantalla de Campeonatos: la delega el PADRE (TodayView),
    /// que la empuja por VALOR (`ChampionshipsRoute`) sobre el `NavigationStack`.
    ///
    /// ⚠️ Antes este banner navegaba a Campeonatos con un `@State`
    /// (`championshipsDestination`) + `navigationDestination(item:)` propios. Pero
    /// el banner muta su estado cada 5 s (auto-advance del carrusel: `currentIndex`
    /// + `Timer`); con una pantalla empujada desde ese `item:`, el siguiente tick
    /// del timer re-resolvía el destino y RECREABA `ChampionshipsView` desde cero
    /// ("Cargando campeonatos…"), perdiendo la navegación a la prueba que el
    /// usuario acababa de tocar dentro de la rejilla → "te devuelve a la misma
    /// pantalla y solo al pulsar atrás aparece el campeonato". Sacar el destino
    /// del banner volátil y empujarlo por valor desde el root estable lo arregla.
    var onTapChampionships: (() -> Void)? = nil
    /// Entrega el destino al contenedor estable que posee el `NavigationStack`.
    /// Evita registrar destinos dentro del carrusel, que puede quedar alojado en
    /// un contenedor diferido y ser ignorado por SwiftUI 27.1.
    var onOpenTarget: ((TodayHighlightTarget) -> Void)? = nil

    /// Sección del cintillo: "road" en Hoy/carretera y "cx" en la agenda de
    /// Ciclocross. Independiza ambas fuentes editoriales.
    let scope: String

    init(
        scope: String = "road",
        onTapChampionships: (() -> Void)? = nil,
        onOpenTarget: ((TodayHighlightTarget) -> Void)? = nil
    ) {
        self.scope = scope
        self.onTapChampionships = onTapChampionships
        self.onOpenTarget = onOpenTarget
        _viewModel = State(initialValue: TodayHighlightsViewModel(scope: scope))
    }

    @State private var viewModel: TodayHighlightsViewModel
    @State private var currentIndex: Int = 0
    /// Dirección del último cambio de slide (+1 adelante, -1 atrás). Gobierna
    /// la dirección de la transición de deslizamiento.
    @State private var slideForward: Bool = true
    @State private var advanceTimer: Timer?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled

    // MARK: - Métricas de diseño

    private let cardCornerRadius: CGFloat = 18
    private let cardHorizontalMargin: CGFloat = 16
    private let logoSide: CGFloat = 34

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.shouldShow {
                bannerCard
                    .transition(.asymmetric(insertion: .opacity, removal: .opacity))
            }
        }
        .task { await viewModel.load() }
    }

    // MARK: - Tarjeta

    private var bannerCard: some View {
        // La tarjeta toma su altura del contenido. El color de
        // marca tiñe muy levemente el material.
        //
        // Un único slide visible: el auto-advance / swipe cambia el índice y la
        // transición `.move` desliza en la dirección del gesto. No se usa
        // TabView (infla con chrome interno y captura el gesto antes que el
        // DragGesture) ni ScrollView paging (binding Int? frágil).
        ZStack {
            slideRow
            if viewModel.items.count > 1 {
                HStack(spacing: 0) {
                    bannerArrow(forward: false)
                    Spacer(minLength: 0)
                    bannerArrow(forward: true)
                }
            }
        }
        .background(cardSurface)
        .clipShape(RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous))
        .overlay(
            // Hairline de borde para definir la tarjeta sobre fondos claros,
            // donde el material casi se funde con systemBackground.
            RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
        )
        .shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 3)
        .padding(.horizontal, cardHorizontalMargin)
        // Swipe horizontal manual para cambiar de slide. `highPriorityGesture`
        // garantiza que SwiftUI atienda primero el swipe antes que cualquier
        // tap interno o scroll vertical del padre.
        .highPriorityGesture(
            DragGesture(minimumDistance: 20)
                .onEnded { value in
                    guard viewModel.items.count > 1 else { return }
                    let dx = value.translation.width
                    let dy = value.translation.height
                    // Aceptar solo gestos predominantemente horizontales.
                    guard abs(dx) > 30, abs(dx) > abs(dy) * 1.5 else { return }
                    stopAdvance()
                    advance(forward: dx < 0)
                }
        )
        .onAppear { startAdvance() }
        .onDisappear { stopAdvance() }
        .onChange(of: viewModel.items.count) { _, _ in startAdvance() }
        .onChange(of: voiceOverEnabled) { _, enabled in
            if enabled {
                stopAdvance()
            } else {
                startAdvance()
            }
        }
    }

    /// Fila principal del slide actual (logo + textos), con su transición
    /// de deslizamiento horizontal direccional.
    @ViewBuilder
    private var slideRow: some View {
        if let item = viewModel.items[safe: currentIndex] {
            // Sustituido el Button por slideLabel + onTapGesture: el Button
            // capturaba el touch antes de que el DragGesture pudiera detectar
            // el swipe horizontal. Con tap+drag explícitos coexisten sin
            // conflicto.
            slideLabel(item: item)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture { tapSlide(item) }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(item.title), \(item.detail)")
                .accessibilityAddTraits(.isButton)
                .accessibilityHint(LocaleService.t(
                    "Pulsa dos veces para abrir este destacado",
                    "Double-tap to open this highlight"
                ))
                .accessibilityAction { tapSlide(item) }
                .id(currentIndex)
                .transition(slideTransition)
        }
    }

    /// Superficie de la tarjeta: material translúcido con un tinte muy leve del
    /// color de marca encima y sin barra de acento lateral.
    @ViewBuilder
    private var cardSurface: some View {
        ZStack {
            Rectangle().fill(AppTheme.cardBackground)
            if let accent = currentAccentColor {
                accent.opacity(0.07)
            }
        }
    }

    /// Color de marca de la carrera actual, si está definido y es parseable.
    private var currentAccentColor: Color? {
        let item = viewModel.items[safe: currentIndex] ?? viewModel.items.first
        guard let hex = item?.accentHex, let color = Color(fromHex: hex) else { return nil }
        return color
    }

    private func bannerArrow(forward: Bool) -> some View {
        Button {
            stopAdvance()
            advance(forward: forward)
        } label: {
            Image(systemName: forward ? "chevron.right" : "chevron.left")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.secondary)
                .frame(width: 44, height: 44)
                // La flecha forma parte de la superficie del cintillo: replica
                // tanto el fondo de tarjeta como su tinte de carrera.
                .background(cardSurface)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            forward
                ? LocaleService.t("Destacado siguiente", "Next highlight")
                : LocaleService.t("Destacado anterior", "Previous highlight")
        )
    }

    private func slideLabel(item: TodayHighlightView) -> some View {
        HStack(spacing: 12) {
            // Slot de logo de tamaño fijo: reserva el espacio aunque el
            // AsyncImage aún no haya cargado, evitando saltos de layout. Cuando
            // NO hay logo (ni icono de campeonatos), no se emite nada: el slot
            // no ocupa espacio y el texto se desplaza a la izquierda a ocuparlo
            // (el spacing del HStack solo se aplica entre vistas visibles).
            if item.isChampionships {
                // Mismo logo que la fila de Campeonatos de Mes/Temporada: el globo
                // terráqueo Europa/África (asset `GlobeEuropeAfrica`, Twemoji 1F30D
                // monocromo) teñido con el color de marca del slide, en lugar del
                // antiguo `flag.checkered` de sistema.
                Image("GlobeEuropeAfrica")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .padding(3)
                    .foregroundStyle(currentAccentColor ?? Color.accentColor)
                    .frame(width: logoSide, height: logoSide)
            } else if item.isTransfers {
                // Mismo icono que la pestaña Fichajes (flechas de intercambio).
                Image(systemName: "arrow.left.arrow.right")
                    .resizable()
                    .scaledToFit()
                    .padding(6)
                    .foregroundStyle(currentAccentColor ?? Color.accentColor)
                    .frame(width: logoSide, height: logoSide)
            } else if item.isSeason {
                // Mismo icono que la pestaña Calendario.
                Image(systemName: "calendar")
                    .resizable()
                    .scaledToFit()
                    .padding(6)
                    .foregroundStyle(currentAccentColor ?? Color.accentColor)
                    .frame(width: logoSide, height: logoSide)
            } else if item.cxRace != nil || item.cxTournament != nil {
                RaceLogo(item.logoUrl, size: logoSide)
            } else if let logoUrl = item.logoUrl, let url = URL(string: logoUrl) {
                AsyncImage(url: url) { phase in
                    if let img = phase.image {
                        img.resizable().scaledToFit()
                    } else {
                        Color.clear
                    }
                }
                .frame(width: logoSide, height: logoSide)
            }

            VStack(alignment: .leading, spacing: 2) {
                // El título utiliza todo el ancho central disponible entre el
                // identificador y la flecha lateral del carrusel.
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                // Subtítulo + chevron en la misma fila — el chevron no compite
                // por espacio con el título.
                HStack(spacing: 5) {
                    Text(item.detail)
                        .font(.caption.weight(.regular))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary.opacity(0.55))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // Padding interno generoso y simétrico en los lados.
        .padding(.horizontal, viewModel.items.count > 1 ? 44 : 14)
        .padding(.top, 14)
        .padding(.bottom, 14)
        .contentShape(Rectangle())
    }

    /// Transición de deslizamiento direccional: el slide entrante llega desde
    /// el lado hacia el que avanza el carrusel y el saliente se va por el opuesto.
    private var slideTransition: AnyTransition {
        .asymmetric(
            insertion: .move(edge: slideForward ? .trailing : .leading).combined(with: .opacity),
            removal: .move(edge: slideForward ? .leading : .trailing).combined(with: .opacity)
        )
    }

    private func tapSlide(_ item: TodayHighlightView) {
        Haptics.play(.primaryAction)
        stopAdvance()
        guard let target = item.target else { return }
        switch target {
        case .stage, .race, .startlist, .startOrder:
            onOpenTarget?(target)
        // El push a Campeonatos lo hace el padre por VALOR (ver `onTapChampionships`).
        case .championships:       onTapChampionships?()
        // Fichajes vive como TAB propio (4.0): se conmuta la pestaña vía el
        // mismo canal que los deep links en vez de empujar al stack de Hoy.
        case .transfers:
            NotificationManager.shared.pendingDeepLink = .tab(2)
        // Calendario también es pestaña propia: abre Temporada en el año indicado.
        case .season(let year):
            NotificationManager.shared.pendingDeepLink = .season(year)
        case .cxRace(let id):
            NotificationManager.shared.pendingDeepLink = .cxRace(id, anchor: nil)
        case .cxTournament:
            // La página de torneo se resuelve por slug; el destino reutiliza el
            // deep link nativo de series.
            if let slug = item.cxTournament?.slug {
                NotificationManager.shared.pendingDeepLink = .cxTournamentSlug(slug)
            }
        }
    }

    // MARK: - Auto-advance

    /// Avanza un slide en la dirección dada, fijando antes `slideForward` para
    /// que la transición deslice en el sentido correcto.
    private func advance(forward: Bool) {
        guard viewModel.items.count > 1 else { return }
        slideForward = forward
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
            if forward {
                currentIndex = (currentIndex + 1) % viewModel.items.count
            } else {
                currentIndex = (currentIndex - 1 + viewModel.items.count) % viewModel.items.count
            }
        }
    }

    private func startAdvance() {
        stopAdvance()
        guard viewModel.items.count > 1, !reduceMotion, !voiceOverEnabled else { return }
        advanceTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task { @MainActor in
                advance(forward: true)
            }
        }
    }

    private func stopAdvance() {
        advanceTimer?.invalidate()
        advanceTimer = nil
    }
}

// MARK: - Helpers

private extension Color {
    init?(fromHex hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count == 6 else { return nil }
        var rgb: UInt64 = 0
        guard Scanner(string: h).scanHexInt64(&rgb) else { return nil }
        let r = Double((rgb >> 16) & 0xFF) / 255.0
        let g = Double((rgb >> 8) & 0xFF) / 255.0
        let b = Double(rgb & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
