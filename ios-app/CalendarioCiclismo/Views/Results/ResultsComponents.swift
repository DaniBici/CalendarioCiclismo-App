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

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(stageKeys, id: \.self) { key in
                        // "final"→F · "0"→P · "3"/"3A" → el número con su sufijo de sector.
                        let label: String = {
                            if key == "final" { return LocaleService.t("F", "F") }
                            let p = UciResultsLogic.parseResultStageKey(key)
                            if p.stageNumber == 0 { return "P" }
                            return "\(p.stageNumber.map(String.init) ?? "")\(p.suffix)"
                        }()
                        ResultsPill(label: label, selected: key == activeKey) { onSelect(key) }
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
        if animated {
            withAnimation { proxy.scrollTo(key, anchor: .center) }
        } else {
            proxy.scrollTo(key, anchor: .center)
        }
    }
}

/// Barra de pestañas de clasificación + menú de filtro por equipo.
struct ResultsClassTabsBar: View {
    let stages: [RaceUciStage]
    let activeClassKind: String
    let teamsAvailable: [String]
    let selectedTeam: String?
    let onSelectClass: (String) -> Void
    let onSelectTeam: (String?) -> Void

    /// True mientras quede contenido por desvelar a la derecha del scroll de
    /// pestañas (lo actualiza `onScrollGeometryChange`). Controla el chevron.
    @State private var canScrollRight = false

    var body: some View {
        HStack(spacing: 6) {
            if stages.count > 1 {
                // Las pestañas scrollean en horizontal y, con muchas clasificaciones,
                // las de la derecha quedan ocultas tras el filtro de equipos. Un
                // chevron anclado al borde derecho —visible SOLO mientras quede
                // contenido por ver— lo señala explícitamente y, al tocarlo, desplaza
                // la fila hasta el final.
                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(stages) { st in
                                ResultsPill(
                                    label: resultsClassLabel(st.classKind),
                                    selected: st.classKind == activeClassKind
                                ) { onSelectClass(st.classKind) }
                                .id(st.classKind)
                            }
                        }
                    }
                    .onScrollGeometryChange(for: Bool.self) { geo in
                        geo.contentOffset.x + geo.containerSize.width < geo.contentSize.width - 1
                    } action: { _, more in
                        canScrollRight = more
                    }
                    .overlay(alignment: .trailing) {
                        if canScrollRight {
                            Button {
                                if let lastId = stages.last?.classKind {
                                    withAnimation { proxy.scrollTo(lastId, anchor: .trailing) }
                                }
                            } label: {
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(Color(.secondaryLabel))
                                    .padding(5)
                                    .background(Color(.tertiarySystemBackground), in: Circle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(LocaleService.t("Ver más clasificaciones", "See more classifications"))
                        }
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
                    .padding(.vertical, 5)
                    .background(Color(.tertiarySystemBackground))
                    .foregroundStyle(Color(.secondaryLabel))
                    .clipShape(Capsule())
                }
                .accessibilityLabel(LocaleService.t("Filtrar por equipo", "Filter by team"))
            }
        }
    }
}

/// Cápsula de filtro (igual estética que StartOrderFilterBar / chips de Hoy).
private struct ResultsPill: View {
    let label: String
    let selected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(label)
                .font(.caption)
                .fontWeight(selected ? .semibold : .regular)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(selected ? Color.accentColor.opacity(0.15) : Color(.tertiarySystemBackground))
                .foregroundStyle(selected ? Color.accentColor : Color(.secondaryLabel))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

// ── Tabla de una clasificación ─────────────────────────────────────

/// Tabla de una clasificación. Carga las filas on-demand por stageRef, decide
/// individual vs CRE colapsada, y aplica el filtro por equipo (recalculando m.t.
/// sobre las filas visibles, como `applyTeamFilter` en la web).
struct ResultsTableView: View {
    let stage: RaceUciStage
    let byDorsal: [Int: ResolvedRider]
    let raceTeams: [Team]
    let raceDayPrimaryType: String?
    let isOneDay: Bool
    let isEn: Bool
    let selectedTeam: String?
    /// Se incrementa en cada pull-to-refresh del padre; entra en la clave del
    /// `.task` para re-pedir las filas (sin él, el swipe-down no recargaba la
    /// clasificación visible porque `stage.id` no cambia).
    var reloadToken: Int = 0
    let onTeamsResolved: ([String]) -> Void

    @State private var rows: [RaceUciResultRow]?
    /// Fallback por globalRiderId para las filas que NO casan por dorsal (CN sin
    /// startlist): bandera + equipo actual + ficha, igual que `byRider` web.
    @State private var byRider: [String: ResolvedRider] = [:]
    /// Override MANUAL de equipo (mig. 112): teamId de la fila → equipo canónico.
    @State private var byTeamOverride: [String: Team] = [:]

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
            let loaded = (try? await SupabaseService.shared.loadResultRows(stageRef: stage.id)) ?? []
            // Enriquecer por globalRiderId las filas que NO resuelven por dorsal
            // (no-op si todas casan → byRider queda vacío). Espejo de la llamada
            // a `enrichRiders` en `renderClassification` (web).
            let unmatchedIds = loaded
                .filter { $0.dorsalInt.flatMap { byDorsal[$0] } == nil }
                .compactMap(\.globalRiderId)
            let enriched = unmatchedIds.isEmpty
                ? [:]
                : await SupabaseService.shared.enrichRidersByGlobalId(unmatchedIds)
            byRider = enriched
            // Override de equipo: resolver los teamId de override a su equipo canónico.
            let overrideIds = loaded.compactMap(\.teamId)
            let overrides = overrideIds.isEmpty
                ? [:]
                : await SupabaseService.shared.enrichTeamsByIds(overrideIds)
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

        VStack(spacing: 0) {
            ResultsTableHeaderRow(
                showTeam: !isTeams,
                showUciPoints: showUciPoints,
                valueHeader: valueHeader
            )
            Divider().opacity(0.4)
            ForEach(display.indices, id: \.self) { i in
                let entry = display[i]
                ResultsRowView(
                    vm: entry.vm, showTeam: !isTeams, showUciPoints: showUciPoints,
                    displayKind: entry.kind,
                    displayValue: entry.value
                )
                Divider().opacity(0.4)
            }
        }
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
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
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

            // Corredor (bandera + chapa + nombre [+ equipo como subtítulo]) o equipo.
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    if !vm.countryCode.isEmpty {
                        CountryFlag(countryCode: vm.countryCode, width: 17.33)
                    }
                    // Chapa: en filas de corredor, la de su equipo; en la pestaña
                    // Equipos, la del equipo casado por nombre (nil si no casó).
                    if let team = vm.team {
                        TeamBadgeView(team: team, size: 14)
                    }
                    Text(vm.riderName.isEmpty ? "—" : vm.riderName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(vm.riderName.isEmpty ? Color.secondary : Color.primary)
                        .lineLimit(1)
                }
                // Equipo como subtítulo (en filas de corredor; oculto en pestaña Equipos).
                if showTeam, !vm.teamName.isEmpty {
                    Text(vm.teamName)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
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
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
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
            .padding(.horizontal, 4)
            .padding(.vertical, 6)
            Divider().opacity(0.4)

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
                            if let t = team.team {
                                TeamBadgeView(team: t, size: 14)
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
                    .padding(.horizontal, 4)
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
        .padding(.trailing, 4)
        .padding(.vertical, 5)
        .background(Color(.secondarySystemBackground).opacity(0.6))
    }
}
