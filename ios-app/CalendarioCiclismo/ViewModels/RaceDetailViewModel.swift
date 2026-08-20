import Foundation

/// ViewModel para la vista de detalle de carrera — equivalente a `js/competicion.js`.
@MainActor
@Observable
final class RaceDetailViewModel {
    var race: Race?
    var days: [EnrichedRaceDay] = []
    var isLoading = false
    var error: String?

    func load(raceId: String) async {
        isLoading = true
        error = nil
        do {
            let result = try await SupabaseService.shared.loadRaceComplete(raceId: raceId)
            race = result.race
            days = result.days
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func load(slug: String) async {
        isLoading = true
        error = nil
        do {
            let raceData = try await SupabaseService.shared.race(bySlug: slug)
            let result = try await SupabaseService.shared.loadRaceComplete(raceId: raceData.id)
            race = result.race
            days = result.days
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    /// Rango de fechas formateado: "6–27 jul".
    var dateRange: String {
        guard let r = race else { return "" }
        return DateFormatting.formatDateRange(start: r.startDate, end: r.endDate)
    }

    /// Etapas activas (no descanso ni canceladas).
    var activeStages: [EnrichedRaceDay] {
        days.filter { !$0.raceDay.isRestDay && !$0.raceDay.isCancelledDay }
    }

    /// Número total de etapas.
    var stageCount: Int {
        activeStages.count
    }
}
