import SwiftUI

// Componentes de la pantalla de resultados — espejo de `ResultsComposables.kt`
// (Android), que a su vez replica `js/resultados.js` (web).

// ── Etiqueta de la pestaña de clasificación ────────────────────────

func resultsClassLabel(_ classKind: String) -> String {
    switch classKind {
    case "gc": return LocaleService.t("General", "GC")
    case "points": return LocaleService.t("Puntos", "Points")
    case "kom": return LocaleService.t("Montaña", "KOM")
    case "youth": return LocaleService.t("Jóvenes", "Youth")
    case "teams": return LocaleService.t("Equipos", "Teams")
    default: return LocaleService.t("Etapa", "Stage")   // "stage" y fallback
    }
}

/// Header simple para clasificación final / carrera de un día sin raceDay.
struct ResultsPlainHeader: View {
    let race: Race

    var body: some View {
        HStack(spacing: 8) {
            if let cc = race.countryCode, !cc.isEmpty {
                CountryFlag(countryCode: cc)
            }
            Text(race.localizedName)
                .font(.headline)
                .lineLimit(2)
            Spacer()
            RaceLogo(race.logoUrl, size: 36)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCardSurface()
    }
}

/// Selector de etapa: P · 1 · 2 · … · F (cápsulas, estética canónica).
struct ResultsStageSelector: View {
    let stageKeys: [String]
    let activeKey: String?
    let onSelect: (String) -> Void
    var labelForKey: ((String) -> String)? = nil
    var subtitleForKey: ((String) -> String)? = nil
    var accessibilityLabelForKey: ((String) -> String)? = nil
    var dateNavigationStyle = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(stageKeys, id: \.self) { key in
                        // "final"→F · "0"→P · "3"/"3A" → el número con su sufijo de sector.
                        let label: String = {
                            if let labelForKey { return labelForKey(key) }
                            if key == "final" { return LocaleService.t("F", "F") }
                            let p = UciResultsLogic.parseResultStageKey(key)
                            if p.stageNumber == 0 { return "P" }
                            return "\(p.stageNumber.map(String.init) ?? "")\(p.suffix)"
                        }()
                        let accessibilityLabel: String = {
                            if let accessibilityLabelForKey { return accessibilityLabelForKey(key) }
                            if key == "final" {
                                return LocaleService.t("Clasificación final", "Final classification")
                            }
                            let p = UciResultsLogic.parseResultStageKey(key)
                            if p.stageNumber == 0 {
                                return LocaleService.t("Prólogo", "Prologue")
                            }
                            return LocaleService.t(
                                "Etapa \(p.stageNumber.map(String.init) ?? "")\(p.suffix)",
                                "Stage \(p.stageNumber.map(String.init) ?? "")\(p.suffix)"
                            )
                        }()
                        ResultsPill(
                            label: label,
                            selected: key == activeKey,
                            subtitle: subtitleForKey?(key),
                            accessibilityLabel: accessibilityLabel,
                            dateNavigationStyle: dateNavigationStyle
                        ) { onSelect(key) }
                            .id(key)
                    }
                }
            }
            // Autoscroll: en etapas avanzadas (p. ej. la 18 de un GT) la píldora
            // seleccionada queda fuera de pantalla; la traemos al centro al
            // aparecer y cada vez que cambia la etapa activa.
            .onAppear { scrollToActive(proxy, animated: false) }
            .onChange(of: activeKey) { _, _ in scrollToActive(proxy, animated: true) }
        }
    }

    private func scrollToActive(_ proxy: ScrollViewProxy, animated: Bool) {
        guard let key = activeKey else { return }
        if animated && !reduceMotion {
            withAnimation { proxy.scrollTo(key, anchor: .center) }
        } else {
            proxy.scrollTo(key, anchor: .center)
        }
    }
}

/// Deslizamiento lateral sobre una clasificación: pasa a la anterior o a la
/// siguiente de `options` con la transición de Hoy (el contenido sale por el
/// lado del gesto y el nuevo entra por el contrario). Ignora el borde
/// izquierdo (retroceso del sistema) y los gestos que empiezan en vertical.
private struct ClassificationSwipe: ViewModifier {
    let options: [String]
    let current: String?
    let onSelect: (String) -> Void

    @State private var offset: CGFloat = 0
    @State private var width: CGFloat = 0
    @State private var isAnimating = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .offset(x: offset)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .gesture(HorizontalSwipeRecognizer(isEnabled: !isAnimating && options.count > 1) { h in
                guard abs(h) > 60, let current, let index = options.firstIndex(of: current) else { return }
                let target = index + (h < 0 ? 1 : -1)
                guard options.indices.contains(target) else { return }
                Haptics.play(.selection)
                select(options[target], forward: h < 0)
            })
    }

    private func select(_ key: String, forward: Bool) {
        guard !reduceMotion, width > 0 else { onSelect(key); return }
        isAnimating = true
        let outDirection: CGFloat = forward ? -1 : 1
        withAnimation(.easeOut(duration: 0.15)) { offset = outDirection * width }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            onSelect(key)
            offset = -outDirection * width
            withAnimation(.easeOut(duration: 0.2)) { offset = 0 }
            try? await Task.sleep(for: .milliseconds(200))
            isAnimating = false
        }
    }
}

/// Arrastre horizontal resuelto en UIKit. El eje se decide al empezar: un
/// arrastre vertical hace fallar el reconocedor y el `ScrollView` que contiene
/// la clasificación se desplaza sin competencia; uno horizontal impide el
/// desplazamiento vertical mientras dura. Con un `DragGesture` simultáneo, la
/// lista se movía en vertical durante el deslizamiento y un desplazamiento
/// vertical con componente lateral cambiaba de clasificación.
private struct HorizontalSwipeRecognizer: UIGestureRecognizerRepresentable {
    let isEnabled: Bool
    let onEnded: (CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let recognizer = UIPanGestureRecognizer()
        recognizer.delegate = context.coordinator
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        recognizer.isEnabled = isEnabled
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        guard recognizer.state == .ended else { return }
        onEnded(recognizer.translation(in: recognizer.view).x)
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return false }
            let translation = pan.translation(in: pan.view)
            let startX = pan.location(in: nil).x - translation.x
            return startX > 24 && abs(translation.x) > abs(translation.y) * 1.5
        }

        /// El desplazamiento vertical espera a que este reconocedor falle. Los
        /// carriles horizontales (selector de etapas, rondas) no esperan.
        func gestureRecognizer(
            _ recognizer: UIGestureRecognizer,
            shouldBeRequiredToFailBy other: UIGestureRecognizer
        ) -> Bool {
            guard let scrollView = other.view as? UIScrollView,
                  other === scrollView.panGestureRecognizer else { return false }
            return scrollView.contentSize.width <= scrollView.bounds.width + 1
        }
    }
}

extension View {
    func classificationSwipe(options: [String], current: String?, onSelect: @escaping (String) -> Void) -> some View {
        modifier(ClassificationSwipe(options: options, current: current, onSelect: onSelect))
    }
}

/// Barra de pestañas de clasificación + menú de filtro por equipo.
struct ResultsClassTabsBar: View {
    let stages: [RaceUciStage]
    let classificationConfig: [RaceClassificationConfig]
    let activeClassKind: String
    let teamsAvailable: [String]
    let selectedTeam: String?
    let onSelectClass: (String) -> Void
    let onSelectTeam: (String?) -> Void

    var body: some View {
        HStack(spacing: 6) {
            if stages.count > 1 {
                ResultsScrollRail(height: 44, spacing: 6, scrollTarget: AnyHashable(activeClassKind)) {
                    ForEach(stages) { st in
                        let config = classificationConfig.first { $0.classKind == st.classKind }
                        let tint = UciResultsLogic.classificationColor(config).map { Color(hex: $0) }
                        ResultsClassificationTab(
                            label: config.map { UciResultsLogic.classificationLabel($0, isEn: LocaleService.shouldShowEnglishContent) }
                                ?? resultsClassLabel(st.classKind),
                            selected: st.classKind == activeClassKind,
                            tint: tint
                        ) { onSelectClass(st.classKind) }
                        .id(st.classKind)
                    }
                }
            } else {
                Spacer()
            }

            // Filtro por equipo (solo si hay ≥2 equipos en la clasificación),
            // separado de las pestañas por un divisor vertical.
            if teamsAvailable.count >= 2 {
                if stages.count > 1 {
                    Divider().frame(height: 22)
                }
                let allLabel = LocaleService.t("Todos los equipos", "All teams")
                Menu {
                    Button(allLabel) { onSelectTeam(nil) }
                    ForEach(teamsAvailable, id: \.self) { tn in
                        Button(tn) { onSelectTeam(tn) }
                    }
                } label: {
                    HStack(spacing: 2) {
                        Text(selectedTeam ?? allLabel)
                            .font(.caption)
                            .lineLimit(1)
                            .frame(maxWidth: 140)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .padding(.horizontal, 10)
                    .frame(minHeight: 44)
                    .background(AppTheme.cardBackgroundHover)
                    .foregroundStyle(Color(.secondaryLabel))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(AppTheme.border, lineWidth: 1)
                    }
                }
                .accessibilityLabel(LocaleService.t("Filtrar por equipo", "Filter by team"))
                .accessibilityValue(selectedTeam ?? allLabel)
            }
        }
    }
}

/// Carril horizontal con zonas de flecha independientes, como el componente
/// web `cc-scroll-arrow`. Las flechas aparecen únicamente cuando hay desborde y
/// permanecen en los extremos sin tapar el contenido.
struct ResultsScrollRail<Content: View>: View {
    let height: CGFloat
    let spacing: CGFloat
    var framed = false
    /// Elemento que debe quedar a la vista (p. ej. la pestaña activa tras
    /// cambiarla con un deslizamiento).
    var scrollTarget: AnyHashable? = nil
    let content: Content

    @State private var metrics = Metrics()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Edge: Hashable { case leading, trailing }
    private struct Metrics: Equatable {
        var overflows = false
        var atStart = true
        var atEnd = true
    }

    init(
        height: CGFloat,
        spacing: CGFloat,
        framed: Bool = false,
        scrollTarget: AnyHashable? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.height = height
        self.spacing = spacing
        self.framed = framed
        self.scrollTarget = scrollTarget
        self.content = content()
    }

    var body: some View {
        ScrollViewReader { proxy in
            HStack(spacing: 0) {
                if metrics.overflows {
                    arrow(forward: false, enabled: !metrics.atStart) {
                        if reduceMotion {
                            proxy.scrollTo(Edge.leading, anchor: .leading)
                        } else {
                            withAnimation(.smooth) { proxy.scrollTo(Edge.leading, anchor: .leading) }
                        }
                    }
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: spacing) {
                        Color.clear.frame(width: 1, height: height).id(Edge.leading)
                        content
                        Color.clear.frame(width: 1, height: height).id(Edge.trailing)
                    }
                }
                .onScrollGeometryChange(for: Metrics.self) { geometry in
                    let maximum = max(0, geometry.contentSize.width - geometry.containerSize.width)
                    return Metrics(
                        overflows: maximum > 2,
                        atStart: geometry.contentOffset.x <= 1,
                        atEnd: geometry.contentOffset.x >= maximum - 1
                    )
                } action: { _, value in
                    metrics = value
                }
                .onChange(of: scrollTarget) { _, target in
                    guard let target else { return }
                    if reduceMotion {
                        proxy.scrollTo(target, anchor: .center)
                    } else {
                        withAnimation(.smooth) { proxy.scrollTo(target, anchor: .center) }
                    }
                }

                if metrics.overflows {
                    arrow(forward: true, enabled: !metrics.atEnd) {
                        if reduceMotion {
                            proxy.scrollTo(Edge.trailing, anchor: .trailing)
                        } else {
                            withAnimation(.smooth) { proxy.scrollTo(Edge.trailing, anchor: .trailing) }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(framed ? AppTheme.cardBackgroundHover : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: framed ? 8 : 0))
            .overlay {
                if framed {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(AppTheme.border, lineWidth: 1)
                }
            }
        }
    }

    private func arrow(forward: Bool, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: forward ? "chevron.right" : "chevron.left")
                .font(.system(size: 14, weight: .semibold))
                .frame(width: 44)
                .frame(maxHeight: .infinity)
                .background(Color.secondary.opacity(enabled ? 0.10 : 0.045))
                .contentShape(Rectangle())
                .overlay(alignment: forward ? .leading : .trailing) {
                    Rectangle().fill(AppTheme.border).frame(width: 1)
                }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.secondary.opacity(enabled ? 1 : 0.48))
        .disabled(!enabled)
        .accessibilityLabel(
            forward
                ? LocaleService.t("Más elementos", "More items")
                : LocaleService.t("Elementos anteriores", "Previous items")
        )
    }
}

/// Pestaña de clasificación alineada con la web 4.4: banda editorial superior,
/// superficie rectangular y subrayado de selección. El color solo aparece si
/// la clasificación lo declara; Etapa permanece neutra.
struct ResultsClassificationTab: View {
    let label: String
    let selected: Bool
    let tint: Color?
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 0) {
                Group {
                    if let tint {
                        tint
                    } else {
                        Color.clear
                    }
                }
                .frame(height: 3)
                .padding(.horizontal, 10)

                Text(label)
                    .font(.caption.weight(selected ? .bold : .semibold))
                    .foregroundStyle(selected ? Color.primary : Color.secondary)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 38)

                Rectangle()
                    .fill(selected ? Color.secondary.opacity(0.65) : Color.clear)
                    .frame(height: 3)
            }
            .background(selected ? AppTheme.cardBackgroundHover : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

/// Cápsula de filtro (igual estética que StartOrderFilterBar / chips de Hoy).
private struct ResultsPill: View {
    let label: String
    let selected: Bool
    var subtitle: String? = nil
    var tint: Color? = nil
    var accessibilityLabel: String? = nil
    var dateNavigationStyle = false
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            // Con subtítulo (selector de meses CX) el mando es el mes: línea
            // grande en color de texto; el año queda pequeño y atenuado.
            VStack(spacing: 1) {
                Text(label)
                    .font(subtitle == nil ? Font.caption : .subheadline)
                    .fontWeight(selected ? .semibold : subtitle == nil ? .regular : .medium)
                    .foregroundStyle(selected ? (tint ?? Color.accentColor)
                                     : subtitle == nil ? Color(.secondaryLabel) : Color.primary)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(selected ? (tint ?? Color.accentColor) : Color(.secondaryLabel))
                }
            }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(selected ? (tint ?? Color.accentColor).opacity(0.15) : dateNavigationStyle ? Color.clear : Color(.tertiarySystemBackground))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityLabel(accessibilityLabel ?? label)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

struct ResultsPublicationStatus: View {
    let stage: RaceUciStage
    let classificationLabel: String
    var showClassificationLabel = true

    private var isOfficial: Bool { stage.publicationStatus == "official" }

    var body: some View {
        HStack(spacing: 12) {
            if showClassificationLabel {
                Text(classificationLabel)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.primary)
            }
            Text(isOfficial
                 ? LocaleService.t("Oficial", "Official")
                 : LocaleService.t("Provisional", "Provisional"))
                .font(.caption)
                .foregroundStyle(.secondary)
            if !isOfficial, UciResultsLogic.classificationIsUpdating(stage) {
                HStack(spacing: 5) {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(.accentColor)
                        .accessibilityHidden(true)
                    Text(LocaleService.t("Actualizando", "Updating"))
                        .font(.caption.weight(.semibold))
                }
                .foregroundStyle(Color.accentColor)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.accentColor.opacity(0.12), in: Capsule())
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(LocaleService.t(
                    "Clasificación actualizándose",
                    "Classification updating"
                ))
            }
            if !isOfficial, let raw = stage.lastSyncedAt,
               let date = DateFormatting.parseISO(raw) {
                Text(LocaleService.t("Últ. act.", "Last upd.") + ": "
                     + date.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// ── Tabla de una clasificación ─────────────────────────────────────

/// Filas de una clasificación ya resueltas (corredores fuera de la startlist y
/// equipos con override). Compartidas entre la tabla visible y la precarga de
/// las clasificaciones contiguas, como los días vecinos de Hoy.
struct ResultsRowsBundle {
    let rows: [RaceUciResultRow]
    let byRider: [String: ResolvedRider]
    let byTeamOverride: [String: Team]
}

@MainActor
final class ResultsRowsCache {
    static let shared = ResultsRowsCache()
    private struct Entry { let bundle: ResultsRowsBundle; let token: Int; let savedAt: Date }
    private var entries: [String: Entry] = [:]
    private var inFlight: [String: Task<ResultsRowsBundle?, Never>] = [:]
    /// Una precarga reciente sirve sin volver a la red al entrar en la pestaña.
    private let freshness: TimeInterval = 120

    func cached(_ stageRef: String) -> ResultsRowsBundle? { entries[stageRef]?.bundle }

    /// Filas de la clasificación: de la caché si son recientes y del mismo
    /// token de recarga; si no, de la red (una sola petición por clasificación).
    func bundle(stageRef: String, token: Int, byDorsal: [Int: ResolvedRider], raceYear: Int?) async -> ResultsRowsBundle? {
        if let entry = entries[stageRef], entry.token == token, Date().timeIntervalSince(entry.savedAt) < freshness {
            return entry.bundle
        }
        if let task = inFlight[stageRef] { return await task.value }
        let task = Task { await Self.fetch(stageRef: stageRef, byDorsal: byDorsal, raceYear: raceYear) }
        inFlight[stageRef] = task
        let bundle = await task.value
        inFlight[stageRef] = nil
        if let bundle { entries[stageRef] = Entry(bundle: bundle, token: token, savedAt: Date()) }
        return bundle
    }

    private static func fetch(stageRef: String, byDorsal: [Int: ResolvedRider], raceYear: Int?) async -> ResultsRowsBundle? {
        guard let loaded = try? await SupabaseService.shared.loadResultRows(stageRef: stageRef) else { return nil }
        // Enriquecer por globalRiderId las filas que NO resuelven por dorsal
        // (no-op si todas casan → byRider queda vacío). Espejo de la llamada
        // a `enrichRiders` en `renderClassification` (web).
        let unmatchedIds = loaded
            .filter { $0.dorsalInt.flatMap { byDorsal[$0] } == nil }
            .compactMap(\.globalRiderId)
        var madridCalendar = Calendar(identifier: .gregorian)
        madridCalendar.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
        let currentMadridYear = madridCalendar.component(.year, from: Date())
        let enriched = unmatchedIds.isEmpty
            ? [:]
            : await SupabaseService.shared.enrichRidersByGlobalId(
                unmatchedIds,
                includeCurrentTeam: raceYear == currentMadridYear
            )
        // Override de equipo: resolver los teamId de override a su equipo canónico.
        let overrideIds = loaded.compactMap(\.teamId)
        let overrides = overrideIds.isEmpty
            ? [:]
            : await SupabaseService.shared.enrichTeamsByIds(overrideIds, year: raceYear)
        return ResultsRowsBundle(rows: loaded, byRider: enriched, byTeamOverride: overrides)
    }
}

/// Tabla de una clasificación. Carga las filas on-demand por stageRef, decide
/// individual vs CRE colapsada, y aplica el filtro por equipo (recalculando m.t.
/// sobre las filas visibles, como `applyTeamFilter` en la web).
struct ResultsTableView: View {
    let stage: RaceUciStage
    let byDorsal: [Int: ResolvedRider]
    let raceTeams: [Team]
    let raceDayPrimaryType: String?
    let raceYear: Int?
    let isOneDay: Bool
    let isEn: Bool
    let selectedTeam: String?
    /// Se incrementa en cada pull-to-refresh del padre; entra en la clave del
    /// `.task` para re-pedir las filas (sin él, el swipe-down no recargaba la
    /// clasificación visible porque `stage.id` no cambia).
    var reloadToken: Int = 0
    let onTeamsResolved: ([String]) -> Void

    @State private var rows: [RaceUciResultRow]?
    /// Fallback por globalRiderId para filas que no casan por dorsal. Solo el año
    /// vigente puede completar además el equipo actual.
    @State private var byRider: [String: ResolvedRider] = [:]
    /// Override MANUAL de equipo (mig. 112): teamId de la fila → equipo canónico.
    @State private var byTeamOverride: [String: Team] = [:]

    init(stage: RaceUciStage, byDorsal: [Int: ResolvedRider], raceTeams: [Team], raceDayPrimaryType: String?,
         raceYear: Int?, isOneDay: Bool, isEn: Bool, selectedTeam: String?, reloadToken: Int = 0,
         onTeamsResolved: @escaping ([String]) -> Void) {
        self.stage = stage
        self.byDorsal = byDorsal
        self.raceTeams = raceTeams
        self.raceDayPrimaryType = raceDayPrimaryType
        self.raceYear = raceYear
        self.isOneDay = isOneDay
        self.isEn = isEn
        self.selectedTeam = selectedTeam
        self.reloadToken = reloadToken
        self.onTeamsResolved = onTeamsResolved
        // Clasificación precargada: la tabla entra ya pintada, sin cargador.
        if let cached = ResultsRowsCache.shared.cached(stage.id) {
            _rows = State(initialValue: cached.rows)
            _byRider = State(initialValue: cached.byRider)
            _byTeamOverride = State(initialValue: cached.byTeamOverride)
        }
    }

    var body: some View {
        Group {
            if stage.isCancelledStage {
                // Etapa CANCELADA: la pestaña "Etapa" no tiene clasificación que
                // mostrar (la carrera no llegó a meta). En vez de una tabla vacía
                // ("sin datos", que se lee como un volcado que falta), el aviso
                // explica QUÉ pasó. Marcador sintético: no hay filas que pedir.
                cancelledStageNotice
            } else if let loaded = rows {
                if loaded.isEmpty {
                    Text(LocaleService.t("No hay datos para esta clasificación.", "No data for this classification."))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                } else {
                    VStack(spacing: 0) {
                        carriedStandingsNotice
                        table(loaded)
                    }
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(24)
            }
        }
        // Clave = etapa + token de recarga: re-pide las filas al cambiar de
        // etapa Y en cada pull-to-refresh. `rows` NO se resetea a nil aquí →
        // la tabla anterior permanece visible mientras recarga (sin parpadeo).
        .task(id: "\(stage.id)#\(reloadToken)") {
            // Marcador sintético de etapa cancelada: no hay filas que pedir.
            if stage.isCancelledStage { onTeamsResolved([]); return }
            guard let bundle = await ResultsRowsCache.shared.bundle(
                stageRef: stage.id, token: reloadToken, byDorsal: byDorsal, raceYear: raceYear
            ), !Task.isCancelled else { return }
            let loaded = bundle.rows, enriched = bundle.byRider, overrides = bundle.byTeamOverride
            byRider = enriched
            byTeamOverride = overrides
            rows = loaded
            // Equipos disponibles para el filtro (vacío en CRE / pestaña Equipos).
            let isTeams = stage.classKind == "teams"
            let isTtt = UciResultsLogic.isTttStage(
                rows: loaded, classKind: stage.classKind, isTeams: isTeams,
                raceDayPrimaryType: raceDayPrimaryType, stageNumber: stage.stageNumber, isOneDay: isOneDay,
                stageRaceType: stage.raceType
            )
            onTeamsResolved(
                (isTeams || isTtt) ? [] : UciResultsLogic.teamsInClass(rows: loaded, byDorsal: byDorsal, byRider: enriched, byTeamOverride: overrides)
            )
        }
    }

    /// Aviso de la pestaña "Etapa" de una jornada CANCELADA (no hay tabla: la
    /// carrera no llegó a meta). Mismo lenguaje que el banner de la ficha.
    /// Espejo de `.res-cancelled-note` (web) y de Android.
    private var cancelledStageNotice: some View {
        HStack(spacing: 6) {
            Image(systemName: "xmark.circle")
                .font(.caption)
                .accessibilityHidden(true)
            Text(LocaleService.t("Etapa cancelada", "Stage cancelled"))
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
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .accessibilityElement(children: .combine)
    }

    /// Aviso de general ARRASTRADA: en una etapa cancelada las generales que se
    /// ven son las de la etapa anterior (la carrera no se movió). Sin decirlo,
    /// una GC idéntica a la de ayer se lee como un volcado viejo o roto.
    @ViewBuilder
    private var carriedStandingsNotice: some View {
        if let fromNum = stage.carriedFromStage {
            let from = "\(fromNum)\(stage.carriedFromSuffix ?? "")"   // "3A" en dobles sectores
            HStack(spacing: 6) {
                Image(systemName: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text(LocaleService.t(
                    "La clasificación no varía: la etapa se canceló. General tras la etapa \(from).",
                    "Standings unchanged: the stage was cancelled. Classification after stage \(from)."
                ))
                .font(.footnote)
                .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color(.tertiarySystemBackground))
            )
            .padding(.bottom, 8)
            .accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder
    private func table(_ loaded: [RaceUciResultRow]) -> some View {
        let isTeams = stage.classKind == "teams"
        let isTtt = UciResultsLogic.isTttStage(
            rows: loaded, classKind: stage.classKind, isTeams: isTeams,
            raceDayPrimaryType: raceDayPrimaryType, stageNumber: stage.stageNumber, isOneDay: isOneDay,
            stageRaceType: stage.raceType
        )

        if isTtt {
            ResultsTttTable(rows: loaded, byDorsal: byDorsal, isEn: isEn, byRider: byRider, byTeamOverride: byTeamOverride)
        } else {
            individualTable(loaded, isTeams: isTeams)
        }
    }

    @ViewBuilder
    private func individualTable(_ loaded: [RaceUciResultRow], isTeams: Bool) -> some View {
        // CRI: ganador con su tiempo oficial truncado en notación de prensa (20'52")
        // y el resto con su diferencia sobre los enteros, como una etapa en línea.
        // Señal doble: RaceTypeCode 'ITT' de la etapa o jornada 'itt' (las CRI de un
        // día llegan con el bloque final sin raceType).
        let isItt = UciResultsLogic.isIttStage(
            classKind: stage.classKind,
            isTeams: isTeams,
            stageRaceType: stage.raceType,
            raceDayPrimaryType: raceDayPrimaryType,
            stageNumber: stage.stageNumber,
            isOneDay: isOneDay
        )
        let vms = UciResultsLogic.buildIndividualRows(
            rows: loaded, classKind: stage.classKind, isTeams: isTeams, byDorsal: byDorsal,
            isEn: isEn, raceTeams: raceTeams, isItt: isItt, byRider: byRider, byTeamOverride: byTeamOverride
        )
        // Filtrado por equipo (si aplica) — la lista visible se deriva aquí.
        let visible = (!isTeams && selectedTeam != nil) ? vms.filter { $0.teamName == selectedTeam } : vms
        let isPts = UciResultsLogic.isPointsClass(stage.classKind)
        let valueHeader = isPts
            ? LocaleService.t("Pts", "Pts")
            : LocaleService.t("Tiempo", "Time")
        let display = displayRows(visible)
        // El slot UCI nace solo cuando haya al menos un dato y permanece estable
        // al filtrar por equipo porque pertenece a la clasificación completa.
        let showUciPoints = vms.contains { $0.uciPoints != nil }

        ResultsClassificationTable(rows: display, showTeam: !isTeams, showUciPoints: showUciPoints, valueHeader: valueHeader)
    }

    /// m.t. dinámico: el 1º visible de cada grupo de gap muestra su gap real;
    /// los siguientes con el mismo gap → m.t. (igual que applyTeamFilter web).
    private func displayRows(
        _ visible: [UciResultsLogic.ResultRowVM]
    ) -> [(vm: UciResultsLogic.ResultRowVM, kind: UciResultsLogic.ValueKind, value: String)] {
        let sameTimeLabel = LocaleService.t("m.t.", "s.t.")
        var prevGap: String?
        return visible.map { vm in
            if vm.valueKind == .gap && !vm.rowGap.isEmpty {
                defer { prevGap = vm.rowGap }
                if let prev = prevGap, vm.rowGap == prev {
                    return (vm, .sameTime, sameTimeLabel)
                }
                return (vm, .gap, vm.rowGap)
            }
            let value = vm.valueKind == .sameTime ? sameTimeLabel : vm.valueText
            return (vm, vm.valueKind, value)
        }
    }
}

struct ResultsClassificationTable: View {
    let rows: [(vm: UciResultsLogic.ResultRowVM, kind: UciResultsLogic.ValueKind, value: String)]
    let showTeam: Bool
    let showUciPoints: Bool
    let valueHeader: String
    /// Pila normal: la tabla vive dentro de una fila de un `LazyVStack` cuya
    /// cabecera fijada son las pestañas de clasificación o de categoría. Una
    /// pila perezosa anidada con su propia cabecera fijada se superpondría a
    /// ellas y obligaría a recomponer la tabla en cada fotograma del scroll.
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerView
            rowViews
        }
        .background(AppTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(AppTheme.border, lineWidth: 1)
        }
    }

    @ViewBuilder private var rowViews: some View {
        ForEach(rows.indices, id: \.self) { i in
            let entry = rows[i]
            ResultsRowView(
                vm: entry.vm, showTeam: showTeam, showUciPoints: showUciPoints,
                displayKind: entry.kind,
                displayValue: entry.value
            )
            Divider().opacity(0.4)
        }
    }

    private var headerView: some View {
        VStack(spacing: 0) {
            ResultsTableHeaderRow(
                showTeam: showTeam,
                showUciPoints: showUciPoints,
                valueHeader: valueHeader
            )
            Divider().opacity(0.4)
        }
        .background(AppTheme.cardBackground)
    }
}

private struct ResultsTableHeaderRow: View {
    let showTeam: Bool
    let showUciPoints: Bool
    let valueHeader: String

    var body: some View {
        HStack(spacing: 6) {
            ResultsHeaderCell(text: "#")
                .frame(width: 32, alignment: .leading)
            ResultsHeaderCell(text: showTeam
                ? LocaleService.t("Corredor", "Rider")
                : LocaleService.t("Equipo", "Team"))
                .frame(maxWidth: .infinity, alignment: .leading)
            if showUciPoints {
                ResultsHeaderCell(text: "UCI")
                    .frame(width: 44, alignment: .trailing)
            }
            ResultsHeaderCell(text: valueHeader)
                .frame(width: 70, alignment: .trailing)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .background(AppTheme.cardBackgroundHover)
    }
}

private struct ResultsHeaderCell: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary)
    }
}

private struct ResultsRowView: View {
    let vm: UciResultsLogic.ResultRowVM
    let showTeam: Bool
    let showUciPoints: Bool
    let displayKind: UciResultsLogic.ValueKind
    let displayValue: String

    var body: some View {
        rowContent
    }

    private var rowContent: some View {
        HStack(spacing: 6) {
            // # / IRM
            Group {
                if let rank = vm.rank {
                    Text(String(rank))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.primary)
                } else {
                    Text(vm.rankBadge ?? "–")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 32, alignment: .leading)

            // Corredor arriba; equipación + equipo en el subtítulo, como en la
            // tabla móvil de la web. La marca cromática identifica al equipo,
            // no al corredor.
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    if !vm.countryCode.isEmpty {
                        CountryFlag(countryCode: vm.countryCode, width: 17.33)
                    }
                    if !showTeam, let team = vm.team, team.hasVisibleBadge {
                        TeamColorBands(team: team)
                    }
                    Text(vm.riderName.isEmpty ? "—" : vm.riderName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(vm.riderName.isEmpty ? Color.secondary : Color.primary)
                        .lineLimit(1)
                }
                // Equipo como subtítulo (en filas de corredor; oculto en pestaña Equipos).
                if showTeam, !vm.teamName.isEmpty {
                    HStack(spacing: 5) {
                        if let team = vm.team, team.hasVisibleBadge {
                            TeamColorBands(team: team)
                        }
                        Text(vm.teamName)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Jerarquía compartida: puesto · identidad · [UCI] · resultado.
            if showUciPoints {
                ResultsUciPointsCell(points: vm.uciPoints)
                    .frame(width: 44, alignment: .trailing)
            }
            ResultsValueCell(kind: displayKind, value: displayValue)
                .frame(width: 70, alignment: .trailing)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
    }
}

private struct ResultsUciPointsCell: View {
    let points: Double?

    var body: some View {
        Text(points?.formatted(.number.precision(.fractionLength(0...2))) ?? "")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }
}

private struct ResultsValueCell: View {
    let kind: UciResultsLogic.ValueKind
    let value: String

    var body: some View {
        let (color, weight): (Color, Font.Weight) = {
            switch kind {
            case .winnerTime: return (Color.accentColor, .bold)
            case .points: return (Color.primary, .semibold)
            default: return (Color.secondary, .regular)
            }
        }()
        Text(value)
            .font(.system(size: 13, weight: weight))
            .foregroundStyle(color)
            .multilineTextAlignment(.trailing)
            .lineLimit(1)
    }
}

// ── CRE (crono por equipos) colapsada ──────────────────────────────

private struct ResultsTttTable: View {
    let rows: [RaceUciResultRow]
    let byDorsal: [Int: ResolvedRider]
    let isEn: Bool
    var byRider: [String: ResolvedRider] = [:]
    var byTeamOverride: [String: Team] = [:]

    @State private var expanded: Set<Int> = []

    var body: some View {
        let teams = UciResultsLogic.collapseTtt(rows: rows, byDorsal: byDorsal, isEn: isEn, byRider: byRider, byTeamOverride: byTeamOverride)
        let winnerSecs = UciResultsLogic.tttWinnerSecs(teams)
        let showUciPoints = rows.contains { $0.uciPoints != nil }

        // Pila normal, como ResultsClassificationTable: las pestañas de
        // clasificación son la cabecera fijada de la pantalla.
        VStack(alignment: .leading, spacing: 0) {
            Section {
                ForEach(teams.indices, id: \.self) { i in
                let team = teams[i]
                let isOpen = expanded.contains(i)

                // Fila de equipo (pulsable → despliega corredores).
                Button {
                    if isOpen { expanded.remove(i) } else { expanded.insert(i) }
                } label: {
                    HStack(spacing: 6) {
                        Text(team.rank.map(String.init) ?? "–")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.primary)
                            .frame(width: 32, alignment: .leading)

                        HStack(spacing: 4) {
                            if let t = team.team, t.hasVisibleBadge {
                                TeamColorBands(team: t)
                            }
                            Text(team.teamName.isEmpty ? "—" : team.teamName)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                            Text(isOpen ? "▴" : "▾")
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        if showUciPoints {
                            ResultsUciPointsCell(points: team.uciPoints)
                                .frame(width: 44, alignment: .trailing)
                        }
                        let isWinner = team.rank == 1 && team.teamTimeText != nil
                        let value: String = {
                            if team.rank == nil { return "" }
                            if isWinner { return team.teamTimeText ?? "" }
                            return UciResultsLogic.tttGapBetween(teamSecs: team.teamSecs, winnerSecs: winnerSecs)
                                ?? (team.teamTimeText ?? "")
                        }()
                        Text(value)
                            .font(.system(size: 13, weight: isWinner ? .bold : .regular))
                            .foregroundStyle(isWinner ? Color.accentColor : Color.secondary)
                            .lineLimit(1)
                            .frame(width: 70, alignment: .trailing)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                // Sub-filas de corredores (al desplegar).
                if isOpen {
                    ForEach(Array(team.riders.enumerated()), id: \.offset) { _, rider in
                        tttRiderRow(rider, showUciPoints: showUciPoints)
                    }
                }
                Divider().opacity(0.4)
                }
            } header: {
                VStack(spacing: 0) {
                    HStack(spacing: 6) {
                        ResultsHeaderCell(text: "#")
                            .frame(width: 32, alignment: .leading)
                        ResultsHeaderCell(text: LocaleService.t("Equipo", "Team"))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if showUciPoints {
                            ResultsHeaderCell(text: "UCI")
                                .frame(width: 44, alignment: .trailing)
                        }
                        ResultsHeaderCell(text: LocaleService.t("Tiempo", "Time"))
                            .frame(width: 70, alignment: .trailing)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
                    .background(AppTheme.cardBackgroundHover)
                    Divider().opacity(0.4)
                }
                .background(AppTheme.cardBackground)
            }
        }
        .background(AppTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(AppTheme.border, lineWidth: 1)
        }
    }

    /// Sub-fila de un corredor de la CRE (bandera + nombre + tiempo/IRM).
    private func tttRiderRow(
        _ rider: UciResultsLogic.TttRiderRow,
        showUciPoints: Bool
    ) -> some View {
        HStack(spacing: 4) {
            if !rider.countryCode.isEmpty {
                CountryFlag(countryCode: rider.countryCode, width: 17.33)
            }
            Text(rider.name.isEmpty ? "—" : rider.name)
                .font(.system(size: 13))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            let indiv: String = {
                if let irm = rider.irm, !irm.isEmpty {
                    return UciResultsLogic.irmLabel(irm, isEn: isEn)
                }
                return rider.timeText ?? ""
            }()
            if showUciPoints {
                ResultsUciPointsCell(points: rider.uciPoints)
                    .frame(width: 44, alignment: .trailing)
            }
            Text(indiv)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(width: 70, alignment: .trailing)
        }
        .padding(.leading, 38)
        .padding(.trailing, 8)
        .padding(.vertical, 5)
        .background(Color(.secondarySystemBackground).opacity(0.6))
    }
}
