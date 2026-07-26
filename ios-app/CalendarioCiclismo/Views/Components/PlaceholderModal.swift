import SwiftUI

/// Alerta nativa centrada para carreras sin información extra.
struct PlaceholderModalOverlay: ViewModifier {
    @Binding var item: PlaceholderModalItem?
    @Environment(\.openURL) private var openURL

    func body(content: Content) -> some View {
        content
            .alert(dialogTitle, isPresented: Binding(
                get: { item != nil },
                set: { if !$0 { item = nil } }
            )) {
                if let item {
                    if let urlString = item.websiteUrl, let url = URL(string: urlString) {
                        Button(LocaleService.t("Web oficial", "Official website")) { openURL(url) }
                    }
                    Button(LocaleService.t("Cerrar", "Close"), role: .cancel) {}
                }
            } message: {
                if let item { Text(dialogMessage(for: item)) }
            }
    }

    private var dialogTitle: String { item?.race.localizedName ?? "" }

    private func dialogMessage(for item: PlaceholderModalItem) -> String {
        let race = item.race
        let rd = item.raceDay
        let detail: String
        if let rd, !rd.stageLabel.isEmpty {
            detail = "\(rd.stageLabel) · \(DateFormatting.formatDateLong(rd.dateKey))"
        } else if let rd {
            detail = DateFormatting.formatDateLong(rd.dateKey)
        } else {
            detail = DateFormatting.formatDateRange(start: race.startDate, end: race.endDate)
        }
        let message: String
        if rd?.isCancelledDay == true {
            message = "Etapa cancelada"
        } else if race.isCancelled {
            message = "Carrera cancelada"
        } else {
            let dateKey = rd?.dateKey ?? race.startDate ?? ""
            message = DateFormatting.todayKey() < dateKey
                ? "Por ahora sin información extra"
                : "Sin información extra"
        }
        return detail.isEmpty ? message : "\(detail)\n\n\(message)"
    }
}

/// Data for the placeholder modal.
struct PlaceholderModalItem: Identifiable {
    let id = UUID()
    let race: Race
    let raceDay: RaceDay?
    let websiteUrl: String?

    init(race: Race, raceDay: RaceDay?, websiteUrl: String? = nil) {
        self.race = race
        self.raceDay = raceDay
        self.websiteUrl = websiteUrl
    }
}

extension View {
    func placeholderModal(item: Binding<PlaceholderModalItem?>) -> some View {
        modifier(PlaceholderModalOverlay(item: item))
    }
}
