import Foundation
import Supabase

/// Fichajes (mercado 2027, mig. 122) — queries y compuestos. Espejo de las
/// funciones homónimas de Android (`SupabaseService.kt` + `CalendarRepository.kt`).
extension SupabaseService {

    /// Movimientos del mercado de una temporada, cronológico inverso.
    func riderTransfers(season: Int) async throws -> [RiderTransfer] {
        try await client.from("rider_transfers")
            .select()
            .eq("season", value: season)
            .order("announcedAt", ascending: false)
            .order("createdAt", ascending: false)
            .execute()
            .value
    }

    /// Versiones de equipo de un año (team_seasons) — para la lista de equipos
    /// del mercado (nombre 2027, categoría 2027, chapa ocultable).
    func teamSeasons(year: Int) async throws -> [TeamSeason] {
        try await client.from("team_seasons")
            .select()
            .eq("year", value: year)
            .execute()
            .value
    }

    /// Fichas mínimas por id (riders_men + riders_women; el id es único
    /// cross-tabla) — para hidratar nombre/bandera de los movimientos.
    func transferRiders(byIds ids: [String]) async throws -> [TransferRider] {
        guard !ids.isEmpty else { return [] }
        let cols = "id,firstName,lastName,nationality,currentTeamId,contractUntil"
        var out: [TransferRider] = []
        for table in ["riders_men", "riders_women"] {
            let rows: [TransferRider] = try await client.from(table)
                .select(cols)
                .in("id", values: ids)
                .execute()
                .value
            out += rows
        }
        return out
    }

    /// Plantilla 2027 MATERIALIZADA de un equipo (rider_team_affiliations
    /// year=market) para la sección "continúan". El panel la puebla al marcar
    /// "continúa"/"duda"/incorporación; un equipo sin afiliaciones sale vacío.
    /// El `contractUntil` efectivo del corredor viene de la afiliación.
    func ridersByAffiliation(teamId: String, season: Int, gender: String?) async throws -> [TransferRider] {
        struct AffRow: Decodable { let riderId: String; let riderGender: String?; let dateTo: String? }
        let affs: [AffRow] = try await client.from("rider_team_affiliations")
            .select("riderId,riderGender,dateTo")
            .eq("year", value: season)
            .eq("teamId", value: teamId)
            .execute()
            .value
        if affs.isEmpty { return [] }

        // El contrato = año de dateTo (31-dic del año de fin), no riders_*.contractUntil.
        func affYear(_ d: String?) -> Int? { d.flatMap { Int($0.prefix(4)) } }
        let cols = "id,firstName,lastName,nationality,currentTeamId,contractUntil"
        let contractByRider = Dictionary(affs.map { ($0.riderId, affYear($0.dateTo)) }, uniquingKeysWith: { a, _ in a })
        let menIds = affs.filter { ($0.riderGender ?? gender) == "male" }.map(\.riderId)
        let womenIds = affs.filter { ($0.riderGender ?? gender) == "female" }.map(\.riderId)

        var out: [TransferRider] = []
        for (table, ids) in [("riders_men", menIds), ("riders_women", womenIds)] where !ids.isEmpty {
            let rows: [TransferRider] = try await client.from(table)
                .select(cols)
                .in("id", values: ids)
                .execute()
                .value
            // El contrato lo manda la afiliación (no riders_*.contractUntil).
            out += rows.map { $0.withContractUntil(contractByRider[$0.id] ?? nil) }
        }
        return out
    }

    /// Carga inicial de la pestaña Fichajes: movimientos + temporadas del
    /// mercado + fichas hidratadas + nombres de equipos referenciados fuera de
    /// team_seasons[market] (orígenes continentales, destinos sin catalogar).
    func loadTransfersMarket(season: Int) async throws -> TransfersLogic.MarketData {
        async let transfersTask = riderTransfers(season: season)
        async let seasonsTask = teamSeasons(year: season)
        async let prevSeasonsTask = try? teamSeasons(year: season - 1)
        let transfers = try await transfersTask
        let seasons = try await seasonsTask
        let prevSeasons = await prevSeasonsTask ?? []

        let riderIds = Array(Set(transfers.map(\.riderId)))
        let riders = try await transferRiders(byIds: riderIds)
        let ridersById = Dictionary(riders.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        var names: [String: String] = [:]
        for s in seasons { if let n = s.name { names[s.teamId] = n } }
        var namesPrev: [String: String] = [:]
        for s in prevSeasons { if let n = s.name { namesPrev[s.teamId] = n } }
        // Fila de la temporada previa por equipo → colores "antiguos" para la
        // chapa mientras el kit del mercado no se publica (mig. 129).
        let prevByTeamId = Dictionary(prevSeasons.map { ($0.teamId, $0) }, uniquingKeysWith: { a, _ in a })

        // Último recurso: equipos sin fila en NINGUNA de las dos temporadas.
        let referenced = Set(transfers.flatMap { [$0.fromTeamId, $0.toTeamId].compactMap { $0 } })
        let missing = referenced.filter { names[$0] == nil && namesPrev[$0] == nil }
        if !missing.isEmpty {
            let teams: [Team] = (try? await client.from("teams")
                .select()
                .in("id", values: Array(missing))
                .execute()
                .value) ?? []
            for t in teams {
                if names[t.id] == nil { names[t.id] = t.name }
                if namesPrev[t.id] == nil { namesPrev[t.id] = t.name }
            }
        }
        return TransfersLogic.MarketData(
            transfers: transfers,
            seasons: seasons,
            ridersById: ridersById,
            teamNameById: names,
            teamNamePrev: namesPrev,
            prevSeasonsByTeamId: prevByTeamId
        )
    }
}
