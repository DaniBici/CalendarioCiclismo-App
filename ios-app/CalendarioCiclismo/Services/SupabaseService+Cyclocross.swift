import Foundation
import Supabase

@MainActor
protocol CxRemote {
    func cxMonth(season: String, month: CxMonth) async throws -> [CxRace]
    func cxTournamentNextDate(season: String, date: String, tournamentId: String) async throws -> String?
    func cxDetail(id: String) async throws -> CxDetail?
    func cxRaceForSlug(_ slug: String) async throws -> CxRace?
    func cxTournamentForSlug(_ slug: String) async throws -> CxTournament?
    func cxSeasonRounds(season: String) async throws -> [String: CxRound]
    /// Generales publicadas de un torneo: estados, filas, catálogo de equipos
    /// y carreras (cabeceras de ronda).
    func cxTournamentStandings(tournamentId: String, season: String) async throws -> CxTournamentStandings
    /// Variantes que ignoran las clases ocultas en el idioma activo
    /// (`CyclocrossPresentation.hiddenClasses`).
    func cxTournamentNextDate(season: String, date: String, tournamentId: String, excluding classes: [String]) async throws -> String?
    /// `true` si el torneo tiene alguna carrera publicada fuera de `classes`.
    func cxTournamentHasRaces(tournamentId: String, excluding classes: [String]) async throws -> Bool
    /// Torneos de `tournamentIds` con alguna carrera publicada fuera de `classes`.
    func cxTournamentIdsWithRaces(_ tournamentIds: [String], excluding classes: [String]) async throws -> Set<String>
}

extension CxRemote {
    func cxTournamentNextDate(season: String, date: String, tournamentId: String, excluding classes: [String]) async throws -> String? {
        try await cxTournamentNextDate(season: season, date: date, tournamentId: tournamentId)
    }
    func cxTournamentHasRaces(tournamentId: String, excluding classes: [String]) async throws -> Bool { true }
    func cxTournamentIdsWithRaces(_ tournamentIds: [String], excluding classes: [String]) async throws -> Set<String> {
        var out = Set<String>()
        for id in tournamentIds where try await cxTournamentHasRaces(tournamentId: id, excluding: classes) {
            out.insert(id)
        }
        return out
    }
    func cxTournamentNextDate(season: String, date: String, tournamentId: String) async throws -> String? { throw URLError(.notConnectedToInternet) }
    func cxTournamentForSlug(_ slug: String) async throws -> CxTournament? { throw URLError(.notConnectedToInternet) }
    func cxSeasonRounds(season: String) async throws -> [String: CxRound] { throw URLError(.notConnectedToInternet) }
    func cxTournamentStandings(tournamentId: String, season: String) async throws -> CxTournamentStandings { throw URLError(.notConnectedToInternet) }
}

private struct CxDateEntry: Decodable, Sendable {
    let dateKey: String
    let cx_race_categories: [Category]
    struct Category: Decodable, Sendable { let dateKey: String?; let isCancelled: Bool }
}

private struct CxIdEntry: Decodable, Sendable {
    let id: String
}

private struct CxSchemeEntry: Decodable, Sendable {
    let pointsScheme: CxPointsScheme?
}

extension SupabaseService: CxRemote {
    private var cxAgendaColumns: String {
        "id,name,nameEn,slug,slugEn,seasonKey,dateKey,endDateKey,class,countryCode,venue,tournamentId,colorHex,logoUrl,isCancelled,timezone," +
        "assets(type,url)," +
        "cx_tournaments(id,name,nameEn,slug,colorHex,logoUrl)," +
        "cx_race_categories(category,startTimeUtc,dateKey,sortOrder,isCancelled,resultsStatus,startlistImportedAt,winnerName,durationFormat,durationRuleVersion,durationMinutes,durationRuleSourceUrl)"
    }

    func cxMonth(season: String, month: CxMonth) async throws -> [CxRace] {
        try await client.from("cx_races").select(cxAgendaColumns)
            .eq("seasonKey", value: season).eq("editorialStatus", value: "published")
            .lte("dateKey", value: month.lastDate)
            .or("dateKey.gte.\(month.firstDate),endDateKey.gte.\(month.firstDate)")
            .order("dateKey").order("id").execute().value
    }

    func cxRaces(byIds ids: [String]) async throws -> [CxRace] {
        var races: [CxRace] = []
        for start in stride(from: 0, to: ids.count, by: 100) {
            let batch = Array(ids[start..<min(start + 100, ids.count)])
            let rows: [CxRace] = try await client.from("cx_races").select(cxAgendaColumns)
                .eq("editorialStatus", value: "published").in("id", values: batch).execute().value
            races.append(contentsOf: rows.filter { CyclocrossLogic.raceInSeason($0) })
        }
        return races
    }

    func cxTournaments(byIds ids: [String]) async throws -> [CxTournament] {
        guard !ids.isEmpty else { return [] }
        var tournaments: [CxTournament] = []
        for start in stride(from: 0, to: ids.count, by: 100) {
            let batch = Array(ids[start..<min(start + 100, ids.count)])
            let rows: [CxTournament] = try await client.from("cx_tournaments")
                .select("id,name,nameEn,slug,seasonKey,colorHex,logoUrl")
                .in("id", values: batch).execute().value
            tournaments.append(contentsOf: rows)
        }
        return tournaments
    }

    func cxTournamentHasRaces(tournamentId: String, excluding classes: [String]) async throws -> Bool {
        var query = client.from("cx_races").select("id")
            .eq("tournamentId", value: tournamentId).eq("editorialStatus", value: "published")
        for raceClass in classes { query = query.neq("class", value: raceClass) }
        let rows: [CxIdEntry] = try await query.limit(1).execute().value
        return !rows.isEmpty
    }

    /// Variante por lotes de `cxTournamentHasRaces`: una sola consulta.
    func cxTournamentIdsWithRaces(_ tournamentIds: [String], excluding classes: [String]) async throws -> Set<String> {
        let ids = Array(Set(tournamentIds))
        guard !ids.isEmpty else { return [] }
        struct Row: Decodable, Sendable { let tournamentId: String? }
        var query = client.from("cx_races").select("tournamentId")
            .in("tournamentId", values: ids).eq("editorialStatus", value: "published")
        for raceClass in classes { query = query.neq("class", value: raceClass) }
        let rows: [Row] = try await query.execute().value
        return Set(rows.compactMap(\.tournamentId))
    }

    func cxTournamentNextDate(season: String, date: String, tournamentId: String) async throws -> String? {
        try await cxTournamentNextDate(season: season, date: date, tournamentId: tournamentId, excluding: [])
    }

    func cxTournamentNextDate(season: String, date: String, tournamentId: String, excluding classes: [String]) async throws -> String? {
        guard let last = CyclocrossAgendaModel.seasonMonths(season).last else { throw CxRepositoryError.invalidMonth }
        var rows: [CxDateEntry] = []
        var offset = 0
        while true {
            var query = client.from("cx_races").select("dateKey,cx_race_categories(dateKey,isCancelled)")
                .eq("seasonKey", value: season).eq("tournamentId", value: tournamentId)
                .eq("editorialStatus", value: "published").eq("isCancelled", value: false)
                .gte("dateKey", value: "\(season.prefix(4))-08-01").lte("dateKey", value: last.lastDate).or("dateKey.gte.\(date),endDateKey.gte.\(date)")
            for raceClass in classes { query = query.neq("class", value: raceClass) }
            let page: [CxDateEntry] = try await query
                .order("id").range(from: offset, to: offset + 999).execute().value
            rows.append(contentsOf: page)
            if page.count < 1000 { break }
            offset += 1000
        }
        return rows.flatMap { race in
            race.cx_race_categories.isEmpty ? [race.dateKey] : race.cx_race_categories.filter { !$0.isCancelled }.map { $0.dateKey ?? race.dateKey }
        }.filter { $0 >= date && CyclocrossLogic.dateInSeason($0, season: season) }.min()
    }

    func cxRaceForSlug(_ slug: String) async throws -> CxRace? {
        guard slug.range(of: "^[a-zA-Z0-9_-]+$", options: .regularExpression) != nil else { return nil }
        let races: [CxRace] = try await client.from("cx_races").select(cxAgendaColumns)
            .eq("editorialStatus", value: "published").or("slug.eq.\(slug),slugEn.eq.\(slug)")
            .limit(1).execute().value
        return races.first
    }

    func cxTournamentForSlug(_ slug: String) async throws -> CxTournament? {
        guard slug.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil else { return nil }
        let query = client.from("cx_tournaments").select("id,name,nameEn,slug,seasonKey,colorHex,logoUrl")
            .eq("slug", value: slug)
        let tournaments: [CxTournament] = try await query.limit(1).execute().value
        return tournaments.first
    }

    func cxSeasonRounds(season: String) async throws -> [String: CxRound] {
        guard let last = CyclocrossAgendaModel.seasonMonths(season).last else { throw CxRepositoryError.invalidMonth }
        var rows: [CxRoundRow] = []
        var offset = 0
        while true {
            let page: [CxRoundRow] = try await client.from("cx_races").select("id,tournamentId,dateKey,seasonKey,isCancelled,cx_race_categories(dateKey,startTimeUtc,isCancelled)")
                .eq("seasonKey", value: season).eq("editorialStatus", value: "published")
                .gte("dateKey", value: "\(season.prefix(4))-08-01").lte("dateKey", value: last.lastDate)
                .order("id").range(from: offset, to: offset + 999).execute().value
            rows.append(contentsOf: page)
            if page.count < 1000 { break }
            offset += 1000
        }
        return CyclocrossLogic.tournamentRounds(rows, season: season)
    }

    /// Orden por columna configurable: cx_standings_state no tiene `id` (su
    /// clave es tournamentId+seasonKey+category) y no admite el orden por defecto.
    private func cxRows<T: Decodable & Sendable>(_ type: T.Type, table: String, columns: String = "*", filters: [String: String], orderColumn: String = "id") async throws -> [T] {
        var rows: [T] = []
        var offset = 0
        while true {
            var query = client.from(table).select(columns)
            for (key, value) in filters { query = query.eq(key, value: value) }
            let page: [T] = try await query.order(orderColumn).range(from: offset, to: offset + 999).execute().value
            rows.append(contentsOf: page)
            if page.count < 1000 { return rows }
            offset += 1000
        }
    }

    func cxDetail(id: String) async throws -> CxDetail? {
        let races: [CxRace] = try await client.from("cx_races").select("*,cx_tournaments(*),cx_race_categories(*)")
            .eq("id", value: id).eq("editorialStatus", value: "published").execute().value
        guard let race = races.first else { return nil }
        let filters = ["raceId": id]
        async let riders = cxRows(CxStartlistRider.self, table: "cx_startlist_riders", filters: filters)
        async let results = cxRows(CxResult.self, table: "cx_results", filters: filters)
        async let broadcasts = cxRows(CxBroadcast.self, table: "cx_broadcasts", filters: filters)
        async let videos = cxRows(CxVideo.self, table: "cx_videos", filters: filters)
        async let docs = cxRows(CxAsset.self, table: "assets", filters: ["cxRaceId": id])
        // Catálogo completo: resultados y generales casan `teamName` por nombre
        // y alias, igual que la web; los dorsales usan `teamId`.
        async let catalog = cxTeamCatalog()
        let rows: [CxStanding]
        let states: [CxStandingState]
        let tournamentRaces: [CxRaceRef]?
        if let tournamentId = race.tournamentId {
            let filters = ["tournamentId": tournamentId, "seasonKey": race.seasonKey]
            async let statesReq = cxRows(CxStandingState.self, table: "cx_standings_state", filters: filters, orderColumn: "category")
            async let rowsReq = cxRows(CxStanding.self, table: "cx_tournament_standings", filters: filters)
            // Las columnas de ronda solo necesitan nombre y clase: un fallo
            // no impide abrir la ficha. Se piden a la vez y se descartan si
            // el torneo no tiene generales.
            async let racesReq: [CxRaceRef]? = try? await cxTournamentRaces(tournamentId: tournamentId)
            states = try await statesReq
            rows = try await rowsReq
            tournamentRaces = rows.isEmpty ? [] : await racesReq
        } else { rows = []; states = []; tournamentRaces = nil }
        let startlist = try await riders
        let teams = try await catalog
        return try await CxDetail(race: race, startlist: startlist, results: results, broadcasts: broadcasts, videos: videos, teams: teams, standings: rows, standingsState: states, assets: docs, tournamentRaces: tournamentRaces)
    }

    /// Catálogo de equipos CX (≈650 filas, paginado). Cambia muy poco: se
    /// conserva una hora en memoria y las fichas abiertas a la vez comparten
    /// la descarga.
    private func cxTeamCatalog() async throws -> [CxTeam] {
        try await sharedRequest("cxTeamCatalog", reuseWindow: 3600) {
            try await self.cxRows(CxTeam.self, table: "cx_teams", filters: [:])
        }
    }

    private func cxTournamentRaces(tournamentId: String) async throws -> [CxRaceRef] {
        try await cxRows(CxRaceRef.self, table: "cx_races", columns: "id,name,nameEn,class", filters: ["tournamentId": tournamentId, "editorialStatus": "published"])
    }

    func cxTournamentStandings(tournamentId: String, season: String) async throws -> CxTournamentStandings {
        let filters = ["tournamentId": tournamentId, "seasonKey": season]
        async let states = cxRows(CxStandingState.self, table: "cx_standings_state", filters: filters, orderColumn: "category")
        async let standings = cxRows(CxStanding.self, table: "cx_tournament_standings", filters: filters)
        async let schemes = cxRows(CxSchemeEntry.self, table: "cx_tournaments", columns: "id,pointsScheme", filters: ["id": tournamentId])
        async let catalog = cxTeamCatalog()
        async let races = cxTournamentRaces(tournamentId: tournamentId)
        return try await CxTournamentStandings(pointsScheme: schemes.first?.pointsScheme, states: states, standings: standings, teams: catalog, races: races)
    }
}
