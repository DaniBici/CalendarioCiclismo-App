import Foundation

/// ViewModel para la vista de detalle de carrera — equivalente a `js/competicion.js`.
@MainActor
@Observable
final class RaceDetailViewModel {
    var race: Race?
    var days: [EnrichedRaceDay] = []
    var isLoading = false
    var error: String?

    /// Instantánea de la ficha guardada en disco para pintarla al instante
    /// en la siguiente visita mientras llega la red.
    private struct Snapshot: Codable {
        let race: Race
        let days: [EnrichedRaceDay]
    }

    func load(raceId: String) async {
        isLoading = true
        error = nil
        await showCachedSnapshot(raceId: raceId)
        await apply { try await SupabaseService.shared.loadRaceComplete(raceId: raceId) }
        isLoading = false
    }

    func load(slug: String) async {
        isLoading = true
        error = nil
        await apply {
            let raceData = try await SupabaseService.shared.race(bySlug: slug)
            // La carrera ya resuelta no se vuelve a pedir.
            return try await SupabaseService.shared.loadRaceComplete(race: raceData)
        }
        isLoading = false
    }

    /// Caché primero: solo si aún no hay etapas en pantalla.
    private func showCachedSnapshot(raceId: String) async {
        guard days.isEmpty,
              let cached = await CacheManager.shared.load(Snapshot.self, forKey: CacheManager.raceDetailKey(raceId)),
              cached.race.id == raceId else { return }
        race = cached.race
        days = cached.days
    }

    private func apply(_ fetch: () async throws -> (race: Race, days: [EnrichedRaceDay])) async {
        do {
            let result = try await fetch()
            race = result.race
            days = result.days
            await CacheManager.shared.save(
                Snapshot(race: result.race, days: result.days),
                forKey: CacheManager.raceDetailKey(result.race.id)
            )
        } catch {
            // Con una instantánea en pantalla se conserva en vez del error.
            if days.isEmpty {
                self.error = error.localizedDescription
            }
        }
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
