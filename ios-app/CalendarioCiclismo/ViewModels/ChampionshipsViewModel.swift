import Foundation

/// ViewModel del Modo Campeonatos — equivalente a `js/campeonatos.js`.
@MainActor
@Observable
final class ChampionshipsViewModel {
    var countries: [ChampionshipCountry] = []
    var isLoading = false
    var error: String?
    var hasLoaded = false
    /// Claves `raceId#stage|final` de pruebas con resultados in-house (keepForWeb).
    /// Si una celda está aquí, su trofeo lleva a la pantalla NATIVA de resultados.
    var inhouseKeys: Set<String> = []
    /// Filtro local (Hoy/Todas/Pro/Masc/Fem), sin persistencia. Empieza en `today`
    /// durante su rango (24–28 jun, predeterminado); fuera de él, en `all`.
    var activeFilter: ChampionshipsConfig.Filter = ChampionshipsConfig.defaultFilter

    /// Países con al menos una prueba visible bajo el filtro activo.
    var displayCountries: [ChampionshipCountry] {
        countries.filter { !$0.visibleSlots(filter: activeFilter).isEmpty }
    }

    func load() async {
        isLoading = true
        error = nil
        hasLoaded = true
        do {
            countries = try await SupabaseService.shared.loadChampionships()
        } catch {
            if Task.isCancelled { isLoading = false; return }
            self.error = error.localizedDescription
        }
        isLoading = false
        // Resultados in-house (no bloqueante): refresca los trofeos a la pantalla
        // nativa cuando aparezcan (los CN suelen no tener in-house, pero un volcado
        // PDF/UCI puede activarlo). El grid ya está pintado; esto solo reetiqueta.
        let raceIds = countries.flatMap { $0.slots.values.compactMap { $0.race?.id } }
        if !raceIds.isEmpty {
            inhouseKeys = await SupabaseService.shared.inhouseStageKeys(raceIds: raceIds)
        }
    }
}
