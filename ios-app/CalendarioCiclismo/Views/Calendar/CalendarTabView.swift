import SwiftUI

private enum CalendarSelection: Identifiable, Hashable {
    case stage(String)
    case race(Race)

    var id: String {
        switch self {
        case .stage(let id): "stage-\(id)"
        case .race(let race): "race-\(race.id)"
        }
    }
}

/// Pestaña Calendario. En ancho compacto conserva la alternancia Mes/Temporada;
/// en tamaño regular amplio presenta ambas superficies dentro del mismo
/// NavigationStack, de modo que cualquier destino sustituya el conjunto.
struct CalendarTabView: View {
    @AppStorage("calendar_subview") private var sub: String = "month"
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var selection: CalendarSelection?

    var body: some View {
        GeometryReader { proxy in
            if AdaptiveLayoutPolicy.usesWideDetail(
                width: proxy.size.width,
                isRegular: horizontalSizeClass == .regular
            ) {
                wideCalendar
            } else {
                compactCalendar
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .background(AppTheme.background.ignoresSafeArea())
        .navigationDestination(for: RaceDay.self) { raceDay in
            StageDetailView(raceDayId: raceDay.id)
        }
        .navigationDestination(for: ChampionshipsRoute.self) { _ in
            ChampionshipsView()
        }
        .navigationDestination(item: $selection) { destination in
            switch destination {
            case .stage(let id): StageDetailView(raceDayId: id)
            case .race(let race): RaceDetailView(raceId: race.id, initialRace: race)
            }
        }
    }

    @ViewBuilder
    private var compactCalendar: some View {
        if sub == "season" {
            SeasonView(
                switchAction: { sub = "month" },
                onOpenStage: { selection = .stage($0) },
                onOpenRace: { selection = .race($0) }
            )
        } else {
            MonthView(switchAction: { sub = "season" })
        }
    }

    @ViewBuilder
    private var wideCalendar: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                MonthView(embedded: true)
                    .frame(width: proxy.size.width * 0.62)
                Divider()
                SeasonView(
                    embedded: true,
                    onOpenStage: { selection = .stage($0) },
                    onOpenRace: { selection = .race($0) }
                )
                    .frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Componentes comunes de Mes y Temporada

/// Pulsación neutra de las filas del calendario: superficie gris al 8 %
/// (`--hover-bg`), sin tinte del color de carrera.
struct CalendarPressStyle: ButtonStyle {
    var cornerRadius: CGFloat = 0

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay {
                if configuration.isPressed {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(AppTheme.neutralFill)
                        .allowsHitTesting(false)
                }
            }
            .contentShape(Rectangle())
    }
}

/// Chip de filtro de categoría (`.tcat-btn`): inactivo sobre la superficie de
/// tarjeta con texto secundario; activo con el acento al 15 % y texto de
/// acento. Chincheta del filtro predeterminado a la derecha.
struct CalendarFilterChipLabel: View {
    let label: String
    let isActive: Bool
    var pinFilled = false
    var pinOutline = false

    var body: some View {
        HStack(spacing: 4) {
            Text(label)
                .ccFont(.s13, weight: isActive ? .semibold : .medium)
            if pinFilled {
                Image(systemName: "pin.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
            } else if pinOutline {
                Image(systemName: "pin")
                    .font(.system(size: 10))
                    .foregroundStyle(Color.accentColor)
                    .opacity(0.55)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(isActive ? Color.accentColor.opacity(0.15) : AppTheme.cardBackground)
        .foregroundStyle(isActive ? Color.accentColor : AppTheme.textMuted)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
    }
}

/// Chip de mes (`.cal-month-chip`): sin fondo en reposo; el activo con el
/// acento al 15 % y texto de acento.
struct CalendarMonthChipLabel: View {
    let label: String
    let isSelected: Bool

    var body: some View {
        Text(label)
            .ccFont(.s14, weight: isSelected ? .semibold : .medium)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
            .foregroundStyle(isSelected ? Color.accentColor : AppTheme.textPrimary)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
    }
}

/// Etiqueta del selector de año o país en la barra: icono y texto, sin fondo
/// propio. El fondo es el de la barra (cápsula de Liquid Glass en iOS 26). Un
/// `Label` dentro de la barra se reduce al icono, por eso van por separado.
struct CalendarSelectorLabel: View {
    let icon: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
            Text(label)
        }
    }
}

/// Marca de la fila sintética de Campeonatos Nacionales: globo terráqueo
/// (Twemoji 1F30D, CC-BY 4.0, el mismo asset que Android) en gris, en el hueco
/// del logotipo.
struct CalendarChampionshipsMark: View {
    var body: some View {
        Image("GlobeEuropeAfrica")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: 20, height: 20)
            .foregroundStyle(AppTheme.textMuted)
            .frame(width: 28, height: 28)
            .accessibilityHidden(true)
    }
}
