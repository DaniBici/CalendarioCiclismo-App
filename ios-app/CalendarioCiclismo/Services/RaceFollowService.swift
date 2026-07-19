import Foundation

/// Gestiona el modo de seguimiento de carreras para notificaciones push.
///
/// Tres modos excluyentes:
///  - `.followAll`    → recibe notificaciones de TODAS las carreras (default,
///                      comportamiento pre-2.0). No hay filas en las tablas
///                      push_race_subscriptions ni push_race_filters en el server.
///  - `.followRaces`  → solo carreras seguidas individualmente.
///  - `.followFilters`→ solo carreras que encajen en los filtros de grupo activos.
///
/// Al cambiar cualquier estado llama a `NotificationManager.shared.healSubscriptionIfNeeded()`
/// para sincronizar con el servidor vía la nueva RPC `set_push_subscription_full`.
@MainActor @Observable
final class RaceFollowService {
    static let shared = RaceFollowService()

    // MARK: - Tipos públicos

    enum FollowMode: String {
        case followAll     = "follow_all"
        case followRaces   = "follow_races"
        case followFilters = "follow_filters"
    }

    /// Filtros predefinidos de grupo. El rawValue coincide con el `filterKey`
    /// del CHECK constraint en `push_race_filters`.
    enum GroupFilter: String, CaseIterable, Identifiable {
        case wtMale     = "wt_male"
        case wtFemale   = "wt_female"
        case grandTours = "grand_tours"
        case proMale    = "pro_male"
        case proFemale  = "pro_female"

        var id: String { rawValue }

        var labelKey: String {
            switch self {
            case .wtMale:     return "WorldTour masculino"
            case .wtFemale:   return "WorldTour femenino"
            case .grandTours: return "Grandes Vueltas"
            case .proMale:    return "ProSeries masculino"
            case .proFemale:  return "ProSeries femenino"
            }
        }

        var icon: String {
            switch self {
            case .wtMale:     return "star.fill"
            case .wtFemale:   return "star.fill"
            case .grandTours: return "trophy.fill"
            case .proMale:    return "medal.fill"
            case .proFemale:  return "medal.fill"
            }
        }
    }

    // MARK: - Estado persistido

    private static let modeKey    = "race_follow_mode"
    private static let racesKey   = "followed_race_ids"
    private static let filtersKey = "race_group_filters"
    private static let stagesKey  = "followed_stage_ids"

    private(set) var followMode: FollowMode
    private(set) var followedRaceIds: Set<String>
    private(set) var activeFilters: Set<GroupFilter>
    /// IDs de jornadas seguidas individualmente. Independiente del followMode de carreras.
    private(set) var followedStageIds: Set<String>

    private init() {
        let rawMode = UserDefaults.standard.string(forKey: Self.modeKey) ?? ""
        followMode = FollowMode(rawValue: rawMode) ?? .followAll

        let rawRaces = UserDefaults.standard.string(forKey: Self.racesKey) ?? ""
        followedRaceIds = rawRaces.isEmpty ? [] : Set(rawRaces.split(separator: ",").map(String.init))

        let rawFilters = UserDefaults.standard.string(forKey: Self.filtersKey) ?? ""
        activeFilters = rawFilters.isEmpty ? [] : Set(
            rawFilters.split(separator: ",").compactMap { GroupFilter(rawValue: String($0)) }
        )

        let rawStages = UserDefaults.standard.string(forKey: Self.stagesKey) ?? ""
        followedStageIds = rawStages.isEmpty ? [] : Set(rawStages.split(separator: ",").map(String.init))
    }

    // MARK: - API pública

    func isFollowing(_ raceId: String) -> Bool {
        followedRaceIds.contains(raceId)
    }

    func isFollowingStage(_ raceDayId: String) -> Bool {
        followedStageIds.contains(raceDayId)
    }

    /// Añade o elimina una carrera de las seguidas individualmente.
    /// Cambia el modo a `.followRaces` si estaba en `.followAll`.
    func setFollowing(_ raceId: String, following: Bool) {
        if following {
            if followMode == .followAll {
                followMode = .followRaces
                persistMode()
            }
            followedRaceIds.insert(raceId)
        } else {
            followedRaceIds.remove(raceId)
        }
        persistRaces()
        Task { await NotificationManager.shared.healSubscriptionIfNeeded() }
    }

    /// Añade o elimina una jornada de las seguidas individualmente.
    /// Independiente del modo de seguimiento de carreras.
    func setFollowingStage(_ raceDayId: String, following: Bool) {
        if following {
            followedStageIds.insert(raceDayId)
        } else {
            followedStageIds.remove(raceDayId)
        }
        persistStages()
        Task { await NotificationManager.shared.healSubscriptionIfNeeded() }
    }

    func setFilter(_ filter: GroupFilter, _ value: Bool) {
        if value {
            if followMode == .followAll {
                followMode = .followFilters
                persistMode()
            }
            activeFilters.insert(filter)
        } else {
            activeFilters.remove(filter)
        }
        persistFilters()
        Task { await NotificationManager.shared.healSubscriptionIfNeeded() }
    }

    func setMode(_ mode: FollowMode) {
        followMode = mode
        if mode == .followAll {
            followedRaceIds.removeAll()
            activeFilters.removeAll()
            persistRaces()
            persistFilters()
        }
        persistMode()
        Task { await NotificationManager.shared.healSubscriptionIfNeeded() }
    }

    // MARK: - Valores para la RPC

    /// raceIds a enviar como p_followed_races. Vacío si followAll o followFilters.
    var followedRacesForRpc: [String] {
        followMode == .followRaces ? Array(followedRaceIds) : []
    }

    /// filterKeys a enviar como p_race_filters. Vacío si followAll o followRaces.
    var raceFiltersForRpc: [String] {
        followMode == .followFilters ? activeFilters.map(\.rawValue) : []
    }

    /// raceDayIds a enviar como p_followed_stages (siempre todos, independiente del modo).
    var followedStagesForRpc: [String] {
        Array(followedStageIds)
    }

    // MARK: - Persistencia

    private func persistMode() {
        UserDefaults.standard.set(followMode.rawValue, forKey: Self.modeKey)
    }

    private func persistRaces() {
        UserDefaults.standard.set(followedRaceIds.joined(separator: ","), forKey: Self.racesKey)
    }

    private func persistFilters() {
        let csv = activeFilters.map(\.rawValue).joined(separator: ",")
        UserDefaults.standard.set(csv, forKey: Self.filtersKey)
    }

    private func persistStages() {
        UserDefaults.standard.set(followedStageIds.joined(separator: ","), forKey: Self.stagesKey)
    }
}
