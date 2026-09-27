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
    @State private var isLoadingResults = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var safariURL: URL?
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(LocaleService.t("Clasificaciones", "Classifications"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let race = stageRaceForToolbar {
                if #available(iOS 26, *) {
                    ToolbarItem(placement: .topBarTrailing) {
                        raceToolbarLink(race)
                    }
                    .sharedBackgroundVisibility(.hidden)
                } else {
                    ToolbarItem(placement: .topBarTrailing) {
                        raceToolbarLink(race)
                    }
                }
            }
        }
        .task(id: "\(raceId)-\(scenePhase)") {
            guard scenePhase == .active else { return }
            await load(resetSelection: activeStageKey == nil)
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                await load(resetSelection: false)
            }
        }
        .safariSheet(url: $safariURL)
    }

    private var stageRaceForToolbar: Race? {
        guard case .ready(let data) = state, data.race.isStageRace else { return nil }
        return data.race
    }

    private func raceToolbarLink(_ race: Race) -> some View {
        NavigationLink(destination: RaceDetailView(raceId: race.id)) {
            RaceLogo(race.logoUrl, size: 24)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(LocaleService.t(
            "Ver todas las etapas de \(race.localizedName)",
            "View all stages of \(race.localizedName)"
        ))
    }

    // MARK: - Carga

    private func load(resetSelection: Bool) async {
        guard !isLoadingResults else { return }
        isLoadingResults = true
        defer { isLoadingResults = false }
        do {
            guard let data = try await SupabaseService.shared.loadResultsData(raceId: raceId) else {
                state = .empty
                return
            }
            try Task.checkCancellation()
            state = .ready(data)
            rowsReloadToken &+= 1
            // Selección inválida tras un refresh (la etapa activa ya no existe)
            // → re-aplicar la selección por defecto.
            let keyInvalid = activeStageKey.map { stagesByKey(data)[$0] == nil } ?? true
            if resetSelection || keyInvalid {
                applyInitialSelection(data)
            } else {
                refreshHeaderRaceDay(data, logView: false)
            }
            // El screen_view de Resultados se emite en `logStageView` (lo dispara
            // `applyInitialSelection`→`refreshHeaderRaceDay` y cada cambio de etapa),
            // para que lleve stage_name/race_day_id de la etapa realmente mostrada
            // y aparezca en "etapas más vistas" como `stage_detail`.
        } catch {
            guard !Task.isCancelled else { return }
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

    private func sortedStages(_ data: UciResultsData, for key: String?) -> [RaceUciStage] {
        guard let key else { return [] }
        let existing = (stagesByKey(data)[key] ?? [])
            .filter { key != "final" || $0.classKind != "stage" }
        return UciResultsLogic.visibleStageClassifications(
            config: data.classificationConfig,
            stages: existing
        )
    }

    /// RaceDay del header al cambiar de etapa. Se resuelve de las jornadas ya
    /// cargadas (`data.raceDays`, con countryCode/ruta/…) por `raceDayId` y, si el
    /// volcado no lo trajo, por `stageNumber` → así la cabecera aplica el override
    /// de país por jornada (p. ej. et1 en Francia de una carrera italiana). Si la
    /// etapa activa no casa por ninguno (un día / general final), se conserva
    /// `data.raceDay`, NUNCA se pone a nil (perdería ruta/distancia).
    private func refreshHeaderRaceDay(_ data: UciResultsData, logView: Bool = true) {
        headerRaceDay = data.raceDay
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
        if logView { logStageView(data) }
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
        let activeStages = sortedStages(data, for: activeStageKey)
        let activeStage = activeStages.first { $0.classKind == activeClassKind } ?? activeStages.first

        VStack(spacing: 0) {
            // La ficha general permanece fuera del scroll. Documentación y
            // selector de etapas se desplazan; las pestañas de clasificación
            // quedan fijadas al recorrer los resultados.
            VStack(alignment: .leading, spacing: 0) {
                if let rd = headerRaceDay {
                    resultsHeader(raceDay: rd, race: data.race)
                } else {
                    ResultsPlainHeader(race: data.race)
                }
            }
            .padding(.horizontal)
            .padding(.top, 12)
            .padding(.bottom, 4)
            .background(AppTheme.background)

            if let activeStage {
                if horizontalSizeClass == .regular,
                   let rd = headerRaceDay,
                   hasResultsStageContext(rd) {
                    HStack(alignment: .top, spacing: 16) {
                        resultsList(data: data, stage: activeStage, isEn: isEn, contextBelow: nil)
                        ScrollView {
                            ResultsStageContext(
                                raceDay: rd,
                                race: data.race
                            )
                        }
                        .frame(width: 320)
                        .padding(.trailing)
                    }
                } else {
                    resultsList(
                        data: data,
                        stage: activeStage,
                        isEn: isEn,
                        contextBelow: headerRaceDay
                    )
                }
            } else {
                Spacer()
            }
        }
        .background(AppTheme.background)
    }

    /// Precarga las clasificaciones contiguas a la visible, como los días
    /// vecinos de Hoy: el deslizamiento las muestra ya pintadas.
    private func prefetchNeighbors(of stage: RaceUciStage, in data: UciResultsData) async {
        let stages = sortedStages(data, for: activeStageKey)
        guard let index = stages.firstIndex(where: { $0.id == stage.id }) else { return }
        for neighbor in [index + 1, index - 1] where stages.indices.contains(neighbor) {
            let target = stages[neighbor]
            guard !target.isCancelledStage, !target.isPendingClassification, !Task.isCancelled else { continue }
            _ = await ResultsRowsCache.shared.bundle(
                stageRef: target.id, token: rowsReloadToken, byDorsal: data.byDorsal, raceYear: data.race.year
            )
        }
    }

    private func hasResultsStageContext(_ raceDay: RaceDay) -> Bool {
        raceDay.hasElevationProfile || raceDay.distanceKm != nil
            || raceDay.elevationProfile?.elevationGain != nil || raceDay.neutralStartTimeUtc != nil
            || raceDay.averageSpeedKmh != nil
            || raceDay.hasValidTimeLimit
    }

    private func resultsList(
        data: UciResultsData,
        stage: RaceUciStage,
        isEn: Bool,
        contextBelow: RaceDay?
    ) -> some View {
        let config = data.classificationConfig.first { $0.classKind == stage.classKind }
        let classificationLabel = config.map { UciResultsLogic.classificationLabel($0, isEn: isEn) }
            ?? resultsClassLabel(stage.classKind)
        let classKinds = sortedStages(data, for: activeStageKey).map(\.classKind)
        return ScrollView {
            // Las pestañas de clasificación son la cabecera fijada; las tablas
            // no fijan su fila de columnas para no superponerse a ellas.
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                if let rd = headerRaceDay {
                    resultsAssetStrip(data: data, raceDay: rd)
                        .padding(.horizontal)
                        .padding(.top, 8)
                        .padding(.bottom, 8)
                }

                let keys = stageKeys(data)
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
                    .padding(.horizontal)
                    .padding(.bottom, 4)
                }

                Section {
                    ResultsPublicationStatus(
                        stage: stage,
                        classificationLabel: classificationLabel,
                        showClassificationLabel: !data.race.isOneDay
                    )
                        .padding(.horizontal)
                        .padding(.top, 2)
                        .padding(.bottom, 4)
                    if stage.isPendingClassification {
                        EmptyStateView(
                            icon: "hourglass",
                            title: LocaleService.t("Pendiente de publicación", "Pending publication"),
                            subtitle: LocaleService.t(
                                "La clasificación está declarada, pero todavía no tiene filas publicadas.",
                                "The classification is available, but its rows have not been published yet."
                            )
                        )
                        .classificationSwipe(options: classKinds, current: stage.classKind) { activeClassKind = $0 }
                    } else {
                        ResultsTableView(
                            stage: stage,
                            byDorsal: data.byDorsal,
                            raceTeams: data.raceTeams,
                            raceDayPrimaryType: headerRaceDay?.primaryType,
                            raceYear: data.race.year,
                            isOneDay: data.race.isOneDay,
                            isEn: isEn,
                            selectedTeam: selectedTeam,
                            reloadToken: rowsReloadToken,
                            onTeamsResolved: { teamsAvailable = $0 }
                        )
                        .id(stage.id)
                        .padding(.horizontal)
                        .padding(.bottom, 16)
                        .contentShape(Rectangle())
                        .classificationSwipe(options: classKinds, current: stage.classKind) { activeClassKind = $0 }
                        .task(id: stage.id) { await prefetchNeighbors(of: stage, in: data) }
                    }
                    if let rd = contextBelow, hasResultsStageContext(rd) {
                        ResultsStageContext(
                            raceDay: rd,
                            race: data.race
                        )
                            .padding(.horizontal)
                            .padding(.bottom, 16)
                    }
                } header: {
                    ResultsClassTabsBar(
                        stages: sortedStages(data, for: activeStageKey),
                        classificationConfig: data.classificationConfig,
                        activeClassKind: stage.classKind,
                        teamsAvailable: teamsAvailable,
                        selectedTeam: selectedTeam,
                        onSelectClass: { activeClassKind = $0 },
                        onSelectTeam: { selectedTeam = $0 }
                    )
                    .padding(.horizontal)
                    .padding(.vertical, 4)
                    .background(AppTheme.background)
                }
            }
        }
        .refreshable {
            await load(resetSelection: false)
        }
    }

    private func resultsHeader(raceDay: RaceDay, race: Race) -> some View {
        StageInfoHeader(raceDay: raceDay, race: race)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .ccCardSurface()
    }

    /// Barra documental de la jornada activa. Mantiene el orden de Jornada,
    /// pero excluye su perfil oficial externo; el acceso de regreso se inserta
    /// tras el Libro de Ruta.
    @ViewBuilder
    private func resultsAssetStrip(data: UciResultsData, raceDay: RaceDay) -> some View {
        let assets = resultsDocumentationAssets(data: data, raceDay: raceDay)
        let profileIndex = Constants.assetOrder.firstIndex(of: "profile") ?? Constants.assetOrder.count
        let hasInteractiveProfile = raceDay.hasElevationProfile
        let hasStaticProfile = assets.contains { $0.type == "profile" }
        let hasInteractiveMap = raceDay.routeGpxUrl?.isEmpty == false
        let hasStaticMap = assets.contains { $0.type == "map" }
        let bothMaps = hasInteractiveMap && hasStaticMap
        let technicalGuide = assets.first { $0.type == "technicalGuide" }
        let assetsBeforeProfile = assets.filter { asset in
            asset.type != "technicalGuide" &&
                (Constants.assetOrder.firstIndex(of: asset.type ?? "") ?? Constants.assetOrder.count) < profileIndex
        }
        let officialMap = bothMaps ? assets.first { $0.type == "map" } : nil
        let assetsFromProfile = assets.filter { asset in
            if asset.type == "profile" { return false }
            if asset.type == "map" && bothMaps { return false }
            return (Constants.assetOrder.firstIndex(of: asset.type ?? "") ?? Constants.assetOrder.count) >= profileIndex
        }

        ResultsScrollRail(height: 60, spacing: 0, framed: true) {
            if let website = data.race.websiteUrl, let url = URL(string: website) {
                Button { safariURL = url } label: {
                    ActionStripTile(icon: "globe", label: LocaleService.t("Web oficial", "Official website"))
                }
                .buttonStyle(.plain)
            }

            if let asset = technicalGuide,
               let urlString = asset.url,
               let url = URL(string: urlString) {
                Button { safariURL = url } label: {
                    ActionStripTile(icon: resultsAssetIcon(for: asset.type), label: asset.typeLabel)
                }
                .buttonStyle(.plain)
            }

            NavigationLink(destination: StageDetailView(raceDayId: raceDay.id)) {
                ActionStripTile(
                    icon: "cc.cursor",
                    label: data.race.isOneDay
                        ? LocaleService.t("Ir a la carrera", "Go to the race")
                        : LocaleService.t("Ir a la etapa", "Go to the stage")
                )
            }
            .buttonStyle(.plain)

            if data.race.startlistImportedAt != nil {
                let provisional = data.race.startlistProvisional == true
                NavigationLink(destination: StartlistView(raceId: data.race.id)) {
                    ActionStripTile(
                        icon: "person.2",
                        label: provisional
                            ? LocaleService.t("Lista provisional", "Provisional Startlist")
                            : LocaleService.t("Dorsales", "Startlist")
                    )
                }
                .buttonStyle(.plain)
            }

            ForEach(assetsBeforeProfile) { asset in
                if asset.type == "startOrder" {
                    NavigationLink(destination: StartOrderView(raceDayId: raceDay.id)) {
                        ActionStripTile(icon: "timer", label: LocaleService.t("Orden de salida", "Start order"))
                    }
                    .buttonStyle(.plain)
                } else if let urlString = asset.url, let url = URL(string: urlString) {
                    let effectiveType = resultsEffectiveAssetType(asset, race: data.race, raceDay: raceDay, hasProfile: hasStaticProfile || hasInteractiveProfile)
                    Button { safariURL = url } label: {
                        ActionStripTile(
                            icon: resultsAssetIcon(for: effectiveType),
                            label: Constants.assetTexts[effectiveType] ?? asset.typeLabel
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            if hasInteractiveProfile {
                NavigationLink(destination: ElevationProfileView(raceDay: raceDay, race: data.race)) {
                    ActionStripTile(
                        icon: resultsAssetIcon(for: "profile"),
                        label: LocaleService.t("Perfil", "Profile")
                    )
                }
                .buttonStyle(.plain)
            }

            if let asset = officialMap,
               let urlString = asset.url,
               let url = URL(string: urlString) {
                Button { safariURL = url } label: {
                    ActionStripTile(icon: resultsAssetIcon(for: "map"), label: LocaleService.t("Mapa", "Map"))
                }
                .buttonStyle(.plain)
            }

            if hasInteractiveMap {
                NavigationLink(destination: RouteMapView(raceDay: raceDay, race: data.race)) {
                    ActionStripTile(
                        icon: resultsAssetIcon(for: "map"),
                        label: bothMaps
                            ? LocaleService.t("Mapa 3D", "3D Map")
                            : LocaleService.t("Mapa", "Map")
                    )
                }
                .buttonStyle(.plain)
            }

            ForEach(assetsFromProfile) { asset in
                if let urlString = asset.url, let url = URL(string: urlString) {
                    let effectiveType = resultsEffectiveAssetType(asset, race: data.race, raceDay: raceDay, hasProfile: hasStaticProfile || hasInteractiveProfile)
                    Button { safariURL = url } label: {
                        ActionStripTile(
                            icon: resultsAssetIcon(for: effectiveType),
                            label: Constants.assetTexts[effectiveType] ?? asset.typeLabel
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func resultsDocumentationAssets(data: UciResultsData, raceDay: RaceDay) -> [Asset] {
        let technicalGuide = data.assets.first {
            $0.type == "technicalGuide" && !($0.url ?? "").isEmpty
        }
        let stageAssets = data.assets.filter {
            $0.raceDayId == raceDay.id && $0.type != "technicalGuide" && $0.type != "live_text"
                && ($0.type == "startOrder" || !($0.url ?? "").isEmpty)
        }
        var seenTypes = Set<String>()
        return ((technicalGuide.map { [$0] } ?? []) + stageAssets)
            .filter { asset in
                let key = asset.type ?? asset.id
                return seenTypes.insert(key).inserted
            }
            .sorted { lhs, rhs in
                let left = Constants.assetOrder.firstIndex(of: lhs.type ?? "") ?? Int.max
                let right = Constants.assetOrder.firstIndex(of: rhs.type ?? "") ?? Int.max
                return left < right
            }
    }

    private func resultsEffectiveAssetType(
        _ asset: Asset,
        race: Race,
        raceDay: RaceDay,
        hasProfile: Bool
    ) -> String {
        guard asset.type == "ports", !hasProfile, raceDay.primaryType == "sterrato" else {
            return asset.type ?? ""
        }
        return race.countryCode?.uppercased() == "FR" ? "ribinou" : "sterrato"
    }

    private func resultsAssetIcon(for type: String?) -> String {
        switch type {
        case "startOrder": return "timer"
        case "profile": return "chart.line.uptrend.xyaxis"
        case "map": return "map"
        case "roadbook": return "doc.text"
        case "ports": return "mountain.2"
        case "pave": return "hexagon"
        case "sterrato", "ribinou": return "circle.grid.3x3.fill"
        default: return "doc"
        }
    }

}

struct ResultsStageContext: View {
    let raceDay: RaceDay
    let race: Race
    var officialProfileAsset: Asset? = nil

    private var hasMetrics: Bool {
        raceDay.distanceKm != nil || raceDay.elevationProfile?.elevationGain != nil
            || raceDay.neutralStartTimeUtc != nil || raceDay.averageSpeedKmh != nil
            || raceDay.hasValidTimeLimit
    }

    var body: some View {
        if raceDay.hasElevationProfile || officialProfileAsset != nil || hasMetrics {
            VStack(alignment: .leading, spacing: 10) {
                if let profile = raceDay.elevationProfile, raceDay.hasElevationProfile {
                    NavigationLink(destination: ElevationProfileView(raceDay: raceDay, race: race)) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(LocaleService.t("Perfil y datos", "Profile and data"))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            MiniElevationProfile(
                                profile: profile,
                                summits: raceDay.profileSummits ?? [],
                                waypoints: raceDay.profileWaypoints ?? [],
                                tint: race.colorHex.map { Color(hex: $0) } ?? .accentColor,
                                height: 58,
                                primaryType: raceDay.primaryType,
                                forceCompleted: true
                            )
                        }
                    }
                    .buttonStyle(.plain)
                }
                if let asset = officialProfileAsset,
                   let urlString = asset.url,
                   let url = URL(string: urlString) {
                    Link(destination: url) {
                        HStack(spacing: 8) {
                            Text(LocaleService.t("Perfil oficial", "Official profile"))
                                .font(.caption.weight(.semibold))
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.caption2)
                        }
                        .frame(minHeight: 44)
                    }
                }
                if let value = raceDay.distanceFormatted {
                    contextMetric(LocaleService.t("Distancia", "Distance"), value)
                }
                if let value = raceDay.elevationGainFormatted {
                    contextMetric(LocaleService.t("Desnivel", "Elevation gain"), value)
                }
                if let raw = raceDay.neutralStartTimeUtc,
                   let value = DateFormatting.formatTimeLocal(raw) {
                    contextMetric(LocaleService.t("Salida neutralizada", "Neutral start"), value)
                }
                if let value = raceDay.averageSpeedKmh {
                    contextMetric(LocaleService.t("Velocidad media", "Average speed"), String(format: "%.1f km/h", value))
                }
                if raceDay.hasValidTimeLimit,
                   let value = RaceDay.formatDuration(seconds: raceDay.timeLimitSeconds) {
                    contextMetric(LocaleService.t("Fuera de control", "Time limit"), value)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .ccCardSurface()
        }
    }

    private func contextMetric(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.caption.weight(.semibold)).monospacedDigit()
        }
    }
}
