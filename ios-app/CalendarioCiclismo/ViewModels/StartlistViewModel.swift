import Foundation

@MainActor
@Observable
final class StartlistViewModel {
    var race: Race?
    var teamsList: [StartlistTeamWithRiders] = []
    var isLoading = false
    var error: String?
    /// Corredores fuera de carrera, por globalRiderId. Vacío si no hay
    /// resultados in-house. (Tachado de abandonos — port de inscritos.js.)
    var ridersOut: [String: RiderOut] = [:]
    var title: String {
        race?.localizedName ?? LocaleService.t("Dorsales", "Startlist")
    }

    var isProvisional: Bool {
        race?.startlistProvisional == true
    }

    var teamCount: Int {
        // Los estados sin equipo no cuentan como formaciones (sus corredores sí).
        teamsList.filter { !$0.isNoTeamPlaceholder }.count
    }

    var riderCount: Int {
        teamsList.reduce(0) { $0 + $1.riders.count }
    }

    func load(raceId: String) async {
        isLoading = true
        error = nil

        do {
            let loaded = try await fetchAll(raceId: raceId)
            race = loaded.race
            teamsList = loaded.teams
            ridersOut = loaded.ridersOut
            error = nil
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func refresh(raceId: String) async {
        do {
            let loaded = try await fetchAll(raceId: raceId)
            race = loaded.race
            teamsList = loaded.teams
            ridersOut = loaded.ridersOut
            error = nil
        } catch {
            // Mantenemos datos anteriores en caso de fallo
        }
    }

    /// Carrera, equipos, corredores y abandonos no dependen entre sí: salen en
    /// una tanda. Solo los equipos canónicos esperan a la lista de equipos.
    private func fetchAll(raceId: String) async throws -> (race: Race, teams: [StartlistTeamWithRiders], ridersOut: [String: RiderOut]) {
        let service = SupabaseService.shared
        async let raceReq = service.race(byId: raceId)
        async let teamsReq = Self.startlistTeams(raceId: raceId)
        async let ridersReq = Self.startlistRiders(raceId: raceId)
        // Tachado de abandonos: si la carrera tiene resultados in-house, marcar a
        // los corredores fuera de carrera (irm en su etapa MÁS RECIENTE). Port de
        // js/inscritos.js vía Android (loadStartlistData). Cualquier fallo de red →
        // comportamiento clásico (sin tachados).
        async let outsReq: [String: RiderOut] = (try? await service.loadRiderOuts(raceId: raceId)) ?? [:]

        let race = try await raceReq
        let teamsData = try await teamsReq
        let ridersData = try await ridersReq
        let teams = try await buildTeams(teamsData: teamsData, ridersData: ridersData, race: race, service: service)
        return (race, teams, await outsReq)
    }

    /// Equipos de la startlist.
    private static func startlistTeams(raceId: String) async throws -> [StartlistTeamDTO] {
        try await SupabaseService.shared.client.from("startlist_teams")
            .select("id,raceId,teamName,sortOrder,teamId,isConfirmed")
            .eq("raceId", value: raceId)
            .order("sortOrder", ascending: true)
            .execute()
            .value
    }

    /// Corredores de la carrera. Vista resuelta: nombre/country canónicos
    /// desde riders_men/women cuando hay globalRiderId; fallback al snapshot
    /// del propio startlist_riders. Se filtra por carrera (no por los equipos)
    /// para no esperar a la consulta de equipos.
    private static func startlistRiders(raceId: String) async throws -> [StartlistRiderDTO] {
        try await SupabaseService.shared.client.from("startlist_riders_resolved")
            .select("id,teamId,dorsal,firstName,lastName,countryCode,globalRiderId")
            .eq("raceId", value: raceId)
            .not("teamId", operator: .is, value: "null")
            .order("dorsal", ascending: true)
            .execute()
            .value
    }

    private func buildTeams(
        teamsData: [StartlistTeamDTO],
        ridersData: [StartlistRiderDTO],
        race: Race,
        service: SupabaseService
    ) async throws -> [StartlistTeamWithRiders] {
        guard !teamsData.isEmpty else { return [] }

        // Agrupar riders por teamId
        let ridersByTeam = Dictionary(grouping: ridersData, by: { $0.teamId })

        // Todas las listas usan sus equipos canónicos, solo para los ids presentes.
        var globalTeamMap: [String: Team] = [:]
        var seasonMap: [String: TeamSeason] = [:]
        let globalTeamIds = Array(Set(teamsData.compactMap { $0.teamId }))
        if !globalTeamIds.isEmpty {
            async let globalTeamsReq: [Team] = service.client.from("teams")
                .select()
                .in("id", values: globalTeamIds)
                .execute()
                .value
            // Render temporal: versión del equipo en el año de la carrera.
            // `teams` queda como fallback (ver Team.applyingSeason). 2026 == teams.
            async let seasonsReq: [TeamSeason] = Self.teamSeasons(year: race.year, teamIds: globalTeamIds)
            let globalTeams = try await globalTeamsReq
            globalTeamMap = Dictionary(uniqueKeysWithValues: globalTeams.map { ($0.id, $0) })
            let seasons = try await seasonsReq
            seasonMap = Dictionary(seasons.map { ($0.teamId, $0) }, uniquingKeysWith: { a, _ in a })
            for id in globalTeamIds where globalTeamMap[id] == nil {
                globalTeamMap[id] = seasonMap[id]?.asTeam()
            }
        }

        let built = teamsData.map { teamDTO -> StartlistTeamWithRiders in
            let globalTeam = teamDTO.teamId
                .flatMap { globalTeamMap[$0] }
                .map { $0.applyingSeason(teamDTO.teamId.flatMap { seasonMap[$0] }) }
            // Un equipo filial se distingue por su propia ficha en `teams`
            // (nombre y chapa propios), no por un sufijo. Ver migración 063.
            let displayName = globalTeam?.name ?? teamDTO.teamName

            let riders = (ridersByTeam[teamDTO.id] ?? [])
                .sorted {
                    switch ($0.dorsal, $1.dorsal) {
                    case (nil, nil): return false
                    case (nil, _): return false
                    case (_, nil): return true
                    case let (a?, b?): return a < b
                    }
                }
                .map { riderDTO in
                    StartlistRiderView(
                        id: riderDTO.id,
                        dorsal: riderDTO.dorsal,
                        firstName: riderDTO.firstName,
                        lastName: riderDTO.lastName,
                        countryCode: riderDTO.countryCode,
                        globalRiderId: riderDTO.globalRiderId
                    )
                }

            return StartlistTeamWithRiders(
                id: teamDTO.id,
                teamId: teamDTO.teamId,
                raceId: teamDTO.raceId,
                teamName: teamDTO.teamName,
                displayName: displayName,
                isConfirmed: teamDTO.isConfirmed ?? false,
                sortOrder: teamDTO.sortOrder,
                team: globalTeam,
                riders: riders
            )
        }

        // Orden de equipos por el dorsal del PRIMER corredor (mínimo dorsal > 0):
        // el sortOrder de BD es el orden de inserción del panel ("al tuntún"),
        // así que el orden canónico lo imponen los dorsales en cliente — espejo
        // de js/inscritos.js y de StartlistLogic (Android). Equipos sin ningún
        // dorsal → al final, conservando sortOrder entre ellos.
        // (riders ya está ordenado ascendente, así que first(where:) = mínimo.)
        func firstDorsal(_ t: StartlistTeamWithRiders) -> Int {
            t.riders.first(where: { ($0.dorsal ?? 0) > 0 })?.dorsal ?? Int.max
        }
        return built.sorted { a, b in
            let da = firstDorsal(a), db = firstDorsal(b)
            if da != db { return da < db }
            return a.sortOrder < b.sortOrder
        }
    }
}

extension StartlistViewModel {
    fileprivate static func teamSeasons(year: Int?, teamIds: [String]) async throws -> [TeamSeason] {
        guard let year else { return [] }
        return try await SupabaseService.shared.client.from("team_seasons")
            .select()
            .eq("year", value: year)
            .in("teamId", values: teamIds)
            .execute()
            .value
    }
}

// MARK: - Data Transfer Objects

struct StartlistTeamDTO: Codable {
    let id: String
    let raceId: String
    let teamName: String
    let sortOrder: Int
    let teamId: String?
    let isConfirmed: Bool?

    enum CodingKeys: String, CodingKey {
        case id, raceId, teamName, sortOrder, teamId, isConfirmed
    }
}

struct StartlistRiderDTO: Codable {
    let id: String
    let teamId: String
    let dorsal: Int?
    let firstName: String
    let lastName: String
    let countryCode: String?
    /// Expuesto por la vista startlist_riders_resolved; lo usa el tachado de
    /// abandonos para cruzar con race_uci_results (puede ser nil si no casó).
    let globalRiderId: String?

    enum CodingKeys: String, CodingKey {
        case id, teamId, dorsal, firstName, lastName, countryCode, globalRiderId
    }
}

// MARK: - View Models

struct StartlistTeamWithRiders: Identifiable {
    let id: String
    let teamId: String?
    let raceId: String
    let teamName: String
    let displayName: String
    let isConfirmed: Bool
    let sortOrder: Int
    let team: Team?
    let riders: [StartlistRiderView]

    /// Estado sin equipo → se oculta su cabecera y no cuenta como equipo.
    var isNoTeamPlaceholder: Bool {
        isNoTeamPlaceholderTeam(teamId: teamId, teamName: teamName)
    }
}

struct StartlistRiderView: Identifiable {
    let id: String
    let dorsal: Int?
    let firstName: String
    let lastName: String
    let countryCode: String?
    /// Cruce con race_uci_results para el tachado de abandonos.
    let globalRiderId: String?

    var fullName: String {
        "\(firstName) \(lastName)"
    }
}
