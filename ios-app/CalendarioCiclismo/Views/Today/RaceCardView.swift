import SwiftUI

/// Tarjeta de carrera en la agenda del día.
struct RaceCardView: View {
    let item: EnrichedRaceDay
    /// Filtro activo de Hoy; permite ocultar redundancias femeninas en Femenino/WWT.
    var activeFilter: Constants.CategoryFilter = .all
    /// Llamada cuando el usuario pulsa el icono de resultados (trofeo).
    /// Nil = no mostrar botón de resultados.
    var onShowResults: (() -> Void)? = nil
    /// Llamada cuando el usuario pulsa el icono de Revive (play).
    /// Nil = no mostrar botón de Revive.
    var onRevive: (() -> Void)? = nil
    /// Llamada cuando el usuario pulsa el badge de inscritos (Premium —
    /// Fase 4 del plan 2.0). Nil = no mostrar badge. Solo se renderiza
    /// además si `race.startlistImportedAt` no es nulo.
    var onShowStartlist: (() -> Void)? = nil
    /// Llamada cuando el usuario pulsa el badge "Orden salida" en CRI/CRE.
    /// Abre la vista nativa de orden de salida desde el caller.
    var onStartOrderTap: (() -> Void)? = nil
    /// Acceso directo a Competición para vueltas con más de una jornada.
    var onShowCompetition: (() -> Void)? = nil
    /// True si es la etapa final de la vuelta.
    var isFinalStage: Bool = false

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var premium = PremiumService.shared

    private var race: Race? { item.race }
    private var rd: RaceDay { item.raceDay }
    private var isFemaleFilterActive: Bool { activeFilter == .female || activeFilter == .wwt }
    private var displayRaceName: String {
        let fallback = LocaleService.t("Carrera", "Race")
        guard let race else { return fallback }
        return isFemaleFilterActive && race.isFemale
            ? RaceLogic.cleanFeminineDisplayName(race.localizedName)
            : race.localizedName
    }
    private var showFemaleIndicator: Bool {
        !isFemaleFilterActive && RaceLogic.shouldShowFemaleIndicator(race)
    }

    /// URL de live texto (asset tipo live_text).
    private var liveTextUrl: String? {
        item.assets.first(where: { $0.type == "live_text" })?.url
    }

    /// True si la jornada es CRI/CRE y tiene asset startOrder publicado.
    /// El badge usa este flag para decidir si renderizarse; la navegación es nativa.
    private var hasStartOrder: Bool {
        guard !rd.isCancelledDay else { return false }
        guard rd.primaryType == "itt" || rd.primaryType == "ttt" else { return false }
        return item.assets.contains(where: { $0.type == "startOrder" })
    }

    /// Subtítulo compacto con etapa, distancia y desnivel.
    /// Las partes ausentes se omiten; el separador es el punto medio (`·`).
    /// "Etapa N" y la distancia se muestran en negrita.
    private var horizontalSubtitleText: Text? {
        let separator = Text(" · ")
        var result: Text? = nil
        func append(_ part: Text) {
            result = result.map { $0 + separator + part } ?? part
        }
        if !rd.stageLabel.isEmpty {
            let label = isFinalStage ? "\(rd.stageLabel) (Final)" : rd.stageLabel
            append(Text(label).fontWeight(.semibold))
        }
        if let dist = rd.distanceFormatted, !dist.isEmpty {
            append(Text(dist).fontWeight(.semibold))
        }
        if let elev = rd.elevationGainFormatted {
            append(Text(elev))
        }
        return result
    }

    /// Use vertical layout for very large Dynamic Type.
    private var useVerticalLayout: Bool {
        dynamicTypeSize >= .accessibility1
    }

    /// True cuando estamos en modo terminado (mostrar iconos en lugar de badges/tiempo).
    private var isFinishedMode: Bool { onShowResults != nil || onRevive != nil }

    /// True si la jornada tiene perfil de elevación cargado y procede mostrar
    /// el mini-perfil compacto. Feature liberada al plan gratuito: gateada por
    /// `premium.featuresUnlocked` (siempre visible), no por la suscripción.
    private var showsMiniProfile: Bool {
        guard premium.featuresUnlocked else { return false }
        guard !rd.isRestDay, !rd.isCancelledDay else { return false }
        guard let pts = rd.elevationProfile?.points, pts.count >= 2 else { return false }
        return true
    }

    /// True si la carrera tiene startlist publicada y el caller proporcionó
    /// el closure de acceso directo. Feature liberada al plan gratuito: gateada
    /// por `premium.featuresUnlocked` (siempre visible), no por la suscripción.
    private var showsStartlistBadge: Bool {
        guard premium.featuresUnlocked else { return false }
        guard !rd.isRestDay, !rd.isCancelledDay else { return false }
        guard onShowStartlist != nil, race?.startlistImportedAt != nil else { return false }
        // Paridad con web: clásicas siempre; vueltas por etapas solo el primer día.
        if race?.isStageRace == true, rd.dateKey != race?.startDate { return false }
        return true
    }

    /// Altura de la franja del mini-perfil (a sangre, al fondo de la tarjeta).
    /// Mayor en montaña para exacerbar las diferencias de perfil; algo más en
    /// cotas, sinuosas y clásicas de pavé/sterrato (desnivel a baja altitud que
    /// sin altura extra queda aplastado). Algo más altas que el sparkline inline
    /// previo, ahora que ocupan todo el ancho de la tarjeta.
    private var miniProfileBandHeight: CGFloat {
        switch rd.primaryType {
        case "high_mountain", "summit_finish", "chrono_climb": return 54
        case "medium_mountain": return 46
        case "cotas", "uphill_finish", "rolling", "cobbles", "sterrato": return 40
        default: return 34
        }
    }

    /// Color del trazo del mini-perfil. Sigue el accent de la carrera si está
    /// definido; si no, el accent global.
    private var miniProfileTint: Color {
        if let hex = race?.colorHex, !hex.isEmpty {
            return Color(hex: hex)
        }
        return .accentColor
    }

    /// Franja de perfil a sangre (edge-to-edge) al fondo de la tarjeta. Sin
    /// padding horizontal: la `CCCard` recorta las esquinas inferiores. Lleva
    /// las horas de salida/llegada para el relleno temporal (gris → teñido).
    @ViewBuilder
    private func miniProfileBand(_ profile: ElevationProfile) -> some View {
        MiniElevationProfile(
            profile: profile,
            summits: rd.profileSummits ?? [],
            waypoints: rd.profileWaypoints ?? [],
            tint: miniProfileTint,
            height: miniProfileBandHeight,
            primaryType: rd.primaryType,
            startTime: rd.neutralStartTimeUtc.flatMap(DateFormatting.parseISO),
            endTime: rd.estimatedFinishTimeUtc.flatMap(DateFormatting.parseISO),
            isTimeTrial: rd.primaryType == "itt" || rd.primaryType == "ttt",
            forceCompleted: isFinishedMode
        )
    }

    /// Badge "Inscritos" tappable. Solo se muestra cuando `showsStartlistBadge`.
    @ViewBuilder
    private var startlistBadge: some View {
        if let onShowStartlist {
            let label: String = {
                if race?.startlistProvisional == true {
                    return LocaleService.t("Lista provisional", "Provisional Startlist")
                } else if race?.isFemale == true {
                    return LocaleService.t("Dorsales", "Startlist")
                } else {
                    return LocaleService.t("Dorsales", "Startlist")
                }
            }()
            Button {
                Haptics.play(.primaryAction)
                onShowStartlist()
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "figure.outdoor.cycle")
                        .font(.caption2)
                    Text(label)
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .textCase(.uppercase)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .foregroundStyle(.white)
                .background(Color.accentColor)
                .clipShape(RoundedRectangle(cornerRadius: 3))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        }
    }

    /// Badge "Orden salida" tappable para CRI/CRE. Solo cuando hay asset startOrder.
    @ViewBuilder
    private var startOrderBadge: some View {
        if hasStartOrder {
            Button {
                Haptics.play(.primaryAction)
                onStartOrderTap?()
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "timer")
                        .font(.caption2)
                    Text(LocaleService.t("Orden salida", "Start order"))
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .textCase(.uppercase)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .foregroundStyle(.white)
                .background(Color.accentColor)
                .clipShape(RoundedRectangle(cornerRadius: 3))
            }
            .buttonStyle(.plain)
        }
    }

    /// Badge de jornada cancelada, con el mismo tratamiento que la web.
    private var cancelledDayBadge: some View {
        Text(LocaleService.t("Cancelada", "Cancelled"))
            .font(.caption2)
            .fontWeight(.semibold)
            .textCase(.uppercase)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(AppTheme.red)
            .background(AppTheme.red.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 3))
            .accessibilityLabel(LocaleService.t("Jornada cancelada", "Cancelled stage"))
    }

    /// Color de la franja lateral de la tarjeta.
    private var stripeColor: Color {
        if let hex = race?.colorHex, !hex.isEmpty {
            return Color(hex: hex)
        }
        return .gray
    }

    var body: some View {
        // Tarjeta canónica (CCCard) con tinte de marca por carrera — paridad con
        // el cintillo "Hoy". El tinte más tenue que el default (4% en lugar de
        // 7%): en una lista con muchas carreras de colores distintos, ordena
        // mejor. Esquinas 14pt, algo menos que el cintillo, para una lista densa.
        CCCard(
            accent: stripeColor,
            accentAlpha: 0.04,
            cornerRadius: 14,
            // Sin sombra proyectada en filas de lista: el material + hairline ya
            // separan cada tarjeta, y N sombras apiladas cargarían el scroll.
            showShadow: false
        ) {
            VStack(spacing: 0) {
                Group {
                    if rd.isRestDay {
                        restDayLayout
                    } else if useVerticalLayout {
                        verticalLayout
                    } else {
                        horizontalLayout
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 12)
                // Cuando hay franja de perfil a sangre, el contenido cede el
                // borde inferior a la franja (que llega de lado a lado).
                .padding(.bottom, showsMiniProfile ? 8 : 12)

                if showsMiniProfile, let profile = rd.elevationProfile {
                    miniProfileBand(profile)
                }
            }
        }
        // Solo se atenúa la CARRERA cancelada (no se corre en absoluto). Una
        // JORNADA cancelada no: el badge "Cancelada" ya lo dice y su ficha
        // (recorrido, perfil, documentación) sigue siendo accesible.
        .opacity(race?.isCancelled == true ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(AccessibilityRaceDescription.raceCardLabel(item: item))
        .accessibilityInputLabels(raceInputLabels)
    }

    private var raceInputLabels: [String] {
        var labels: [String] = []
        if let name = race?.localizedName {
            labels.append(name)
            if let abbrev = race?.abbrev {
                labels.append(abbrev)
            }
        }
        return labels
    }

    // MARK: - Rest day layout

    private var restDayLayout: some View {
        HStack(spacing: 10) {
            RaceLogo(race?.logoUrl, size: 36)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    if race?.hideFlag != true || rd.countryCode != nil {
                        CountryFlag(countryCode: rd.countryCode ?? race?.countryCode)
                    }
                    Text(displayRaceName)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .lineLimit(1)

                    competitionButton

                    if showFemaleIndicator {
                        Text("♀")
                            .font(.caption)
                            .foregroundStyle(AppTheme.green)
                    }
                }

                HStack(spacing: 4) {
                    Image(systemName: "moon.zzz")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text(LocaleService.t("Descanso", "Rest day"))
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 0)
        }
    }

    // MARK: - Standard horizontal layout

    private var horizontalLayout: some View {
        HStack(spacing: 10) {
            RaceLogo(race?.logoUrl, size: 36)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    if race?.hideFlag != true || rd.countryCode != nil {
                        CountryFlag(countryCode: rd.countryCode ?? race?.countryCode)
                    }
                    Text(displayRaceName)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .lineLimit(1)

                    competitionButton

                    if showFemaleIndicator {
                        Text("♀")
                            .font(.caption)
                            .foregroundStyle(AppTheme.green)
                    }
                }

                if let subtitle = horizontalSubtitleText {
                    subtitle
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                // Badges de categoría + tipo + TV (ocultos en modo terminado).
                // Cuando hay mini-perfil, los badges van por ENCIMA del perfil
                // y se omite StageTypeBadge (primary/secondary) — la silueta
                // de elevación ya comunica el carácter de la etapa.
                if !isFinishedMode {
                    FlowLayout(spacing: 4) {
                        CategoryBadge(category: race?.uciCategory)
                        if rd.isCancelledDay {
                            cancelledDayBadge
                        } else if !showsMiniProfile || rd.primaryType == "itt" || rd.primaryType == "ttt" {
                            StageTypeBadge(primaryType: rd.primaryType, secondaryType: rd.secondaryType, countryCode: rd.countryCode ?? race?.countryCode)
                        }
                        // Una jornada cancelada no se emite: ni TV ni Live Texto
                    // (no hay nada que seguir). Paridad con la web y Android.
                    if !rd.isCancelledDay {
                        TVBadge(tvStatus: rd.tvStatus, broadcasts: item.broadcasts, neutralStartTimeUtc: rd.neutralStartTimeUtc, liveTextUrl: liveTextUrl)
                    }
                        if showsStartlistBadge {
                            startlistBadge
                        }
                        startOrderBadge
                    }
                } else {
                    // En modo terminado solo se muestra la categoría
                    CategoryBadge(category: race?.uciCategory)
                }
                // El mini-perfil ya no va aquí: se renderiza como franja a
                // sangre al fondo de la tarjeta (ver `miniProfileBand`).
            }

            Spacer(minLength: 0)

            // Columna derecha: tiempos normalmente, iconos cuando terminado
            if isFinishedMode {
                finishedIconsColumn
            } else {
                timesColumn
            }
        }
    }

    // MARK: - Columna de tiempos (modo normal)

    private var timesColumn: some View {
        VStack(alignment: .trailing, spacing: 1) {
            // Cancelada → sin horario: la etapa no se corre (paridad con la web).
            if rd.isCancelledDay {
                EmptyView()
            } else if let startTime = rd.neutralStartTimeUtc,
               let startStr = DateFormatting.formatTimeLocal(startTime) {
                Text(startStr)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let finishTime = rd.estimatedFinishTimeUtc,
                   let finishStr = DateFormatting.formatTimeLocal(finishTime) {
                    Text("↓")
                        .font(.system(size: 8))
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                    Text(finishStr)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.secondary)
                }
            } else if let finishTime = rd.estimatedFinishTimeUtc,
                      let finishStr = DateFormatting.formatTimeLocal(finishTime) {
                Text(finishStr)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var competitionButton: some View {
        if let onShowCompetition {
            Button {
                Haptics.play(.navigation)
                onShowCompetition()
            } label: {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 16, height: 16)
                    .background(Color.accentColor.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 3))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(LocaleService.t("Ver competición", "View race"))
        }
    }

    // MARK: - Iconos de resultados/revive (modo terminado)

    private var finishedIconsColumn: some View {
        HStack(spacing: 4) {
            if let onShowResults {
                Button {
                    onShowResults()
                } label: {
                    Image(systemName: "trophy")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(LocaleService.t("Resultados", "Results"))
            }
            if let onRevive {
                Button {
                    onRevive()
                } label: {
                    Image(systemName: "tv")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(LocaleService.t("Revive la carrera", "Relive the race"))
            }
        }
    }

    // MARK: - Vertical layout for large Dynamic Type

    private var verticalLayout: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if race?.hideFlag != true || rd.countryCode != nil {
                    CountryFlag(countryCode: rd.countryCode ?? race?.countryCode)
                }
                Text(displayRaceName)
                    .font(.subheadline)
                    .fontWeight(.medium)

                competitionButton

                if showFemaleIndicator {
                    Text("♀")
                        .font(.caption)
                        .foregroundStyle(AppTheme.green)
                }
            }

            if !rd.stageLabel.isEmpty {
                Text(isFinalStage ? "\(rd.stageLabel) (Final)" : rd.stageLabel)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 6) {
                if let dist = rd.distanceFormatted {
                    Text(dist)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.secondary)
                }
                if let elev = rd.elevationGainFormatted {
                    Text(elev)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if !isFinishedMode, !rd.isCancelledDay,
                   let startTime = rd.neutralStartTimeUtc,
                   let startStr = DateFormatting.formatTimeLocal(startTime) {
                    Text("\(LocaleService.t("Salida", "Start")) \(startStr)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            // Badges encima del perfil. Cuando hay mini-perfil se omite
            // StageTypeBadge (la silueta ya comunica el carácter de la etapa).
            if isFinishedMode {
                HStack(spacing: 8) {
                    CategoryBadge(category: race?.uciCategory)
                    Spacer()
                    finishedIconsColumn
                }
            } else {
                FlowLayout(spacing: 4) {
                    CategoryBadge(category: race?.uciCategory)
                    if rd.isCancelledDay {
                        cancelledDayBadge
                    } else if !showsMiniProfile || rd.primaryType == "itt" || rd.primaryType == "ttt" {
                        StageTypeBadge(primaryType: rd.primaryType, secondaryType: rd.secondaryType, countryCode: rd.countryCode ?? race?.countryCode)
                    }
                    // Una jornada cancelada no se emite: ni TV ni Live Texto
                    // (no hay nada que seguir). Paridad con la web y Android.
                    if !rd.isCancelledDay {
                        TVBadge(tvStatus: rd.tvStatus, broadcasts: item.broadcasts, neutralStartTimeUtc: rd.neutralStartTimeUtc, liveTextUrl: liveTextUrl)
                    }
                    if showsStartlistBadge {
                        startlistBadge
                    }
                }
            }
            // El mini-perfil va como franja a sangre al fondo de la tarjeta
            // (ver `miniProfileBand`), no inline en la columna.
        }
    }
}
