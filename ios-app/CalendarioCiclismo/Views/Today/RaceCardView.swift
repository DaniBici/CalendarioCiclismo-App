import SwiftUI

/// Tarjeta de carrera en la agenda del día (`buildCard` de js/app.js).
///
/// Estructura común a todos los anchos: columna de logotipo (con la bandera
/// debajo) a la izquierda; a su derecha, el nombre (hasta dos líneas, nunca
/// cortado) con la hora o los accesos de jornada terminada arriba a la derecha,
/// la línea de cifras debajo y las etiquetas a todo el ancho a 6 pt de las
/// cifras. El miniperfil ocupa la banda inferior.
///
/// Altura única: todas las tarjetas miden lo que una tarjeta completa (nombre,
/// cifras, una fila de etiquetas y banda del miniperfil), tengan o no perfil,
/// cifras, etiquetas o botón de competición, como `--road-card-h` de la web. El
/// contenido se alinea arriba y el perfil queda anclado al pie. Nombre, cifras y
/// etiquetas ocupan una línea cada uno: las etiquetas que no caben se omiten.
///
/// Superficie neutra: el color de la carrera solo marca el avance de una
/// jornada en directo (perfil recorrido o, sin perfil, relleno del 8 % hasta el
/// porcentaje de avance). Las destacadas no tienen diseño propio.
struct RaceCardView: View {
    let item: EnrichedRaceDay
    /// Fuerza la evaluación con datos nuevos conservando la identidad de la tarjeta.
    var refreshToken: Int = 0
    /// Filtro activo de Hoy; permite ocultar redundancias femeninas en Femenino/WWT.
    /// Solo Femenino marcado en los filtros: sin sufijo femenino ni ♀.
    var femaleOnly = false
    /// Llamada cuando el usuario pulsa el icono de resultados (trofeo).
    /// Nil = no mostrar botón de resultados.
    var onShowResults: (() -> Void)? = nil
    /// Llamada cuando el usuario pulsa el icono de Revive (TV).
    /// Nil = no mostrar botón de Revive.
    var onRevive: (() -> Void)? = nil
    /// Abre la jornada en su panel Vídeos. Con `onRevive`, el botón de TV es un
    /// menú «Vídeos» / «Completa». Nil = sin vídeos propios.
    var onShowVideos: (() -> Void)? = nil
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
    private var isFemaleFilterActive: Bool { femaleOnly }
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

    /// Teléfono: miniperfil de 36 pt. Pantallas anchas (iPad): 58 pt.
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
    private var isFinishedMode: Bool { onShowResults != nil || onRevive != nil || onShowVideos != nil }
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
                ),
                timeHatch: RaceLogic.profileUsesTimeHatch(rd: rd, hasInhouseResults: isFinishedMode)
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
                RaceActionLabel(label: startlistLabel, icon: LogoCyclistIcon.name)
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
                RaceActionLabel(label: LocaleService.t("Orden de salida", "Start order"), icon: "timer")
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
            // La plantilla fija el alto mínimo de todas las tarjetas; el
            // contenido recibe ese alto y ancla el miniperfil al pie.
            RaceCardMinHeightLayout {
                heightTemplate

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

                    // Con el alto único, o en una fila de dos tarjetas estiradas
                    // al alto de la más alta, el miniperfil queda anclado al pie.
                    Spacer(minLength: 0)

                    if showsMiniProfile, let profile = rd.elevationProfile {
                        miniProfileBand(profile)
                    }
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
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
            if let onShowVideos {
                Button(LocaleService.t("Vídeos", "Videos"), action: onShowVideos)
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
        race.map { [$0.localizedName] } ?? []
    }

    // MARK: - Altura única

    /// Alto mínimo de la fila del nombre: el del botón de competición (20 pt),
    /// igual con y sin él, para que las cifras y las etiquetas queden a la misma
    /// altura en todas las tarjetas (`.race-card__name` de la web).
    private static let nameRowMinHeight: CGFloat = 20

    /// Plantilla invisible de una tarjeta completa: relleno superior, nombre,
    /// cifras, una fila de etiquetas (la de icono y texto, la más alta), 12 pt
    /// sobre la banda y la banda del miniperfil. `RaceCardMinHeightLayout` la
    /// mide con las mismas fuentes que la tarjeta, así que el alto sigue el
    /// tamaño de letra. Al cambiar el relleno, las separaciones o las fuentes
    /// del contenido, cambiarlos aquí.
    private var heightTemplate: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: "Ag")
                .ccFont(.s16, weight: .medium)
                .lineLimit(1)
                .frame(minHeight: Self.nameRowMinHeight)
            // Cifras o, en un descanso, su rótulo con icono: la más alta de las dos.
            ZStack(alignment: .leading) {
                Text(verbatim: "Ag")
                    .ccFont(.s13)
                    .lineLimit(1)
                Label { Text(verbatim: "Ag") } icon: { Image(systemName: "moon.zzz") }
                    .ccFont(.s13, weight: .semibold)
                    .lineLimit(1)
            }
            .padding(.top, 2)
            RaceActionLabel(label: "Ag", icon: "tv")
                .padding(.top, 6)
            Color.clear.frame(height: 12 + miniProfileBandHeight)
        }
        .padding(.top, isPhone ? 14 : 16)
        .hidden()
        .accessibilityHidden(true)
    }

    // MARK: - Identidad (logotipo y bandera)

    private var showsFlag: Bool { race?.hideFlag != true || rd.countryCode != nil }
    private var hasLogo: Bool { race?.logoUrl.map { !$0.isEmpty } == true }
    /// Sin logo, hueco de la marca salvo en los Campeonatos Nacionales.
    private var showsLogoSlot: Bool { hasLogo || (race != nil && race?.uciCategory != "CN") }

    /// Columna izquierda: logotipo en caja de lista con la bandera debajo; sin
    /// logotipo, solo la bandera (`cardLogoHtml` de la web).
    @ViewBuilder
    private var identityColumn: some View {
        if showsLogoSlot || showsFlag {
            VStack(spacing: 4) {
                if showsLogoSlot {
                    RaceLogo(race?.logoUrl, size: 32, placeholder: true)
                }
                if showsFlag {
                    CountryFlag(countryCode: rd.countryCode ?? race?.countryCode, outlined: true)
                }
            }
            .frame(width: 32)
        }
    }

    /// Nombre de la carrera en una línea; se recorta con puntos suspensivos.
    private var nameRow: some View {
        HStack(alignment: .center, spacing: 6) {
            Text(displayRaceName)
                .ccFont(.s16, weight: .medium)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .truncationMode(.tail)

            competitionButton
                .layoutPriority(1)

            if showFemaleIndicator {
                Text("♀")
                    .ccFont(.s13)
                    .foregroundStyle(.secondary)
                    .layoutPriority(1)
                    .accessibilityLabel(LocaleService.t("Carrera femenina", "Women's race"))
            }
        }
        .frame(minHeight: Self.nameRowMinHeight)
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

            // Nombre y cifras a la izquierda; hora o accesos de jornada
            // terminada arriba a la derecha, alineados con la primera línea
            // del nombre; etiquetas a 6 pt de las cifras.
            RaceCardHeaderLayout {
                VStack(alignment: .leading, spacing: 2) {
                    nameRow
                    if let metrics = metricsText {
                        metrics
                            .ccFont(.s13)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .layoutValue(key: RaceCardHeaderLayout.RoleKey.self, value: .main)

                trailingColumn
                    .layoutValue(key: RaceCardHeaderLayout.RoleKey.self, value: .trailing)

                badges
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Etiquetas a todo el ancho (disposición vertical de Dynamic Type grande).
    private var badgesRow: some View {
        FlowLayout(spacing: 6) {
            badges
        }
    }

    /// Etiquetas en el orden de la web: Categoría → Cancelada → Tipo → TV →
    /// Dorsales → Orden de salida.
    @ViewBuilder
    private var badges: some View {
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
                scheduleStack(label: finishLabel, value: "~\(finishStr)", day: otherDay(finishTime))
            } else if let startTime = rd.neutralStartTimeUtc,
                      let startStr = DateFormatting.formatTimeLocal(startTime) {
                scheduleStack(label: startLabel, value: startStr, day: otherDay(startTime))
            } else if let finishTime = rd.estimatedFinishTimeUtc,
                      let finishStr = DateFormatting.formatTimeLocal(finishTime) {
                scheduleStack(label: finishLabel, value: "~\(finishStr)", day: otherDay(finishTime))
            }
        }
    }

    private var startLabel: String {
        isTimeTrial ? LocaleService.t("Inicio", "Start") : LocaleService.t("Salida", "Start")
    }

    private var finishLabel: String {
        isTimeTrial ? LocaleService.t("Final", "End") : LocaleService.t("Meta", "Finish")
    }

    /// Día de la hora cuando cae en otra fecha que la jornada ("sáb.").
    private func otherDay(_ isoString: String) -> String? {
        DateFormatting.otherDayLabel(isoString, dateKey: rd.dateKey)
    }

    private func scheduleStack(label: String, value: String, day: String?) -> some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text(label)
                .ccFont(.s12)
                .foregroundStyle(.secondary)
            Text(value)
                .ccFont(isPhone ? .s14 : .s16, weight: .semibold)
                .monospacedDigit()
                .foregroundStyle(.primary)
            if let day {
                Text("(\(day))")
                    .ccFont(.s12)
                    .foregroundStyle(.secondary)
            }
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
            FinishedVideoAction(onShowVideos: onShowVideos, onRevive: onRevive,
                                font: .system(size: isPhone ? 17 : 20), size: CGSize(width: 36, height: 40), alignment: .top)
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
    /// Línea bajo el nombre, en la columna principal junto al logo: número de
    /// rondas de un torneo de ciclocross; categoría, etapas y fechas de una
    /// competición de carretera.
    var detail: AnyView? = nil
    var showFemale = false
    /// Sin logo, hueco de la marca (no en los Campeonatos Nacionales).
    var logoPlaceholder = false
    private var showsLogo: Bool { (logoUrl?.isEmpty == false) || logoPlaceholder }
    /// Alto de la columna del logo con la bandera debajo (48 + 4 + 15): el bloque de
    /// texto de la derecha se centra en vertical respecto a ella mientras quepa.
    private var leadingColumnHeight: CGFloat {
        let flag: CGFloat = hideFlag ? 0 : 15
        return (showsLogo ? 48 : 0) + (showsLogo && !hideFlag ? 4 : 0) + flag
    }
    /// Nombre con el símbolo femenino al final del mismo texto: no resta un hueco aparte
    /// al nombre ni lo desplaza. El símbolo va en color secundario, como en Hoy, Últimos
    /// resultados, Android y la web.
    private var nameText: Text {
        let title = Text(name).font(.title3).fontWeight(.bold)
        guard showFemale else { return title }
        return title + Text(" ♀").font(.subheadline).foregroundStyle(.secondary)
    }
    var body: some View {
        // Logo y bandera arriba aunque el nombre ocupe varias líneas, como en
        // las tarjetas de Hoy de Ciclocross. Con el bloque de texto más bajo que
        // la columna del logo y la bandera, se centra en vertical respecto a ella.
        HStack(alignment: .top, spacing: 12) {
            // Logo con la bandera debajo, como las tarjetas de Hoy: con letra grande
            // la bandera no resta ancho al nombre.
            VStack(spacing: 4) {
                RaceLogo(logoUrl, size: 48, placeholder: logoPlaceholder)
                if !hideFlag { CountryFlag(countryCode: countryCode) }
            }
            VStack(alignment: .leading, spacing: 4) {
                nameText.lineLimit(3).truncationMode(.tail)
                    .accessibilityLabel(showFemale ? "\(name), \(LocaleService.t("carrera femenina", "women's race"))" : name)
                if let originalName { Text(originalName).font(.subheadline).foregroundStyle(.secondary) }
                if let detail { detail.font(.subheadline).foregroundStyle(.secondary) }
            }
            .frame(minHeight: leadingColumnHeight, alignment: .leading)
            Spacer()
        }.accessibilityElement(children: .combine)
    }
}

/// Cabecera de la tarjeta de Hoy: nombre y cifras (`.main`) a la izquierda,
/// horario o accesos (`.trailing`) arriba a la derecha y las etiquetas en una
/// sola línea a 6 pt de las cifras: la etiqueta que no cabe, y las que la
/// siguen, se omiten para que todas las tarjetas midan lo mismo. Cuando el
/// horario es más alto que las cifras («(sáb.)» bajo la hora), la línea de
/// etiquetas, que empieza a su altura, dispone solo del ancho de las cifras.
/// Mismo reparto que `RaceCardHeader` en Android.
private struct RaceCardHeaderLayout: Layout {
    enum Role { case main, trailing, badge }

    struct RoleKey: LayoutValueKey {
        static let defaultValue = Role.badge
    }

    var columnSpacing: CGFloat = 12
    var badgesTop: CGFloat = 6
    var badgeSpacing: CGFloat = 6
    /// Posición de las etiquetas omitidas: lejos de cualquier tarjeta visible.
    private static let hiddenOrigin = CGPoint(x: -10_000, y: -10_000)

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, frame) in result.frames.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrange(width: CGFloat?, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var frames = Array(repeating: CGRect.zero, count: subviews.count)
        let mainIndex = subviews.firstIndex { $0[RoleKey.self] == .main }
        let trailingIndex = subviews.firstIndex { $0[RoleKey.self] == .trailing }
        let trailingSize = trailingIndex.map { subviews[$0].sizeThatFits(.unspecified) } ?? .zero
        let reserved = trailingSize.width > 0 ? trailingSize.width + columnSpacing : 0
        let totalWidth: CGFloat
        if let width, width.isFinite {
            totalWidth = width
        } else {
            totalWidth = (mainIndex.map { subviews[$0].sizeThatFits(.unspecified).width } ?? 0) + reserved
        }
        let mainWidth = max(0, totalWidth - reserved)

        var mainHeight: CGFloat = 0
        if let mainIndex {
            mainHeight = subviews[mainIndex].sizeThatFits(ProposedViewSize(width: mainWidth, height: nil)).height
            frames[mainIndex] = CGRect(x: 0, y: 0, width: mainWidth, height: mainHeight)
        }
        if let trailingIndex {
            frames[trailingIndex] = CGRect(origin: CGPoint(x: totalWidth - trailingSize.width, y: 0), size: trailingSize)
        }

        // Etiquetas en una sola línea, centradas en vertical. Una línea que
        // empieza a la altura del horario dispone solo del ancho de las cifras.
        // Las omitidas se colocan fuera de la tarjeta, que recorta su contenido,
        // y no suman altura.
        var x: CGFloat = 0
        var y = mainHeight + badgesTop
        var rowHeight: CGFloat = 0
        var row: [Int] = []
        var overflowed = false
        func available() -> CGFloat { y < trailingSize.height ? mainWidth : totalWidth }
        for index in subviews.indices where subviews[index][RoleKey.self] == .badge {
            let size = subviews[index].sizeThatFits(.unspecified)
            guard size.width > 0 || size.height > 0 else { continue }
            if x > 0 && x + size.width > available() { overflowed = true }
            if overflowed {
                frames[index] = CGRect(origin: Self.hiddenOrigin, size: size)
                continue
            }
            // Etiqueta que no cabe junto al horario: la línea empieza bajo él.
            if x == 0 && size.width > available() && y < trailingSize.height {
                y = trailingSize.height + badgeSpacing
            }
            frames[index] = CGRect(origin: CGPoint(x: x, y: y), size: size)
            row.append(index)
            rowHeight = max(rowHeight, size.height)
            x += size.width + badgeSpacing
        }
        for i in row { frames[i].origin.y = y + (rowHeight - frames[i].height) / 2 }

        let height = max(trailingSize.height, mainHeight, y + rowHeight)
        return (CGSize(width: totalWidth, height: height), frames)
    }
}

/// Contenedor de la tarjeta de Hoy con el alto de una tarjeta completa como
/// mínimo. El primer subview es la plantilla invisible, que solo se mide; el
/// segundo, el contenido, que recibe el alto resultante para anclar el
/// miniperfil al pie.
private struct RaceCardMinHeightLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard subviews.count == 2 else { return .zero }
        let content = subviews[1].sizeThatFits(proposal)
        let template = subviews[0].sizeThatFits(ProposedViewSize(width: content.width, height: nil))
        return CGSize(width: content.width, height: max(content.height, template.height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        subviews[0].place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: nil))
        subviews[1].place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
    }
}
