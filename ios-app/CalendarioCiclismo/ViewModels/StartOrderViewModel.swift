import Foundation

@MainActor
@Observable
final class StartOrderViewModel {
    var entries: [StartOrderEntry] = []
    /// DTO con campos extra (TT/GC dorsals, timezone) que no están en `RaceDay`.
    var raceDay: StartOrderRaceDay?
    /// `RaceDay` canónico usado por `StageInfoHeader` (paridad con perfil).
    var fullRaceDay: RaceDay?
    var race: Race?
    /// Equipos con la paleta efectiva del año de la carrera, para las bandas.
    var teams: [Team] = []
    var isLoading = false
    var error: String?
    var activeFilter: Filter = .all

    enum Filter: String { case all, tt, gc }

    var filteredEntries: [StartOrderEntry] {
        switch activeFilter {
        case .all: return entries
        case .tt:
            let set = Set(raceDay?.startOrderTtDorsals ?? [])
            return entries.filter { set.contains($0.dorsal) }
        case .gc:
            let set = Set(raceDay?.startOrderGcDorsals ?? [])
            return entries.filter { set.contains($0.dorsal) }
        }
    }

    /// CRE (contrarreloj por equipos): salen equipos, no corredores. La vista
    /// muestra solo Salida + Equipo (sin dorsal, sin bandera, sin corredor) y
    /// sin los filtros TT/GC (que se basan en dorsales de corredor).
    var isTtt: Bool { raceDay?.primaryType == "ttt" }

    var hasTtFilter: Bool { !isTtt && !(raceDay?.startOrderTtDorsals ?? []).isEmpty }
    var hasGcFilter: Bool { !isTtt && !(raceDay?.startOrderGcDorsals ?? []).isEmpty }
    var hasAnyFilter: Bool { hasTtFilter || hasGcFilter }

    var title: String { LocaleService.t("Orden de salida", "Start order") }

    func load(raceDayId: String) async {
        isLoading = true
        error = nil

        do {
            let service = SupabaseService.shared

            // Fila de la jornada, RaceDay canónico y entradas solo dependen de
            // la jornada: salen a la vez.
            async let raceDaysReq: [StartOrderRaceDay] = service.client
                .from("race_days")
                .select("id, raceId, date, dateKey, slug, slugEn, stageNumber, primaryType, startLocation, finishLocation, startLocationEn, finishLocationEn, distanceKm, timezone, startOrderTtDorsals, startOrderGcDorsals")
                .eq("id", value: raceDayId)
                .limit(1)
                .execute()
                .value
            // RaceDay canónico para reusar StageInfoHeader (mismo que perfil)
            async let fullRaceDayReq: RaceDay? = try? await service.raceDays(byIds: [raceDayId]).first
            async let entriesReq: [StartOrderEntry] = service.client
                .from("start_order_entries_resolved")
                .select()
                .eq("raceDayId", value: raceDayId)
                .order("sortOrder", ascending: true)
                .execute()
                .value

            let raceDays = try await raceDaysReq
            self.raceDay = raceDays.first
            self.fullRaceDay = await fullRaceDayReq

            if let rId = raceDays.first?.raceId {
                async let raceReq: Race? = try? await service.race(byId: rId)
                async let startlistTeamIdsReq: [String]? = Self.startlistTeamIds(raceId: rId)
                self.race = await raceReq
                if let year = self.race?.year {
                    self.teams = await Self.teams(year: year, startlistTeamIds: await startlistTeamIdsReq)
                } else {
                    self.teams = []
                }
            } else {
                self.race = nil
                self.teams = []
            }

            self.entries = try await entriesReq

            error = nil
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    /// Fila mínima de startlist_teams (referencia al equipo canónico).
    private struct StartlistTeamRef: Codable, Sendable {
        let teamId: String?
    }

    /// Equipos canónicos de la startlist de la carrera. nil si no hay
    /// startlist, falla la consulta o algún equipo no está enlazado al
    /// catálogo: entonces se casa por nombre contra el catálogo completo.
    private static func startlistTeamIds(raceId: String) async -> [String]? {
        guard let rows: [StartlistTeamRef] = try? await SupabaseService.shared.client.from("startlist_teams")
            .select("teamId")
            .eq("raceId", value: raceId)
            .execute()
            .value,
            !rows.isEmpty,
            rows.allSatisfy({ $0.teamId != nil }) else { return nil }
        return Array(Set(rows.compactMap(\.teamId)))
    }

    /// Equipos con la paleta del año para casar por nombre las bandas. Con una
    /// startlist enlazada se piden solo sus equipos; si no, el catálogo completo
    /// (paginado, para no depender del tope de filas por respuesta).
    private static func teams(year: Int, startlistTeamIds: [String]?) async -> [Team] {
        let service = SupabaseService.shared
        let base: [Team]
        let seasons: [TeamSeason]
        if let startlistTeamIds, !startlistTeamIds.isEmpty {
            async let baseReq: [Team] = (try? await service.inChunks(startlistTeamIds) { chunk in
                try await service.client.from("teams").select().in("id", values: chunk).execute().value
            }) ?? []
            async let seasonsReq: [TeamSeason] = (try? await service.inChunks(startlistTeamIds) { chunk in
                try await service.client.from("team_seasons")
                    .select()
                    .eq("year", value: year)
                    .in("teamId", values: chunk)
                    .execute()
                    .value
            }) ?? []
            base = await baseReq
            seasons = await seasonsReq
        } else {
            async let baseReq = Self.allTeams()
            async let seasonsReq: [TeamSeason] = (try? await service.teamSeasons(year: year)) ?? []
            base = await baseReq
            seasons = await seasonsReq
        }
        let seasonByTeam = Dictionary(seasons.map { ($0.teamId, $0) }, uniquingKeysWith: { first, _ in first })
        let baseById = Dictionary(base.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return Set(baseById.keys).union(seasonByTeam.keys).compactMap { id in
            baseById[id]?.applyingSeason(seasonByTeam[id]) ?? seasonByTeam[id]?.asTeam()
        }
    }

    /// Catálogo completo de equipos, paginado por `id`.
    private static func allTeams() async -> [Team] {
        var all: [Team] = []
        var offset = 0
        while true {
            guard let page: [Team] = try? await SupabaseService.shared.client.from("teams")
                .select()
                .order("id")
                .range(from: offset, to: offset + 999)
                .execute()
                .value else { return all }
            all.append(contentsOf: page)
            if page.count < 1000 { return all }
            offset += 1000
        }
    }

    func refresh(raceDayId: String) async {
        await load(raceDayId: raceDayId)
    }

    // MARK: - Time helpers

    /// Indica si conviene convertir la hora de la carrera a hora del usuario.
    var shouldConvertTime: Bool {
        guard let raceTz = raceDay?.timezone, !raceTz.isEmpty else { return false }
        let userTz = TimeZone.current.identifier
        if raceTz == userTz { return false }
        // Probe: ¿formatear el mismo instante en ambas TZs da resultados distintos?
        guard let probe = entries.first.flatMap({ raceLocalInstant(date: raceDay?.effectiveDate, time: $0.startTime, tz: raceTz) }) else {
            return false
        }
        let raceStr = formatTime(probe, in: TimeZone(identifier: raceTz))
        let userStr = formatTime(probe, in: .current)
        return raceStr != userStr
    }

    /// Devuelve la hora convertida a la zona horaria del usuario, junto con un sufijo
    /// "+1d" / "-1d" si la fecha-en-zona-del-usuario difiere de la de la carrera.
    func convertedTime(for entry: StartOrderEntry) -> (text: String, dayShift: String?) {
        guard let raceTz = raceDay?.timezone,
              let rdDate = raceDay?.effectiveDate,
              let instant = raceLocalInstant(date: rdDate, time: entry.startTime, tz: raceTz) else {
            return (entry.startTime, nil)
        }
        let userTz = TimeZone.current
        let userStr = formatTime(instant, in: userTz)
        // Detectar cambio de día: comparar el día (en zona del usuario) del instante
        // con la fecha de la carrera (string `rdDate`), como un diff de día puro.
        // OJO: no reinterpretar `rdDate` en la TZ de la carrera — para zonas detrás de
        // UTC (p.ej. America/Bogota, UTC-5) la medianoche UTC cae el día anterior y
        // produciría un "+1d" espurio en todas las filas. (Paridad con web/Android.)
        var calUser = Calendar(identifier: .gregorian)
        calUser.timeZone = userTz
        let userDay = calUser.dateComponents([.year, .month, .day], from: instant)
        let raceParts = rdDate.split(separator: "-").compactMap { Int($0) }
        if raceParts.count == 3, let uy = userDay.year, let um = userDay.month, let ud = userDay.day {
            var utcCal = Calendar(identifier: .gregorian)
            utcCal.timeZone = TimeZone(identifier: "UTC") ?? .current
            var raceComps = DateComponents()
            raceComps.year = raceParts[0]; raceComps.month = raceParts[1]; raceComps.day = raceParts[2]
            var userComps = DateComponents()
            userComps.year = uy; userComps.month = um; userComps.day = ud
            if let raceDayDate = utcCal.date(from: raceComps), let userDate = utcCal.date(from: userComps) {
                let diff = utcCal.dateComponents([.day], from: raceDayDate, to: userDate).day ?? 0
                if diff != 0 {
                    let sign = diff > 0 ? "+" : ""
                    return (userStr, "\(sign)\(diff)d")
                }
            }
        }
        return (userStr, nil)
    }

    /// "Offset" legible para una TZ en una fecha concreta (DST-correct).
    func tzOffsetLabel(_ tzIdentifier: String) -> String {
        guard let tz = TimeZone(identifier: tzIdentifier), let date = parseDate(raceDay?.effectiveDate) else { return "" }
        let secs = tz.secondsFromGMT(for: date)
        let sign = secs >= 0 ? "+" : "-"
        let absMin = abs(secs) / 60
        let h = absMin / 60
        let m = absMin % 60
        return m == 0 ? "GMT\(sign)\(h)" : String(format: "GMT%@%d:%02d", sign, h, m)
    }

    var raceLocationLabel: String {
        if let startEn = raceDay?.startLocationEn, LocaleService.isEnglish, !startEn.isEmpty { return startEn }
        if let start = raceDay?.startLocation, !start.isEmpty { return start }
        if let tz = raceDay?.timezone, !tz.isEmpty { return tz.split(separator: "/").last.map { String($0).replacingOccurrences(of: "_", with: " ") } ?? tz }
        return ""
    }

    // MARK: - Internal helpers

    private func parseDate(_ s: String?) -> Date? {
        guard let s else { return nil }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.date(from: s)
    }

    private func raceLocalInstant(date: String?, time: String?, tz: String?) -> Date? {
        guard let date, let time, let tzId = tz, let tz = TimeZone(identifier: tzId) else { return nil }
        let dateComps = date.split(separator: "-").compactMap { Int($0) }
        let timeComps = time.split(separator: ":").compactMap { Int($0) }
        guard dateComps.count == 3, timeComps.count >= 2 else { return nil }
        var c = DateComponents()
        c.year = dateComps[0]; c.month = dateComps[1]; c.day = dateComps[2]
        c.hour = timeComps[0]; c.minute = timeComps[1]
        c.second = timeComps.count > 2 ? timeComps[2] : 0
        c.timeZone = tz
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        return cal.date(from: c)
    }

    private func formatTime(_ date: Date, in tz: TimeZone?) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        f.timeZone = tz
        return f.string(from: date)
    }
}
