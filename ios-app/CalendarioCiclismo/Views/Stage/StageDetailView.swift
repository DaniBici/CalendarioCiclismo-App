import SwiftUI
import QuickLook
import UIKit

/// Clasificación del motivo por el que un enlace no puede abrirse sin red,
/// o por el que un pull-to-refresh no puede completarse.
enum OfflineAccessAlert: Identifiable {
    /// El usuario TIENE offline activo, pero el fichero no está cacheado.
    /// Solo botón "Cerrar".
    case outOfRange
    /// El enlace es externo (no propio) y no hay red. Solo botón "Cerrar".
    case externalLinkOffline
    /// El usuario tiene offline DESACTIVADO y accede a un asset propio sin red.
    /// Botón "Cerrar" + botón "Activar modo sin conexión".
    case offlineDisabled
    /// Pull-to-refresh invocado sin red. El texto cambia según tenga el modo
    /// sin conexión activo o no; la CTA de activarlo solo aparece si está OFF.
    case refreshOffline(offlineEnabled: Bool)
    /// Pull-to-refresh sin red + offline ON, pero la jornada cae FUERA de la
    /// ventana sincronizada (mes actual/mes siguiente). Los datos cacheados
    /// pueden estar desactualizados y el sync no los mantiene al día.
    case refreshOutOfRange

    var id: String {
        switch self {
        case .outOfRange: return "outOfRange"
        case .externalLinkOffline: return "externalLinkOffline"
        case .offlineDisabled: return "offlineDisabled"
        case .refreshOffline(let enabled): return "refreshOffline-\(enabled)"
        case .refreshOutOfRange: return "refreshOutOfRange"
        }
    }

    var title: String {
        switch self {
        case .outOfRange: return "Archivo fuera de rango"
        case .externalLinkOffline: return "Enlace externo"
        case .offlineDisabled, .refreshOffline: return "Sin conexión"
        case .refreshOutOfRange: return "Jornada fuera de rango"
        }
    }

    var message: String {
        switch self {
        case .outOfRange:
            return "Archivo fuera de rango del modo sin conexión. Podrás consultarlo cuando vuelvas a tener red."
        case .externalLinkOffline:
            return "Enlace externo. Solo disponible con conexión de red."
        case .offlineDisabled:
            return "Estás intentando acceder sin conexión de red. Te recomendamos activar el modo sin conexión para tener los archivos precargados."
        case .refreshOffline(let offlineEnabled):
            return offlineEnabled
                ? "No hay red para actualizar los datos. Estás viendo la última versión descargada en tu dispositivo."
                : "No hay red para actualizar los datos. Activa el modo sin conexión para tenerlos precargados."
        case .refreshOutOfRange:
            return "Esta jornada está fuera del rango del modo sin conexión, por lo que los datos descargados pueden no estar actualizados. Podrás refrescarlos cuando vuelvas a tener red."
        }
    }

    /// `true` si el modal debe ofrecer el botón "Activar modo sin conexión".
    var offersEnableOfflineCTA: Bool {
        switch self {
        case .offlineDisabled: return true
        case .refreshOffline(let enabled): return !enabled
        default: return false
        }
    }
}

/// Bloque de datos generales de la etapa (carrera, jornada, fecha, recorrido,
/// badges de tipo/distancia/desnivel). Es el bloque que en la jornada aparece
/// encima de la documentación; se comparte con el perfil de elevación
/// (`ElevationProfileView`) para mantener el contexto de la etapa por encima
/// del perfil.
struct StageInfoHeader: View {
    let raceDay: RaceDay
    let race: Race?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Carrera
            if let race {
                HStack(spacing: 8) {
                    RaceLogo(race.logoUrl, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            // Override puramente cosmético: si la jornada
                            // tiene un país propio (etapas en el extranjero),
                            // se usa para la bandera y vence a hideFlag.
                            if race.hideFlag != true || raceDay.countryCode != nil {
                                CountryFlag(countryCode: raceDay.countryCode ?? race.countryCode)
                            }
                            Text(race.localizedName)
                                .font(.headline)
                        }
                        CategoryBadge(category: race.uciCategory)
                    }
                    Spacer()
                }
                .accessibilityElement(children: .combine)
            }

            Divider()

            // Etapa
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    if !raceDay.stageLabel.isEmpty {
                        Text(raceDay.stageLabel)
                            .font(.title2)
                            .fontWeight(.bold)
                            .accessibilityAddTraits(.isHeader)
                    }

                    // La fecha de la cabecera va en el idioma del CONTENIDO (igual
                    // que el nombre de carrera, la ruta y el km), no en el del
                    // chrome de la UI. Paridad con Android (StageInfoBlock).
                    Text(DateFormatting.formatDateLongContent(raceDay.dateKey))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            // Recorrido
            if let route = raceDay.routeDescription {
                HStack(spacing: 8) {
                    Image(systemName: "mappin.and.ellipse")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(route)
                            .font(.body)
                        if raceDay.isSingleCity {
                            Text(LocaleService.t("Salida y meta", "Start and finish"))
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(LocaleService.t("Recorrido: \(route)\(raceDay.isSingleCity ? ", salida y meta en la misma ciudad" : "")", "Route: \(route)\(raceDay.isSingleCity ? ", start and finish in the same city" : "")"))
            }

            // Badges
            HStack(spacing: 6) {
                StageTypeBadge(primaryType: raceDay.primaryType, secondaryType: raceDay.secondaryType, countryCode: race?.countryCode)

                if let dist = raceDay.distanceFormatted {
                    Text(dist)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if raceDay.distanceFormatted != nil && raceDay.elevationGainFormatted != nil {
                    Text("·")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let elev = raceDay.elevationGainFormatted {
                    Text(elev)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            // Aviso de jornada cancelada — espejo del `jornada-cancelled-banner`
            // de la web y del banner de Android: la ficha sigue siendo accesible
            // (recorrido, perfil, documentación), pero deja claro de entrada que
            // la etapa no se corrió.
            if raceDay.isCancelledDay {
                HStack(spacing: 6) {
                    Image(systemName: "xmark.circle")
                        .font(.caption)
                        .accessibilityHidden(true)
                    Text(race?.isOneDay == true
                         ? LocaleService.t("Carrera cancelada", "Race cancelled")
                         : LocaleService.t("Etapa cancelada", "Stage cancelled"))
                        .font(.caption)
                        .fontWeight(.bold)
                }
                .foregroundStyle(.red)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.red.opacity(0.10))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(Color.red.opacity(0.30), lineWidth: 1)
                        )
                )
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// Vista de detalle de etapa/jornada — equivalente a `jornada.html` + `jornada.js`.
struct StageDetailView: View {
    let raceDayId: String

    @State private var viewModel = StageDetailViewModel()
    @State private var localeService = LocaleService.shared
    @State private var safariURL: URL?
    /// Si el asset está descargado en local (R2), se muestra con QuickLook
    /// para que funcione sin conexión. Si no, fallback a Safari con la URL remota.
    @State private var quickLookURL: URL?
    @State private var offlineAlert: OfflineAccessAlert?
    @State private var guideExpanded = false
    @State private var actionStripAtStart = true
    @State private var actionStripAtEnd = false
    private let network  = NetworkMonitor.shared
    private let offline  = OfflineManager.shared
    private let manager  = NotificationManager.shared
    private let raceFollow = RaceFollowService.shared

    var body: some View {
        Group {
            if viewModel.isLoading || (viewModel.raceDay == nil && viewModel.error == nil) {
                LoadingView()
            } else if let error = viewModel.error {
                ErrorView(message: error) {
                    Task { await viewModel.load(raceDayId: raceDayId) }
                }
            } else if let rd = viewModel.raceDay {
                ScrollView {
                    VStack(spacing: 16) {
                        stageHeader(rd)
                        timeSection(rd)
                        previousResultsSection(rd)
                        resultsSection(rd)
                        broadcastSection(rd)
                        descriptionSection(rd)
                        bonusesNotesSection(rd)
                    }
                    // La revisión cambia solo después de una respuesta remota
                    // completa: fuerza a reconstruir la descripción y el resto
                    // de secciones cuando haya altas, bajas o vaciados.
                    .id(viewModel.refreshToken)
                    .padding()
                }
                .refreshable {
                    // Sin red no tiene sentido pegar a Supabase — el spinner
                    // colgaría hasta el timeout. Reutilizamos el mismo patrón de
                    // modales que usamos al tocar un asset sin conexión: si el
                    // modo sin conexión está OFF, ofrecemos activarlo; si está
                    // ON pero la jornada cae fuera de la ventana sincronizada,
                    // avisamos específicamente de que los datos pueden no estar
                    // al día.
                    guard network.isOnline else {
                        if offline.isEnabled,
                           !offline.isInOfflineRange(dateKey: rd.dateKey) {
                            offlineAlert = .refreshOutOfRange
                        } else {
                            offlineAlert = .refreshOffline(offlineEnabled: offline.isEnabled)
                        }
                        Haptics.play(.warning)
                        return
                    }
                    // Pull-to-refresh: re-fetch desde Supabase. `refresh` no toca
                    // `isLoading`, así que el contenido actual permanece visible
                    // mientras el spinner del sistema hace su trabajo.
                    await viewModel.refresh(raceDayId: raceDayId)
                    Haptics.play(.success)
                }
            }
        }
        .navigationTitle(viewModel.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let race = viewModel.race, race.isStageRace {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(destination: RaceDetailView(raceId: race.id)) {
                        RaceLogo(race.logoUrl, size: 24)
                    }
                    .accessibilityLabel(LocaleService.t("Ver todas las etapas de \(race.localizedName)", "View all stages of \(race.localizedName)"))
                }
            }
        }
        .safariSheet(url: $safariURL)
        .quickLookSheet(url: $quickLookURL)
        .alert(item: $offlineAlert) { alert in
            if alert.offersEnableOfflineCTA {
                return Alert(
                    title: Text(alert.title),
                    message: Text(alert.message),
                    primaryButton: .default(Text(LocaleService.t("Activar modo sin conexión", "Enable offline mode"))) {
                        Task { await offline.enable() }
                    },
                    secondaryButton: .cancel(Text(LocaleService.t("Cerrar", "Close")))
                )
            }
            return Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text(LocaleService.t("Cerrar", "Close")))
            )
        }

        .task { await viewModel.load(raceDayId: raceDayId) }
        .onChange(of: viewModel.raceDay) { _, newRaceDay in
            guard let raceDay = newRaceDay, let race = viewModel.race else { return }
            AnalyticsService.shared.logScreenView("stage_detail", parameters: [
                "race_day_id": raceDay.id,
                "stage_name": raceDay.stageLabel,
                "race_name": race.name,
            ])
        }
        .onChange(of: viewModel.isLoading) { _, newValue in
            if !newValue, let rd = viewModel.raceDay {
                let title = viewModel.title
                let route = rd.routeDescription ?? ""
                AccessibilityAnnouncement.announce("\(title)\(route.isEmpty ? "" : ", \(route)")")
            }
        }
    }

    // MARK: - Secciones

    @ViewBuilder
    private func stageHeader(_ rd: RaceDay) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            StageInfoHeader(raceDay: rd, race: viewModel.race)

            // Enlaces de documentación — integrados en la primera card para
            // exponerlos arriba del todo, como hace la web. Sin titular.
            documentationChips
        }
        .padding()
        .ccCardSurface()
        .accessibilityIdentifier(AccessibilityID.stageHeader)
    }

    // Una CRI/CRE no tiene "salida neutralizada"/"meta estimada" (cada
    // corredor/equipo sale y llega en un momento distinto) — se sustituye por
    // "salida 1º corredor/equipo" y "meta último corredor/equipo".
    private func startLabel(_ rd: RaceDay) -> String {
        let fem = viewModel.race?.isFemale == true
        switch rd.primaryType {
        case "itt": return localeService.t(fem ? "Salida 1ª corredora" : "Salida 1º corredor", "First rider start")
        case "ttt": return localeService.t("Salida 1º equipo", "First team start")
        default: return localeService.t("Salida neutralizada", "Neutralised start")
        }
    }

    private func finishLabel(_ rd: RaceDay) -> String {
        let fem = viewModel.race?.isFemale == true
        switch rd.primaryType {
        case "itt": return localeService.t(fem ? "Meta última corredora" : "Meta último corredor", "Last rider finish")
        case "ttt": return localeService.t("Meta último equipo", "Last team finish")
        default: return localeService.t("Meta estimada", "Estimated finish")
        }
    }

    @ViewBuilder
    private func timeSection(_ rd: RaceDay) -> some View {
        // Jornada cancelada → sin horario: la etapa no se corre, la salida/meta
        // ya no describen nada (el aviso del header es quien lo cuenta).
        // Paridad con la web y con Android.
        let hasStart = !rd.isCancelledDay && rd.neutralStartTimeUtc != nil
        let hasFinish = !rd.isCancelledDay && rd.estimatedFinishTimeUtc != nil
        let startTitle = startLabel(rd)
        let finishTitle = finishLabel(rd)

        if hasStart || hasFinish {
            VStack(alignment: .leading, spacing: 8) {
                Text(localeService.t("Horario", "Schedule"))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)

                HStack(spacing: 20) {
                    if hasStart, let start = rd.neutralStartTimeUtc,
                       let formatted = DateFormatting.formatTimeLocal(start) {
                        VStack(spacing: 2) {
                            Text(formatted)
                                .font(.title3)
                                .fontWeight(.semibold)
                            Text(startTitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(localeService.t("\(startTitle) a las \(formatted)", "\(startTitle) at \(formatted)"))
                    }

                    if hasStart && hasFinish {
                        Image(systemName: "arrow.right")
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }

                    if hasFinish, let finish = rd.estimatedFinishTimeUtc,
                       let formatted = DateFormatting.formatTimeLocal(finish) {
                        VStack(spacing: 2) {
                            Text(formatted)
                                .font(.title3)
                                .fontWeight(.semibold)
                            Text(finishTitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(localeService.t("\(finishTitle) a las \(formatted)", "\(finishTitle) at \(formatted)"))
                    }
                }

                simplifiedGuide(rd)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .ccCardSurface()
            .accessibilityIdentifier(AccessibilityID.timeSection)
        }
    }

    // MARK: - Guía simplificada de horarios de paso (despliegue inline)

    @ViewBuilder
    private func simplifiedGuide(_ rd: RaceDay) -> some View {
        let rows = SimplifiedGuide.build(
            distanceKm: rd.distanceKm ?? rd.elevationProfile?.distance,
            neutralStartTimeUtc: rd.neutralStartTimeUtc,
            estimatedFinishTimeUtc: rd.estimatedFinishTimeUtc,
            summits: rd.profileSummits ?? [],
            waypoints: rd.profileWaypoints ?? [],
            primaryType: rd.primaryType
        )
        if SimplifiedGuide.hasGuide(rows) {
            Divider().padding(.top, 4)
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { guideExpanded.toggle() }
            } label: {
                HStack {
                    Text(localeService.t("Ver horarios de paso", "Show timetable"))
                    Spacer()
                    Image(systemName: guideExpanded ? "chevron.up" : "chevron.down")
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(AccessibilityID.timetableToggle)

            if guideExpanded {
                VStack(spacing: 0) {
                    ForEach(rows) { row in guideRowView(row) }
                }
                .padding(.top, 4)
                if rows.contains(where: { $0.isEstimated && $0.timeUtc != nil }) {
                    Text(localeService.t(
                        "Las horas con * son estimaciones; el resto provienen del rutómetro.",
                        "Times with * are estimates; the rest come from the road book."))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                }
            }
        }
    }

    @ViewBuilder
    private func guideRowView(_ row: GuideRow) -> some View {
        let timeStr = row.timeUtc.flatMap { DateFormatting.formatTimeLocal($0) }
        return HStack(spacing: 10) {
            HStack(spacing: 1) {
                Text(timeStr ?? "—")
                    .font(.callout.weight(.semibold))
                    .monospacedDigit()
                if row.isEstimated && row.timeUtc != nil {
                    Text("*").font(.callout.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            .frame(width: 58, alignment: .leading)

            GuideMarkerView(type: row.type, category: row.category)
                .frame(width: 20, height: 20)

            Text(guideRowLabel(row))
                .font(.subheadline)
                .lineLimit(1)
            Spacer(minLength: 4)
            if let kmToGo = row.kmToGo {
                // A ≤0.5 km de meta (o en la propia meta) → "Meta", igual que el
                // perfil interactivo. Cubre varios puntos cercanos y negativos por redondeo.
                let posText = kmToGo <= 0.5
                    ? localeService.t("Meta", "Finish")
                    : localeService.t("a \(fmtKm(kmToGo)) km", "\(fmtKm(kmToGo)) km to go")
                Text(posText)
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) {
            Divider()
        }
    }

    private func guideRowLabel(_ row: GuideRow) -> String {
        switch row.type {
        case "start":  return localeService.t("Salida", "Start")
        case "finish": return localeService.t("Llegada", "Finish")
        case "climb_foot":
            return row.label.map { localeService.t("Pie de \($0)", "Foot of \($0)") }
                ?? localeService.t("Pie de puerto", "Foot of climb")
        case "summit": return row.label ?? localeService.t("Cima", "Summit")
        case "intermediate_sprint": return row.label ?? localeService.t("Sprint intermedio", "Intermediate sprint")
        case "bonus_sprint":        return row.label ?? localeService.t("Sprint bonificación", "Bonus sprint")
        case "intermediate_split":  return row.label ?? localeService.t("Punto intermedio", "Intermediate point")
        case "cobblestone":         return row.label ?? localeService.t("Pavé", "Cobbles")
        case "sterrato":            return row.label ?? localeService.t("Sterrato", "Gravel")
        case "town":                return row.label ?? localeService.t("Localidad", "Town")
        default:                    return row.label ?? row.type
        }
    }

    /// Formatea un km de la guía con el separador decimal del IDIOMA DE CONTENIDO
    /// (ES → coma, EN → punto), igual que `RaceDay.distanceFormatted`. Espejo de la
    /// web (_fmtGuideKm) y Android (fmtKm).
    private func fmtKm(_ d: Double) -> String {
        if d == d.rounded() { return String(Int(d)) }
        let raw = String(format: "%.1f", d) // siempre con '.'
        return LocaleService.shouldShowEnglishContent ? raw : raw.replacingOccurrences(of: ".", with: ",")
    }

    /// "Así está la carrera": resultados de la etapa anterior. Si esa etapa tiene
    /// clasificaciones in-house → CTA primario a la pantalla nativa (FC/PCS de
    /// respaldo); si no, comportamiento clásico FC/PCS con el gate temporal.
    /// Espejo de jornada.js (web) y StageScreen (Android).
    @ViewBuilder
    private func previousResultsSection(_ rd: RaceDay) -> some View {
        let race = viewModel.race
        if let prevRd = viewModel.previousStage, let race {
            // ¿Los resultados de la etapa ACTUAL ya están disponibles (in-house o
            // por hora)? Si lo están, la GC del día los recoge → no se muestra
            // "Así está la carrera" (espejo de `_currentResultsAvailable`).
            let currentResultsAvailable = viewModel.hasInhouseResults
                || RaceLogic.shouldShowResultsDetail(rd: rd, race: race)
            let showPrevInhouse = viewModel.prevHasInhouse && !currentResultsAvailable
            let showPrevExternal = RaceLogic.shouldShowPreviousResults(prevRd: prevRd, currentRd: rd, race: race)
            if viewModel.areInhouseGatesResolved && (showPrevExternal || showPrevInhouse) {
                ResultsButtonsCard(
                    title: localeService.t("Así está la carrera", "Race standings"),
                    fcUrl: RaceLogic.buildFcUrl(race: race, stageNumber: prevRd.stageNumber),
                    pcsUrl: RaceLogic.buildPcsUrl(race: race, stageNumber: prevRd.stageNumber, stageSuffix: prevRd.stageSuffix),
                    inhouseRoute: showPrevInhouse
                        // "Así está la carrera" → abre en la General (GC) de la
                        // etapa anterior, no en su clasificación de etapa.
                        ? ResultsRoute(raceId: race.id, stageNumber: viewModel.prevResultsStageNumber, stageSuffix: prevRd.stageSuffix, classKind: "gc")
                        : nil,
                    onLinkTap: { tapExternal(url: $0) }
                )
            }
        }
    }

    /// Bloque "Resultados" de la etapa actual: una sola tarjeta con el CTA
    /// in-house arriba (si lo hay) y FC/PCS como "También en" debajo — mismo
    /// patrón que "Así está la carrera" y que jornada.js (web). Sin in-house →
    /// FC/PCS clásicos.
    @ViewBuilder
    private func resultsSection(_ rd: RaceDay) -> some View {
        let race = viewModel.race
        if let race {
            let showResults = RaceLogic.shouldShowResultsDetail(rd: rd, race: race)
            if viewModel.areInhouseGatesResolved && (showResults || viewModel.hasInhouseResults) {
                ResultsButtonsCard(
                    title: localeService.t("Resultados", "Results"),
                    fcUrl: RaceLogic.buildFcUrl(race: race, stageNumber: rd.stageNumber),
                    pcsUrl: RaceLogic.buildPcsUrl(race: race, stageNumber: rd.stageNumber, stageSuffix: rd.stageSuffix),
                    inhouseRoute: viewModel.hasInhouseResults
                        ? ResultsRoute(raceId: race.id, stageNumber: viewModel.resultsStageNumber, stageSuffix: rd.stageSuffix)
                        : nil,
                    onLinkTap: { tapExternal(url: $0) }
                )
            }
        }
    }

    @ViewBuilder
    private func broadcastSection(_ rd: RaceDay) -> some View {
        // Cancelada → nada de emisión EN DIRECTO (no se corrió), pero SÍ el
        // "Revive" si existe: una etapa cancelada en carrera puede tener vídeo de
        // lo que sí se disputó (Qinghai E6 y su broadcast showInRevive curado).
        // Además no espera al T+30: ya no habrá directo que esperar.
        let cancelledRevive = rd.isCancelledDay
            && !RaceLogic.reviveBroadcasts(from: viewModel.broadcasts).isEmpty
        let isRevive = cancelledRevive || RaceLogic.hasReviveBroadcasts(viewModel.broadcasts, rd: rd)
        let visibleBroadcasts = isRevive
            ? RaceLogic.reviveBroadcasts(from: viewModel.broadcasts)
            : (rd.isCancelledDay ? [] : viewModel.broadcasts)
        let race = viewModel.race
        let sectionTitle: String = {
            if isRevive {
                return race?.isOneDay == true
                    ? LocaleService.t("Revive la carrera", "Relive the race")
                    : LocaleService.t("Revive la etapa", "Relive the stage")
            }
            return LocaleService.t("Retransmisión", "Broadcast")
        }()

        if !visibleBroadcasts.isEmpty || (!isRevive && rd.tvStatus == "pending") {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Text(sectionTitle)
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)

                    // Mismo chip de Hoy. En Jornada se mantiene visible incluso
                    // si ya hay un canal provisional o Live texto.
                    if !isRevive && rd.tvStatus == "pending" {
                        TVBadge(tvStatus: "pending", broadcasts: [])
                    }
                }

                ForEach(visibleBroadcasts) { broadcast in
                    BroadcastRowView(broadcast: broadcast, isRevive: isRevive) { url in
                        if isRevive {
                            // Revive: abrir la app externa (YouTube, HBO Max…)
                            UIApplication.shared.open(url)
                        } else {
                            tapBroadcast(url: url)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .ccCardSurface()
            .accessibilityIdentifier(AccessibilityID.broadcastSection)
        }
    }

    /// Chips de documentación (web oficial, inscritos, assets R2). Viven dentro
    /// de la primera card, debajo de los badges, para replicar la disposición
    /// de la web, donde estos enlaces aparecen en la parte superior de la
    /// jornada. No llevan titular propio; un divider los separa del bloque
    /// previo de datos de la etapa.
    private var icalSubscribeURL: URL? {
        guard let slug = viewModel.raceDay?.slug,
              viewModel.raceDay?.isRestDay != true,
              viewModel.raceDay?.isCancelledDay != true else { return nil }
        return URL(string: "webcal://calendariociclismo.app/feed/event/\(slug).ics")
    }

    @ViewBuilder
    private var documentationChips: some View {
        let hasGPXProfile = viewModel.raceDay?.hasElevationProfile == true
        let hasRouteMap = viewModel.raceDay?.routeGpxUrl?.isEmpty == false
        // Cuando existen AMBOS (perfil interactivo GPX + asset estático) se
        // ofrecen los dos chips: "Perfil interactivo" (nativo) + "Perfil oficial"
        // (asset). Con uno solo, la etiqueta es simplemente "Perfil".
        let hasStaticProfile = viewModel.assets.contains(where: { $0.type == "profile" })
        let bothProfiles = hasGPXProfile && hasStaticProfile
        let hasStaticMap = viewModel.assets.contains(where: { $0.type == "map" && !($0.url ?? "").isEmpty })
        let bothMaps = hasRouteMap && hasStaticMap
        // Dividimos los assets en dos grupos respecto al índice de "profile"
        // en assetOrder para que el chip web SVG aparezca siempre después
        // del rutómetro y antes (o junto) al asset estático de perfil.
        // Jornada cancelada: no hay carrera que seguir en directo → fuera el
        // Live Texto. La documentación del recorrido (rutómetro/perfil/mapa) SÍ
        // se conserva: describe la etapa que estaba trazada, no su seguimiento.
        // Espejo del filtro de `buildActionButtons` (web) y de Android.
        let allAssets = viewModel.raceDay?.isCancelledDay == true
            ? viewModel.sortedAssets.filter { $0.type != "live_text" }
            : viewModel.sortedAssets
        let profileIdx = Constants.assetOrder.firstIndex(of: "profile") ?? Constants.assetOrder.count
        // El Libro de Ruta pertenece a toda la competición y, igual que en la
        // web, ocupa la posición fija entre la web oficial y los dorsales.
        // Se extrae del resto para no heredarlo en la posición anterior.
        let technicalGuideAsset = allAssets.first {
            $0.type == "technicalGuide" && !($0.url ?? "").isEmpty
        }
        let assetsBeforeProfile = allAssets.filter { a in
            a.type != "technicalGuide" &&
            (Constants.assetOrder.firstIndex(of: a.type ?? "") ?? Constants.assetOrder.count) < profileIdx
        }
        let assetsFromProfile = allAssets.filter { a in
            let idx = Constants.assetOrder.firstIndex(of: a.type ?? "") ?? Constants.assetOrder.count
            // El asset estático de tipo "profile" NO se muestra en este grupo:
            //  - Si solo hay perfil SVG web (sin ambos), se oculta por completo.
            //  - Si están ambos ("Perfil oficial" + "Perfil interactivo"), el
            //    oficial se renderiza aparte, JUSTO ANTES del interactivo (para
            //    que el orden sea Rutómetro → oficial → interactivo → Mapa), así
            //    que también se excluye de aquí.
            if a.type == "profile" && hasGPXProfile { return false }
            // Con mapa interactivo y oficial, el oficial se renderiza aparte,
            // justo antes del interactivo, como sucede con los perfiles.
            if a.type == "map" && bothMaps { return false }
            return idx >= profileIdx
        }
        // Asset estático de perfil que se muestra como "Perfil oficial" cuando
        // coexisten ambos perfiles (se renderiza antes del interactivo).
        let officialProfileAsset: Asset? = bothProfiles
            ? viewModel.sortedAssets.first(where: { $0.type == "profile" && !($0.url ?? "").isEmpty })
            : nil
        let officialMapAsset: Asset? = bothMaps
            ? viewModel.sortedAssets.first(where: { $0.type == "map" && !($0.url ?? "").isEmpty })
            : nil
        let actionCount = allAssets.count
            + (viewModel.race?.websiteUrl == nil ? 0 : 1)
            + (viewModel.hasStartlist ? 1 : 0)
            + (hasGPXProfile ? 1 : 0)
            + (hasRouteMap ? 1 : 0)
            + (icalSubscribeURL == nil ? 0 : 1)
        if !allAssets.isEmpty || viewModel.hasStartlist || viewModel.race?.websiteUrl != nil || icalSubscribeURL != nil || hasGPXProfile || hasRouteMap {
            Divider()
            ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                // HStack conserva el desplazamiento nativo de ScrollView y no
                // convierte los marcadores de extremo en una celda completa.
                HStack(spacing: 0) {
                Color.clear.frame(width: 1, height: 60).id("stage-actions-start")
                // Web oficial — siempre primero si existe
                if let websiteStr = viewModel.race?.websiteUrl,
                   let websiteURL = URL(string: websiteStr) {
                    Button { tapExternal(url: websiteURL) } label: {
                        ActionStripTile(icon: "globe", label: LocaleService.t("Web oficial", "Official website"))
                    }
                    .accessibilityLabel(LocaleService.t("Web oficial", "Official website"))
                    .accessibilityHint(LocaleService.t("Se abrirá en el navegador", "Will open in browser"))
                }
                // Libro de Ruta: fijo tras la web oficial, antes de Dorsales.
                if let asset = technicalGuideAsset,
                   let urlStr = asset.url,
                   let url = URL(string: urlStr) {
                    let displayLabel = Constants.assetTexts["technicalGuide"] ?? asset.typeLabel
                    Button {
                        tapAsset(asset, remote: url)
                    } label: {
                        ActionStripTile(icon: assetIcon(for: "technicalGuide"), label: displayLabel)
                    }
                    .accessibilityLabel("Ver \(displayLabel)")
                    .accessibilityHint(asset.isDownloadableR2
                                       ? "Se abrirá en la app"
                                       : "Se abrirá en el navegador")
                }

                // Dorsales van tras el Libro de Ruta cuando está disponible.
                if viewModel.hasStartlist, let race = viewModel.race {
                    let provisional = race.startlistProvisional == true
                    let startlistLabel = provisional
                        ? LocaleService.t("Lista provisional", "Provisional Startlist")
                        : LocaleService.t("Dorsales", "Startlist")
                    NavigationLink(destination: StartlistView(raceId: race.id)) {
                        ActionStripTile(icon: "person.2", label: startlistLabel)
                    }
                    .accessibilityLabel(provisional ? LocaleService.t("Ver lista provisional", "View Provisional Startlist") : LocaleService.t("Ver dorsales", "View Startlist"))
                }

                // Otros assets antes de la posición de "profile" (orden de
                // salida, rutómetro); el Libro de Ruta ya se ha renderizado.
                ForEach(assetsBeforeProfile) { asset in
                    // Caso especial: el asset startOrder ahora abre la vista nativa
                    // de orden de salida en vez de la web.
                    if asset.type == "startOrder", let rdId = viewModel.raceDay?.id {
                        NavigationLink(destination: StartOrderView(raceDayId: rdId)) {
                            ActionStripTile(icon: "timer", label: LocaleService.t("Orden de salida", "Start order"))
                        }
                        .accessibilityLabel(LocaleService.t("Ver orden de salida", "View start order"))
                    } else if let urlStr = asset.url, let url = URL(string: urlStr) {
                        let hasProfile = viewModel.assets.contains(where: { $0.type == "profile" })
                        let isSterratiPorts = asset.type == "ports" && !hasProfile
                            && viewModel.raceDay?.primaryType == "sterrato"
                        let isFrance = viewModel.race?.countryCode?.uppercased() == "FR"
                        let effectiveType = isSterratiPorts
                            ? (isFrance ? "ribinou" : "sterrato")
                            : (asset.type ?? "")
                        let displayLabel = Constants.assetTexts[effectiveType] ?? asset.typeLabel
                        let displayIcon  = assetIcon(for: effectiveType.isEmpty ? asset.type : effectiveType)
                        Button {
                            tapAsset(asset, remote: url)
                        } label: {
                            ActionStripTile(icon: displayIcon, label: displayLabel)
                        }
                        .accessibilityLabel("Ver \(displayLabel)")
                        .accessibilityHint(asset.isDownloadableR2
                                           ? "Se abrirá en la app"
                                           : "Se abrirá en el navegador")
                    }
                }

                // Perfil oficial (asset estático) — solo cuando coexisten ambos.
                // Va JUSTO DESPUÉS del rutómetro y ANTES del perfil interactivo.
                if let asset = officialProfileAsset, let urlStr = asset.url, let url = URL(string: urlStr) {
                    Button {
                        tapAsset(asset, remote: url)
                    } label: {
                        ActionStripTile(icon: "chart.line.uptrend.xyaxis", label: LocaleService.t("Perfil", "Profile"))
                    }
                    .accessibilityLabel(LocaleService.t("Ver perfil oficial", "View official profile"))
                    .accessibilityHint(asset.isDownloadableR2
                                       ? "Se abrirá en la app"
                                       : "Se abrirá en el navegador")
                }

                // Perfil SVG — abre la vista nativa del perfil; aparece siempre
                // después del rutómetro (y del perfil oficial, si lo hay). Con
                // asset estático además, este es el "Perfil interactivo"; si no,
                // solo "Perfil".
                if hasGPXProfile, let rd = viewModel.raceDay {
                    NavigationLink(destination: ElevationProfileView(raceDay: rd, race: viewModel.race)) {
                        ActionStripTile(icon: "chart.line.uptrend.xyaxis", label: bothProfiles
                                        ? LocaleService.t("Perfil + Datos", "Profile + Data")
                                        : LocaleService.t("Perfil", "Profile"))
                    }
                    .accessibilityLabel(LocaleService.t("Ver perfil de altimetría", "View elevation profile"))
                    .accessibilityHint(LocaleService.t("Abre el perfil interactivo de la etapa", "Opens the interactive stage profile"))
                }

                // Mapa oficial — cuando también existe mapa interactivo, va primero.
                if let asset = officialMapAsset, let urlStr = asset.url, let url = URL(string: urlStr) {
                    Button {
                        tapAsset(asset, remote: url)
                    } label: {
                        ActionStripTile(icon: "map", label: LocaleService.t("Mapa", "Map"))
                    }
                    .accessibilityLabel(LocaleService.t("Ver mapa oficial", "View official map"))
                    .accessibilityHint(asset.isDownloadableR2
                                       ? "Se abrirá en la app"
                                       : "Se abrirá en el navegador")
                }

                // Mapa interactivo nativo. Con el oficial, se etiqueta como
                // "Mapa interactivo" y queda inmediatamente después.
                if hasRouteMap, let rd = viewModel.raceDay {
                    NavigationLink(destination: RouteMapView(raceDay: rd, race: viewModel.race)) {
                        ActionStripTile(icon: "map", label: bothMaps
                                        ? LocaleService.t("Mapa 3D", "3D Map")
                                        : LocaleService.t("Mapa", "Map"))
                    }
                    .accessibilityLabel(LocaleService.t("Ver mapa del recorrido", "View route map"))
                    .accessibilityHint(LocaleService.t("Abre el mapa interactivo de la etapa", "Opens the interactive stage map"))
                }

                // Assets desde la posición de "profile" en adelante
                // (profile estático, ports, map, live_text)
                ForEach(assetsFromProfile) { asset in
                    if let urlStr = asset.url, let url = URL(string: urlStr) {
                        let hasProfile = viewModel.assets.contains(where: { $0.type == "profile" })
                        let isSterratiPorts = asset.type == "ports" && !hasProfile
                            && viewModel.raceDay?.primaryType == "sterrato"
                        let isFrance = viewModel.race?.countryCode?.uppercased() == "FR"
                        let effectiveType = isSterratiPorts
                            ? (isFrance ? "ribinou" : "sterrato")
                            : (asset.type ?? "")
                        let displayLabel = Constants.assetTexts[effectiveType] ?? asset.typeLabel
                        let displayIcon  = assetIcon(for: effectiveType.isEmpty ? asset.type : effectiveType)
                        Button {
                            tapAsset(asset, remote: url)
                        } label: {
                            ActionStripTile(icon: displayIcon, label: displayLabel)
                        }
                        .accessibilityLabel("Ver \(displayLabel)")
                        .accessibilityHint(asset.isDownloadableR2
                                           ? "Se abrirá en la app"
                                           : "Se abrirá en el navegador")
                    }
                }

                // La acción también sirve de entrada a las notificaciones: no
                // se oculta antes de que el usuario conceda los permisos.
                if viewModel.raceDay?.isRestDay != true,
                   viewModel.raceDay?.isCancelledDay != true {
                    StageNotificationChip(raceDayId: raceDayId)
                }

                // iCal — suscripción individual a esta jornada (último)
                if let icalURL = icalSubscribeURL {
                    Button {
                        UIApplication.shared.open(icalURL)
                        Haptics.play(.primaryAction)
                    } label: {
                        ActionStripTile(
                            icon: "calendar.badge.plus",
                            label: LocaleService.t("Añadir al calendario", "Add to calendar")
                        )
                    }
                    .accessibilityLabel(LocaleService.t("Añadir al calendario", "Add to calendar"))
                    .accessibilityHint(LocaleService.t("Añade esta jornada a tu aplicación de calendario", "Adds this day to your calendar app"))
                }
                Color.clear.frame(width: 1, height: 60).id("stage-actions-end")
                }
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 2)
                .background(HorizontalScrollBounceDisabler())
            }
            .id("stage-actions-start")
            .frame(maxWidth: .infinity, alignment: .leading)
            // Unos pocos píxeles extra por encima del FlowLayout para que los
            // chips respiren respecto al divider y no queden pegados al
            // bloque de datos de la etapa.
            .padding(.top, 4)
            .accessibilityIdentifier(AccessibilityID.assetSection)
            .onScrollGeometryChange(for: ActionStripEdges.self) { geometry in
                let maxOffset = max(0, geometry.contentSize.width - geometry.containerSize.width)
                return ActionStripEdges(
                    atStart: geometry.contentOffset.x <= 1,
                    atEnd: geometry.contentOffset.x >= maxOffset - 1
                )
            } action: { _, edges in
                actionStripAtStart = edges.atStart
                actionStripAtEnd = edges.atEnd
            }
            .overlay(alignment: .leading) {
                if actionCount > 4 && !actionStripAtStart {
                    ZStack(alignment: .leading) {
                        LinearGradient(
                            gradient: Gradient(stops: [
                                .init(color: AppTheme.cardBackground, location: 0),
                                .init(color: AppTheme.cardBackground, location: 0.3),
                                .init(color: .clear, location: 1),
                            ]),
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: 24, height: 60)

                        Button {
                            withAnimation(.smooth) {
                                proxy.scrollTo("stage-actions-start", anchor: .leading)
                            }
                        } label: {
                            Image(systemName: "chevron.left")
                                .font(.subheadline.weight(.semibold))
                                .frame(width: 28, height: 28)
                                .background(AppTheme.cardBackground.opacity(0.96), in: Circle())
                                .overlay { Circle().stroke(Color.accentColor.opacity(0.14), lineWidth: 1) }
                        }
                        .frame(width: 40, height: 60, alignment: .leading)
                        .foregroundStyle(Color.accentColor)
                        .buttonStyle(.plain)
                    }
                    .frame(width: 40, height: 60, alignment: .leading)
                }
            }
            .overlay(alignment: .trailing) {
                if actionCount > 4 && !actionStripAtEnd {
                    ZStack(alignment: .trailing) {
                        LinearGradient(
                            gradient: Gradient(stops: [
                                .init(color: .clear, location: 0),
                                .init(color: AppTheme.cardBackground, location: 0.7),
                                .init(color: AppTheme.cardBackground, location: 1),
                            ]),
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: 24, height: 60)

                        Button {
                            withAnimation(.smooth) {
                                proxy.scrollTo("stage-actions-end", anchor: .trailing)
                            }
                        } label: {
                            Image(systemName: "chevron.right")
                                .font(.subheadline.weight(.semibold))
                                .frame(width: 28, height: 28)
                                .background(AppTheme.cardBackground.opacity(0.96), in: Circle())
                                .overlay { Circle().stroke(Color.accentColor.opacity(0.14), lineWidth: 1) }
                        }
                        .frame(width: 40, height: 60, alignment: .trailing)
                        .foregroundStyle(Color.accentColor)
                        .buttonStyle(.plain)
                    }
                    .frame(width: 40, height: 60, alignment: .trailing)
                }
            }
            }
        }
    }

    private struct ActionStripEdges: Equatable {
        let atStart: Bool
        let atEnd: Bool
    }

    /// SwiftUI no expone un comportamiento «sin rebote» para una tira que sí
    /// desborda horizontalmente. Este marcador localiza solo su UIScrollView
    /// contenedor y evita que el gesto sobrepase los extremos.
    private struct HorizontalScrollBounceDisabler: UIViewRepresentable {
        func makeUIView(context: Context) -> BounceDisablerView { BounceDisablerView() }

        func updateUIView(_ uiView: BounceDisablerView, context: Context) {
            uiView.disableAncestorBounceIfNeeded()
        }

        final class BounceDisablerView: UIView {
            private weak var scrollView: UIScrollView?
            private var originalBounces: Bool?
            private var originalAlwaysBounceHorizontal: Bool?

            override func didMoveToSuperview() {
                super.didMoveToSuperview()
                disableAncestorBounceIfNeeded()
            }

            func disableAncestorBounceIfNeeded() {
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    var view = self.superview
                    while let current = view {
                        if let scrollView = current as? UIScrollView,
                           scrollView.contentSize.width > scrollView.bounds.width + 1 {
                            guard self.scrollView !== scrollView else { return }
                            self.restoreBounce()
                            self.scrollView = scrollView
                            self.originalBounces = scrollView.bounces
                            self.originalAlwaysBounceHorizontal = scrollView.alwaysBounceHorizontal
                            scrollView.bounces = false
                            scrollView.alwaysBounceHorizontal = false
                            return
                        }
                        view = current.superview
                    }
                }
            }

            deinit { restoreBounce() }

            private func restoreBounce() {
                guard let scrollView else { return }
                if let originalBounces { scrollView.bounces = originalBounces }
                if let originalAlwaysBounceHorizontal {
                    scrollView.alwaysBounceHorizontal = originalAlwaysBounceHorizontal
                }
                self.scrollView = nil
                originalBounces = nil
                originalAlwaysBounceHorizontal = nil
            }
        }
    }

    @ViewBuilder
    private func descriptionSection(_ rd: RaceDay) -> some View {
        if let desc = rd.localizedDescription, !desc.isEmpty {
            let paragraphs = desc.components(separatedBy: "\n")
                .filter {
                    !$0.trimmingCharacters(in: .whitespacesAndNewlines)
                        .replacingOccurrences(of: "\u{00A0}", with: "")
                        .isEmpty
                }
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(localeService.t("Descripción", "Description"))
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    if rd.isDescriptionAutoTranslated {
                        Text("AI translated from Spanish, might contain errors")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(paragraphs.indices, id: \.self) { i in
                        MarkdownText(paragraphs[i])
                            .font(.body)
                            .foregroundStyle(.primary)
                            .lineSpacing(3)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .ccCardSurface()
        }
    }

    @ViewBuilder
    private func bonusesNotesSection(_ rd: RaceDay) -> some View {
        let localizedBonuses = rd.localizedBonuses
        let localizedNotes = rd.localizedNotes
        let hasBonuses = localizedBonuses != nil && !localizedBonuses!.isEmpty
        let hasNotes = localizedNotes != nil && !localizedNotes!.isEmpty

        if hasBonuses || hasNotes {
            VStack(alignment: .leading, spacing: 12) {
                if hasBonuses {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(localeService.t("Bonificaciones", "Bonuses"))
                            .font(.headline)
                            .accessibilityAddTraits(.isHeader)
                        Text(localizedBonuses ?? "")
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .lineSpacing(3)
                    }
                }

                if hasBonuses && hasNotes {
                    Divider()
                }

                if hasNotes {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(localeService.t("Notas", "Notes"))
                            .font(.headline)
                            .accessibilityAddTraits(.isHeader)
                        Text(localizedNotes ?? "")
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .lineSpacing(3)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .ccCardSurface()
        }
    }

    // MARK: - Lógica de apertura de enlaces (online / offline)

    /// Tap en un asset R2 (roadbook, perfil, mapa, etc.). Abre con QuickLook si
    /// hay fichero local descargado; si no, intenta red y muestra modal si falta.
    private func tapAsset(_ asset: Asset, remote: URL) {
        Task {
            // 1. Si está descargado localmente, siempre abrir — no necesita red.
            if let localURL = await CacheManager.shared.localAssetURL(for: asset) {
                quickLookURL = localURL
                return
            }
            // 2. Sin fichero local: si es R2 (propio) aplicar reglas de offline.
            if asset.isDownloadableR2 {
                tapOwnR2(url: remote)
            } else {
                // 3. Si la URL no es nuestra (live_text u otras externas), tratarla
                //    como enlace externo estándar.
                tapExternal(url: remote)
            }
        }
    }

    /// Abre una URL propia (R2 o interna de la app) — como inscritos. Si no hay
    /// red y no hay caché, muestra modal según offline esté activo o no.
    private func tapOwnR2(url: URL) {
        if network.isOnline {
            safariURL = url
        } else if offline.isEnabled {
            offlineAlert = .outOfRange
        } else {
            offlineAlert = .offlineDisabled
        }
    }

    /// Abre una URL externa (web oficial, broadcast TV, live_text, inscritos web).
    /// Sin red, siempre modal "Enlace externo". Si el host tiene app nativa
    /// preferida (X, YouTube, HBO Max…) se delega a `UIApplication.shared.open`
    /// para que iOS enrute vía universal links.
    private func tapExternal(url: URL) {
        if !network.isOnline {
            offlineAlert = .externalLinkOffline
            return
        }
        if prefersNativeApp(url: url) {
            UIApplication.shared.open(url)
        } else {
            safariURL = url
        }
    }

    /// Tap en el chip "Perfil" cuando la jornada tiene perfil SVG web. Con red,
    /// abre la página de perfil en el navegador (comportamiento original). Sin
    /// red y con modo sin conexión activo, si existe un asset estático de tipo
    /// "profile" descargado en local lo muestra con QuickLook en vez de
    /// caer en el modal de "Enlace externo".
    private func tapWebProfile(url: URL) {
        if network.isOnline {
            tapExternal(url: url)
            return
        }
        if offline.isEnabled,
           let profileAsset = viewModel.assets.first(where: { $0.type == "profile" }) {
            Task {
                if let localURL = await CacheManager.shared.localAssetURL(for: profileAsset) {
                    quickLookURL = localURL
                    return
                }
                tapExternal(url: url)
            }
            return
        }
        tapExternal(url: url)
    }

    /// Abre el enlace de una retransmisión en vivo. YouTube y HBO Max se
    /// delegan a `UIApplication.shared.open` para que iOS enrute al app
    /// nativo vía universal links cuando está instalado; el resto usa
    /// `SFSafariViewController` in-app.
    private func tapBroadcast(url: URL) {
        if !network.isOnline {
            offlineAlert = .externalLinkOffline
            return
        }
        if prefersNativeApp(url: url) {
            UIApplication.shared.open(url)
        } else {
            safariURL = url
        }
    }

    /// YouTube, HBO Max y X deben abrirse en su app nativa si está instalada.
    private func prefersNativeApp(url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host.contains("youtube.com") || host.contains("youtu.be") ||
            host.contains("hbomax.com") || host.contains("play.max.com") ||
            host.contains("x.com") || host.contains("twitter.com")
    }

    private func assetIcon(for type: String?) -> String {
        switch type {
        case "startOrder": return "timer"
        case "profile": return "chart.line.uptrend.xyaxis"
        case "map": return "map"
        case "roadbook": return "doc.text"
        case "ports": return "mountain.2"
        case "live_text": return "text.bubble"
        case "sterrato", "ribinou": return "circle.grid.3x3.fill"
        default: return "doc"
        }
    }
}

/// Tarjeta de botones de resultados, compartida por "Resultados" (etapa actual)
/// y "Así está la carrera" (etapa anterior). UNA sola tarjeta: si hay
/// clasificaciones in-house (`inhouseRoute != nil`), el CTA primario "Ver
/// clasificaciones" va arriba y FC/PCS quedan como respaldo discreto bajo
/// "También en"; sin in-house, FC/PCS son los botones principales. Espejo de
/// `resultsButtonsHtml` en jornada.js (web) y `ResultsButtonsCard` (Android).
struct ResultsButtonsCard: View {
    let title: String
    let fcUrl: URL?
    let pcsUrl: URL?
    var inhouseRoute: ResultsRoute? = nil
    let onLinkTap: (URL) -> Void

    var body: some View {
        // Sin in-house y sin FC/PCS no hay nada que mostrar. Con in-house, el CTA
        // primario se muestra aunque FC/PCS falten.
        if inhouseRoute != nil || fcUrl != nil || pcsUrl != nil {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)

                if let route = inhouseRoute {
                    // CTA primario → pantalla nativa de clasificaciones.
                    NavigationLink(destination: ResultsView(raceId: route.raceId, initialStageNumber: route.stageNumber, initialStageSuffix: route.stageSuffix, initialClassKind: route.classKind)) {
                        Text(LocaleService.t("Ver clasificaciones", "View classifications"))
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(Color.accentColor)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                    }
                    .accessibilityLabel(LocaleService.t("Ver clasificaciones", "View classifications"))
                    // FC/PCS de respaldo discreto bajo "También en".
                    if fcUrl != nil || pcsUrl != nil {
                        Text(LocaleService.t("También en", "Also on"))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                if fcUrl != nil || pcsUrl != nil {
                    HStack(spacing: 8) {
                        if let url = fcUrl {
                            externalButton("FirstCycling", url: url)
                        }
                        if let url = pcsUrl {
                            externalButton("ProCyclingStats", url: url)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .ccCardSurface()
        }
    }

    private func externalButton(_ label: String, url: URL) -> some View {
        Button { onLinkTap(url) } label: {
            Text(label)
                .font(.caption)
                .fontWeight(.medium)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Color.accentColor.opacity(0.1))
                .foregroundStyle(Color.accentColor)
                .clipShape(RoundedRectangle(cornerRadius: 3))
        }
        .accessibilityLabel(label)
        .accessibilityHint(LocaleService.t("Abre resultados en el navegador", "Opens results in the browser"))
    }
}

/// Fila individual de broadcast — extraída para simplificar la inferencia de tipos en ForEach.
struct BroadcastRowView: View {
    let broadcast: Broadcast
    var isRevive: Bool = false
    /// Callback para abrir la URL externa. Delegado al padre para centralizar
    /// la lógica de red/offline y mostrar modales cuando corresponda.
    let onTap: (URL) -> Void
    @Environment(\.colorScheme) private var colorScheme

    private var rowAccessibilityLabel: String {
        let channel = broadcast.channel ?? "Canal"
        var parts: [String] = []
        if !isRevive, let time = broadcast.startTimeLocal {
            parts.append("\(channel), a las \(time)")
        } else {
            parts.append(channel)
        }
        if (!isRevive || broadcast.showInRevive == true), let note = broadcast.note, !note.isEmpty {
            parts.append(note)
        }
        return parts.joined(separator: ". ")
    }

    var body: some View {
        let urlStr = broadcast.url
        let url = urlStr.flatMap { URL(string: $0) }

        return HStack(spacing: 10) {
            Image(systemName: "tv")
                .foregroundStyle(.secondary)
                .frame(width: 20)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 0) {
                    Text(broadcast.channel ?? "Canal")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    if !isRevive, let time = broadcast.startTimeLocal {
                        Text("  ·  \(time)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                if (!isRevive || broadcast.showInRevive == true), let note = broadcast.note, !note.isEmpty {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if url != nil {
                Image(systemName: "arrow.up.right.square")
                    .foregroundStyle(colorScheme == .dark ? .white : Color.accentColor)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture {
            if let url = url {
                onTap(url)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rowAccessibilityLabel)
        .accessibilityAddTraits(.isButton)
    }
}

/// Wrapper de QLPreviewController para mostrar PDFs / imágenes descargados
/// del CDN R2 sin necesidad de conexión.
private struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        context.coordinator.url = url
        controller.reloadData()
    }

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem {
            url as NSURL
        }
    }
}

private struct QuickLookSheet: ViewModifier {
    @Binding var url: URL?

    func body(content: Content) -> some View {
        content.sheet(isPresented: Binding(
            get: { url != nil },
            set: { if !$0 { url = nil } }
        )) {
            if let url {
                QuickLookPreview(url: url)
                    .ignoresSafeArea()
            }
        }
    }
}

private extension View {
    func quickLookSheet(url: Binding<URL?>) -> some View {
        modifier(QuickLookSheet(url: url))
    }
}

/// Layout de flujo simple para badges/botones.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        // Índice del primer elemento de la fila en curso: al cerrarla se
        // recentran sus elementos sobre la altura definitiva de la fila.
        var rowStart = 0

        // Los elementos de una misma fila se centran verticalmente entre sí. Sin
        // esto quedaban pegados al BORDE SUPERIOR de la fila: un badge con fondo
        // + padding propio (CategoryBadge) junto a un texto pelado ("Cancelada")
        // desalineaba las dos líneas de texto. Espejo del centrado de Android.
        func centerRow(upTo end: Int) {
            for i in rowStart..<end {
                let h = subviews[i].sizeThatFits(.unspecified).height
                positions[i].y += (rowHeight - h) / 2
            }
        }

        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                centerRow(upTo: index)
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
                rowStart = index
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }
        centerRow(upTo: subviews.count)

        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}

// MARK: - Action strip

/// Celda de documentación agrupada, inspirada en los controles compactos de
/// iOS: superficie clara continua, separador tenue, símbolo arriba y título
/// truncado en una sola línea.
struct ActionStripTile: View {
    let icon: String
    let label: String
    var tint: Color = .accentColor
    var showsTrailingSeparator = true

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.subheadline)
            Text(label)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(tint)
        .frame(width: 100, height: 60)
        .background(tint.opacity(0.09))
        .overlay(alignment: .trailing) {
            if showsTrailingSeparator {
                Rectangle()
                    .fill(tint.opacity(0.18))
                    .frame(width: 1)
            }
        }
    }
}

// MARK: - StageNotificationChip

/// Chip de notificaciones por jornada. Visible a todos los usuarios:
/// - Sin Premium → presenta paywall.
/// - Premium → toggle inmediato (sin cambio de modo, las jornadas son independientes).
private struct StageNotificationChip: View {
    let raceDayId: String

    @State private var raceFollow = RaceFollowService.shared

    private var isFollowing: Bool { raceFollow.isFollowingStage(raceDayId) }

    var body: some View {
        Button {
            handleTap()
        } label: {
            ActionStripTile(
                icon: isFollowing ? "bell.fill" : "bell",
                label: LocaleService.t("Notificaciones", "Notifications")
            )
        }
        .accessibilityLabel(LocaleService.t("Notificaciones de esta jornada", "Stage notifications"))
        .accessibilityValue(isFollowing
            ? LocaleService.t("Activas", "Active")
            : LocaleService.t("Inactivas", "Inactive"))
    }

    private func handleTap() {
        // Notificaciones enriquecidas liberadas al plan gratuito: sin paywall.
        Haptics.play(.selection)
        raceFollow.setFollowingStage(raceDayId, following: !isFollowing)
    }
}

/// Marcador circular de una fila de la guía simplificada. Dibuja el glifo con
/// formas vectoriales (Canvas) bien centradas y dimensionadas dentro del
/// círculo, salvo las categorías de puerto / letras de sprint, que van como
/// texto. Espejo del `guideMarkerSVG` de la web (js/elevation-profile.js) y del
/// `GuideMarker` de Android.
struct GuideMarkerView: View {
    let type: String
    let category: String?

    private var circleColor: Color {
        switch type {
        case "start":               return Color(red: 0.24, green: 0.73, blue: 0.44)
        case "finish":              return Color(red: 0.90, green: 0.24, blue: 0.24)
        case "climb_foot", "summit": return Color(red: 0.77, green: 0.19, blue: 0.19)
        case "intermediate_sprint": return Color(red: 0.24, green: 0.73, blue: 0.44)
        case "bonus_sprint":        return Color(red: 0.90, green: 0.72, blue: 0.0)
        case "intermediate_split":  return Color(red: 0.10, green: 0.36, blue: 0.66)
        case "cobblestone":         return Color(white: 0.55)
        case "sterrato":            return Color(red: 0.77, green: 0.59, blue: 0.35)
        default:                    return Color(white: 0.55)
        }
    }

    /// Texto centrado para categorías de puerto y letras de sprint/bonif.
    private var letter: String? {
        switch type {
        case "summit":              return (category != nil && category != "M") ? category : nil
        case "intermediate_sprint": return "S"
        case "bonus_sprint":        return "B"
        default:                    return nil
        }
    }

    var body: some View {
        ZStack {
            Circle().fill(circleColor)
            if let letter {
                Text(letter)
                    .font(.system(size: letter.count >= 2 ? 9 : 11, weight: .bold))
                    .foregroundStyle(type == "bonus_sprint" ? .black : .white)
            } else {
                Canvas { ctx, size in
                    let w = size.width
                    let cx = w / 2, cy = size.height / 2
                    let u = w / 20   // 1 unidad de diseño = 1/20 del diámetro
                    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: cx + x * u, y: cy + y * u) }
                    let white = GraphicsContext.Shading.color(.white)
                    switch type {
                    case "start":
                        var path = Path()
                        path.move(to: p(-3.3, -5)); path.addLine(to: p(5, 0)); path.addLine(to: p(-3.3, 5)); path.closeSubpath()
                        ctx.fill(path, with: white)
                    case "finish":
                        let t = 4 * u
                        let x0 = cx - 4 * u, y0 = cy - 4 * u
                        ctx.fill(Path(CGRect(x: x0, y: y0, width: t * 2, height: t * 2)),
                                 with: .color(.white.opacity(0.3)))
                        ctx.fill(Path(CGRect(x: x0, y: y0, width: t, height: t)), with: white)
                        ctx.fill(Path(CGRect(x: x0 + t, y: y0 + t, width: t, height: t)), with: white)
                    case "climb_foot":
                        var a = Path(); a.move(to: p(-4, 4)); a.addLine(to: p(4, -4))
                        var b = Path(); b.move(to: p(0.5, -4)); b.addLine(to: p(4, -4)); b.addLine(to: p(4, -0.5))
                        let st = StrokeStyle(lineWidth: 1.7 * u, lineCap: .round, lineJoin: .round)
                        ctx.stroke(a, with: white, style: st); ctx.stroke(b, with: white, style: st)
                    case "intermediate_split":
                        let st = StrokeStyle(lineWidth: 1.6 * u, lineCap: .round)
                        var v = Path(); v.move(to: p(0, -4)); v.addLine(to: p(0, -0.6))
                        var h = Path(); h.move(to: p(0, 0)); h.addLine(to: p(2.6, 0))
                        var crown = Path(); crown.move(to: p(-2, -7)); crown.addLine(to: p(2, -7))
                        ctx.stroke(v, with: white, style: st); ctx.stroke(h, with: white, style: st)
                        ctx.stroke(crown, with: white, style: StrokeStyle(lineWidth: 1.5 * u, lineCap: .round))
                    case "cobblestone":
                        let pts = [p(-1.6, 4.4), p(-4.4, 0.55), p(-1.6, -2.75), p(2.25, -4.4), p(4.4, -2.75), p(5.5, 0.55), p(3.85, 4.4)]
                        var path = Path(); path.move(to: pts[0]); for i in 1..<pts.count { path.addLine(to: pts[i]) }; path.closeSubpath()
                        ctx.stroke(path, with: white, style: StrokeStyle(lineWidth: 1.2 * u, lineCap: .round, lineJoin: .round))
                    case "sterrato":
                        let st = StrokeStyle(lineWidth: 1.2 * u)
                        func ellipse(_ ecx: CGFloat, _ ecy: CGFloat, _ rx: CGFloat, _ ry: CGFloat) {
                            ctx.stroke(Path(ellipseIn: CGRect(x: cx + (ecx - rx) * u, y: cy + (ecy - ry) * u, width: rx * 2 * u, height: ry * 2 * u)), with: white, style: st)
                        }
                        ellipse(-3, 2.5, 2.5, 1.65); ellipse(2.5, 2.5, 2.2, 1.55); ellipse(0, -1.7, 2.5, 1.65)
                    default:
                        // Localidad / town: punto sólido.
                        ctx.fill(Path(ellipseIn: CGRect(x: cx - 2.6 * u, y: cy - 2.6 * u, width: 5.2 * u, height: 5.2 * u)), with: white)
                    }
                }
            }
        }
    }
}
