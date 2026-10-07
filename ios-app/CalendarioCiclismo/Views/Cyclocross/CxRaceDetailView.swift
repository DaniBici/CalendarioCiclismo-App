import SwiftUI
import WebKit

enum CxDetailSection: String, CaseIterable, Identifiable {
    case programme, startlist, results, general, videos
    var id: String { rawValue }
    @MainActor var title: String {
        switch self {
        case .programme: CyclocrossPresentation.t("Programa", "Programme")
        case .startlist: CyclocrossPresentation.t("Dorsales", "Startlist")
        case .results: CyclocrossPresentation.t("Resultados", "Results")
        case .general: CyclocrossPresentation.t("General", "Standings")
        case .videos: CyclocrossPresentation.t("Vídeos", "Videos")
        }
    }
}

@MainActor struct CxDetailSelection {
    let section: CxDetailSection
    let category: String?
    static func from(anchor: String?, detail: CxDetail) -> Self {
        if anchor == "general" { return Self(section: .general, category: nil) }
        if anchor == "videos" { return Self(section: .videos, category: nil) }
        if anchor == "programme" {
            let available = actualCategories(detail)
            return Self(section: .programme, category: available.contains("ME") ? "ME" : available.first)
        }
        if let anchor, anchor.hasPrefix("general-") { return Self(section: .general, category: String(anchor.dropFirst(8))) }
        if let anchor, anchor.hasPrefix("resultados-") { return Self(section: .results, category: String(anchor.dropFirst(11))) }
        if let anchor, anchor.hasPrefix("inscritos-") { return Self(section: .startlist, category: String(anchor.dropFirst(10))) }
        if let anchor, let category = detail.race.categories.first(where: { $0.category == anchor }) {
            return Self(section: resultCategories(detail).contains(category.category) ? .results : .programme, category: anchor)
        }
        let results = resultCategories(detail)
        let available = results.isEmpty ? actualCategories(detail) : results
        // Sección por defecto de la web: resultados, programa con horario,
        // dorsales y, por último, programa. La TV no la altera.
        let fallback: CxDetailSection = hasScheduledProgramme(detail) || detail.startlist.isEmpty ? .programme : .startlist
        return Self(section: results.isEmpty ? fallback : .results,
                    category: available.contains("ME") ? "ME" : available.first)
    }
    static func actualCategories(_ detail: CxDetail) -> [String] {
        CyclocrossLogic.categories.filter { code in detail.race.categories.contains {
            $0.category == code && CyclocrossLogic.dateInSeason($0.dateKey ?? detail.race.dateKey, season: detail.race.seasonKey)
        } }
    }
    static func resultCategories(_ detail: CxDetail) -> [String] {
        actualCategories(detail).filter { code in detail.race.categories.contains {
            $0.category == code && ["official", "provisional"].contains($0.resultsStatus)
        } && detail.results.contains { $0.category == code } }
    }
    static func generalCategories(_ detail: CxDetail) -> [String] {
        CyclocrossLogic.categories.filter { code in
            guard detail.standings.contains(where: { $0.category == code }) else { return false }
            let source = detail.race.tournament?.pointsScheme?.categories?[code]?.extras?.derived?.fromCategory ?? code
            let hasResults = resultCategories(detail).contains(source)
            guard let state = detail.standingsState?.first(where: { $0.category == code }) else { return !hasResults }
            return ["ready", "manual"].contains(state.status) && (!hasResults || state.roundIds.contains(detail.race.id))
        }
    }
    /// Categorías con horario verificado, por día y hora de salida: la que no
    /// lo tiene no se lista en Horarios ni en Datos de la jornada.
    static func scheduledCategories(_ detail: CxDetail) -> [CxCategory] {
        let actual = actualCategories(detail)
        return detail.race.categories.filter { actual.contains($0.category) && $0.startTimeUtc != nil }.sorted {
            let left = $0.dateKey ?? detail.race.dateKey, right = $1.dateKey ?? detail.race.dateKey
            if left != right { return left < right }
            return (CyclocrossLogic.instant($0.startTimeUtc) ?? .distantFuture) < (CyclocrossLogic.instant($1.startTimeUtc) ?? .distantFuture)
        }
    }
    private static func hasScheduledProgramme(_ detail: CxDetail) -> Bool {
        let actual = Set(actualCategories(detail))
        return detail.race.categories.contains { actual.contains($0.category) && $0.startTimeUtc != nil }
    }
    /// TV en directo (de cualquier región) o Revive de la región: la TV vive
    /// en el programa, que se muestra aunque no haya horarios.
    static func hasMedia(_ detail: CxDetail, allowedGroups: Set<String>? = nil, at now: Date = Date()) -> Bool {
        let media = CyclocrossPresentation.programmeMedia(detail, allowedGroups: allowedGroups ?? RegionService.shared.allowedBroadcastGroups, at: now)
        return media.showsLiveTV || !media.revive.isEmpty
    }
    static func sections(_ detail: CxDetail) -> [CxDetailSection] {
        let hasProgramme = hasScheduledProgramme(detail) || hasMedia(detail)
        let hasStartlist = !detail.startlist.isEmpty
        return (hasProgramme ? [.programme] : []) + (hasStartlist ? [.startlist] : []) + (resultCategories(detail).isEmpty ? [] : [.results])
            + (generalCategories(detail).isEmpty ? [] : [.general])
            + (CyclocrossPresentation.videos(detail).isEmpty ? [] : [.videos])
    }
    static func showsSectionSelector(_ detail: CxDetail) -> Bool {
        sections(detail).count > 1 && (hasScheduledProgramme(detail) || hasMedia(detail) || !detail.startlist.isEmpty || !CyclocrossPresentation.videos(detail).isEmpty)
    }
    static func categories(_ detail: CxDetail, section: CxDetailSection) -> [String] {
        switch section {
        case .results: resultCategories(detail)
        case .general: generalCategories(detail)
        case .videos: []
        default: actualCategories(detail)
        }
    }
    func normalized(_ detail: CxDetail) -> Self {
        let sections = Self.sections(detail)
        let available = sections.contains(section) ? section : (sections.first ?? .programme)
        let codes = Self.categories(detail, section: available)
        return Self(section: available, category: available == section && codes.contains(category ?? "") ? category : codes.contains("ME") ? "ME" : codes.first)
    }
    static func standingMode(_ detail: CxDetail, category: String) -> String? {
        guard let mode = detail.race.tournament?.pointsScheme?.categories?[category]?.mode, ["points", "time"].contains(mode) else { return nil }
        return mode
    }
}

struct CxRaceDetailView: View {
    let raceId: String
    var anchor: String? = nil
    @State private var data: CxDetail?
    @State private var busy = false
    @State private var loaded = false
    @State private var error: String?
    @State private var section = CxDetailSection.programme
    @State private var category = ""
    @State private var region = RegionService.shared
    @State private var locale = LocaleService.shared
    @State private var round: CxRound?
    /// Numeración de rondas de la temporada: cabeceras «#n» de la general.
    @State private var tournamentRounds: [String: CxRound] = [:]
    /// Mapa precargado durante la pantalla de carga: el contenido se publica
    /// con la imagen ya disponible, sin cargas asíncronas posteriores.
    @State private var mapImage: UIImage?
    @State private var mapImageUrl: String?
    /// Catálogo CX indexado una vez por publicación: resultados y generales
    /// casan cada fila sin volver a normalizar los ~400 equipos al pintar.
    @State private var teamMatcher = UciResultsLogic.TeamMatcher(teams: [])
    /// Huella del último detalle publicado: el refresco de cada minuto no
    /// reconstruye la ficha (ni la clasificación) si los datos no cambian.
    @State private var publishedFingerprint: Data?
    /// Web oficial, Libro de Ruta y Mapa se abren dentro de la app mediante
    /// `SFSafariViewController`, igual que en carretera (StageDetailView).
    @State private var safariURL: URL?
    /// Aviso sin conexión de los enlaces de TV y Revive (mecanismo de carretera).
    @State private var offlineAlert: OfflineAccessAlert?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        Group {
            // Primera carga: pantalla completa de marca (sin perfil inferior,
            // como las transiciones de Hoy). Fuera del ScrollView: dentro del
            // LazyVStack la altura máxima no se expande y el cargador queda
            // pegado arriba en vez de centrado.
            if data == nil, error == nil, !loaded {
                LoadingView(branded: true, showProfile: false, title: CyclocrossPresentation.t("Ciclocross", "Cyclocross"))
            } else {
                GeometryReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14, pinnedViews: [.sectionHeaders]) {
                            // Sin indicador en línea durante el refresco periódico:
                            // insertarlo sobre el contenido desplazaba la
                            // clasificación cada minuto. Tirar para refrescar
                            // conserva su propio indicador.
                            if let error {
                                Text(error).foregroundStyle(.red)
                                Button(CyclocrossPresentation.t("Reintentar", "Retry")) { Task { await refresh() } }.buttonStyle(.bordered).buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))
                            }
                            if let data, CyclocrossPresentation.isHidden(data.race) {
                                CxSpanishAudienceView()
                            } else if let data {
                                header(data.race, assets: data.assets ?? [])
                                detailLayout(data, proxy: proxy)
                            } else if loaded, error == nil {
                                empty(CyclocrossPresentation.t("Carrera no disponible", "Race unavailable"))
                            }
                        }.padding()
                    }
                }
            }
        }
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(CyclocrossPresentation.t("Ciclocross", "Cyclocross"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let race = data?.race, let tournament = race.tournament {
                if #available(iOS 26, *) {
                    ToolbarItem(placement: .topBarTrailing) { tournamentLink(tournament, season: race.seasonKey) }
                        .sharedBackgroundVisibility(.hidden)
                } else {
                    ToolbarItem(placement: .topBarTrailing) { tournamentLink(tournament, season: race.seasonKey) }
                }
            }
        }
        .safariSheet(url: $safariURL)
        .offlineAccessAlert($offlineAlert)
        .refreshable { await refresh(forceArtwork: true) }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await refresh()
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
            }
        }
    }

    @ViewBuilder
    private func detailLayout(_ detail: CxDetail, proxy: GeometryProxy) -> some View {
        let wide = AdaptiveLayoutPolicy.usesWideDetail(
            width: proxy.size.width,
            isRegular: horizontalSizeClass == .regular
        )
        let mapUrl = section == .videos ? nil : mapAssetUrl(detail)
        // Resultados, publicados o no, llevan columna lateral como en carretera:
        // mapa en pequeño y, debajo, los datos de la jornada (el horario).
        let raceData = section == .results && !CxDetailSelection.scheduledCategories(detail).isEmpty
        Section {
            if wide, mapUrl != nil || raceData {
                let gap = detailColumnSpacing(in: proxy)
                if section == .programme, let url = mapUrl {
                    HStack(alignment: .top, spacing: gap) {
                        CxMapView(url: url, preloaded: mapImageUrl == url.absoluteString ? mapImage : nil)
                            .frame(maxWidth: .infinity, alignment: .top)
                        selectedContent(detail, wide: true)
                            .frame(width: min(380, max(320, (proxy.size.width - gap - 32) * 0.40)), alignment: .top)
                    }
                } else {
                    HStack(alignment: .top, spacing: gap) {
                        selectedContent(detail, wide: true)
                            .frame(maxWidth: .infinity, alignment: .top)
                        sideColumn(detail, mapUrl: mapUrl, raceData: raceData)
                            .frame(width: min(380, max(320, (proxy.size.width - gap - 32) * 0.40)), alignment: .top)
                    }
                }
            } else {
                selectedContent(detail, wide: false)
                sideColumn(detail, mapUrl: mapUrl, raceData: raceData)
            }
        } header: {
            if CxDetailSelection.showsSectionSelector(detail) || section != .programme {
                VStack(alignment: .leading, spacing: 0) {
                    if CxDetailSelection.showsSectionSelector(detail) { sectionControls }
                    if section != .programme, section != .videos { categoryControls(CxDetailSelection.categories(detail, section: section), selection: $category) }
                }
                .padding(.vertical, 4)
                .background(AppTheme.background)
            }
        }
    }

    @ViewBuilder
    private func selectedContent(_ detail: CxDetail, wide: Bool) -> some View {
        if section == .programme {
            CxProgrammeSection(
                detail: detail,
                broadcastColumns: wide ? 2 : 1,
                onStartlist: { code in category = code; section = .startlist },
                onResults: { code in category = code; section = .results },
                onOpenLink: { ExternalLinkOpener.open($0, safariURL: $safariURL, offlineAlert: $offlineAlert) }
            )
        } else if section == .videos {
            CxVideosSection(videos: CyclocrossPresentation.videos(detail),
                            onOpen: { ExternalLinkOpener.open($0, safariURL: $safariURL, offlineAlert: $offlineAlert) })
        } else if section == .general {
            // Con columnas de ronda, el gesto horizontal desplaza la tabla y no
            // cambia de categoría.
            let rows = detail.standings.filter { $0.category == category }
            let rounds = CxStandingsTable.hasRounds(state: detail.standingsState?.first { $0.category == category },
                mode: CyclocrossPresentation.standingMode(scheme: detail.race.tournament?.pointsScheme, category: category, rows: rows))
            CxStandingsSection(detail: detail, category: category, matcher: teamMatcher, rounds: tournamentRounds)
                .contentShape(Rectangle())
                .classificationSwipe(options: rounds ? [] : CxDetailSelection.categories(detail, section: section), current: category) { category = $0 }
        } else if let selected = detail.race.categories.first(where: { $0.category == category && actualCategories(detail).contains($0.category) }) {
            switch section {
            case .programme: EmptyView()
            case .startlist:
                CxStartlistSection(detail: detail, category: category)
                    .contentShape(Rectangle())
                    .classificationSwipe(options: CxDetailSelection.categories(detail, section: section), current: category) { category = $0 }
            case .results:
                CxResultsSection(detail: detail, category: selected, matcher: teamMatcher)
                    .contentShape(Rectangle())
                    .classificationSwipe(options: CxDetailSelection.categories(detail, section: section), current: category) { category = $0 }
            case .general: EmptyView()
            case .videos: EmptyView()
            }
        } else {
            empty(CyclocrossPresentation.t("Sin categorías publicadas", "No published categories"))
        }
    }

    @ViewBuilder
    private func sideColumn(_ detail: CxDetail, mapUrl: URL?, raceData: Bool) -> some View {
        if mapUrl != nil || raceData {
            VStack(alignment: .leading, spacing: 14) {
                if let mapUrl {
                    CxMapView(url: mapUrl, preloaded: mapImageUrl == mapUrl.absoluteString ? mapImage : nil,
                              maxImageHeight: section == .results ? 260 : nil)
                }
                if raceData { CxRaceDataCard(detail: detail, activeCategory: category) }
            }
        }
    }

    private func detailColumnSpacing(in proxy: GeometryProxy) -> CGFloat {
        AdaptiveLayoutPolicy.divisionSpacing(in: proxy)
    }
    private func tournamentLink(_ tournament: CxTournament, season: String) -> some View {
        NavigationLink(destination: CyclocrossView(tournament: tournament, season: season)) {
            RaceLogo(tournament.logoUrl, size: 24)
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(CyclocrossPresentation.t("Ver torneo \(tournament.name)", "View series \(tournament.nameEn ?? tournament.name)"))
    }
    /// Nombre del torneo como enlace a la página de serie y número de prueba
    /// (n/total): paridad con la web.
    @ViewBuilder private func tournamentHeading(_ race: CxRace) -> some View {
        if let tournament = race.tournament {
            HStack(spacing: 6) {
                NavigationLink(destination: CyclocrossView(tournament: tournament, season: race.seasonKey)) {
                    CxLinkLabel(label: CyclocrossPresentation.t(tournament.name, tournament.nameEn ?? tournament.name))
                }.buttonStyle(CxCategoryBoxStyle())
                if let round, round.total > 1 {
                    Text("\(round.n)/\(round.total)").ccFont(.s12).foregroundStyle(AppTheme.textMuted).monospacedDigit()
                }
            }
        }
    }
    private func actualCategories(_ detail: CxDetail) -> [String] { CxDetailSelection.actualCategories(detail) }
    /// URL del mapa embebible (jpg/png): la misma validación que CxMapView.
    private func mapAssetUrl(_ detail: CxDetail) -> URL? {
        guard let asset = detail.assets?.first(where: { $0.type == "map" && ["jpg", "jpeg", "png"].contains(CyclocrossPresentation.link($0.url)?.pathExtension.lowercased() ?? "") }) else { return nil }
        return CyclocrossPresentation.link(asset.url)
    }
    private func accept(_ value: CxCached<CxDetail>) {
        let fingerprint = try? Self.fingerprintEncoder.encode(value.data)
        if loaded, data != nil, fingerprint != nil, fingerprint == publishedFingerprint { return }
        publishedFingerprint = fingerprint
        let requested = loaded ? CxDetailSelection(section: section, category: category)
            : CxDetailSelection.from(anchor: anchor, detail: value.data)
        let selection = requested.normalized(value.data)
        teamMatcher = UciResultsLogic.TeamMatcher(teams: value.data.teams.map(\.roadTeam))
        data = value.data
        section = selection.section
        category = selection.category ?? ""
        loaded = true
    }
    private static let fingerprintEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return encoder
    }()
    /// Publicación completa: nada se pinta sin la ronda y, en la primera
    /// carga, sin el mapa ya descargado.
    private func publish(_ value: CxCached<CxDetail>, forceArtwork: Bool) async {
        if !loaded { await preloadMap(mapAssetUrl(value.data)) }
        let season = value.data.race.seasonKey
        tournamentRounds = await CyclocrossRepository.shared.rounds(season: season, force: forceArtwork)
        round = tournamentRounds[value.data.race.id]
        accept(value)
    }
    private func preloadMap(_ url: URL?) async {
        guard let url, mapImageUrl != url.absoluteString else { return }
        do {
            let (bytes, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let image = UIImage(data: bytes) else { return }
            // Decodificada fuera del hilo principal: el primer dibujado del
            // mapa no bloquea el scroll.
            mapImage = await image.byPreparingForDisplay() ?? image
            mapImageUrl = url.absoluteString
        } catch { }
    }
    private func refresh(forceArtwork: Bool = false) async {
        guard !busy else { return }
        busy = true
        if forceArtwork { ImageRefresh.shared.refresh() }
        defer { busy = false }
        do {
            if !loaded, let cached = await CyclocrossRepository.shared.cachedDetail(id: raceId) {
                await publish(cached, forceArtwork: forceArtwork)
            }
            if let fresh = try await CyclocrossRepository.shared.detail(id: raceId) {
                await publish(fresh, forceArtwork: forceArtwork)
            } else if !loaded {
                data = nil
                loaded = true
            }
            error = nil
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            self.error = error.localizedDescription
            loaded = true
        }
    }
    private var sectionControls: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(data.map(CxDetailSelection.sections) ?? [.programme, .startlist]) { item in
                    ResultsClassificationTab(label: item.title, selected: section == item, tint: nil) {
                        section = item
                        if let data {
                            let codes = CxDetailSelection.categories(data, section: item)
                            if !codes.contains(category) { category = preferredCategory(codes) }
                        }
                    }
                }
            }
        }
    }
    private func categoryControls(_ codes: [String], selection: Binding<String>) -> some View {
        ResultsStageSelector(stageKeys: codes, activeKey: selection.wrappedValue,
            onSelect: { selection.wrappedValue = $0 }, labelForKey: { $0 },
            accessibilityLabelForKey: { CyclocrossPresentation.category($0) })
    }
    private func preferredCategory(_ codes: [String]) -> String { codes.contains("ME") ? "ME" : codes.first ?? "" }
    /// Zona de documentación de la jornada, idéntica a la de carretera: tira
    /// enmarcada con Web oficial · Libro de Ruta · Mapa en el orden fijo.
    @ViewBuilder private func documentationChips(race: CxRace, assets: [CxAsset]) -> some View {
        let valid = assets.filter { !($0.url ?? "").isEmpty && ["technicalGuide", "map"].contains($0.type ?? "") }
        let website = CyclocrossPresentation.link(race.websiteUrl)
        Divider()
        ResultsScrollRail(height: 60, spacing: 0, framed: true) {
            if let website {
                Button { safariURL = website } label: {
                    ActionStripTile(icon: "globe", label: CyclocrossPresentation.t("Web oficial", "Official website"))
                }
                    .accessibilityLabel(CyclocrossPresentation.t("Web oficial", "Official website"))
                    .accessibilityHint(CyclocrossPresentation.t("Se abrirá en el navegador", "Will open in browser"))
            }
            ForEach(valid.sorted { ($0.type == "technicalGuide" ? 0 : 1) < ($1.type == "technicalGuide" ? 0 : 1) }) { asset in
                if let url = CyclocrossPresentation.link(asset.url) {
                    Button { safariURL = url } label: {
                        ActionStripTile(icon: asset.type == "map" ? "map" : "doc",
                                        label: asset.type == "map" ? CyclocrossPresentation.t("Mapa", "Map") : CyclocrossPresentation.t("Libro de ruta", "Technical Guide"))
                    }
                        .accessibilityLabel(CyclocrossPresentation.t("Ver \(asset.type == "map" ? "mapa" : "libro de ruta")", "View \(asset.type == "map" ? "map" : "technical guide")"))
                        .accessibilityHint(CyclocrossPresentation.t("Se abrirá en el navegador", "Will open in browser"))
                }
            }
            // Los avisos de ciclocross solo se ofrecen en las pruebas con
            // resultados en directo (Mundial, Continental, Copa del Mundo,
            // Superprestige y X2O), igual que el indicador de espera.
            if CyclocrossPresentation.awaitsResults(race) {
                CxRaceNotificationChip(raceId: race.id)
            }
        }.padding(.top, 4)
    }
    private func header(_ race: CxRace, assets: [CxAsset]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            RaceDayHeading(name: CyclocrossPresentation.name(race), logoUrl: CyclocrossPresentation.logo(race), countryCode: race.countryCode,
                           // Clase completa (Nacional, Campeonato nacional, UCI C1…),
                           // nunca la sigla sola.
                           category: CyclocrossPresentation.className(race.raceClass),
                           dateLabel: DateFormatting.formatDateLongContent(race.dateKey) + (race.endDateKey.flatMap { $0 == race.dateKey ? nil : " – " + DateFormatting.formatDateLongContent($0) } ?? ""))
            RaceDayLocation(location: race.venue ?? "")
            tournamentHeading(race)
            if race.isCancelled { Text(CyclocrossPresentation.t("Carrera cancelada", "Race cancelled")).ccFont(.s12, weight: .bold).foregroundStyle(AppTheme.red) }
            documentationChips(race: race, assets: assets)
        }.padding().ccCardSurface()
    }
    private func empty(_ text: String) -> some View { Text(text).ccFont(.s14).foregroundStyle(AppTheme.textMuted).frame(maxWidth: .infinity, alignment: .leading) }
}

private struct CxProgrammeSection: View {
    let detail: CxDetail
    let broadcastColumns: Int
    let onStartlist: (String) -> Void
    let onResults: (String) -> Void
    let onOpenLink: (URL) -> Void
    private var categories: [CxCategory] { CxDetailSelection.scheduledCategories(detail) }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !categories.isEmpty {
                JornadaInfoCard {
                    Text(CyclocrossPresentation.t("Horarios", "Schedule")).ccFont(.s16, weight: .semibold).accessibilityAddTraits(.isHeader)
                    ForEach(categories) { category in
                        if category.id != categories.first?.id { Divider() }
                        // Fila centrada verticalmente: hora (en negrita) y
                        // categoría a la izquierda con su metadata debajo;
                        // dorsales y copa a la derecha.
                        HStack(alignment: .center, spacing: 10) {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 10) {
                                    Text(detail.race.isCancelled || category.isCancelled ? CyclocrossPresentation.t("Cancelada", "Cancelled") : CyclocrossPresentation.localTime(category.startTimeUtc) ?? "").ccFont(.s16, weight: .bold).monospacedDigit()
                                    Text(CyclocrossPresentation.category(category.category)).ccFont(.s16)
                                }
                                if Set(detail.race.categories.map { $0.dateKey ?? detail.race.dateKey }).count > 1 {
                                    Text(DateFormatting.formatDateLongContent(category.dateKey ?? detail.race.dateKey)).ccFont(.s13).foregroundStyle(AppTheme.textMuted)
                                }
                            }
                            Spacer(minLength: 0)
                            HStack(spacing: 6) {
                                if detail.startlist.contains(where: { $0.category == category.category }) {
                                    Button { onStartlist(category.category) } label: { CxLinkLabel(label: CyclocrossPresentation.t("Dorsales", "Startlist"), icon: "figure.outdoor.cycle") }.buttonStyle(CxCategoryBoxStyle())
                                }
                                // Copa solo-icono de las cards de Hoy en lugar del
                                // botón de texto; la sección Revive sigue aparte.
                                if CxDetailSelection.resultCategories(detail).contains(category.category) {
                                    Button { onResults(category.category) } label: {
                                        Image(systemName: "trophy").font(.body).foregroundStyle(.secondary)
                                            .frame(width: 32, height: 24).contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(CyclocrossPresentation.category(category.category) + ": " + CyclocrossPresentation.t("Resultados", "Results"))
                                }
                            }
                        }
                    }
                }
            }
            CxBroadcastSection(detail: detail, columns: broadcastColumns, onOpen: onOpenLink)
        }
    }
}

/// Datos esenciales de la jornada junto a los resultados, como la tarjeta de
/// carretera: en ciclocross, la hora de salida de cada categoría, con la
/// seleccionada resaltada.
private struct CxRaceDataCard: View {
    let detail: CxDetail
    let activeCategory: String
    var body: some View {
        let categories = CxDetailSelection.scheduledCategories(detail)
        let multiDate = Set(detail.race.categories.map { $0.dateKey ?? detail.race.dateKey }).count > 1
        VStack(alignment: .leading, spacing: 10) {
            Text(CyclocrossPresentation.t("Datos de la jornada", "Race data")).ccFont(.s16, weight: .semibold).accessibilityAddTraits(.isHeader)
            ForEach(categories) { category in
                let active = category.category == activeCategory
                let time = detail.race.isCancelled || category.isCancelled ? CyclocrossPresentation.t("Cancelada", "Cancelled")
                    : (multiDate ? DateFormatting.formatDateShort(category.dateKey ?? detail.race.dateKey) + " · " : "") + (CyclocrossPresentation.localTime(category.startTimeUtc) ?? "")
                HStack(spacing: 8) {
                    Text(CyclocrossPresentation.category(category.category))
                        .ccFont(.s14, weight: active ? .semibold : .regular)
                        .foregroundStyle(active ? AppTheme.textPrimary : AppTheme.textMuted)
                    Spacer(minLength: 0)
                    Text(time).ccFont(.s14, weight: .semibold).monospacedDigit()
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCardSurface()
    }
}

private struct CxStartlistSection: View {
    let detail: CxDetail
    let category: String
    private var rows: [CxStartlistRider] { detail.startlist.filter { $0.category == category }.sorted { $0.sortOrder < $1.sortOrder } }
    var body: some View {
        CCCard {
            VStack(alignment: .leading, spacing: 12) {
                Text(CyclocrossPresentation.t("Dorsales", "Startlist")).ccFont(.s16, weight: .semibold).accessibilityAddTraits(.isHeader)
                if rows.isEmpty { Text(CyclocrossPresentation.t("Dorsales pendientes", "Startlist pending")).ccFont(.s14).foregroundStyle(AppTheme.textMuted) }
                ForEach(rows) { row in
                    HStack(alignment: .top, spacing: 8) {
                        Text(row.bib ?? "—").ccFont(.s14, weight: .semibold).monospacedDigit().frame(minWidth: 28, alignment: .leading)
                        CountryFlag(countryCode: row.countryCode)
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text([row.firstName, row.lastName].filter { !$0.isEmpty }.joined(separator: " ")).ccFont(.s14).layoutPriority(1)
                            if let team = detail.teams.first(where: { $0.id == row.teamId }) {
                                TeamColorBands(team: team.roadTeam)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                }
            }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct CxResultsSection: View {
    let detail: CxDetail
    let category: CxCategory
    let matcher: UciResultsLogic.TeamMatcher
    var body: some View {
        let rows = detail.results.filter { $0.category == category.category }.sorted { $0.sortOrder < $1.sortOrder }
        VStack(alignment: .leading, spacing: 4) {
            // Estado de publicación con la misma fila que las clasificaciones
            // de carretera y pegado a la tabla (sin aire extra).
            CxPublicationStatus(label: CyclocrossPresentation.category(category.category), official: category.resultsStatus == "official")
                .padding(.top, 2)
                .padding(.bottom, 2)
            ResultsClassificationTable(rows: CyclocrossPresentation.resultRows(rows, matcher: matcher).map { vm in
                return (vm: vm, kind: vm.valueKind, value: vm.valueText)
            }, showTeam: rows.contains { !($0.teamName ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }, showUciPoints: rows.contains { $0.points != nil }, valueHeader: CyclocrossPresentation.t("Tiempo", "Time"))
            ForEach(rows.filter { $0.bonusSeconds != nil }) { row in
                Text(row.riderDisplay + " · " + CyclocrossPresentation.t("Bonificación: ", "Bonus: ") + String(row.bonusSeconds!) + " s")
                    .ccFont(.s12).foregroundStyle(AppTheme.textMuted)
            }
        }
    }
}

/// Aviso en inglés para una carrera o un torneo solo nacional.
struct CxSpanishAudienceView: View {
    var body: some View {
        EmptyStateView(icon: "globe", title: "Available in Spanish", subtitle: CyclocrossPresentation.spanishAudienceNotice)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Fila de estado de publicación de una clasificación CX, idéntica a
/// `ResultsPublicationStatus` de carretera: etiqueta en negrita y
/// Oficial/Provisional en secundario.
struct CxPublicationStatus: View {
    let label: String
    let official: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .ccFont(.s14, weight: .bold)
                .foregroundStyle(AppTheme.textPrimary)
            Text(official
                 ? CyclocrossPresentation.t("Oficial", "Official")
                 : CyclocrossPresentation.t("Provisional", "Provisional"))
                .ccFont(.s12)
                .foregroundStyle(AppTheme.textMuted)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct CxStandingsSection: View {
    let detail: CxDetail
    let category: String
    let matcher: UciResultsLogic.TeamMatcher
    let rounds: [String: CxRound]
    var body: some View {
        let rows = detail.standings.filter { $0.category == category }
        CxStandingsTable(rows: rows, state: detail.standingsState?.first { $0.category == category },
                         mode: CyclocrossPresentation.standingMode(scheme: detail.race.tournament?.pointsScheme, category: category, rows: rows),
                         matcher: matcher, rounds: rounds, races: detail.tournamentRaces ?? [])
    }
}

/// Tabla de una general CX, común a la ficha de carrera y a la página de
/// torneo. Con desglose por ronda, puesto y corredor quedan fijos y el total
/// y las rondas se desplazan en horizontal; sin él, tabla de clasificación
/// estándar.
struct CxStandingsTable: View {
    let rows: [CxStanding]
    let state: CxStandingState?
    let mode: String
    let matcher: UciResultsLogic.TeamMatcher
    let rounds: [String: CxRound]
    let races: [CxRaceRef]

    /// `true` si la tabla lleva columnas de ronda (desplazamiento horizontal
    /// propio, incompatible con el deslizamiento entre categorías).
    static func hasRounds(state: CxStandingState?, mode: String) -> Bool {
        CyclocrossPresentation.standingsBreakdown(state: state, mode: mode) != nil
    }

    var body: some View {
        let isEn = LocaleService.shared.current.rawValue == "en"
        let values = CyclocrossPresentation.standingValues(rows, mode: mode, isEn: isEn)
        let showTeam = rows.contains { !($0.teamName ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let valueHeader = mode == "time" ? CyclocrossPresentation.t("Tiempo", "Time") : "Pts"
        if let breakdown = CyclocrossPresentation.standingsBreakdown(state: state, mode: mode) {
            CxStandingsRoundsTable(values: values, breakdown: breakdown,
                                   headers: CyclocrossPresentation.roundHeaders(breakdown.roundIds, rounds: rounds, races: races),
                                   showTeam: showTeam, valueHeader: valueHeader, matcher: matcher)
                // Cada categoría parte del inicio de sus rondas.
                .id(state?.category ?? "")
        } else {
            ResultsClassificationTable(rows: values.map { entry in
                let vm = CyclocrossPresentation.standingRow(entry.row, mode: mode, matcher: matcher)
                return (vm: vm, kind: entry.value.kind, value: entry.value.text)
            }, showTeam: showTeam, showUciPoints: false, valueHeader: valueHeader)
        }
    }
}

/// Posición horizontal de la tabla de rondas, fuera del estado observado: el
/// desplazamiento no reconstruye la tabla en cada fotograma.
private final class CxScrollOffset { var x: CGFloat = 0 }

/// General con desglose por ronda. Dos bloques de filas de altura fija
/// (identidad fija a la izquierda; total y rondas desplazables) comparten
/// cabecera y separadores, con la superficie de `ResultsClassificationTable`.
private struct CxStandingsRoundsTable: View {
    let values: [(row: CxStanding, value: CxStandingValue)]
    let breakdown: CxStandingsBreakdown
    let headers: [CxRoundHeader]
    let showTeam: Bool
    let valueHeader: String
    let matcher: UciResultsLogic.TeamMatcher

    @State private var width: CGFloat = 0
    @State private var hasMore = false
    @State private var position = ScrollPosition(idType: String.self)
    @State private var offset = CxScrollOffset()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let headerHeight: CGFloat = 32
    private let rankWidth: CGFloat = 32
    private let totalWidth: CGFloat = 56
    private let roundWidth: CGFloat = 40
    private var rowHeight: CGFloat { showTeam ? 50 : 36 }
    /// Columna del corredor: ocupa el espacio sobrante si todas las rondas
    /// caben; si no, se limita para dejar ver el total y las primeras rondas.
    private var riderWidth: CGFloat {
        let minimum = min(220, max(150, width * 0.45))
        return max(minimum, width - rankWidth - 14 - valuesWidth)
    }
    private var identityWidth: CGFloat { rankWidth + 14 + riderWidth }
    private var valuesWidth: CGFloat { totalWidth + CGFloat(headers.count) * roundWidth + 8 }
    private var viewportWidth: CGFloat { max(0, width - identityWidth) }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            identityColumn
            ScrollView(.horizontal, showsIndicators: false) {
                valueColumns
            }
            .scrollPosition($position)
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.x + geometry.containerSize.width < geometry.contentSize.width - 1
            } action: { _, more in hasMore = more }
            .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.x } action: { _, x in offset.x = x }
            .overlay(alignment: .topTrailing) {
                if hasMore { scrollHint }
            }
        }
        .ccCardSurface()
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        // La geometría del desplazamiento solo avisa de cambios: el estado
        // inicial y los cambios de ancho se calculan con las medidas fijas.
        .onChange(of: width, initial: true) { _, _ in
            hasMore = width > 0 && offset.x + viewportWidth < valuesWidth - 1
        }
    }

    // MARK: Columnas

    private var identityColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                headerText("#").frame(width: rankWidth, alignment: .leading)
                headerText(CyclocrossPresentation.t("Corredor", "Rider")).frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, 8)
            .frame(width: identityWidth, height: headerHeight, alignment: .leading)
            .background(AppTheme.cardBackgroundHover)
            Divider().opacity(0.4)
            ForEach(values.indices, id: \.self) { index in
                let entry = values[index]
                identityRow(entry.row, value: entry.value)
                    .frame(width: identityWidth, height: rowHeight, alignment: .leading)
                Divider().opacity(0.4)
            }
        }
        .frame(width: identityWidth)
    }

    private var valueColumns: some View {
        VStack(alignment: .trailing, spacing: 0) {
            HStack(spacing: 0) {
                headerText(valueHeader).frame(width: totalWidth, alignment: .trailing)
                ForEach(headers) { header in roundHeader(header) }
            }
            .padding(.trailing, 8)
            .frame(height: headerHeight)
            .background(AppTheme.cardBackgroundHover)
            Divider().opacity(0.4)
            ForEach(values.indices, id: \.self) { index in
                let entry = values[index]
                HStack(spacing: 0) {
                    valueText(entry.value).frame(width: totalWidth, alignment: .trailing)
                    ForEach(Array(breakdown.cells(entry.row).enumerated()), id: \.offset) { _, cell in
                        roundCell(cell).frame(width: roundWidth, alignment: .trailing)
                    }
                }
                .padding(.trailing, 8)
                .frame(height: rowHeight)
                .accessibilityElement(children: .combine)
                Divider().opacity(0.4)
            }
        }
        .frame(width: valuesWidth)
    }

    // MARK: Celdas

    private func identityRow(_ row: CxStanding, value: CxStandingValue) -> some View {
        let team = matcher.match(row.teamName)
        return HStack(spacing: 6) {
            Text(String(row.rank))
                .ccFont(.s13, weight: .semibold)
                .foregroundStyle(AppTheme.textPrimary)
                .frame(width: rankWidth, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    if let country = row.isoCode2, !country.isEmpty {
                        CountryFlag(countryCode: country, width: 17.33)
                    }
                    Text(row.riderDisplay.isEmpty ? "—" : row.riderDisplay)
                        .ccFont(.s14, weight: .semibold)
                        .foregroundStyle(AppTheme.textPrimary)
                        .lineLimit(1)
                }
                if let teamName = row.teamName, !teamName.isEmpty {
                    HStack(spacing: 5) {
                        if let team, team.hasVisibleBadge {
                            TeamColorBands(team: team)
                        }
                        Text(teamName)
                            .ccFont(.s12)
                            .foregroundStyle(AppTheme.textMuted)
                            .lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 8)
        .accessibilityElement(children: .combine)
    }

    private func headerText(_ text: String) -> some View {
        Text(text)
            .ccFont(.s12, weight: .semibold)
            .foregroundStyle(AppTheme.textMuted)
    }

    @ViewBuilder private func roundHeader(_ header: CxRoundHeader) -> some View {
        if header.linked {
            NavigationLink(value: CxDestination(raceId: header.raceId)) {
                headerText(header.label)
                    .frame(width: roundWidth, height: headerHeight, alignment: .trailing)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(header.title ?? header.label)
        } else {
            headerText(header.label)
                .frame(width: roundWidth, alignment: .trailing)
        }
    }

    private func valueText(_ value: CxStandingValue) -> some View {
        let (color, weight): (Color, Font.Weight) = {
            switch value.kind {
            case .winnerTime: return (Color.accentColor, .bold)
            case .points: return (Color.primary, .semibold)
            default: return (Color.secondary, .regular)
            }
        }()
        return Text(value.text)
            .ccFont(.s13, weight: weight)
            .foregroundStyle(color)
            .lineLimit(1)
    }

    private func roundCell(_ cell: CxRoundCell) -> some View {
        Text(cell.text)
            .ccFont(.s12)
            .monospacedDigit()
            .strikethrough(cell.dropped)
            .foregroundStyle(cell.dropped ? Color.secondary : Color.primary)
            .lineLimit(1)
            .accessibilityLabel(cell.dropped ? cell.text + ", " + CyclocrossPresentation.t("resultado descartado", "dropped result") : cell.text)
    }

    /// Indicador de desplazamiento: flecha a la altura de la cabecera y
    /// degradado hacia el fondo de la tabla mientras quedan rondas fuera.
    private var scrollHint: some View {
        VStack(spacing: 0) {
            Button(action: advance) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: headerHeight)
                    .background(AppTheme.cardBackgroundHover)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CyclocrossPresentation.t("Más rondas", "More rounds"))
            LinearGradient(colors: [AppTheme.cardBackground.opacity(0), AppTheme.cardBackground], startPoint: .leading, endPoint: .trailing)
                .frame(width: 28)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private func advance() {
        let target = min(offset.x + viewportWidth * 0.6, max(0, valuesWidth - viewportWidth))
        if reduceMotion { position.scrollTo(x: target) } else { withAnimation(.easeOut(duration: 0.25)) { position.scrollTo(x: target) } }
    }
}

private struct CxBroadcastSection: View {
    let detail: CxDetail
    let columns: Int
    /// Apertura con el mecanismo de carretera: aviso sin conexión, app nativa
    /// si existe y, si no, navegador interno.
    let onOpen: (URL) -> Void
    @State private var showAll = false
    @State private var region = RegionService.shared

    var body: some View {
        // La TV en directo se retira al concluir cada categoría: se recalcula
        // cada minuto aunque el detalle no cambie.
        TimelineView(.everyMinute) { context in
            let selection = CyclocrossPresentation.programmeMedia(detail, allowedGroups: region.allowedBroadcastGroups, showAll: showAll, at: context.date)
            if selection.showsLiveTV { tvCard(selection) }
            if !selection.revive.isEmpty { reviveCard(selection.revive) }
        }
    }

    /// Presentación de carretera, dividida por categorías: emisiones comunes
    /// (sin categoría) sin encabezado y un bloque por categoría en directo, en
    /// el orden del programa. Filas y mensaje vacío salen de `programmeMedia`.
    private func tvCard(_ selection: CxMediaSelection) -> some View {
        JornadaInfoCard {
            HStack {
                Text(CyclocrossPresentation.t("TV y streaming", "TV and streaming")).ccFont(.s16, weight: .semibold).accessibilityAddTraits(.isHeader)
                Spacer()
                if selection.hasHiddenTV {
                    Button(showAll ? CyclocrossPresentation.t("Mi región", "My region") : CyclocrossPresentation.t("Todas", "All")) { showAll.toggle() }
                        .ccFont(.s12, weight: .semibold).buttonStyle(.bordered).buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))
                }
            }
            // Conmutador y mensaje con las reglas de carretera (StageDetailView):
            // botón solo con filas de otras regiones, etiqueta de región con
            // «Todas» y mensaje solo sin filas de la región y sin «Todas».
            if selection.showsRegionEmpty {
                Text(CyclocrossPresentation.t("No hay TV en tu región", "No TV available in your region")).ccFont(.s14).foregroundStyle(AppTheme.textMuted)
            }
            ForEach(selection.tv) { group in
                if let code = group.category {
                    Text(CyclocrossPresentation.category(code)).ccFont(.s14, weight: .semibold)
                }
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(minimum: 0), spacing: 8, alignment: .top), count: columns),
                    alignment: .leading,
                    spacing: 8
                ) {
                    ForEach(group.rows) { row in
                        BroadcastRowView(broadcast: Broadcast(id: row.id, raceDayId: detail.race.id, channel: row.channel, startTimeUtc: row.startTimeUtc,
                            url: CyclocrossPresentation.link(row.url)?.absoluteString, note: row.note, sortOrder: row.sortOrder, showInRevive: row.showInRevive, country: row.country),
                            showsRegion: showAll, onTap: onOpen)
                    }
                }
            }
        }
    }

    private func reviveCard(_ links: [CxReplayLink]) -> some View {
        JornadaInfoCard {
            Text(CyclocrossPresentation.t("Revive la carrera", "Race replay")).ccFont(.s16, weight: .semibold).accessibilityAddTraits(.isHeader)
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(minimum: 0), spacing: 8, alignment: .top), count: columns),
                alignment: .leading,
                spacing: 8
            ) {
                ForEach(links) { item in
                    BroadcastRowView(broadcast: Broadcast(id: item.id, raceDayId: detail.race.id, channel: item.title, startTimeUtc: nil,
                        url: item.url.absoluteString, note: nil, sortOrder: nil, showInRevive: true, country: nil), isRevive: true, hasResults: true, onTap: onOpen)
                }
            }
        }
    }
}

private struct CxVideosSection: View {
    let videos: [CxVideo]
    /// Mismo mecanismo que TV y Revive: aviso sin conexión, app nativa o
    /// navegador interno.
    let onOpen: (URL) -> Void

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(videos, id: \.id) { video in
                if let id = CyclocrossPresentation.youtubeVideoId(video.url),
                   let url = CyclocrossPresentation.link(video.url) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(CyclocrossPresentation.title(video)).ccFont(.s16, weight: .semibold)
                        CxYouTubePlayer(id: id)
                            .aspectRatio(16.0 / 9.0, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.surface))
                        BroadcastRowView(broadcast: Broadcast(id: video.id, raceDayId: video.raceId, channel: "YouTube", startTimeUtc: nil,
                            url: url.absoluteString, note: nil, sortOrder: nil, showInRevive: true, country: nil), isRevive: true, hasResults: true, onTap: onOpen)
                    }.padding().ccCardSurface()
                }
            }
        }
    }
}

private struct CxYouTubePlayer: UIViewRepresentable {
    let id: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.scrollView.isScrollEnabled = false
        view.loadHTMLString("""
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;width:100%;height:100%;background:#000}iframe{width:100%;height:100%;border:0}</style>
        </head><body><iframe src="https://www.youtube-nocookie.com/embed/\(id)?playsinline=1"
        title="YouTube" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe></body></html>
        """, baseURL: URL(string: "https://calendariociclismo.app"))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}

// MARK: - CxRaceNotificationChip

/// Chip de notificaciones por carrera de ciclocross. Independiente del modo de
/// carretera: seguir una carrera CX no altera `followMode` ni los filtros de
/// carretera. El aviso se entrega solo con la categoría `cyclocross` activa en
/// Ajustes y el seguimiento de esa carrera (paridad con las carreras de ruta).
private struct CxRaceNotificationChip: View {
    let raceId: String

    @State private var raceFollow = RaceFollowService.shared

    private var isFollowing: Bool { raceFollow.isFollowingCx(raceId) }

    var body: some View {
        Button {
            Haptics.play(.selection)
            raceFollow.setFollowingCx(raceId, following: !isFollowing)
        } label: {
            ActionStripTile(
                icon: isFollowing ? "bell.fill" : "bell",
                label: CyclocrossPresentation.t("Notificaciones", "Notifications"),
                showsTrailingSeparator: false
            )
        }
        .accessibilityLabel(CyclocrossPresentation.t("Notificaciones de esta carrera", "Race notifications"))
        .accessibilityValue(isFollowing
            ? CyclocrossPresentation.t("Activas", "Active")
            : CyclocrossPresentation.t("Inactivas", "Inactive"))
    }
}
