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
        // El ficticio "Individual" no cuenta como equipo (sus corredores sí).
        teamsList.filter { !$0.isIndividualPlaceholder }.count
    }

    var riderCount: Int {
        teamsList.reduce(0) { $0 + $1.riders.count }
    }

    func load(raceId: String) async {
        isLoading = true
        error = nil

        do {
            let service = SupabaseService.shared

            let race = try await service.race(byId: raceId)
            self.race = race

            teamsList = try await fetchTeams(raceId: raceId, race: race, service: service)
            await loadRiderOuts(raceId: raceId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func refresh(raceId: String) async {
        do {
            let service = SupabaseService.shared
            let race = try await service.race(byId: raceId)
            self.race = race
            teamsList = try await fetchTeams(raceId: raceId, race: race, service: service)
            await loadRiderOuts(raceId: raceId)
            error = nil
        } catch {
            // Mantenemos datos anteriores en caso de fallo
        }
    }

    /// Tachado de abandonos: si la carrera tiene resultados in-house, marcar a
    /// los corredores fuera de carrera (irm en su etapa MÁS RECIENTE). Port de
    /// js/inscritos.js vía Android (loadStartlistData). Cualquier fallo de red →
    /// comportamiento clásico (sin tachados).
    private func loadRiderOuts(raceId: String) async {
        ridersOut = (try? await SupabaseService.shared.loadRiderOuts(raceId: raceId)) ?? [:]
    }

    private func fetchTeams(raceId: String, race: Race, service: SupabaseService) async throws -> [StartlistTeamWithRiders] {
        // Query 1: equipos
        let teamsData = try await service.client.from("startlist_teams")
            .select("*")
            .eq("raceId", value: raceId)
            .order("sortOrder", ascending: true)
            .execute()
            .value as [StartlistTeamDTO]

        guard !teamsData.isEmpty else { return [] }

        // Query 2: corredores de esos equipos.
        // Vista resuelta: nombre/country canónicos desde riders_men/women cuando
        // hay globalRiderId; fallback al snapshot del propio startlist_riders.
        let teamIds = teamsData.map { $0.id }
        let ridersData = try await service.client.from("startlist_riders_resolved")
            .select("*")
            .in("teamId", values: teamIds)
            .order("dorsal", ascending: true)
            .execute()
            .value as [StartlistRiderDTO]

        // Agrupar riders por teamId
        let ridersByTeam = Dictionary(grouping: ridersData, by: { $0.teamId })

        // Equipos globales si la lista es enriquecida
        var globalTeamMap: [String: Team] = [:]
        var seasonMap: [String: TeamSeason] = [:]
        if race.enrichedStartlist == true {
            let globalTeams = try await service.client.from("teams")
                .select()
                .execute()
                .value as [Team]
            globalTeamMap = Dictionary(uniqueKeysWithValues: globalTeams.map { ($0.id, $0) })

            // Render temporal: versión del equipo en el año de la carrera.
            // `teams` queda como fallback (ver Team.applyingSeason). 2026 == teams.
            if let year = race.year {
                let seasons = try await service.client.from("team_seasons")
                    .select()
                    .eq("year", value: year)
                    .execute()
                    .value as [TeamSeason]
                seasonMap = Dictionary(seasons.map { ($0.teamId, $0) }, uniquingKeysWith: { a, _ in a })
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

    /// Ficticio "Individual" → se oculta su cabecera y no cuenta como equipo.
    var isIndividualPlaceholder: Bool {
        isIndividualPlaceholderTeam(teamId: teamId, teamName: teamName)
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
