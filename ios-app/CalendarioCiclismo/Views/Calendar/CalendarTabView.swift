import SwiftUI

private enum CalendarSelection: Identifiable, Hashable {
    case stage(String)
    case race(String)

    var id: String {
        switch self {
        case .stage(let id): "stage-\(id)"
        case .race(let id): "race-\(id)"
        }
    }
}

/// Pestaña Calendario. En ancho compacto conserva la alternancia Mes/Temporada;
/// en tamaño regular amplio presenta ambas superficies dentro del mismo
/// NavigationStack, de modo que cualquier destino sustituya el conjunto.
struct CalendarTabView: View {
    @AppStorage("calendar_subview") private var sub: String = "month"
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var localeService = LocaleService.shared
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
        .navigationTitle(localeService.t("Calendario", "Calendar"))
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
            case .race(let id): RaceDetailView(raceId: id)
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
