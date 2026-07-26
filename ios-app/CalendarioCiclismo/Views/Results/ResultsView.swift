import SwiftUI

/// Destino de navegación a la pantalla de resultados in-house. Se navega por
/// VALOR (`navigationDestination(item:)` / `NavigationLink(value:)`), igual que
/// `ChampionshipsRoute`, para no corromper el `NavigationStack` de Hoy.
struct ResultsRoute: Identifiable, Hashable {
    let raceId: String
    /// Etapa pedida (0 = prólogo); nil = clasificación final / última con datos.
    let stageNumber: Int?
    /// Sufijo de sector (A/B) del deep-link — doble sector 3A/3B.
    var stageSuffix: String? = nil
    /// Clasificación pedida (p. ej. "gc" para abrir en la General); nil = la primera
    /// de la etapa (stage). Lo usa "Así está la carrera" para abrir en la General.
    var classKind: String? = nil

    var id: String { "\(raceId)-\(stageNumber.map(String.init) ?? "final")\(stageSuffix ?? "")-\(classKind ?? "")" }
}

// La clave de agrupación de etapa es un `String` sector-consciente: "final" |
// "3" | "3A" (espejo de js/resultados.js y de Android). El orden lo da
// `UciResultsLogic.parseResultStageKey`. Antes era un enum stage(Int)|final,
// que no distinguía dobles sectores (3A/3B → mismo stageNumber).
private func stageKeyRank(_ key: String) -> (Int, String) {
    if key == "final" { return (Int.max, "") }
    let p = UciResultsLogic.parseResultStageKey(key)
    return (p.stageNumber ?? Int.max, p.suffix)
}

private enum ResultsState {
    case loading
    case ready(UciResultsData)
    case error(String)
    case empty
}

/// Pantalla de resultados in-house (clasificaciones UCI de una carrera).
/// Réplica nativa de `js/resultados.js` y espejo de `ResultsScreen.kt` (Android).
/// Prima de `StartOrderView`.
///
/// Solo-online: se carga en vivo desde Supabase (sin caché). La lógica de
/// tiempos/gaps/CRE vive en `UciResultsLogic` (testeada).
struct ResultsView: View {
    let raceId: String
    /// Etapa pedida (deep-link desde la jornada); nil = última/final.
    var initialStageNumber: Int? = nil
    /// Sufijo de sector (A/B) del deep-link — doble sector.
    var initialStageSuffix: String? = nil
    /// Clasificación inicial (p. ej. "gc"); nil = la primera de la etapa (stage).
    var initialClassKind: String? = nil

    @State private var state: ResultsState = .loading

    // ── Selección (espejo de ResultsContent en Android) ────────────
    @State private var activeStageKey: String?
    @State private var activeClassKind: String?
    /// RaceDay del header: el de la etapa activa (se refresca al cambiar de etapa).
    @State private var headerRaceDay: RaceDay?
    /// Filtro por equipo (persiste al cambiar de clasificación, como la web).
    @State private var selectedTeam: String?
    /// Equipos disponibles en la clasificación actual (los publica ResultsTableView).
    @State private var teamsAvailable: [String] = []
    /// Token de recarga de filas. Las filas de cada clasificación las carga el
    /// propio `ResultsTableView` por `stage.id`, NO `loadResultsData`; sin esto,
    /// el pull-to-refresh recargaba cabecera/etapas/equipos pero NO las filas
    /// visibles (el `.task(id: stage.id)` no se re-disparaba al no cambiar la
    /// etapa). Se incrementa en cada pull-to-refresh y entra en la clave de
    /// carga del hijo → re-pide `race_uci_results` sin parpadeo.
    @State private var rowsReloadToken = 0

    var body: some View {
        Group {
            switch state {
            case .loading:
                LoadingView(
                    message: LocaleService.t("Cargando clasificaciones...", "Loading classifications..."),
                    branded: true
                )
            case .error(let message):
                ErrorView(message: message) {
                    Task { await load(resetSelection: true) }
                }
            case .empty:
                EmptyStateView(
                    icon: "trophy",
                    title: LocaleService.t("Sin resultados", "No results"),
                    subtitle: LocaleService.t(
                        "Aún no hay resultados disponibles para esta carrera.",
                        "No results available yet for this race."
                    )
                )
            case .ready(let data):
                content(data)
            }
        }
        .navigationTitle(LocaleService.t("Clasificaciones", "Classifications"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: raceId) { await load(resetSelection: true) }
    }

    // MARK: - Carga

    private func load(resetSelection: Bool) async {
        do {
            guard let data = try await SupabaseService.shared.loadResultsData(raceId: raceId) else {
                state = .empty
                return
            }
            state = .ready(data)
            // Selección inválida tras un refresh (la etapa activa ya no existe)
            // → re-aplicar la selección por defecto.
            let keyInvalid = activeStageKey.map { stagesByKey(data)[$0] == nil } ?? true
            if resetSelection || keyInvalid {
                applyInitialSelection(data)
            }
            // El screen_view de Resultados se emite en `logStageView` (lo dispara
            // `applyInitialSelection`→`refreshHeaderRaceDay` y cada cambio de etapa),
            // para que lleve stage_name/race_day_id de la etapa realmente mostrada
            // y aparezca en "etapas más vistas" como `stage_detail`.
        } catch {
            if case .ready = state { return }   // pull-to-refresh fallido: conservar datos
            state = .error(error.localizedDescription)
        }
    }

    /// Etapa activa inicial: la pedida si existe, si no la última con datos.
    /// Clasificación activa: la primera de la etapa. Header: el raceDay por defecto.
    private func applyInitialSelection(_ data: UciResultsData) {
        let keys = stageKeys(data)
        let initial: String? = requestedEntryKey(data) ?? keys.last
        activeStageKey = initial
        // Clasificación inicial: la pedida (p. ej. "gc" desde "Así está la carrera")
        // si existe en la etapa; si no, la primera (stage) — degradación con gracia.
        let stagesForKey = sortedStages(data, for: initial)
        activeClassKind = initialClassKind.flatMap { req in
            stagesForKey.first { $0.classKind == req }?.classKind
        } ?? stagesForKey.first?.classKind
        headerRaceDay = data.raceDay
        refreshHeaderRaceDay(data)
    }

    // MARK: - Derivados

    /// Clave de entrada pedida por el deep-link (sector-consciente). Un número
    /// pelado que resulta ser doble sector cae a su primer sector (A).
    private func requestedEntryKey(_ data: UciResultsData) -> String? {
        guard let n = initialStageNumber else { return nil }
        let sfx = (initialStageSuffix ?? "").uppercased()
        let exact = "\(n)\(sfx)"
        let byKey = stagesByKey(data)
        if byKey[exact] != nil { return exact }
        if sfx.isEmpty, data.sectoredStageNumbers.contains(n) {
            return stageKeys(data).first { UciResultsLogic.parseResultStageKey($0).stageNumber == n }
        }
        return nil
    }

    private func stagesByKey(_ data: UciResultsData) -> [String: [RaceUciStage]] {
        var grouped = Dictionary(grouping: data.stages) {
            UciResultsLogic.resultStageEntryKey($0.stageNumber, $0.raceDayId,
                                                data.sectorSuffixByRaceDayId, data.sectoredStageNumbers)
        }
        // Las generales del ÚLTIMO día (clasificación final, stageNumber nil) se
        // muestran TAMBIÉN bajo la última etapa numerada — duplicado visual a
        // petición: la pantalla 'F' se conserva ("final" sigue en stageKeys) y
        // todas las generales aparecen a la vez en los dos sitios. No se vuelcan
        // dos veces (es solo presentación). Si la etapa ya trae una clasificación
        // del mismo tipo, manda la final (es la oficial del último día).
        if let finals = grouped["final"], !finals.isEmpty,
           let lastKey = grouped.keys.filter({ $0 != "final" }).max(by: { stageKeyRank($0) < stageKeyRank($1) }) {
            let finalKinds = Set(finals.map { $0.classKind })
            let kept = (grouped[lastKey] ?? []).filter { !finalKinds.contains($0.classKind) }
            grouped[lastKey] = kept + finals
        }
        return grouped
    }

    private func stageKeys(_ data: UciResultsData) -> [String] {
        stagesByKey(data).keys.sorted { stageKeyRank($0) < stageKeyRank($1) }
    }

    private func classOrderIndex(_ classKind: String) -> Int {
        UciResultsLogic.classOrder.firstIndex(of: classKind) ?? 99
    }

    private func sortedStages(_ data: UciResultsData, for key: String?) -> [RaceUciStage] {
        guard let key else { return [] }
        return (stagesByKey(data)[key] ?? []).sorted { classOrderIndex($0.classKind) < classOrderIndex($1.classKind) }
    }

    /// RaceDay del header al cambiar de etapa. Se resuelve de las jornadas ya
    /// cargadas (`data.raceDays`, con countryCode/ruta/…) por `raceDayId` y, si el
    /// volcado no lo trajo, por `stageNumber` → así la cabecera aplica el override
    /// de país por jornada (p. ej. et1 en Francia de una carrera italiana). Si la
    /// etapa activa no casa por ninguno (un día / general final), se conserva
    /// `data.raceDay`, NUNCA se pone a nil (perdería ruta/distancia).
    private func refreshHeaderRaceDay(_ data: UciResultsData) {
        let active = sortedStages(data, for: activeStageKey)
        let daysById = Dictionary(uniqueKeysWithValues: data.raceDays.map { ($0.id, $0) })
        var daysByStage: [Int: RaceDay] = [:]
        for d in data.raceDays where d.stageNumber != nil {
            if daysByStage[d.stageNumber!] == nil { daysByStage[d.stageNumber!] = d }
        }
        if let rdId = active.first(where: { $0.raceDayId != nil })?.raceDayId,
           var rd = daysById[rdId] {
            // El header muestra el sufijo de sector (3A/3B) igual que el selector.
            if let sfx = data.sectorSuffixByRaceDayId[rdId] { rd.stageSuffix = sfx }
            headerRaceDay = rd
        } else if let sn = active.first(where: { $0.stageNumber != nil })?.stageNumber,
                  let rd = daysByStage[sn] {
            headerRaceDay = rd
        }
        // `headerRaceDay` ya refleja la etapa activa → loguear con su stage_name.
        // (Si la etapa no casa —un día / final— se conserva data.raceDay.)
        logStageView(data)
    }

    /// Emite el `screen_view` de Resultados con el contexto de la etapa activa,
    /// con los MISMOS parámetros que `stage_detail` para sumar en "etapas más
    /// vistas". Se llama en la carga inicial y en cada cambio de etapa.
    private func logStageView(_ data: UciResultsData) {
        var params: [String: Any] = [
            "race_id": raceId,
            "race_name": data.race.name,
        ]
        if let rd = headerRaceDay {
            params["race_day_id"] = rd.id
            params["stage_name"] = rd.stageLabel
        }
        AnalyticsService.shared.logScreenView("results", parameters: params)
    }

    // MARK: - Contenido

    @ViewBuilder
    private func content(_ data: UciResultsData) -> some View {
        let isEn = LocaleService.shouldShowEnglishContent
        let keys = stageKeys(data)
        let activeStages = sortedStages(data, for: activeStageKey)
        let activeStage = activeStages.first { $0.classKind == activeClassKind } ?? activeStages.first

        VStack(spacing: 0) {
            // Bloque FIJO arriba (no scrollea con la tabla): cabecera de carrera +
            // selector de etapa + barra de clasificaciones/filtro de equipo. Así,
            // al recorrer una clasificación larga, el contexto (qué etapa y qué
            // clasificación se miran) permanece siempre visible. El padding
            // inferior generoso forma un "colchón" bajo el filtro/pestañas para
            // que las filas se deslicen por debajo con aire. Paridad con
            // ResultsScreen (Android) y con la cabecera sticky de Inscritos.
            VStack(alignment: .leading, spacing: 16) {
                if let rd = headerRaceDay {
                    StageInfoHeader(raceDay: rd, race: data.race)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .ccCardSurface()
                } else {
                    ResultsPlainHeader(race: data.race)
                }

                if keys.count > 1 {
                    ResultsStageSelector(
                        stageKeys: keys,
                        activeKey: activeStageKey,
                        onSelect: { key in
                            activeStageKey = key
                            activeClassKind = sortedStages(data, for: key).first?.classKind
                            refreshHeaderRaceDay(data)
                        }
                    )
                }

                if let activeStage {
                    ResultsClassTabsBar(
                        stages: activeStages,
                        activeClassKind: activeStage.classKind,
                        teamsAvailable: teamsAvailable,
                        selectedTeam: selectedTeam,
                        onSelectClass: { activeClassKind = $0 },
                        onSelectTeam: { selectedTeam = $0 }
                    )
                }
            }
            .padding(.horizontal)
            .padding(.top, 12)
            .padding(.bottom, 16)
            .background(Color(.systemBackground))

            if let activeStage {
                ScrollView {
                    // `.id` fuerza un estado limpio de la tabla al cambiar de
                    // clasificación o etapa (recarga de filas + reset de CRE).
                    ResultsTableView(
                        stage: activeStage,
                        byDorsal: data.byDorsal,
                        raceTeams: data.raceTeams,
                        raceDayPrimaryType: headerRaceDay?.primaryType,
                        isOneDay: data.race.isOneDay,
                        isEn: isEn,
                        selectedTeam: selectedTeam,
                        reloadToken: rowsReloadToken,
                        onTeamsResolved: { teamsAvailable = $0 }
                    )
                    .id(activeStage.id)
                    .padding(.horizontal)
                    .padding(.bottom, 16)
                }
                .refreshable {
                    rowsReloadToken &+= 1
                    await load(resetSelection: false)
                }
            } else {
                Spacer()
            }
        }
    }
}
