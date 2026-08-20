import SwiftUI

/// Cintillo "Hoy" — carrusel horizontal de carreras destacadas editado desde panel admin.
/// Aparece encima del selector de días en TodayView.
/// Cada slide puede apuntar a una jornada, startlist u orden de salida.
///
/// Diseño: tarjeta estilo "App Store Today" — superficie con esquinas
/// redondeadas, márgenes laterales y material translúcido. El color de marca
/// de la carrera se usa como ACENTO (barra lateral + tinte muy leve del
/// material), no como fondo a sangre. Indicador de página (dots) en la base.
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

    @State private var viewModel = TodayHighlightsViewModel()
    @State private var currentIndex: Int = 0
    /// Dirección del último cambio de slide (+1 adelante, -1 atrás). Gobierna
    /// la dirección de la transición de deslizamiento.
    @State private var slideForward: Bool = true
    @State private var advanceTimer: Timer?
    /// Wrappers para presentar el destino del slide tocado.
    @State private var stageDestination: IdentifiableID?
    @State private var raceDestination: IdentifiableID?
    @State private var startlistDestination: IdentifiableID?
    @State private var startOrderDestination: IdentifiableID?

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
        .sheet(item: $startlistDestination) { wrapper in
            NavigationStack {
                StartlistView(raceId: wrapper.id, showDismissButton: true)
            }
        }
        .sheet(item: $startOrderDestination) { wrapper in
            NavigationStack {
                StartOrderView(raceDayId: wrapper.id, showDismissButton: true)
            }
        }
        .navigationDestination(item: $stageDestination) { wrapper in
            StageDetailView(raceDayId: wrapper.id)
        }
        .navigationDestination(item: $raceDestination) { wrapper in
            RaceDetailView(raceId: wrapper.id)
        }
    }

    // MARK: - Tarjeta

    private var bannerCard: some View {
        // La tarjeta toma su altura del contenido (slide + dots). El color de
        // marca tiñe muy levemente el material y pinta una barra lateral; el
        // dismiss vive dentro de la tarjeta, top-trailing, discreto.
        //
        // Un único slide visible: el auto-advance / swipe cambia el índice y la
        // transición `.move` desliza en la dirección del gesto. No se usa
        // TabView (infla con chrome interno y captura el gesto antes que el
        // DragGesture) ni ScrollView paging (binding Int? frágil).
        VStack(spacing: 0) {
            ZStack(alignment: .topTrailing) {
                slideRow
                dismissButton
            }
            if viewModel.items.count > 1 {
                pageDots
                    .padding(.bottom, 10)
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
                    startAdvance()
                }
        )
        .onAppear { startAdvance() }
        .onDisappear { stopAdvance() }
        .onChange(of: viewModel.items.count) { _, _ in startAdvance() }
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
                .id(currentIndex)
                .transition(slideTransition)
        }
    }

    /// Superficie de la tarjeta: material translúcido con un tinte muy leve del
    /// color de marca encima. Sin barra de acento lateral — la identidad de
    /// color vive en el tinte del material y en el dot activo de paginación.
    @ViewBuilder
    private var cardSurface: some View {
        ZStack {
            Rectangle().fill(.regularMaterial)
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

    /// X discreta de dismiss, dentro de la tarjeta (top-trailing).
    private var dismissButton: some View {
        Button {
            Haptics.play(.selection)
            stopAdvance()
            withAnimation { viewModel.dismiss() }
        } label: {
            Image(systemName: "xmark")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .opacity(0.55)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(LocaleService.t("Cerrar destacado", "Dismiss highlight"))
    }

    /// Indicador de página estilo iOS: punto activo con color de marca, resto
    /// en quaternary. Animación de tamaño al cambiar de slide.
    private var pageDots: some View {
        HStack(spacing: 6) {
            ForEach(viewModel.items.indices, id: \.self) { idx in
                Circle()
                    .fill(idx == currentIndex
                          ? (currentAccentColor ?? Color.accentColor)
                          : Color.secondary.opacity(0.28))
                    .frame(width: idx == currentIndex ? 7 : 6,
                           height: idx == currentIndex ? 7 : 6)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: currentIndex)
        .accessibilityHidden(true)
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
                // Título con padding derecho propio para no chocar con la X.
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .padding(.trailing, 30)
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
            Spacer(minLength: 0)
        }
        // Padding interno generoso y simétrico en los lados.
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, viewModel.items.count > 1 ? 12 : 14)
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
        case .stage(let id):       stageDestination     = IdentifiableID(id: id)
        case .race(let id):        raceDestination      = IdentifiableID(id: id)
        case .startlist(let id):   startlistDestination = IdentifiableID(id: id)
        case .startOrder(let id):  startOrderDestination = IdentifiableID(id: id)
        // El push a Campeonatos lo hace el padre por VALOR (ver `onTapChampionships`).
        case .championships:       onTapChampionships?()
        // Fichajes vive como TAB propio (4.0): se conmuta la pestaña vía el
        // mismo canal que los deep links en vez de empujar al stack de Hoy.
        case .transfers:
            NotificationManager.shared.pendingDeepLink = .tab(2)
        }
    }

    // MARK: - Auto-advance

    /// Avanza un slide en la dirección dada, fijando antes `slideForward` para
    /// que la transición deslice en el sentido correcto.
    private func advance(forward: Bool) {
        guard viewModel.items.count > 1 else { return }
        slideForward = forward
        withAnimation(.easeInOut(duration: 0.3)) {
            if forward {
                currentIndex = (currentIndex + 1) % viewModel.items.count
            } else {
                currentIndex = (currentIndex - 1 + viewModel.items.count) % viewModel.items.count
            }
        }
    }

    private func startAdvance() {
        stopAdvance()
        guard viewModel.items.count > 1 else { return }
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
