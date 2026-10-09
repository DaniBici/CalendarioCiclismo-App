import Foundation
import Supabase

/// Resultados in-house UCI — queries y compuestos. Espejo de las funciones
/// homónimas de Android (`SupabaseService.kt` + `CalendarRepository.kt`).
extension SupabaseService {

    // MARK: - Queries

    /// Columnas que decodifica `RaceUciStage` (sin identificadores de la fuente
    /// ni metadatos de volcado).
    static let raceUciStageColumns =
        "id,raceId,raceDayId,classKind,eventName,isTeamEvent,stageNumber,isFinalClassification," +
        "keepForWeb,rowCount,raceType,stageDate,winnerName,publicationStatus,lastSyncedAt,updating,updatingUntil"

    /// Ejecuta una consulta `in` por bloques de IDs, en paralelo, para no
    /// superar la longitud de URL con listas largas.
    func inChunks<T: Sendable>(
        _ ids: [String],
        size: Int = 150,
        _ fetch: @escaping @MainActor @Sendable ([String]) async throws -> [T]
    ) async throws -> [T] {
        let unique = Array(Set(ids.filter { !$0.isEmpty }))
        guard !unique.isEmpty else { return [] }
        if unique.count <= size { return try await fetch(unique) }
        let chunks = stride(from: 0, to: unique.count, by: size).map {
            Array(unique[$0..<min($0 + size, unique.count)])
        }
        return try await withThrowingTaskGroup(of: [T].self) { group in
            for chunk in chunks { group.addTask { try await fetch(chunk) } }
            var out: [T] = []
            for try await part in group { out += part }
            return out
        }
    }

    /// Clasificaciones keepForWeb de una carrera (clasif. de etapa + GC del día +
    /// generales acumuladas). 1 fila por (etapa × clasificación).
    func raceUciStages(raceId: String) async throws -> [RaceUciStage] {
        try await client.from("race_uci_stages")
            .select(Self.raceUciStageColumns)
            .eq("raceId", value: raceId)
            .eq("keepForWeb", value: true)
            .order("stageNumber", ascending: true, nullsFirst: true)
            .execute()
            .value
    }

    func raceClassifications(raceId: String) async throws -> [RaceClassificationConfig] {
        try await client.from("race_classifications")
            .select("raceId,classKind,position,labelEs,labelEn,colorHex")
            .eq("raceId", value: raceId)
            .order("position", ascending: true)
            .execute()
            .value
    }

    func raceClassifications(raceIds: [String]) async throws -> [RaceClassificationConfig] {
        // Por bloques de carreras: el orden por posición se conserva dentro de
        // cada carrera, que es como lo consumen los llamadores.
        try await inChunks(raceIds) { chunk in
            try await self.client.from("race_classifications")
                .select("raceId,classKind,position,labelEs,labelEn,colorHex")
                .in("raceId", values: chunk)
                .order("position", ascending: true)
                .execute()
                .value
        }
    }

    /// Clasificaciones keepForWeb de un lote de carreras. Bloques de carreras
    /// en paralelo, cada uno paginado (una vuelta supera las 100 filas).
    func raceUciStages(raceIds: [String]) async throws -> [RaceUciStage] {
        try await inChunks(raceIds, size: 40) { chunk in
            var rows: [RaceUciStage] = []
            var offset = 0
            while true {
                let page: [RaceUciStage] = try await self.client.from("race_uci_stages")
                    .select(Self.raceUciStageColumns)
                    .in("raceId", values: chunk)
                    .eq("keepForWeb", value: true)
                    .order("id")
                    .range(from: offset, to: offset + 999)
                    .execute()
                    .value
                rows.append(contentsOf: page)
                if page.count < 1000 { return rows }
                offset += 1000
            }
        }
    }

    /// Filas de una clasificación concreta (siempre por stageRef → índice).
    func raceUciResults(stageRef: String) async throws -> [RaceUciResultRow] {
        try await client.from("race_uci_results")
            .select()
            .eq("stageRef", value: stageRef)
            .order("sortOrder", ascending: true)
            .execute()
            .value
    }

    /// Filas con abandono (irm) de un conjunto de etapas — para tachar inscritos.
    /// CLAVE: el filtro `globalRiderId IS NOT NULL` + `irm IS NOT NULL` va EN EL
    /// SERVIDOR (no en memoria): traer todas las filas de todas las etapas y filtrar
    /// en cliente chocaba con el tope de filas por respuesta de PostgREST → los abandonos
    /// de las primeras etapas se truncaban (p.ej. Cat Ferguson, DNF etapa 1 del
    /// Giro Women, no se tachaba). Filtrando en servidor solo vuelven los pocos DNF.
    func raceUciResultsForStages(stageRefs: [String]) async throws -> [RaceUciResultRow] {
        guard !stageRefs.isEmpty else { return [] }
        return try await client.from("race_uci_results")
            .select()
            .in("stageRef", values: stageRefs)
            .not("globalRiderId", operator: .is, value: "null")
            .not("irm", operator: .is, value: "null")
            .execute()
            .value
    }

    /// Vista resuelta con globalRiderId (lo necesita la reconstrucción por dorsal
    /// de los resultados para el tachado de abandonos).
    func startlistRidersResolvedFull(raceId: String) async throws -> [StartlistRiderResolved] {
        try await client.from("startlist_riders_resolved")
            .select("dorsal,firstName,lastName,countryCode,teamId,globalRiderId")
            .eq("raceId", value: raceId)
            .execute()
            .value
    }

    /// Fila mínima de startlist_teams para resolver la chapa canónica.
    private struct SlimStartlistTeam: Codable, Sendable {
        let id: String
        let teamId: String?
        let teamName: String?
    }

    // MARK: - Compuestos (espejo de CalendarRepository en Android)

    private func startlistTeamsSlim(raceId: String) async throws -> [SlimStartlistTeam] {
        try await client.from("startlist_teams")
            .select("id,teamId,teamName")
            .eq("raceId", value: raceId)
            .execute()
            .value
    }

    /// Equipos canónicos por ID con su versión del año (team_seasons). Ambas
    /// consultas se lanzan a la vez; la de temporadas es tolerante a fallos.
    private func canonicalTeams(ids: [String], year: Int?) async throws -> [String: Team] {
        guard !ids.isEmpty else { return [:] }
        async let teamsReq: [Team] = inChunks(ids) { chunk in
            try await self.client.from("teams").select().in("id", values: chunk).execute().value
        }
        async let seasonsReq: [TeamSeason] = teamSeasonsOrEmpty(ids: ids, year: year)
        let teams = try await teamsReq
        let seasons = await seasonsReq
        var teamById = Dictionary(teams.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        if year != nil {
            let seasonByTeam = Dictionary(seasons.map { ($0.teamId, $0) }, uniquingKeysWith: { first, _ in first })
            teamById = teamById.mapValues { $0.applyingSeason(seasonByTeam[$0.id]) }
            for id in ids where teamById[id] == nil {
                teamById[id] = seasonByTeam[id]?.asTeam()
            }
        }
        return teamById
    }

    private func teamSeasonsOrEmpty(ids: [String], year: Int?) async -> [TeamSeason] {
        guard let year else { return [] }
        return (try? await inChunks(ids) { chunk in
            try await self.client.from("team_seasons")
                .select()
                .eq("year", value: year)
                .in("teamId", values: chunk)
                .execute()
                .value
        }) ?? []
    }

    /// Reconstruye el corredor por dorsal contra la startlist curada (idéntico a
    /// `js/resultados.js`): `bib → dorsal → nombre/bandera/equipo`. Devuelve
    /// también los equipos CANÓNICOS de la startlist (`raceTeams`), que la
    /// pestaña Equipos casa por nombre (sus filas no llevan dorsal).
    ///
    /// OJO: `startlist_riders.teamId` apunta al **PK** de `startlist_teams`, NO a
    /// su columna `teamId` (la ref canónica a `teams`). La chapa del equipo sale
    /// de ese teamId canónico.
    private func buildByDorsal(
        slRiders: [StartlistRiderResolved],
        slTeams: [SlimStartlistTeam],
        year: Int?
    ) async throws -> ([Int: ResolvedRider], [Team]) {
        let slTeamByPk = Dictionary(slTeams.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let canonIds = Array(Set(slTeams.compactMap(\.teamId)))
        // Solo los equipos de la startlist: el catálogo completo pesa más de
        // 1 MB y crece hacia el tope de filas por respuesta de PostgREST.
        let teamById = try await canonicalTeams(ids: canonIds, year: year)

        var out: [Int: ResolvedRider] = [:]
        out.reserveCapacity(slRiders.count)
        for r in slRiders {
            guard let dorsal = r.dorsal else { continue }
            let slTeam = r.teamId.flatMap { slTeamByPk[$0] }
            let canon = slTeam?.teamId.flatMap { teamById[$0] }
            // Estado sin equipo → ocultación cosmética: sin nombre de equipo,
            // y en cascada sin chapa ni opción en el filtro por equipo.
            let isPlaceholder = slTeam.map { isNoTeamPlaceholderTeam(teamId: $0.teamId, teamName: $0.teamName) } ?? false
            let slName = isPlaceholder ? "" : (slTeam?.teamName ?? "")
            out[dorsal] = ResolvedRider(
                name: "\(r.firstName ?? "") \(r.lastName ?? "")".trimmingCharacters(in: .whitespaces),
                countryCode: r.countryCode ?? "",
                // Equipo casado → nombre canónico; sin casar → el crudo de la startlist.
                teamName: canon?.name ?? slName,
                team: canon,
                globalRiderId: r.globalRiderId
            )
        }
        return (out, Array(teamById.values))
    }

    /// Fila mínima de riders_men/women para el fallback por globalRiderId.
    private struct SlimRiderRow: Codable {
        let id: String
        let firstName: String?
        let lastName: String?
        let nationality: String?
        let currentTeamId: String?
    }

    /// Resuelve un conjunto de `globalRiderId` a `ResolvedRider` directamente
    /// desde riders_men/women. La ficha aporta nombre y nacionalidad; el equipo
    /// actual solo se incluye cuando el llamador confirma que consulta el año vigente.
    /// Fail-silent: si una query falla, esos ids
    /// no entran en el mapa (la fila se renderiza sin bandera/chapa, como antes).
    func enrichRidersByGlobalId(_ ids: [String], includeCurrentTeam: Bool = true) async -> [String: ResolvedRider] {
        let need = Array(Set(ids.filter { !$0.isEmpty }))
        guard !need.isEmpty else { return [:] }
        let columns = includeCurrentTeam ? "id,firstName,lastName,nationality,currentTeamId" : "id,firstName,lastName,nationality"
        async let menReq: [SlimRiderRow] = (try? await client.from("riders_men")
            .select(columns)
            .in("id", values: need)
            .execute()
            .value) ?? []
        async let womenReq: [SlimRiderRow] = (try? await client.from("riders_women")
            .select(columns)
            .in("id", values: need)
            .execute()
            .value) ?? []
        let riders = await menReq + womenReq
        guard !riders.isEmpty else { return [:] }

        let currentIds = includeCurrentTeam ? Array(Set(riders.compactMap(\.currentTeamId))) : []
        var teamById: [String: Team] = [:]
        if !currentIds.isEmpty {
            let teams: [Team] = (try? await client.from("teams")
                .select()
                .in("id", values: currentIds)
                .execute()
                .value) ?? []
            teamById = Dictionary(uniqueKeysWithValues: teams.map { ($0.id, $0) })
        }
        var out: [String: ResolvedRider] = [:]
        out.reserveCapacity(riders.count)
        for r in riders {
            let team = includeCurrentTeam ? r.currentTeamId.flatMap { teamById[$0] } : nil
            out[r.id] = ResolvedRider(
                name: [r.firstName, r.lastName].compactMap { $0 }.joined(separator: " ")
                    .trimmingCharacters(in: .whitespaces),
                countryCode: r.nationality ?? "",
                teamName: team?.name ?? "",
                team: team,
                globalRiderId: r.id
            )
        }
        return out
    }

    /// Override MANUAL de equipo (mig. 112): resuelve los `teamId` de override de
    /// las filas de resultados a su equipo canónico (nombre + chapa). Espejo de
    /// `enrichOverrideTeams` en `js/resultados.js`. Silencioso: ids sin equipo
    /// no entran en el mapa (la fila cae a la resolución por dorsal).
    func enrichTeamsByIds(_ ids: [String], year: Int?) async -> [String: Team] {
        let need = Array(Set(ids.filter { !$0.isEmpty }))
        guard !need.isEmpty else { return [:] }
        return (try? await canonicalTeams(ids: need, year: year)) ?? [:]
    }

    /// Parte de la pantalla de resultados que no cambia durante la carrera:
    /// ficha, corredores por dorsal, equipos e inventario de clasificaciones.
    private struct ResultsStaticData: Sendable {
        let race: Race
        let byDorsal: [Int: ResolvedRider]
        let raceTeams: [Team]
        let classificationConfig: [RaceClassificationConfig]
    }

    private func resultsStaticData(raceId: String, reusing previous: UciResultsData?) async throws -> ResultsStaticData {
        if let previous {
            return ResultsStaticData(
                race: previous.race,
                byDorsal: previous.byDorsal,
                raceTeams: previous.raceTeams,
                classificationConfig: previous.classificationConfig
            )
        }
        async let raceReq = race(byId: raceId)
        async let ridersReq = startlistRidersResolvedFull(raceId: raceId)
        async let teamsReq = startlistTeamsSlim(raceId: raceId)
        async let configsReq: [RaceClassificationConfig] = (try? await raceClassifications(raceId: raceId)) ?? []
        let race = try await raceReq
        let slRiders = try await ridersReq
        let slTeams = try await teamsReq
        let (byDorsal, raceTeams) = try await buildByDorsal(slRiders: slRiders, slTeams: slTeams, year: race.year)
        return ResultsStaticData(
            race: race,
            byDorsal: byDorsal,
            raceTeams: raceTeams,
            classificationConfig: await configsReq
        )
    }

    /// Carga de la pantalla de resultados. nil si la carrera no tiene
    /// clasificaciones keepForWeb (→ estado Empty). Todas las consultas salen
    /// en una tanda; solo los equipos canónicos esperan a la startlist.
    ///
    /// `previous` (refresco periódico de la misma carrera) reutiliza la parte
    /// estática y pide las jornadas sin perfil, conservando el perfil ya
    /// descargado de cada una.
    func loadResultsData(raceId: String, reusing previous: UciResultsData? = nil) async throws -> UciResultsData? {
        // La parte estática solo se reutiliza durante `resultsStaticReuseWindow`:
        // después se vuelve a pedir para recoger cambios de ficha, startlist o
        // inventario de clasificaciones sin reabrir la pantalla.
        let reuse = previous.flatMap {
            $0.race.id == raceId && Date().timeIntervalSince($0.staticFetchedAt) < Self.resultsStaticReuseWindow ? $0 : nil
        }
        let dayColumns = reuse == nil ? Self.raceDayProfileColumns : Self.raceDayCoreColumns
        async let stagesReq = raceUciStages(raceId: raceId)
        // Las jornadas se cargan SIEMPRE: una etapa CANCELADA no tiene
        // clasificaciones propias y su pantalla se sintetiza a partir de ellas
        // (aviso + generales de la etapa anterior). La señal `isCancelledDay`
        // vive en race_days, no en race_uci_stages. Espejo de js/resultados.js.
        async let daysReq: [RaceDay] = (try? await raceDays(byRaceId: raceId, columns: dayColumns)) ?? []
        async let assetsReq: [Asset] = (try? await assets(byPublishedRaceId: raceId)) ?? []
        async let staticReq = resultsStaticData(raceId: raceId, reusing: reuse)

        let rawStages = try await stagesReq
        var allDays = await daysReq
        if let reuse {
            let previousById = Dictionary(reuse.raceDays.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            allDays = allDays.map { day in
                guard let old = previousById[day.id], old.elevationProfile != nil else { return day }
                return day.applying(elevation: RaceDayElevationData(
                    id: day.id,
                    elevationProfile: old.elevationProfile,
                    profileSummits: old.profileSummits,
                    profileWaypoints: old.profileWaypoints,
                    profileNotViewable: day.profileNotViewable
                ))
            }
            // Jornadas sin perfil en la carga anterior (nuevas o con el perfil
            // publicado después): se piden solo las suyas.
            let missingProfileIds = allDays
                .filter { previousById[$0.id]?.elevationProfile == nil }
                .map(\.id)
            if !missingProfileIds.isEmpty,
               let elevation = try? await raceDaysElevation(byIds: missingProfileIds) {
                let elevationById = Dictionary(elevation.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
                allDays = allDays.map { day in elevationById[day.id].map { day.applying(elevation: $0) } ?? day }
            }
        }
        let stageDays = allDays.map {
            UciResultsLogic.StageDay(
                id: $0.id,
                stageNumber: $0.stageNumber,
                dateKey: $0.dateKey,
                isCancelledDay: $0.isCancelledDay,
                isRestDay: $0.isRestDay,
                neutralStartTimeUtc: $0.neutralStartTimeUtc
            )
        }
        // Dobles sectores (3A/3B): mapa raceDayId → sufijo + stageNumbers sectorizados.
        let (sectorSuffixByRaceDayId, sectoredStageNumbers) = UciResultsLogic.sectorSuffixMap(stageDays)
        let stages = UciResultsLogic.applyCancelledStages(rawStages, days: stageDays, raceId: raceId)
        // Sin clasificaciones NI etapa cancelada que sintetizar → estado Empty.
        guard !stages.isEmpty else { return nil }
        let staticData = try await staticReq
        let resultAssets = await assetsReq

        // Índices de jornadas (de `allDays`, que YA traen countryCode/ruta/…) para
        // resolver el header sin más red: por raceDayId y —si el volcado no lo
        // trajo (race_uci_stages.raceDayId NULL)— por stageNumber. Sin el segundo,
        // la cabecera cae al país de la CARRERA e ignora el override por jornada.
        let daysById = Dictionary(uniqueKeysWithValues: allDays.map { ($0.id, $0) })
        var daysByStage: [Int: RaceDay] = [:]
        for d in allDays where d.stageNumber != nil {
            if daysByStage[d.stageNumber!] == nil { daysByStage[d.stageNumber!] = d }
        }
        func rdForStage(_ st: RaceUciStage) -> RaceDay? {
            if let rdId = st.raceDayId, let rd = daysById[rdId] { return rd }
            if let sn = st.stageNumber, let rd = daysByStage[sn] { return rd }
            return nil
        }

        // RaceDay por defecto = el de la última etapa con datos (mayor stageNumber).
        let defaultStage = stages.max { ($0.stageNumber ?? Int.min) < ($1.stageNumber ?? Int.min) }
        var raceDay: RaceDay? = defaultStage.flatMap(rdForStage)
        // Carreras de un día / general final: la "Final Classification" no trae
        // raceDayId ni stageNumber. Si la carrera tiene UNA sola jornada, la
        // usamos para el header (ruta + distancia + tipo), igual que la web.
        if raceDay == nil, allDays.count == 1 { raceDay = allDays.first }
        var data = UciResultsData(
            race: staticData.race, stages: stages, byDorsal: staticData.byDorsal,
            raceTeams: staticData.raceTeams, raceDay: raceDay,
            raceDays: allDays,
            sectorSuffixByRaceDayId: sectorSuffixByRaceDayId,
            sectoredStageNumbers: sectoredStageNumbers,
            classificationConfig: staticData.classificationConfig,
            assets: resultAssets
        )
        data.staticFetchedAt = reuse?.staticFetchedAt ?? Date()
        return data
    }

    /// Tiempo durante el que el refresco periódico de Resultados reutiliza la
    /// ficha, los corredores por dorsal y el inventario de clasificaciones.
    static let resultsStaticReuseWindow: TimeInterval = 600

    /// Filas de una clasificación concreta (on-demand, al cambiar de pestaña).
    func loadResultRows(stageRef: String) async throws -> [RaceUciResultRow] {
        try await raceUciResults(stageRef: stageRef)
    }

    /// ¿Tiene esta jornada resultados in-house? Devuelve `(true, stageNumber)`
    /// con el `stageNumber` al que navegar, o `(false, nil)` si no hay.
    /// Consulta de red ligera y NO bloqueante (el CTA de la jornada aparece de
    /// forma diferida; sin red simplemente no se muestra, como en la web).
    ///
    /// OJO carreras de un día: su clasificación es la "Final Classification"
    /// (`classKind='gc'`) con `stageNumber=nil` Y `raceDayId=nil` → NO se puede
    /// exigir `classKind='stage'` ni `raceDayId!=nil`. El gate es "hay una stage
    /// keepForWeb con filas que corresponde a esta jornada".
    func resultsStageNumberForDay(raceId: String, raceDayId: String, stageNumber: Int?) async -> (Bool, Int?) {
        let stages = ((try? await raceUciStages(raceId: raceId)) ?? [])
            .filter { $0.rowCount > 0 }
        // Correspondencia con la jornada: por raceDayId directo, o —si la stage no
        // lo trae (un día / final)— por igualdad de stageNumber (nil==nil en un día).
        let match = stages.first { $0.raceDayId == raceDayId }
            ?? stages.first { $0.raceDayId == nil && $0.stageNumber == stageNumber }
        guard let match else { return (false, nil) }
        return (true, match.stageNumber)
    }

    /// Jornada candidata al trofeo de resultados in-house.
    struct InhouseDayRequest: Sendable {
        let raceId: String
        let raceDayId: String
        let stageNumber: Int?
        let isCancelled: Bool
    }

    /// Fila mínima de race_uci_stages para los gates del trofeo.
    private struct InhouseStageRow: Codable, Sendable {
        let id: String
        let raceId: String
        let raceDayId: String?
        let stageNumber: Int?
    }

    /// Clasificaciones in-house (keepForWeb + rowCount>0) de un lote de
    /// carreras con columnas mínimas. Bloques de carreras en paralelo, cada
    /// uno paginado para no depender del tope de filas por respuesta.
    private func inhouseStageRows(raceIds: [String]) async throws -> [InhouseStageRow] {
        try await inChunks(raceIds, size: 60) { chunk in
            var rows: [InhouseStageRow] = []
            var offset = 0
            while true {
                let page: [InhouseStageRow] = try await self.client.from("race_uci_stages")
                    .select("id,raceId,raceDayId,stageNumber")
                    .eq("keepForWeb", value: true)
                    .gt("rowCount", value: 0)
                    .in("raceId", values: chunk)
                    .order("id")
                    .range(from: offset, to: offset + 999)
                    .execute()
                    .value
                rows.append(contentsOf: page)
                if page.count < 1000 { return rows }
                offset += 1000
            }
        }
    }

    /// Resuelve, para un conjunto de jornadas de UNA carrera, cuáles tienen
    /// resultados in-house y a qué stageNumber navega su trofeo.
    /// `days` = (raceDayId, stageNumber de la jornada). Devuelve raceDayId →
    /// stageNumber al que navegar (presencia en el mapa = tiene in-house).
    /// Lo usa la pantalla de competición; ver la variante por lotes.
    func inhouseStagesForDays(
        raceId: String,
        days: [(String, Int?)],
        cancelledDayIds: Set<String> = []
    ) async -> [String: Int?] {
        await inhouseStagesForDays(days.map {
            InhouseDayRequest(raceId: raceId, raceDayId: $0.0, stageNumber: $0.1, isCancelled: cancelledDayIds.contains($0.0))
        })
    }

    /// Variante por lotes (varias carreras en una sola consulta): Hoy la usa
    /// para todas las tarjetas visibles.
    ///
    /// Maneja el caso de un día / general: la stage sin raceDayId se asigna a la
    /// jornada cuyo `stageNumber` coincide (nil==nil para carreras de un día).
    /// Lo usan Hoy y competición para redirigir el trofeo a la pantalla nativa.
    /// Una jornada CANCELADA nunca entra en el mapa: sus clasificaciones son
    /// irrelevantes (no se corrió), así que la card no debe ofrecer el trofeo
    /// aunque el cron llegara a volcar filas antes de la cancelación. El CTA de
    /// su FICHA es otra cosa y se conserva (ver `hasInhouseResults` en
    /// StageDetailView): allí la página explica la cancelación y arrastra las
    /// generales de la etapa anterior.
    func inhouseStagesForDays(_ days: [InhouseDayRequest]) async -> [String: Int?] {
        guard !days.isEmpty else { return [:] }
        let rows = (try? await inhouseStageRows(raceIds: days.map(\.raceId))) ?? []
        guard !rows.isEmpty else { return [:] }
        // Mismo orden que la consulta por carrera: stageNumber ascendente con
        // los nulos primero; la última fila de una jornada prevalece.
        let sorted = rows.sorted {
            switch ($0.stageNumber, $1.stageNumber) {
            case (nil, nil): return $0.id < $1.id
            case (nil, _): return true
            case (_, nil): return false
            case let (a?, b?): return a == b ? $0.id < $1.id : a < b
            }
        }
        let rowsByRace = Dictionary(grouping: sorted, by: \.raceId)
        var out: [String: Int?] = [:]
        for (raceId, raceDays) in Dictionary(grouping: days, by: \.raceId) {
            guard let stages = rowsByRace[raceId] else { continue }
            var byDayId: [String: Int?] = [:]
            for s in stages where s.raceDayId != nil { byDayId[s.raceDayId!] = s.stageNumber }
            let orphans = stages.filter { $0.raceDayId == nil }   // un día / final
            for day in raceDays {
                if day.isCancelled { continue }
                if let mapped = byDayId[day.raceDayId] {
                    out[day.raceDayId] = mapped
                } else if let orphan = orphans.first(where: { $0.stageNumber == day.stageNumber }) {
                    out[day.raceDayId] = orphan.stageNumber
                }
            }
        }
        return out
    }

    /// Conjunto de claves `raceId#stageNumber` (o `raceId#final` si stageNumber es
    /// nil) con clasificaciones in-house (keepForWeb + rowCount>0) para un LOTE de
    /// carreras. Espejo de `loadInhouseStageSet(raceIds)` en
    /// `js/race-data-modal.js`. Lo usa la rejilla de Campeonatos para llevar el
    /// trofeo a la pantalla nativa de resultados cuando los hay. Fail-silent: sin red → conjunto vacío (gate cerrado).
    func inhouseStageKeys(raceIds: [String]) async -> Set<String> {
        let rows = (try? await inhouseStageRows(raceIds: raceIds)) ?? []
        return Set(rows.map { "\($0.raceId)#\($0.stageNumber.map(String.init) ?? "final")" })
    }

    /// Clave de un EnrichedRaceDay para consultar `inhouseStageKeys` (mismo formato).
    static func inhouseKey(raceId: String, stageNumber: Int?) -> String {
        "\(raceId)#\(stageNumber.map(String.init) ?? "final")"
    }

    /// RaceDay canónico de una etapa (para refrescar el header al cambiar de
    /// etapa en la pantalla de resultados).
    func raceDayById(_ raceDayId: String) async -> RaceDay? {
        try? await raceDays(byIds: [raceDayId]).first
    }

    // MARK: - Feed "Últimos resultados" (pestaña Resultados, apps 3.1)

    /// Clasificaciones in-house del rango para el feed: etapas + generales con
    /// filas. stageDate NULL (volcados PDF) también entra: su fecha se resuelve
    /// en cliente y se filtra después. Los DOS parámetros `or=` repetidos los
    /// AND-ea PostgREST (espejo exacto de la query de `js/resultados-feed.js`).
    /// Paginada por `id`: con «Cargar más» la ventana crece sin límite fijo y
    /// no debe depender del tope de filas por respuesta de PostgREST.
    func raceUciStagesFeed(from fromKey: String, to toKey: String) async throws -> [RaceUciStage] {
        var rows: [RaceUciStage] = []
        var offset = 0
        while true {
            let page: [RaceUciStage] = try await client.from("race_uci_stages")
                .select("id,raceId,raceDayId,stageNumber,classKind,stageDate,winnerName,isFinalClassification,keepForWeb,rowCount")
                .eq("keepForWeb", value: true)
                .gt("rowCount", value: 0)
                .in("classKind", values: ["stage", "gc"])
                .or("stageDate.gte.\(fromKey),stageDate.is.null")
                .or("stageDate.lte.\(toKey),stageDate.is.null")
                .order("id")
                .range(from: offset, to: offset + 999)
                .execute()
                .value
            rows.append(contentsOf: page)
            if page.count < 1000 { return rows }
            offset += 1000
        }
    }

    /// Jornadas publicadas del rango del feed (km/desnivel/tipos/hora de las
    /// filas in-house, vía raceDayId). Del perfil solo se pide el desnivel
    /// positivo (`raceDayFeedColumns`), que es lo único que muestra la fila.
    func raceDaysFeedWindow(from fromKey: String, to toKey: String) async throws -> [RaceDay] {
        try await raceDays(from: fromKey, to: toKey, columns: Self.raceDayFeedColumns)
    }

    /// Columnas del programa de cada carrera del feed (última jornada
    /// competitiva para los líderes complementarios).
    private static let raceDayProgramColumns =
        "id,raceId,dateKey,isRestDay,isCancelledDay,stageNumber,neutralStartTimeUtc,editorialStatus,hasAssets"

    /// Instantánea semanal de DataRide compartida por las tres plataformas.
    /// La tabla no conserva históricos: cada martes se reemplazan ambos géneros.
    func loadUciTeamRankings() async throws -> [UciTeamRankingRow] {
        try await client.from("uci_team_rankings")
            .select("gender,rank,previousRank,uciTeamId,teamId,teamCategory,sourceName,displayName,teamCode,countryCode,points,rankingDate,sourceUrl")
            .order("gender", ascending: true)
            .order("rank", ascending: true)
            .execute()
            .value
    }

    /// Fila mínima del rank 1 de una clasificación (resolución del ganador).
    private struct FeedRank1Row: Codable, Sendable {
        let stageRef: String
        let raceId: String
        let bib: String?
        let globalRiderId: String?
        let teamId: String?
        let riderDisplay: String?
        let irm: String?
    }

    /// Filas rank=1 de un conjunto de clasificaciones (ganadores del feed).
    private func raceUciRank1(stageRefs: [String]) async throws -> [FeedRank1Row] {
        try await inChunks(stageRefs) { chunk in
            try await self.client.from("race_uci_results")
                .select("stageRef,raceId,bib,globalRiderId,teamId,riderDisplay,irm")
                .in("stageRef", values: chunk)
                .eq("rank", value: 1)
                .execute()
                .value
        }
    }

    /// Fila mínima de ficha de corredor (nombre canónico del ganador).
    private struct FeedRiderNameRow: Codable, Sendable {
        let id: String
        let firstName: String?
        let lastName: String?
    }

    /// Identidad de fallback del inscrito cuando el resultado todavía no está
    /// enlazado a una ficha global, equivalente al cruce por dorsal de la web.
    private struct FeedStartlistIdentityRow: Codable, Sendable {
        let raceId: String
        let dorsal: Int?
        let globalRiderId: String?
        let firstName: String?
        let lastName: String?
    }

    private func feedStartlistIdentities(raceIds: [String]) async throws -> [FeedStartlistIdentityRow] {
        // Por bloques de pocas carreras: cada startlist ronda los 150-200
        // corredores y la respuesta no debe acercarse al tope de filas por
        // respuesta de PostgREST.
        try await inChunks(raceIds, size: 4) { chunk in
            try await self.client.from("startlist_riders_resolved")
                .select("raceId,dorsal,globalRiderId,firstName,lastName")
                .in("raceId", values: chunk)
                .execute()
                .value
        }
    }

    /// Nombres canónicos "First Last" desde riders_men + riders_women (en
    /// paralelo y por bloques de IDs).
    private func riderNamesByIds(_ ids: [String]) async throws -> [String: String] {
        guard !ids.isEmpty else { return [:] }
        async let men: [FeedRiderNameRow] = inChunks(ids) { chunk in
            try await self.client.from("riders_men")
                .select("id,firstName,lastName")
                .in("id", values: chunk)
                .execute()
                .value
        }
        async let women: [FeedRiderNameRow] = inChunks(ids) { chunk in
            try await self.client.from("riders_women")
                .select("id,firstName,lastName")
                .in("id", values: chunk)
                .execute()
                .value
        }
        var out: [String: String] = [:]
        for r in try await men + women {
            out[r.id] = "\(r.firstName ?? "") \(r.lastName ?? "")".trimmingCharacters(in: .whitespaces)
        }
        return out
    }

    /// Fila mínima de startlist_riders_resolved para resolver el equipo de
    /// una CRE (ref al PK de startlist_teams).
    private struct FeedSlrTeamRef: Codable, Sendable {
        let raceId: String
        let globalRiderId: String?
        let teamId: String?
    }

    /// Filas de startlist de los corredores dados en un lote de carreras
    /// (resolución del EQUIPO ganador de las CRE, una sola consulta).
    private func startlistRiderTeamRefs(raceIds: [String], riderIds: [String]) async throws -> [FeedSlrTeamRef] {
        guard !raceIds.isEmpty, !riderIds.isEmpty else { return [] }
        return try await inChunks(riderIds) { chunk in
            try await self.client.from("startlist_riders_resolved")
                .select("raceId,globalRiderId,teamId")
                .in("raceId", values: raceIds)
                .in("globalRiderId", values: chunk)
                .execute()
                .value
        }
    }

    /// Filas de startlist_teams por PK (teamName crudo + ref canónica).
    private func startlistTeamsByPks(_ pks: [String]) async throws -> [SlimStartlistTeam] {
        try await inChunks(pks) { chunk in
            try await self.client.from("startlist_teams")
                .select("id,teamId,teamName")
                .in("id", values: chunk)
                .execute()
                .value
        }
    }

    private struct FeedTeamIdentityRow: Codable, Sendable {
        let id: String
        let name: String
    }

    private func teamNamesByIds(_ ids: [String]) async throws -> [String: String] {
        guard !ids.isEmpty else { return [:] }
        let rows: [FeedTeamIdentityRow] = try await inChunks(ids) { chunk in
            try await self.client.from("teams")
                .select("id,name")
                .in("id", values: chunk)
                .execute()
                .value
        }
        return Dictionary(rows.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    }

    /// Fechas YYYY-MM-DD del rango [fromKey, toKey].
    private static func dateKeys(from fromKey: String, to toKey: String) -> [String] {
        var keys: [String] = []
        var cursor = fromKey
        while cursor <= toKey, keys.count < 800 {
            keys.append(cursor)
            guard let next = DateFormatting.dayOffset(from: cursor, by: 1), next > cursor else { break }
            cursor = next
        }
        return keys
    }

    /// Carga el feed de resultados de un rango: entradas YA ordenadas con el
    /// ganador refinado a nombre canónico (corredor por rank 1 → ficha;
    /// CRE → equipo vía startlist). Espejo de `fetchEntries` (web).
    /// Primera tanda: clasificaciones, jornadas y destacados del rango; la
    /// segunda (carreras, generales, inventario y programa) solo espera a las
    /// clasificaciones.
    func loadResultsFeed(from fromKey: String, to toKey: String) async throws -> [FeedEntry] {
        async let stagesReq = raceUciStagesFeed(from: fromKey, to: toKey)
        async let daysReq = raceDaysFeedWindow(from: fromKey, to: toKey)
        // Los destacados se piden para todas las fechas del rango: las
        // entradas solo pueden caer dentro de él.
        async let featuredReq = featuredRaces(for: Self.dateKeys(from: fromKey, to: toKey))

        let stages = try await stagesReq
        let raceIds = Array(Set(stages.map(\.raceId)))
        async let racesReq = races(byIds: raceIds)
        async let allStagesReq = raceUciStages(raceIds: raceIds)
        async let configsReq = raceClassifications(raceIds: raceIds)
        async let programReq = raceDays(byRaceIds: raceIds, columns: Self.raceDayProgramColumns)

        let days = try await daysReq
        let feedRaces = try await racesReq
        var entries = ResultsFeedLogic.buildEntries(
            stages: stages,
            raceDays: days,
            races: feedRaces,
            fromKey: fromKey,
            toKey: toKey
        )
        let featured = (try? await featuredReq) ?? []
        let allStages = (try? await allStagesReq) ?? []
        let configs = (try? await configsReq) ?? []
        let program = (try? await programReq) ?? days
        applyFeedPresentation(
            &entries,
            featured: featured,
            allStages: allStages,
            configs: configs,
            raceDays: program
        )
        entries = ResultsFeedLogic.featuredFirst(entries, selected: Set(featured.map { "\($0.dateKey)#\($0.raceId)" }))
        try await resolveFeedWinners(&entries)
        // La tarea de SwiftUI se cancela al cambiar de pestaña o abrir una
        // clasificación. No publicar entonces el modelo intermedio que todavía
        // contiene winnerName crudo.
        try Task.checkCancellation()
        return entries
    }

    private func applyFeedPresentation(
        _ entries: inout [FeedEntry],
        featured: [FeaturedRaceSelection],
        allStages: [RaceUciStage],
        configs: [RaceClassificationConfig],
        raceDays: [RaceDay]
    ) {
        let selected = Set(featured.map { "\($0.dateKey)#\($0.raceId)" })
        let finals = Set(entries.filter(\.isGcFinal).map { "\($0.date)#\($0.race.id)" })
        let configByRace = Dictionary(grouping: configs, by: \.raceId)
        let lastCompetitiveDayByRace = Dictionary(
            raceDays
                .filter { !$0.isRestDay && !$0.isCancelledDay }
                .sorted {
                    if $0.dateKey != $1.dateKey { return $0.dateKey < $1.dateKey }
                    if ($0.neutralStartTimeUtc ?? "") != ($1.neutralStartTimeUtc ?? "") {
                        return ($0.neutralStartTimeUtc ?? "") < ($1.neutralStartTimeUtc ?? "")
                    }
                    return ($0.stageNumber ?? 0) < ($1.stageNumber ?? 0)
                }
                .compactMap { day in day.raceId.map { ($0, day.id) } },
            uniquingKeysWith: { _, latest in latest }
        )

        for index in entries.indices {
            let entry = entries[index]
            let key = "\(entry.date)#\(entry.race.id)"
            let isFeatured = selected.contains(key) && (!finals.contains(key) || entry.isGcFinal)
            entries[index].isFeatured = isFeatured
            guard isFeatured, entry.kind == .inhouse else { continue }

            // Como en la web: las pruebas de un día no necesitan líderes
            // complementarios y, en la última jornada de una vuelta, estos se
            // muestran en la entrada independiente de la general final.
            if entry.race.isOneDay || (!entry.isGcFinal && entry.rd?.id == lastCompetitiveDayByRace[entry.race.id]) {
                continue
            }

            let candidates = allStages.filter { stage in
                guard stage.raceId == entry.race.id, stage.rowCount > 0,
                      stage.classKind != "stage" else { return false }
                if entry.isGcFinal {
                    return stage.classKind != "gc"
                        && (stage.isFinalClassification || stage.stageNumber == nil)
                        && (stage.stageDate == nil || stage.stageDate == entry.date)
                }
                if let raceDayId = entry.rd?.id, let stageRaceDayId = stage.raceDayId {
                    return raceDayId == stageRaceDayId && !stage.isFinalClassification
                }
                return stage.stageNumber == entry.stageNumber && !stage.isFinalClassification
            }
            let inventory = UciResultsLogic.classificationInventory(
                config: configByRace[entry.race.id] ?? [],
                stages: candidates
            )
            entries[index].complementary = candidates.compactMap { stage in
                let config = inventory.first { $0.classKind == stage.classKind }
                let fallback = RaceClassificationConfig(
                    raceId: stage.raceId, classKind: stage.classKind,
                    position: UciResultsLogic.classOrder.firstIndex(of: stage.classKind) ?? 10,
                    labelEs: nil, labelEn: nil, colorHex: nil
                )
                let row = config ?? fallback
                return FeedComplementaryClassification(
                    stageRef: stage.id,
                    classKind: stage.classKind,
                    labelEs: UciResultsLogic.classificationLabel(row, isEn: false),
                    labelEn: UciResultsLogic.classificationLabel(row, isEn: true),
                    colorHex: UciResultsLogic.classificationColor(row),
                    winner: ResultsFeedLogic.cleanWinner(stage.winnerName)
                )
            }
            .sorted { lhs, rhs in
                let positions = Dictionary(uniqueKeysWithValues: inventory.map { ($0.classKind, $0.position) })
                return (positions[lhs.classKind] ?? 99) < (positions[rhs.classKind] ?? 99)
            }
        }
    }

    /// Ganadores con nombre canónico de la ficha. rank 1 de cada clasificación
    /// → globalRiderId → riders_men/women. Si hay VARIOS rank 1 (CRE: todo el
    /// equipo comparte puesto) o no resuelve, se mantiene el winnerName crudo.
    /// CRE: el ganador es el EQUIPO (jornada 'ttt' o varios rank 1) → corredor
    /// rank 1 → fila de startlist → equipo, con nombre canónico si está enlazado.
    private func resolveFeedWinners(_ entries: inout [FeedEntry]) async throws {
        do {
            var referencedStages: [String] = []
            for entry in entries where entry.kind == .inhouse {
                if let stageRefId = entry.stageRefId { referencedStages.append(stageRefId) }
                referencedStages.append(contentsOf: entry.complementary.map(\.stageRef))
            }
            let refIds = Array(Set(referencedStages))
            guard !refIds.isEmpty else { return }
            let rank1Rows = try await raceUciRank1(stageRefs: refIds)
            let nonWinnerRefs = Set(rank1Rows.filter { UciResultsLogic.isNonWinnerIrm($0.irm) }.map(\.stageRef))
            let rows = rank1Rows.filter { !UciResultsLogic.isNonWinnerIrm($0.irm) }

            // Nombres canónicos primero: el cruce por dorsal de la startlist
            // también debe cubrir filas cuya ficha existe pero no resuelve
            // nombre (oculta por el aislamiento del catálogo histórico o sin
            // nombre público), no solo las que llegan sin globalRiderId.
            // Los nombres canónicos de equipo solo dependen de las filas rank 1:
            // se piden a la vez que los de corredor.
            async let canonicalTeamNamesReq: [String: String] =
                (try? await teamNamesByIds(Array(Set(rows.compactMap { $0.teamId })))) ?? [:]
            var nameById = try await riderNamesByIds(Array(Set(rows.compactMap(\.globalRiderId))))
            let unresolvedRaceIds = Array(Set(rows.compactMap { row -> String? in
                guard Int(row.bib ?? "") != nil else { return nil }
                if let gid = row.globalRiderId, let name = nameById[gid], !name.isEmpty { return nil }
                return row.raceId
            }))
            let startlistRows: [FeedStartlistIdentityRow] =
                (try? await feedStartlistIdentities(raceIds: unresolvedRaceIds)) ?? []
            var startlistByBib: [String: FeedStartlistIdentityRow] = [:]
            for row in startlistRows {
                guard let dorsal = row.dorsal else { continue }
                startlistByBib["\(row.raceId)#\(dorsal)"] = row
            }

            var byRef: [String: Set<String>] = [:]
            for row in rows {
                if byRef[row.stageRef] == nil { byRef[row.stageRef] = [] }
                let dorsal = Int(row.bib ?? "")
                let fallback = dorsal.flatMap { startlistByBib["\(row.raceId)#\($0)"] }
                if let gid = row.globalRiderId ?? fallback?.globalRiderId {
                    byRef[row.stageRef]?.insert(gid)
                }
            }

            let riderIds = Array(Set(rows.compactMap { row -> String? in
                if let gid = row.globalRiderId { return gid }
                guard let dorsal = Int(row.bib ?? "") else { return nil }
                return startlistByBib["\(row.raceId)#\(dorsal)"]?.globalRiderId
            }))
            let extraIds = riderIds.filter { nameById[$0] == nil }
            if !extraIds.isEmpty {
                for (id, name) in try await riderNamesByIds(extraIds) {
                    nameById[id] = name
                }
            }

            func resolvedRiderName(_ row: FeedRank1Row) -> String? {
                let fallback = Int(row.bib ?? "").flatMap { startlistByBib["\(row.raceId)#\($0)"] }
                if let gid = row.globalRiderId ?? fallback?.globalRiderId,
                   let name = nameById[gid], !name.isEmpty { return name }
                let fallbackName = "\(fallback?.firstName ?? "") \(fallback?.lastName ?? "")"
                    .trimmingCharacters(in: .whitespaces)
                if !fallbackName.isEmpty { return fallbackName }
                return ResultsFeedLogic.cleanWinner(row.riderDisplay)
            }

            let canonicalTeamNames = await canonicalTeamNamesReq
            let rowsByRef = Dictionary(grouping: rows) { $0.stageRef }

            for i in entries.indices {
                guard entries[i].kind == .inhouse else { continue }
                if let ref = entries[i].stageRefId {
                    let names = Array(Set((rowsByRef[ref] ?? []).compactMap(resolvedRiderName)))
                    if nonWinnerRefs.contains(ref), names.isEmpty { entries[i].winner = "" }
                    if names.count == 1, entries[i].rd?.primaryType != "ttt" {
                        entries[i].winner = names[0]
                    }
                }

                entries[i].complementary = entries[i].complementary.map { item in
                    let leaderRows = rowsByRef[item.stageRef] ?? []
                    let names: [String]
                    if item.classKind == "teams" {
                        names = Array(Set(leaderRows.compactMap { row in
                            row.teamId.flatMap { canonicalTeamNames[$0] }
                                ?? ResultsFeedLogic.cleanWinner(row.riderDisplay)
                        }))
                    } else {
                        names = Array(Set(leaderRows.compactMap(resolvedRiderName)))
                    }
                    return FeedComplementaryClassification(
                        stageRef: item.stageRef,
                        classKind: item.classKind,
                        labelEs: item.labelEs,
                        labelEn: item.labelEn,
                        colorHex: item.colorHex,
                        winner: names.isEmpty ? item.winner : names.sorted().joined(separator: " / ")
                    )
                }
            }

            // CRE: señales = jornada 'ttt' (variante B de la UCI, solo el líder
            // lleva rank 1) o varios corredores comparten el rank 1 (variante A).
            // Todas las CRE del feed se resuelven por lotes: corredores →
            // filas de startlist → equipos de startlist → nombres canónicos.
            struct CreTarget { let index: Int; let raceId: String; let riderIds: Set<String> }
            let creTargets: [CreTarget] = entries.indices.compactMap { i in
                let e = entries[i]
                guard e.kind == .inhouse, let ref = e.stageRefId, !e.isGcFinal else { return nil }
                let rank1Ids = byRef[ref] ?? []
                guard e.rd?.primaryType == "ttt" || rank1Ids.count > 1 else { return nil }
                let ids = Set(rank1Ids.prefix(3))
                return ids.isEmpty ? nil : CreTarget(index: i, raceId: e.race.id, riderIds: ids)
            }
            if !creTargets.isEmpty {
                do {
                    let refs = try await startlistRiderTeamRefs(
                        raceIds: Array(Set(creTargets.map(\.raceId))),
                        riderIds: Array(Set(creTargets.flatMap(\.riderIds)))
                    )
                    var pksByTarget: [Int: Set<String>] = [:]
                    for target in creTargets {
                        pksByTarget[target.index] = Set(refs.compactMap { ref in
                            guard ref.raceId == target.raceId,
                                  let gid = ref.globalRiderId, target.riderIds.contains(gid) else { return nil }
                            return ref.teamId
                        })
                    }
                    let uniquePks = pksByTarget.values.compactMap { $0.count == 1 ? $0.first : nil }
                    let slTeams = try await startlistTeamsByPks(Array(Set(uniquePks)))
                    let slTeamByPk = Dictionary(slTeams.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
                    let canonNames = (try? await teamNamesByIds(Array(Set(slTeams.compactMap(\.teamId))))) ?? [:]
                    try Task.checkCancellation()
                    for target in creTargets {
                        guard let pks = pksByTarget[target.index], pks.count == 1,
                              let pk = pks.first, let slt = slTeamByPk[pk] else { continue }
                        var teamWinner = slt.teamName ?? ""
                        if let canonId = slt.teamId, let canonName = canonNames[canonId], !canonName.isEmpty {
                            teamWinner = canonName
                        }
                        if !teamWinner.isEmpty {
                            entries[target.index].winner = ResultsFeedLogic.localizedNationName(
                                teamWinner,
                                isEnglish: LocaleService.shouldShowEnglishContent
                            )
                        }
                    }
                } catch is CancellationError {
                    throw CancellationError()
                } catch { /* se quedan los ganadores que hubiera */ }
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch { /* ganador crudo si falla la resolución */ }
        // Algunas librerías de red pueden envolver la cancelación en otro error.
        // El estado cancelado de la Task sigue siendo la fuente definitiva.
        try Task.checkCancellation()
    }

    /// Mapa globalRiderId → fuera-de-carrera, con la etapa MÁS RECIENTE de cada
    /// corredor (mayor stageNumber). Señal = `irm` de ABANDONO REAL (DNF/DNS/OTL/DSQ/
    /// ABD vía `isAbandonIrm`) en una clasificación de ETAPA (`classKind='stage'`, NO
    /// la "Stage General" que es el GC del día). Un código de ruido como 'LAP' (doblada)
    /// NO tacha — la UCI lo cuelga a veces de corredores en carrera, incluida la propia
    /// ganadora (ver UciResultsLogic). Port de inscritos.js L228–256 vía
    /// CalendarRepository.loadRiderOuts (Android).
    func loadRiderOuts(raceId: String) async throws -> [String: RiderOut] {
        let stages = try await raceUciStages(raceId: raceId)
            .filter { $0.classKind == "stage" && $0.rowCount > 0 }
        guard !stages.isEmpty else { return [:] }

        let stageNumById = Dictionary(uniqueKeysWithValues: stages.map { ($0.id, $0.stageNumber) })
        let rows = try await raceUciResultsForStages(stageRefs: stages.map(\.id))
            .filter { !($0.globalRiderId ?? "").isEmpty && UciResultsLogic.isAbandonIrm($0.irm) }

        var out: [String: RiderOut] = [:]
        for row in rows {
            guard let gid = row.globalRiderId, let irm = row.irm else { continue }
            let sn = stageNumById[row.stageRef] ?? nil
            // Quedarse con la etapa más reciente (mayor stageNumber; nil = -1).
            let snVal = sn ?? -1
            let prevVal = out[gid]?.stageNumber ?? -2
            if snVal >= prevVal {
                out[gid] = RiderOut(irm: irm, stageNumber: sn)
            }
        }
        return out
    }
}
