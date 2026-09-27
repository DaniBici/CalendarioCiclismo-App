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

/// Alerta de placeholder para carreras CX: la ficha no tiene la carga mínima
/// (Libro de Ruta o Mapa, y horarios) o la prueba está cancelada. Mismo
/// mensaje que en Hoy en Carretera y en el modal de Android.
private struct CxPlaceholderModalOverlay: ViewModifier {
    @Binding var race: CxRace?
    func body(content: Content) -> some View {
        content.alert(dialogTitle, isPresented: Binding(
            get: { race != nil },
            set: { if !$0 { race = nil } }
        )) {
            Button(LocaleService.t("Cerrar", "Close"), role: .cancel) {}
        } message: {
            if let race { Text(dialogMessage(for: race)) }
        }
    }
    private var dialogTitle: String { race.map { LocaleService.t($0.name, $0.nameEn ?? $0.name) } ?? "" }
    private func dialogMessage(for race: CxRace) -> String {
        if race.isCancelled { return LocaleService.t("Carrera cancelada", "Race cancelled") }
        return DateFormatting.todayKey() < race.dateKey
            ? LocaleService.t("Por ahora sin información extra", "No additional information yet")
            : LocaleService.t("Sin información extra", "No additional information")
    }
}

extension View {
    func cxPlaceholderModal(_ race: Binding<CxRace?>) -> some View {
        modifier(CxPlaceholderModalOverlay(race: race))
    }
}

extension View {
    func placeholderModal(item: Binding<PlaceholderModalItem?>) -> some View {
        modifier(PlaceholderModalOverlay(item: item))
    }
}
