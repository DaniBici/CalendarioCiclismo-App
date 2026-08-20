import SwiftUI

/// Alerta nativa centrada de resultados post-carrera: enlaces a FirstCycling
/// y ProCyclingStats. A diferencia de `confirmationDialog`, `alert` mantiene
/// una posición centrada y predecible respecto a la pantalla.
struct ResultsSheetOverlay: ViewModifier {
    @Binding var item: ResultsSheetItem?
    @State private var safariUrl: URL?

    func body(content: Content) -> some View {
        content
            .alert(dialogTitle, isPresented: Binding(
                get: { item != nil },
                set: { if !$0 { item = nil } }
            )) {
                if let item {
                    if let url = RaceLogic.buildFcUrl(race: item.race, stageNumber: item.raceDay.stageNumber) {
                        Button("FirstCycling") { safariUrl = url }
                    }
                    if let url = RaceLogic.buildPcsUrl(race: item.race, stageNumber: item.raceDay.stageNumber, stageSuffix: item.raceDay.stageSuffix) {
                        Button("ProCyclingStats") { safariUrl = url }
                    }
                    Button("Cancelar", role: .cancel) {}
                }
            } message: {
                if let item {
                    Text(item.race.isOneDay ? "Resultados" : "Resultados · \(item.raceDay.stageLabel)")
                }
            }
            .safariSheet(url: $safariUrl)
    }

    private var dialogTitle: String { item?.race.localizedName ?? "Resultados" }
}

struct ResultsSheetItem: Identifiable {
    let id = UUID()
    let race: Race
    let raceDay: RaceDay
}

extension View {
    func resultsSheet(item: Binding<ResultsSheetItem?>) -> some View {
        modifier(ResultsSheetOverlay(item: item))
    }
}
