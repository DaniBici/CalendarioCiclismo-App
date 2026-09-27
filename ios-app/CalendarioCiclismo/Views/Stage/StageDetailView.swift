import SwiftUI
import QuickLook
import UIKit
import WebKit

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

/// Identidad y fecha compartidas por las jornadas de carretera y ciclocross.
struct RaceDayHeading: View {
    let name: String?
    let logoUrl: String?
    let countryCode: String?
    var showFlag = true
    var category: String? = nil
    var stageLabel = ""
    let dateLabel: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Carrera
            if let name {
                HStack(spacing: 8) {
                    RaceLogo(logoUrl, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            // Override puramente cosmético: si la jornada
                            // tiene un país propio (etapas en el extranjero),
                            // se usa para la bandera y vence a hideFlag.
                            if showFlag {
                                CountryFlag(countryCode: countryCode)
                            }
                            Text(name)
                                .font(.headline)
                        }
                        if let category { CategoryBadge(category: category) }
                    }
                    Spacer()
                }
                .accessibilityElement(children: .combine)
            }

            Divider()

            // Etapa
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    if !stageLabel.isEmpty {
                        Text(stageLabel)
                            .font(.title2)
                            .fontWeight(.bold)
                            .accessibilityAddTraits(.isHeader)
                    }

                    // La fecha de la cabecera va en el idioma del CONTENIDO (igual
                    // que el nombre de carrera, la ruta y el km), no en el del
                    // chrome de la UI. Paridad con Android (StageInfoBlock).
                    Text(dateLabel)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

        }
    }
}

struct RaceDayLocation: View {
    let location: String
    var detail: String? = nil
    var category: String? = nil
    var body: some View {
        HStack(spacing: 8) {
            if let category { CategoryBadge(category: category) }
            if !location.isEmpty { Image(systemName: "mappin.and.ellipse").foregroundStyle(.secondary).accessibilityHidden(true) }
            VStack(alignment: .leading, spacing: 2) {
                if !location.isEmpty { Text(location).font(.body) }
                if let detail { Text(detail).font(.caption).foregroundStyle(.tertiary) }
            }
        }.accessibilityElement(children: .combine)
    }
}

struct StageInfoHeader: View {
    let raceDay: RaceDay
    let race: Race?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RaceDayHeading(name: race?.localizedName, logoUrl: race?.logoUrl, countryCode: raceDay.countryCode ?? race?.countryCode,
                           showFlag: race?.hideFlag != true || raceDay.countryCode != nil, category: race?.uciCategory,
                           stageLabel: raceDay.stageLabel, dateLabel: DateFormatting.formatDateLongContent(raceDay.dateKey))

            // Recorrido
            if let route = raceDay.routeDescription {
                RaceDayLocation(location: route, detail: raceDay.isSingleCity ? LocaleService.t("Salida y meta", "Start and finish") : nil)
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
    @State private var showAllCriticalPoints = false
    @State private var showAllBroadcasts = false
    private let network  = NetworkMonitor.shared
    private let offline  = OfflineManager.shared
    private let manager  = NotificationManager.shared
    private let raceFollow = RaceFollowService.shared
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        Group {
            if viewModel.isLoading || (viewModel.raceDay == nil && viewModel.error == nil) {
                LoadingView(branded: true)
            } else if let error = viewModel.error {
                ErrorView(message: error) {
                    Task { await viewModel.load(raceDayId: raceDayId) }
                }
            } else if let rd = viewModel.raceDay {
                GeometryReader { proxy in
                    ScrollView {
                        stageContent(rd, proxy: proxy)
                            // La revisión cambia solo después de una respuesta
                            // remota completa.
                            .id(viewModel.refreshToken)
                            .padding()
                    }
                    .background(AppTheme.background)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        // Pull-to-refresh aplicado al contenedor completo, no al ScrollView
        // interno: el gesto queda registrado en la raíz de la jornada con
        // independencia del punto de entrada (Hoy, Mes, Temporada, Competición,
        // Campeonatos, Resultados…) y del estado (carga/error/contenido). Antes
        // colgaba del ScrollView de la rama `else if`, de modo que solo se
        // activaba cuando un ancestro del NavigationStack ya exponía su propio
        // gesto (Hoy y agenda CX) y se perdía al llegar desde el resto.
        .refreshable {
            // Sin red no tiene sentido pegar a Supabase — el spinner
            // colgaría hasta el timeout. Reutilizamos el mismo patrón de
            // modales que usamos al tocar un asset sin conexión: si el
            // modo sin conexión está OFF, ofrecemos activarlo; si está
            // ON pero la jornada cae fuera de la ventana sincronizada,
            // avisamos específicamente de que los datos pueden no estar
            // al día.
            guard let rd = viewModel.raceDay else { return }
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
        .navigationTitle(viewModel.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let race = viewModel.race, race.isStageRace {
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

    private func raceToolbarLink(_ race: Race) -> some View {
        NavigationLink(destination: RaceDetailView(raceId: race.id)) {
            RaceLogo(race.logoUrl, size: 24)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(LocaleService.t("Ver todas las etapas de \(race.localizedName)", "View all stages of \(race.localizedName)"))
    }

    // MARK: - Secciones

    @ViewBuilder
    private func stageContent(_ rd: RaceDay, proxy: GeometryProxy) -> some View {
        let wide = AdaptiveLayoutPolicy.usesWideDetail(
            width: proxy.size.width,
            isRegular: horizontalSizeClass == .regular
        )
        VStack(spacing: 16) {
            stageHeader(rd)
            if wide {
                let gap = detailColumnSpacing(in: proxy)
                let sideWidth = min(360, max(300, (proxy.size.width - gap - 32) * 0.38))
                HStack(alignment: .top, spacing: gap) {
                    VStack(spacing: 16) {
                        profileSection(rd)
                        editorialSections(rd)
                    }
                    .frame(maxWidth: .infinity, alignment: .top)

                    VStack(spacing: 16) {
                        timeSection(rd)
                        criticalPointsSection(rd)
                        metricsSection(rd)
                    }
                    .frame(width: sideWidth, alignment: .top)
                }
                broadcastSection(rd, columns: 2)
            } else {
                timeSection(rd)
                profileSection(rd)
                criticalPointsSection(rd)
                metricsSection(rd)
                broadcastSection(rd)
                editorialSections(rd)
            }
        }
    }

    private func detailColumnSpacing(in proxy: GeometryProxy) -> CGFloat {
        AdaptiveLayoutPolicy.divisionSpacing(in: proxy)
    }

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

            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .ccCardSurface()
            .accessibilityIdentifier(AccessibilityID.timeSection)
        }
    }

    // MARK: - Puntos clave del recorrido

    @ViewBuilder
    private func criticalPointsSection(_ rd: RaceDay) -> some View {
        let points = SimplifiedGuide.build(
            distanceKm: rd.distanceKm ?? rd.elevationProfile?.distance,
            neutralStartTimeUtc: rd.neutralStartTimeUtc,
            estimatedFinishTimeUtc: rd.estimatedFinishTimeUtc,
            summits: rd.profileSummits ?? [],
            waypoints: rd.profileWaypoints ?? [],
            primaryType: rd.primaryType
        ).filter { $0.type != "start" && $0.type != "finish" }
        if !points.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(localeService.t("Puntos clave", "Key points"))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                ForEach(showAllCriticalPoints ? points : Array(points.prefix(5))) { row in
                    guideRowView(row)
                }
                if points.count > 5 {
                    Button(showAllCriticalPoints
                           ? localeService.t("Ver menos", "Show less")
                           : localeService.t("Ver todos", "See all")) {
                        showAllCriticalPoints.toggle()
                    }
                    .font(.subheadline.weight(.semibold))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .ccCardSurface()
        }
    }

    @ViewBuilder
    private func guideRowView(_ row: GuideRow) -> some View {
        // Las horas estimadas por interpolación no se publican aquí: solo se
        // muestra la hora explícita del rutómetro.
        let timeStr = row.isEstimated ? nil : row.timeUtc.flatMap { DateFormatting.formatTimeLocal($0) }
        HStack(spacing: 10) {
            if let kmToGo = row.kmToGo {
                let posText = kmToGo <= 0.5
                    ? localeService.t("Meta", "Finish")
                    : localeService.t("a \(fmtKm(kmToGo)) km", "\(fmtKm(kmToGo)) km to go")
                Text(posText)
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .frame(width: 78, alignment: .leading)
            }

            HStack(spacing: -3) {
                GuideMarkerView(type: row.type, category: row.category)
                    .frame(width: 20, height: 20)
                if let secondaryType = row.secondaryType {
                    GuideMarkerView(type: secondaryType, category: nil)
                        .frame(width: 20, height: 20)
                }
            }
            .accessibilityHidden(true)

            Text(guideRowLabel(row))
                .font(.subheadline)
                .lineLimit(2)
            Spacer(minLength: 4)
            if let timeStr {
                Text(timeStr)
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) {
            Divider()
        }
    }

    private func guideRowLabel(_ row: GuideRow) -> String {
        let primary = guideTypeLabel(type: row.type, label: row.label)
        guard let secondaryType = row.secondaryType else { return primary }
        let secondary = guideTypeLabel(type: secondaryType, label: row.secondaryLabel)
        return secondary == primary ? primary : "\(primary) · \(secondary)"
    }

    private func guideTypeLabel(type: String, label: String?) -> String {
        switch type {
        case "start":  return localeService.t("Salida", "Start")
        case "finish": return localeService.t("Llegada", "Finish")
        case "climb_foot":
            return label.map { localeService.t("Pie de \($0)", "Foot of \($0)") }
                ?? localeService.t("Pie de puerto", "Foot of climb")
        case "summit": return label ?? localeService.t("Cima", "Summit")
        case "intermediate_sprint": return label ?? localeService.t("Sprint intermedio", "Intermediate sprint")
        case "bonus_sprint":        return label ?? localeService.t("Sprint bonificación", "Bonus sprint")
        case "intermediate_split":  return label ?? localeService.t("Punto intermedio", "Intermediate point")
        case "cobblestone":         return label ?? localeService.t("Pavé", "Cobbles")
        case "sterrato":            return label ?? localeService.t("Sterrato", "Gravel")
        case "town":                return label ?? localeService.t("Localidad", "Town")
        default:                    return label ?? type
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

    @ViewBuilder
    private func metricsSection(_ rd: RaceDay) -> some View {
        let timeLimit = rd.hasValidTimeLimit ? RaceDay.formatDuration(seconds: rd.timeLimitSeconds) : nil
        if rd.competitiveDistanceKm != nil || timeLimit != nil {
            VStack(alignment: .leading, spacing: 10) {
                Text(localeService.t("Datos de carrera", "Race data"))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 8) {
                    if let distance = rd.competitiveDistanceKm {
                        metricRow(localeService.t("Distancia competitiva", "Competitive distance"), String(format: "%.1f km", distance))
                    }
                    if let timeLimit { metricRow(localeService.t("Fuera de control", "Time limit"), timeLimit) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .ccCardSurface()
        }
    }

    private func metricRow(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
        }
    }

    @ViewBuilder
    private func profileSection(_ rd: RaceDay) -> some View {
        let officialProfile = viewModel.sortedAssets.first {
            $0.type == "profile" && !($0.url ?? "").isEmpty && !rd.profileNotViewable
        }
        if rd.hasElevationProfile || officialProfile != nil {
            StageProfileSection(
                raceDay: rd,
                race: viewModel.race,
                officialProfile: officialProfile,
                onOpenOfficial: { asset in
                    guard let raw = asset.url, let url = URL(string: raw) else { return }
                    tapAsset(asset, remote: url)
                }
            )
        }
    }

    @ViewBuilder
    private func editorialSections(_ rd: RaceDay) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) {
                descriptionSection(rd).frame(maxWidth: .infinity, alignment: .topLeading)
                bonusesNotesSection(rd).frame(maxWidth: .infinity, alignment: .topLeading)
            }
            VStack(spacing: 16) {
                descriptionSection(rd)
                bonusesNotesSection(rd)
            }
        }
    }

    @ViewBuilder
    private func broadcastSection(_ rd: RaceDay, columns: Int = 1) -> some View {
        // Una jornada cancelada solo ofrece Revive si tiene clasificaciones
        // propias y una emisión seleccionada para su reproducción.
        let cancelledReviveBroadcasts = rd.isCancelledDay
            ? RaceLogic.reviveBroadcasts(from: viewModel.broadcasts, isCancelled: true)
            : []
        let isRevive = RaceLogic.hasReviveBroadcasts(
            viewModel.broadcasts, hasCurrentResults: viewModel.hasActualResults,
            isCancelled: rd.isCancelledDay)
        let regionalBroadcasts = rd.isCancelledDay ? [] : viewModel.broadcasts
        let completeBroadcasts = rd.isCancelledDay ? [] : viewModel.allBroadcasts
        let regionalIds = Set(regionalBroadcasts.map(\.id))
        let hasHiddenBroadcasts = completeBroadcasts.contains { !regionalIds.contains($0.id) }
        let selectedBroadcasts = showAllBroadcasts ? completeBroadcasts : regionalBroadcasts
        let visibleBroadcasts = isRevive
            ? (rd.isCancelledDay
                ? cancelledReviveBroadcasts
                : RaceLogic.reviveBroadcasts(from: viewModel.broadcasts, isCancelled: false))
            : selectedBroadcasts
        // En web, Live texto pertenece a la cabecera de Retransmisión, situado
        // tras el selector regional. No forma parte del carril documental de la
        // cabecera y desaparece en descansos, cancelaciones y jornadas cerradas.
        let liveTextAsset = (!rd.isCancelledDay && !rd.isRestDay &&
            !viewModel.hasActualResults && rd.raceStatus != "finished")
            ? viewModel.sortedAssets.first { $0.type == "live_text" && !($0.url ?? "").isEmpty }
            : nil
        let race = viewModel.race
        let sectionTitle: String = {
            if isRevive {
                return race?.isOneDay == true
                    ? LocaleService.t("Revive la carrera", "Relive the race")
                    : LocaleService.t("Revive la etapa", "Relive the stage")
            }
            return LocaleService.t("Retransmisión", "Broadcast")
        }()

        if liveTextAsset != nil || !visibleBroadcasts.isEmpty || hasHiddenBroadcasts || (!isRevive && rd.tvStatus == "pending") {
            JornadaInfoCard {
                HStack(spacing: 6) {
                    Text(sectionTitle)
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)

                    if !isRevive && rd.tvStatus == "pending" {
                        TVBadge(tvStatus: "pending", broadcasts: [])
                    }

                    Spacer()

                    if hasHiddenBroadcasts && !isRevive {
                        Button {
                            showAllBroadcasts.toggle()
                        } label: {
                            Text(showAllBroadcasts
                                 ? localeService.t("Mi región", "My region")
                                 : localeService.t("Todas", "All"))
                                .font(.caption)
                                .fontWeight(.semibold)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(
                                    Capsule().fill(showAllBroadcasts
                                        ? Color.accentColor.opacity(0.14)
                                        : Color.secondary.opacity(0.10))
                                )
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(showAllBroadcasts ? Color.accentColor : Color.secondary)
                    }

                    if let asset = liveTextAsset,
                       let urlString = asset.url,
                       let url = URL(string: urlString) {
                        Button {
                            tapExternal(url: url)
                        } label: {
                            Text(localeService.t("Live texto", "Live text"))
                                .font(.caption)
                                .fontWeight(.semibold)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Capsule().fill(Color.accentColor.opacity(0.14)))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHint(localeService.t("Se abrirá en el navegador", "Will open in browser"))
                    }
                }

                if visibleBroadcasts.isEmpty && hasHiddenBroadcasts && !showAllBroadcasts {
                    Text(localeService.t("No hay TV en tu región", "No TV in your region"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                LazyVGrid(
                    columns: Array(
                        repeating: GridItem(.flexible(minimum: 0), spacing: 12, alignment: .top),
                        count: columns
                    ),
                    alignment: .leading,
                    spacing: 8
                ) {
                    ForEach(visibleBroadcasts) { broadcast in
                        BroadcastRowView(
                            broadcast: broadcast,
                            isRevive: isRevive,
                            hasResults: viewModel.hasActualResults,
                            showsRegion: showAllBroadcasts && !isRevive
                        ) { url in
                            tapBroadcast(url: url)
                        }
                    }
                }
            }

            .accessibilityIdentifier(AccessibilityID.broadcastSection)
        }
    }

    /// Chips de documentación (web oficial, inscritos, assets R2). Viven dentro
    /// de la primera card, debajo de los badges, para replicar la disposición
    /// de la web, donde estos enlaces aparecen en la parte superior de la
    /// jornada. No llevan titular propio; un divider los separa del bloque
    /// previo de datos de la etapa.
    private var icalSubscribeURL: URL? {
        guard RaceLogic.hasCalendarForYear(viewModel.race?.year),
              let slug = viewModel.raceDay?.slug,
              !slug.isEmpty,
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
        let allAssets = viewModel.sortedAssets.filter {
            $0.type != "live_text" && !(viewModel.raceDay?.profileNotViewable == true && $0.type == "profile")
        }
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
        // Clasificaciones propias (in-house): de esta jornada si ya están
        // volcadas; en su defecto, la GENERAL de la etapa anterior (vueltas por
        // etapas). Se ofrece como PRIMER chip de la tira; sin clasificaciones
        // propias no hay chip. Espejo de jornada.js (web) y StageScreen (Android).
        let showCurrentResults = viewModel.areInhouseGatesResolved && viewModel.hasInhouseResults
        let showPrevResults = viewModel.areInhouseGatesResolved
            && viewModel.prevHasInhouse && !viewModel.hasInhouseResults
        let hasResultsChip = (showCurrentResults || showPrevResults) && viewModel.race != nil
        if !allAssets.isEmpty || viewModel.hasStartlist || viewModel.race?.websiteUrl != nil || icalSubscribeURL != nil || hasGPXProfile || hasRouteMap || hasResultsChip {
            Divider()
            ResultsScrollRail(height: 60, spacing: 0, framed: true) {
                // Clasificaciones propias (in-house) — primer chip de la tira,
                // en azul de marca. Sin clasificaciones no hay chip.
                if let race = viewModel.race {
                    if showCurrentResults {
                        NavigationLink(destination: ResultsView(
                            raceId: race.id,
                            initialStageNumber: viewModel.resultsStageNumber,
                            initialStageSuffix: viewModel.raceDay?.stageSuffix,
                            initialClassKind: nil
                        )) {
                            ActionStripTile(
                                icon: "trophy",
                                label: LocaleService.t("Clasificaciones", "Classifications"),
                                highlighted: true
                            )
                        }
                        .accessibilityLabel(LocaleService.t("Clasificaciones", "Classifications"))
                    } else if showPrevResults, let prevRd = viewModel.previousStage {
                        NavigationLink(destination: ResultsView(
                            raceId: race.id,
                            initialStageNumber: viewModel.prevResultsStageNumber,
                            initialStageSuffix: prevRd.stageSuffix,
                            initialClassKind: "gc"
                        )) {
                            ActionStripTile(
                                icon: "trophy",
                                label: LocaleService.t("Clasificaciones", "Classifications")
                            )
                        }
                        .accessibilityLabel(LocaleService.t("Clasificaciones", "Classifications"))
                    }
                }

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
                        ActionStripTile(icon: "chart.line.uptrend.xyaxis", label: LocaleService.t("Perfil oficial", "Official profile"))
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
                                        ? LocaleService.t("Perfil interactivo", "Interactive profile")
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
            }
            // Unos pocos píxeles extra por encima del FlowLayout para que los
            // chips respiren respecto al divider y no queden pegados al
            // bloque de datos de la etapa.
            .padding(.top, 4)
            .accessibilityIdentifier(AccessibilityID.assetSection)
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
            JornadaInfoCard {
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
    /// preferida (X, YouTube, HBO Max…) intenta su enlace universal. Si la app
    /// correspondiente no está instalada, permanece en el navegador interno.
    private func tapExternal(url: URL) {
        if !network.isOnline {
            offlineAlert = .externalLinkOffline
            return
        }
        NativeAppLinkOpener.openIfInstalled(url) { safariURL = url }
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

    /// Abre una retransmisión en su app nativa cuando está instalada; si el
    /// enlace universal no tiene receptor, usa `SFSafariViewController` in-app.
    private func tapBroadcast(url: URL) {
        if !network.isOnline {
            offlineAlert = .externalLinkOffline
            return
        }
        NativeAppLinkOpener.openIfInstalled(url) { safariURL = url }
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

private enum StageProfileMode: String {
    case interactive
    case official
}

/// Visor de perfil integrado en Jornada, con la misma conmutación entre el
/// perfil interactivo y el documento oficial que ofrece la web.
private struct StageProfileSection: View {
    let raceDay: RaceDay
    let race: Race?
    let officialProfile: Asset?
    let onOpenOfficial: (Asset) -> Void

    @AppStorage("cc_profile_mode") private var preferredMode = StageProfileMode.interactive.rawValue

    private var hasInteractive: Bool { raceDay.hasElevationProfile }
    private var visibleOfficial: Asset? {
        raceDay.profileNotViewable ? nil : officialProfile
    }
    private var activeMode: StageProfileMode {
        if !hasInteractive { return .official }
        if visibleOfficial == nil { return .interactive }
        return StageProfileMode(rawValue: preferredMode) ?? .interactive
    }

    var body: some View {
        VStack(spacing: 0) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    profileTitle
                    Spacer(minLength: 8)
                    profileModePicker
                }
                VStack(alignment: .leading, spacing: 8) {
                    profileTitle
                    profileModePicker
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            Divider()

            switch activeMode {
            case .interactive:
                if let profile = raceDay.elevationProfile {
                    ElevationChartCard(
                        profile: profile,
                        summits: raceDay.profileSummits ?? [],
                        waypoints: raceDay.profileWaypoints ?? [],
                        profileColor: race?.colorHex.map { Color(hex: $0) } ?? .accentColor
                    )
                    .padding(12)
                }
            case .official:
                if let asset = visibleOfficial {
                    OfficialStageProfilePreview(asset: asset) {
                        onOpenOfficial(asset)
                    }
                }
            }
        }
        .ccCardSurface(cornerRadius: 12, showShadow: false)
    }

    private var profileTitle: some View {
        Text(LocaleService.t("Perfil", "Profile"))
            .font(.headline)
            .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private var profileModePicker: some View {
        if hasInteractive, visibleOfficial != nil {
            Picker(
                LocaleService.t("Tipo de perfil", "Profile format"),
                selection: Binding(
                    get: { activeMode.rawValue },
                    set: { preferredMode = $0 }
                )
            ) {
                Text(LocaleService.t("Interactivo", "Interactive"))
                    .tag(StageProfileMode.interactive.rawValue)
                Text(LocaleService.t("Oficial", "Official"))
                    .tag(StageProfileMode.official.rawValue)
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 220)
        }
    }
}

private struct OfficialStageProfilePreview: View {
    let asset: Asset
    let onOpen: () -> Void

    @State private var sourceURL: URL?

    var body: some View {
        ZStack {
            Color.white
            if let sourceURL {
                OfficialStageProfileWebView(
                    url: sourceURL,
                    isPDF: asset.fileExtension == "pdf"
                )
            } else {
                ProgressView()
                    .tint(.accentColor)
            }
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(perform: onOpen)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 320)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(LocaleService.t("Perfil oficial", "Official profile"))
        .accessibilityHint(LocaleService.t("Pulsa dos veces para abrirlo a tamaño completo", "Double tap to open it full size"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onOpen() }
        .task(id: asset.id) {
            if let localURL = await CacheManager.shared.localAssetURL(for: asset) {
                sourceURL = localURL
            } else if let raw = asset.url {
                sourceURL = URL(string: raw)
            }
        }
    }
}

private struct OfficialStageProfileWebView: UIViewRepresentable {
    let url: URL
    let isPDF: Bool

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        view.isOpaque = false
        view.backgroundColor = .white
        view.scrollView.backgroundColor = .white
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.allowsLinkPreview = false
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loadedURL != url else { return }
        context.coordinator.loadedURL = url
        if isPDF {
            if url.isFileURL {
                view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            } else {
                view.load(URLRequest(url: url))
            }
            return
        }

        let source = (url.isFileURL ? url.lastPathComponent : url.absoluteString)
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let html = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
        <style>html,body{margin:0;width:100%;height:100%;background:#fff}body{display:flex;align-items:center;justify-content:center}img{display:block;max-width:100%;max-height:100%;width:100%;height:auto;object-fit:contain}</style>
        </head><body><img src="\(source)" alt=""></body></html>
        """
        view.loadHTMLString(html, baseURL: url.isFileURL ? url.deletingLastPathComponent() : nil)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var loadedURL: URL?
    }
}

/// Fila individual de broadcast — extraída para simplificar la inferencia de tipos en ForEach.
struct BroadcastRowView: View {
    let broadcast: Broadcast
    var isRevive: Bool = false
    var hasResults: Bool = false
    var showsRegion: Bool = false
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
        if RaceLogic.shouldShowBroadcastNote(
            hasResults: hasResults,
            isRevive: isRevive,
            showInRevive: broadcast.showInRevive == true
        ), let note = broadcast.note, !note.isEmpty {
            parts.append(note)
        }
        return parts.joined(separator: ". ")
    }

    private var regionLabel: String? {
        guard showsRegion, let country = broadcast.country, country != "ALL" else { return nil }
        if LocaleService.isEnglish {
            return [
                "EUROPA": "EUROPE",
                "UK_IE": "UK / IRL",
                "NORTEAM": "NORTH AM.",
            ][country] ?? country
        }
        return [
            "UK_IE": "GB / IRL",
            "SCANDI": "ESCANDI",
        ][country] ?? country
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
                HStack(spacing: 6) {
                    Text(broadcast.channel ?? "Canal")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    if let regionLabel {
                        Text(regionLabel)
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .textCase(.uppercase)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.accentColor.opacity(0.12))
                            .foregroundStyle(Color.accentColor)
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                    }

                    if !isRevive, let time = broadcast.startTimeLocal {
                        Text("·")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text(time)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                if RaceLogic.shouldShowBroadcastNote(
                    hasResults: hasResults,
                    isRevive: isRevive,
                    showInRevive: broadcast.showInRevive == true
                ), let note = broadcast.note, !note.isEmpty {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if url != nil {
                Image(systemName: "chevron.right")
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
    /// Invierte la celda al azul de marca con contenido blanco; lo usa el
    /// primer chip ("Clasificaciones") de la tira de jornada.
    var highlighted = false

    var body: some View {
        VStack(spacing: 4) {
            Group {
                if icon == "cc.cursor" {
                    Image("ActionCursor")
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 17, height: 17)
                } else {
                    Image(systemName: icon)
                        .font(.subheadline)
                }
            }
            Text(label)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(highlighted ? Color.white : tint)
        // La celda destacada ("Clasificaciones") se ensancha con su etiqueta;
        // el resto conserva el ancho fijo de la tira.
        .frame(minWidth: 100, maxWidth: highlighted ? nil : 100, minHeight: 60, maxHeight: 60)
        .background(highlighted ? AppTheme.brandAccent : AppTheme.cardBackgroundHover)
        .overlay(alignment: .trailing) {
            if showsTrailingSeparator {
                Rectangle()
                    .fill(AppTheme.border)
                    .frame(width: 1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
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
        case "summit":
            let value = category?.trimmingCharacters(in: .whitespacesAndNewlines)
            return value.flatMap { $0.isEmpty ? nil : $0 } ?? "M"
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
                    case "cobblestone", "sterrato":
                        drawSurfaceGlyph(type: type, context: ctx, center: CGPoint(x: cx, y: cy), diameter: w)
                    default:
                        // Localidad / town: punto sólido.
                        ctx.fill(Path(ellipseIn: CGRect(x: cx - 2.6 * u, y: cy - 2.6 * u, width: 5.2 * u, height: 5.2 * u)), with: white)
                    }
                }
            }
        }
    }
}

/// Glifo compartido por la guía, el perfil y sus etiquetas.
func drawSurfaceGlyph(type: String, context ctx: GraphicsContext, center: CGPoint, diameter: CGFloat) {
    let cx = center.x, cy = center.y
    let u = diameter / 20
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: cx + x * u, y: cy + y * u) }
    let white = GraphicsContext.Shading.color(.white)
    switch type {
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
    default: break
    }
}
