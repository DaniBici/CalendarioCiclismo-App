import SwiftUI

/// Tarjeta de carrera en la agenda del día (`buildCard` de js/app.js).
///
/// Estructura común a todos los anchos: columna de logotipo (con la bandera
/// debajo) a la izquierda; a su derecha, el nombre (hasta dos líneas, nunca
/// cortado) con la hora o los accesos de jornada terminada arriba a la derecha,
/// la línea de cifras debajo y las etiquetas a todo el ancho a 6 pt de las
/// cifras. El miniperfil ocupa la banda inferior.
///
/// Superficie neutra: el color de la carrera solo marca el avance de una
/// jornada en directo (perfil recorrido o, sin perfil, relleno del 8 % hasta el
/// porcentaje de avance). Las destacadas no tienen diseño propio.
struct RaceCardView: View {
    let item: EnrichedRaceDay
    /// Fuerza la evaluación con datos nuevos conservando la identidad de la tarjeta.
    var refreshToken: Int = 0
    /// Filtro activo de Hoy; permite ocultar redundancias femeninas en Femenino/WWT.
    var activeFilter: Constants.CategoryFilter = .all
    /// Llamada cuando el usuario pulsa el icono de resultados (trofeo).
    /// Nil = no mostrar botón de resultados.
    var onShowResults: (() -> Void)? = nil
    /// Llamada cuando el usuario pulsa el icono de Revive (TV).
    /// Nil = no mostrar botón de Revive.
    var onRevive: (() -> Void)? = nil
    /// Llamada cuando el usuario pulsa la etiqueta de dorsales. Nil = sin
    /// etiqueta. Solo se renderiza además si `race.startlistImportedAt` no es nulo.
    var onShowStartlist: (() -> Void)? = nil
    /// Llamada cuando el usuario pulsa la etiqueta «Orden de salida» en CRI/CRE.
    /// Abre la vista nativa de orden de salida desde el caller.
    var onStartOrderTap: (() -> Void)? = nil
    /// Acceso directo a Competición para vueltas con más de una jornada.
    var onShowCompetition: (() -> Void)? = nil
    /// True si es la etapa final de la vuelta.
    var isFinalStage: Bool = false
    var showsFinishTimeOnly: Bool = false
    var isWaitingForResults: Bool = false

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
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

    /// Teléfono: etiquetas de dorsales y orden de salida solo con icono y
    /// miniperfil de 36 pt. Pantallas anchas (iPad): con texto y 58 pt.
    private var isPhone: Bool { horizontalSizeClass != .regular }

    /// URL de live texto (asset tipo live_text).
    private var liveTextUrl: String? {
        item.assets.first(where: { $0.type == "live_text" })?.url
    }

    /// True si la jornada es CRI/CRE y tiene asset startOrder publicado.
    /// La etiqueta usa este flag para decidir si renderizarse; la navegación es nativa.
    private var hasStartOrder: Bool {
        guard !rd.isCancelledDay else { return false }
        guard isTimeTrial else { return false }
        return item.assets.contains(where: { $0.type == "startOrder" })
    }

    /// Cifras de la jornada: etapa · distancia · desnivel. Las partes ausentes
    /// se omiten; la etapa y la distancia van en el color de texto principal y
    /// seminegrita, como `.race-card__stage` y `.race-card__km` de la web.
    private var metricsText: Text? {
        let separator = Text(" · ")
        var result: Text? = nil
        func append(_ part: Text) {
            result = result.map { $0 + separator + part } ?? part
        }
        if !rd.stageLabel.isEmpty {
            let label = isFinalStage ? "\(rd.stageLabel) (Final)" : rd.stageLabel
            append(Text(label).fontWeight(.semibold).foregroundStyle(Color.primary))
        }
        if let dist = rd.distanceFormatted, !dist.isEmpty {
            append(Text(dist).fontWeight(.semibold).foregroundStyle(Color.primary))
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

    /// True cuando estamos en modo terminado (mostrar iconos en lugar de horario).
    private var isFinishedMode: Bool { onShowResults != nil || onRevive != nil }
    private var isTimeTrial: Bool { rd.primaryType == "itt" || rd.primaryType == "ttt" }

    /// True si la jornada tiene perfil de elevación cargado. Feature liberada
    /// al plan gratuito: gateada por `premium.featuresUnlocked` (siempre
    /// visible), no por la suscripción.
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
        // Crono de etapa única: el orden de salida sustituye a los dorsales.
        if isTimeTrial, race?.isStageRace != true { return false }
        return true
    }

    /// Las etiquetas de enlace (TV, dorsales, orden de salida) solo mientras la
    /// jornada no ha terminado ni espera resultados (paridad con la web).
    private var showsLinkBadges: Bool { !isFinishedMode && !isWaitingForResults }

    /// Tipo de etapa: CRI/CRE y cronoescalada siempre; el resto solo sin
    /// miniperfil (la silueta ya comunica el carácter de la etapa).
    /// Etiqueta de tipo solo en contrarreloj (CRI, CRE y cronoescalada), como
    /// la web: el resto de tipos no lleva etiqueta, haya o no miniperfil.
    private var showsStageType: Bool {
        !rd.isCancelledDay && (isTimeTrial || rd.secondaryType == "chrono_climb")
    }

    /// Altura de la banda del miniperfil: 36 pt en teléfono y 58 pt en
    /// pantallas anchas, como `.race-card__profile` de la web.
    private var miniProfileBandHeight: CGFloat { isPhone ? 36 : 58 }

    /// Color de la carrera; sin color definido, el acento global.
    private var raceColor: Color {
        if let hex = race?.colorHex, !hex.isEmpty {
            return Color(hex: hex)
        }
        return .accentColor
    }

    /// Relleno de avance de la tarjeta: solo jornadas en directo sin miniperfil
    /// (con perfil, el avance lo marca la parte recorrida).
    private var showsLiveFill: Bool {
        !showsMiniProfile && !isFinishedMode && !isWaitingForResults
            && !rd.isRestDay && !rd.isCancelledDay && !isTimeTrial
    }

    /// Franja de perfil a sangre (edge-to-edge) al fondo de la tarjeta. Sin
    /// padding horizontal: la `CCCard` recorta las esquinas inferiores. El
    /// avance se recalcula cada minuto (`RaceLogic.profileProgress`).
    private func miniProfileBand(_ profile: ElevationProfile) -> some View {
        TimelineView(.everyMinute) { context in
            MiniElevationProfile(
                profile: profile,
                summits: rd.profileSummits ?? [],
                waypoints: rd.profileWaypoints ?? [],
                tint: raceColor,
                height: miniProfileBandHeight,
                primaryType: rd.primaryType,
                fixedProgress: RaceLogic.profileProgress(
                    rd: rd,
                    hasInhouseResults: isFinishedMode,
                    now: context.date
                )
            )
        }
    }

    /// Relleno del 8 % del color de la carrera desde la izquierda hasta el
    /// porcentaje de avance; nada antes de la salida ni tras la meta.
    @ViewBuilder
    private var liveFill: some View {
        if showsLiveFill {
            TimelineView(.everyMinute) { context in
                let progress = RaceLogic.profileProgress(rd: rd, hasInhouseResults: false, now: context.date)
                GeometryReader { geo in
                    if progress > 0, progress < 1 {
                        Rectangle()
                            .fill(raceColor.opacity(0.08))
                            .frame(width: geo.size.width * progress)
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private var startlistLabel: String {
        race?.startlistProvisional == true
            ? LocaleService.t("Lista provisional", "Provisional startlist")
            : LocaleService.t("Dorsales", "Startlist")
    }

    /// Etiqueta «Dorsales». Solo se muestra cuando `showsStartlistBadge`.
    @ViewBuilder
    private var startlistBadge: some View {
        if let onShowStartlist {
            Button {
                Haptics.play(.primaryAction)
                onShowStartlist()
            } label: {
                RaceActionLabel(label: startlistLabel, icon: "figure.outdoor.cycle", iconOnly: isPhone)
            }
            .buttonStyle(.plain)
        }
    }

    /// Etiqueta «Orden de salida» para CRI/CRE. Solo con asset startOrder.
    @ViewBuilder
    private var startOrderBadge: some View {
        if hasStartOrder {
            Button {
                Haptics.play(.primaryAction)
                onStartOrderTap?()
            } label: {
                RaceActionLabel(label: LocaleService.t("Orden de salida", "Start order"), icon: "timer", iconOnly: isPhone)
            }
            .buttonStyle(.plain)
        }
    }

    /// Etiqueta de jornada cancelada, con el mismo tratamiento que la web.
    private var cancelledDayBadge: some View {
        Text(LocaleService.t("Cancelada", "Cancelled"))
            .ccFont(.s12, weight: .semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(AppTheme.red)
            .background(AppTheme.red.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
            .accessibilityLabel(LocaleService.t("Jornada cancelada", "Cancelled stage"))
    }

    var body: some View {
        CCCard {
            VStack(spacing: 0) {
                Group {
                    if rd.isRestDay {
                        restDayLayout
                    } else if useVerticalLayout {
                        verticalLayout
                    } else {
                        standardLayout
                    }
                }
                .padding(.horizontal, isPhone ? 16 : 20)
                .padding(.top, isPhone ? 14 : 16)
                // Con banda de perfil, el contenido deja 12 pt sobre ella.
                .padding(.bottom, showsMiniProfile ? 12 : (isPhone ? 14 : 16))

                if showsMiniProfile, let profile = rd.elevationProfile {
                    miniProfileBand(profile)
                }
            }
            .background(alignment: .leading) { liveFill }
        }
        // Solo se atenúa la CARRERA cancelada (no se corre en absoluto). Una
        // JORNADA cancelada no: la etiqueta «Cancelada» ya lo dice y su ficha
        // (recorrido, perfil, documentación) sigue siendo accesible.
        .opacity(race?.isCancelled == true ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(AccessibilityRaceDescription.raceCardLabel(
            item: item,
            isWaitingForResults: isWaitingForResults
        ))
        .accessibilityInputLabels(raceInputLabels)
        // La tarjeta se anuncia como una sola unidad para evitar repetir toda
        // su composición visual. Los accesos secundarios se mantienen
        // disponibles para VoiceOver mediante acciones personalizadas.
        .accessibilityActions {
            if let onShowResults {
                Button(LocaleService.t("Resultados", "Results"), action: onShowResults)
            }
            if let onRevive {
                Button(LocaleService.t("Revive la carrera", "Relive the race"), action: onRevive)
            }
            if let onShowCompetition {
                Button(LocaleService.t("Ver competición", "View race"), action: onShowCompetition)
            }
            if showsStartlistBadge, showsLinkBadges, let onShowStartlist {
                Button(LocaleService.t("Ver inscritos", "View startlist"), action: onShowStartlist)
            }
            if hasStartOrder, showsLinkBadges, let onStartOrderTap {
                Button(LocaleService.t("Ver orden de salida", "View start order"), action: onStartOrderTap)
            }
        }
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

    // MARK: - Identidad (logotipo y bandera)

    private var showsFlag: Bool { race?.hideFlag != true || rd.countryCode != nil }
    private var hasLogo: Bool { race?.logoUrl.map { !$0.isEmpty } == true }

    /// Columna izquierda: logotipo en caja de lista con la bandera debajo; sin
    /// logotipo, solo la bandera (`cardLogoHtml` de la web).
    @ViewBuilder
    private var identityColumn: some View {
        if hasLogo || showsFlag {
            VStack(spacing: 4) {
                if hasLogo {
                    RaceLogo(race?.logoUrl, size: 32)
                }
                if showsFlag {
                    CountryFlag(countryCode: rd.countryCode ?? race?.countryCode)
                }
            }
            .frame(width: 32)
        }
    }

    /// Nombre de la carrera: pasa a dos líneas si hace falta, nunca se corta.
    private var nameRow: some View {
        HStack(alignment: .center, spacing: 6) {
            Text(displayRaceName)
                .ccFont(.s16, weight: .medium)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)

            competitionButton

            if showFemaleIndicator {
                Text("♀")
                    .ccFont(.s13)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(LocaleService.t("Carrera femenina", "Women's race"))
            }
        }
    }

    // MARK: - Rest day layout

    private var restDayLayout: some View {
        HStack(alignment: .top, spacing: 12) {
            identityColumn

            VStack(alignment: .leading, spacing: 2) {
                nameRow
                Label(LocaleService.t("Descanso", "Rest day"), systemImage: "moon.zzz")
                    .ccFont(.s13, weight: .semibold)
                    .foregroundStyle(.secondary)
                CategoryBadge(category: race?.uciCategory)
                    .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Standard layout

    private var standardLayout: some View {
        HStack(alignment: .top, spacing: 12) {
            identityColumn

            VStack(alignment: .leading, spacing: 0) {
                // Nombre y cifras a la izquierda; hora o accesos de jornada
                // terminada arriba a la derecha, alineados con la primera
                // línea del nombre.
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        nameRow
                        if let metrics = metricsText {
                            metrics
                                .ccFont(.s13)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    trailingColumn
                }

                badgesRow
                    .padding(.top, 6)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Etiquetas a todo el ancho bajo las cifras, en el orden de la web:
    /// Categoría → Cancelada → Tipo → TV → Dorsales → Orden de salida.
    private var badgesRow: some View {
        FlowLayout(spacing: 6) {
            CategoryBadge(category: race?.uciCategory)
            if rd.isCancelledDay {
                cancelledDayBadge
            } else if showsStageType {
                StageTypeBadge(primaryType: rd.primaryType, secondaryType: rd.secondaryType, countryCode: rd.countryCode ?? race?.countryCode)
            }
            if showsLinkBadges {
                // Una jornada cancelada no se emite: ni TV ni Live texto
                // (no hay nada que seguir). Paridad con la web y Android.
                if !rd.isCancelledDay {
                    TVBadge(tvStatus: rd.tvStatus, broadcasts: item.broadcasts, neutralStartTimeUtc: rd.neutralStartTimeUtc, liveTextUrl: liveTextUrl)
                }
                if showsStartlistBadge {
                    startlistBadge
                }
                startOrderBadge
            }
        }
    }

    /// Esquina superior derecha: accesos de jornada terminada, espera de
    /// resultados u horario.
    @ViewBuilder
    private var trailingColumn: some View {
        if isFinishedMode {
            finishedIcons
        } else if isWaitingForResults {
            WaitingResultsLabel()
        } else {
            scheduleColumn
        }
    }

    // MARK: - Horario

    /// Rótulo (Salida/Meta/Inicio/Final) apilado sobre la hora.
    @ViewBuilder
    private var scheduleColumn: some View {
        // Cancelada → sin horario: la etapa no se corre (paridad con la web).
        if !rd.isCancelledDay {
            if showsFinishTimeOnly,
               let finishTime = rd.estimatedFinishTimeUtc,
               let finishStr = DateFormatting.formatTimeLocal(finishTime) {
                scheduleStack(label: finishLabel, value: "~\(finishStr)")
            } else if let startTime = rd.neutralStartTimeUtc,
                      let startStr = DateFormatting.formatTimeLocal(startTime) {
                scheduleStack(label: startLabel, value: startStr)
            } else if let finishTime = rd.estimatedFinishTimeUtc,
                      let finishStr = DateFormatting.formatTimeLocal(finishTime) {
                scheduleStack(label: finishLabel, value: "~\(finishStr)")
            }
        }
    }

    private var startLabel: String {
        isTimeTrial ? LocaleService.t("Inicio", "Start") : LocaleService.t("Salida", "Start")
    }

    private var finishLabel: String {
        isTimeTrial ? LocaleService.t("Final", "End") : LocaleService.t("Meta", "Finish")
    }

    private func scheduleStack(label: String, value: String) -> some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text(label)
                .ccFont(.s12)
                .foregroundStyle(.secondary)
            Text(value)
                .ccFont(isPhone ? .s14 : .s16, weight: .semibold)
                .monospacedDigit()
                .foregroundStyle(.primary)
        }
        .fixedSize()
    }

    @ViewBuilder
    private var competitionButton: some View {
        if let onShowCompetition {
            Button {
                Haptics.play(.navigation)
                onShowCompetition()
            } label: {
                RaceCompetitionLabel()
            }
            .buttonStyle(.plain)
            .accessibilityLabel(LocaleService.t("Ver competición", "View race"))
        }
    }

    // MARK: - Iconos de resultados/revive (modo terminado)

    /// Copa y TV juntas arriba a la derecha. El glifo queda alineado con la
    /// primera línea del nombre; el área táctil se extiende hacia abajo.
    private var finishedIcons: some View {
        HStack(spacing: 0) {
            if let onShowResults {
                finishedIcon("trophy", label: LocaleService.t("Resultados", "Results"), action: onShowResults)
            }
            if let onRevive {
                finishedIcon("tv", label: LocaleService.t("Revive la carrera", "Relive the race"), action: onRevive)
            }
        }
        .padding(.trailing, -6)
    }

    private func finishedIcon(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(label, systemImage: symbol)
                .labelStyle(.iconOnly)
                .font(.system(size: isPhone ? 17 : 20))
                .foregroundStyle(.secondary)
                .frame(width: 36, height: 40, alignment: .top)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Vertical layout for large Dynamic Type

    private var verticalLayout: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 12) {
                identityColumn
                nameRow
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let metrics = metricsText {
                metrics
                    .ccFont(.s13)
                    .foregroundStyle(.secondary)
            }

            trailingColumn

            badgesRow
        }
    }
}

/// Acceso a la competición junto al nombre (`.race-card__overview-btn` de la
/// web): glifo atenuado sobre la superficie neutra, radio 4.
struct RaceCompetitionLabel: View {
    var body: some View {
        Image(systemName: "line.3.horizontal")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(width: 20, height: 20)
            .background(AppTheme.neutralFill)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
            .contentShape(Rectangle())
    }
}

struct RaceCompetitionIdentity: View {
    let name: String
    let logoUrl: String?
    let countryCode: String?
    var hideFlag = false
    var originalName: String? = nil
    var showFemale = false
    var body: some View {
        HStack(spacing: 12) {
            RaceLogo(logoUrl, size: 48)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if !hideFlag { CountryFlag(countryCode: countryCode) }
                    Text(name).font(.title3).fontWeight(.bold)
                    if showFemale { Text("♀").foregroundStyle(AppTheme.green).accessibilityLabel("Carrera femenina") }
                }
                if let originalName { Text(originalName).font(.subheadline).foregroundStyle(.secondary) }
            }
            Spacer()
        }.accessibilityElement(children: .combine)
    }
}
