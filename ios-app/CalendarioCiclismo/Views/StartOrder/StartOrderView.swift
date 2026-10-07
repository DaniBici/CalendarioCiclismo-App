import SwiftUI

struct StartOrderView: View {
    @State private var viewModel = StartOrderViewModel()
    let raceDayId: String
    var showDismissButton: Bool = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        ZStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header idéntico al de ElevationProfileView (paridad visual).
                    if let rd = viewModel.fullRaceDay {
                        StageInfoHeader(raceDay: rd, race: viewModel.race)
                    }

                    if horizontalSizeClass == .regular,
                       let rd = viewModel.fullRaceDay,
                       let race = viewModel.race,
                       hasStageContext(rd) {
                        HStack(alignment: .top, spacing: 16) {
                            orderContent
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                            ResultsStageContext(
                                raceDay: rd,
                                race: race
                            )
                                .frame(width: 320)
                        }
                    } else {
                        orderContent
                        if let rd = viewModel.fullRaceDay,
                           let race = viewModel.race,
                           hasStageContext(rd) {
                            ResultsStageContext(
                                raceDay: rd,
                                race: race
                            )
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical)
            }
            .background(AppTheme.background)
            .refreshable {
                await viewModel.refresh(raceDayId: raceDayId)
            }

            if viewModel.isLoading && viewModel.raceDay == nil {
                LoadingView(title: LocaleService.t("Orden de salida", "Start order"))
            } else if let error = viewModel.error {
                ErrorView(message: error, retry: {
                    Task { await viewModel.load(raceDayId: raceDayId) }
                })
            }
        }
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(viewModel.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if showDismissButton {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel(LocaleService.t("Cerrar", "Close"))
                }
            }
        }
        .task {
            await viewModel.load(raceDayId: raceDayId)
            var soParams: [String: Any] = [
                "race_day_id": raceDayId,
                "race_name": viewModel.race?.name ?? "",
            ]
            if let label = viewModel.fullRaceDay?.stageLabel { soParams["stage_name"] = label }
            AnalyticsService.shared.logScreenView("start_order", parameters: soParams)
        }
    }

    private func hasStageContext(_ raceDay: RaceDay) -> Bool {
        raceDay.hasElevationProfile || raceDay.distanceKm != nil
            || raceDay.elevationProfile?.elevationGain != nil || raceDay.neutralStartTimeUtc != nil
            || raceDay.averageSpeedKmh != nil
            || raceDay.hasValidTimeLimit
    }

    @ViewBuilder
    private var orderContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            if viewModel.hasAnyFilter {
                StartOrderFilterBar(viewModel: viewModel)
            }
            if viewModel.shouldConvertTime, let raceTz = viewModel.raceDay?.timezone {
                StartOrderTimezoneNote(
                    userOffset: viewModel.tzOffsetLabel(TimeZone.current.identifier),
                    raceOffset: viewModel.tzOffsetLabel(raceTz),
                    location: viewModel.raceLocationLabel
                )
            }
            if viewModel.entries.isEmpty && !viewModel.isLoading {
                Text(LocaleService.t("No hay datos de orden de salida para esta jornada.",
                                     "No start order data available for this stage."))
                    .ccFont(.s14)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding()
            } else {
                StartOrderTable(viewModel: viewModel)
            }
        }
    }
}

// MARK: - Header
// El header del orden de salida ahora reusa `StageInfoHeader` (mismo que
// usa ElevationProfileView) para paridad visual con el resto de la app.
// Ver StageDetailView.swift::StageInfoHeader.

// MARK: - Filter bar

struct StartOrderFilterBar: View {
    @Bindable var viewModel: StartOrderViewModel

    var body: some View {
        HStack(spacing: 6) {
            chip(.all,  LocaleService.t("Todos", "All"))
            if viewModel.hasTtFilter { chip(.tt, LocaleService.t("Contrarrelojistas", "TT Specialists")) }
            if viewModel.hasGcFilter { chip(.gc, LocaleService.t("General", "GC")) }
            Spacer()
        }
    }

    /// Filtro con el aspecto de los de Hoy: inactivo en gris sobre la
    /// superficie de tarjeta; activo con el acento al 15 % y texto de acento
    /// en negrita.
    private func chip(_ filter: StartOrderViewModel.Filter, _ label: String) -> some View {
        let isActive = viewModel.activeFilter == filter
        return Button { viewModel.activeFilter = filter } label: {
            Text(label)
                .ccFont(.s13, weight: isActive ? .bold : .medium)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    isActive ? Color.accentColor.opacity(0.15) : AppTheme.cardBackground,
                    in: RoundedRectangle(cornerRadius: AppTheme.Radius.control)
                )
                .foregroundStyle(isActive ? Color.accentColor : Color(.secondaryLabel))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
    }
}

// MARK: - TZ note

struct StartOrderTimezoneNote: View {
    let userOffset: String
    let raceOffset: String
    let location: String

    var body: some View {
        Text(LocaleService.isEnglish
             ? "Times shown in your local time (\(userOffset)). Tap a time for race-local time in \(location) (\(raceOffset))."
             : "Horarios en tu hora local (\(userOffset)). Toca una hora para ver la oficial en \(location) (\(raceOffset)).")
            .ccFont(.s13)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Table

/// Orden de salida con la presentación de las clasificaciones
/// (`ResultsTableSurface`): misma superficie, cabecera gris, filas con filete
/// fino y tipografía de 14.
struct StartOrderTable: View {
    @Bindable var viewModel: StartOrderViewModel

    var body: some View {
        let entries = viewModel.filteredEntries
        ResultsTableSurface {
            // Cabecera — CRE muestra solo Salida + Equipo; CRI las 3 columnas.
            HStack(spacing: ResultsTableMetrics.columnSpacing) {
                ResultsHeaderCell(text: LocaleService.t("Salida", "Start"))
                    .frame(width: StartOrderRow.timeWidth, alignment: .leading)
                if viewModel.isTtt {
                    ResultsHeaderCell(text: LocaleService.t("Equipo", "Team"))
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ResultsHeaderCell(text: LocaleService.t("Dor.", "Bib"))
                        .frame(width: StartOrderRow.dorsalWidth, alignment: .center)
                    ResultsHeaderCell(text: LocaleService.t("Corredor", "Rider"))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, ResultsTableMetrics.horizontalPadding)
            .padding(.vertical, ResultsTableMetrics.headerVerticalPadding)
            ResultsTableRule()

            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                StartOrderRow(entry: entry, viewModel: viewModel)
                if index < entries.count - 1 { ResultsTableRule() }
            }
        }
    }
}

struct StartOrderRow: View {
    static let timeWidth: CGFloat = 76
    static let dorsalWidth: CGFloat = 36

    let entry: StartOrderEntry
    @Bindable var viewModel: StartOrderViewModel
    @State private var showingOfficialTime = false

    private var timeText: (text: String, dayShift: String?) {
        if viewModel.shouldConvertTime {
            return viewModel.convertedTime(for: entry)
        }
        return (entry.startTime, nil)
    }

    var body: some View {
        let (timeStr, shift) = timeText
        HStack(spacing: ResultsTableMetrics.columnSpacing) {
            HStack(spacing: 3) {
                if let shift {
                    Text(shift)
                        .ccFont(.s12, weight: .semibold)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 3)
                        .background(AppTheme.neutralFill, in: RoundedRectangle(cornerRadius: AppTheme.Radius.control))
                }
                // Hora en negrita con cifras tabulares, sin espaciado de letras.
                Text(timeStr)
                    .ccFont(.s14, weight: .bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.accentColor)
                    .lineLimit(1)
            }
            .frame(width: Self.timeWidth, alignment: .leading)
            // Solo es interactivo cuando se está convirtiendo a hora del usuario:
            // si no, la hora mostrada YA es la oficial de la sede y no hay nada
            // que revelar. Al tocar, popover con la hora oficial original.
            .contentShape(Rectangle())
            .modifier(OfficialTimeTapModifier(
                enabled: viewModel.shouldConvertTime,
                isPresented: $showingOfficialTime,
                officialTime: entry.startTime,
                location: viewModel.raceLocationLabel
            ))

            if viewModel.isTtt {
                HStack(spacing: 5) {
                    if let team = UciResultsLogic.findMatchingTeam(entry.teamName, teams: viewModel.teams) {
                        TeamColorBands(team: team)
                    }
                    Text(entry.teamName?.isEmpty == false ? entry.teamName! : "—")
                        .ccFont(.s14, weight: .medium)
                        .foregroundStyle(entry.teamName?.isEmpty == false ? .primary : .secondary)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("\(entry.dorsal)")
                    .ccFont(.s13, weight: .semibold)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .frame(width: Self.dorsalWidth, alignment: .center)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        if let cc = entry.countryCode, !cc.isEmpty {
                            CountryFlag(countryCode: cc, width: 17.33)
                        }
                        Text(entry.riderName?.isEmpty == false ? entry.riderName! : "—")
                            .ccFont(.s14, weight: .medium)
                            .foregroundStyle(entry.riderName?.isEmpty == false ? .primary : .secondary)
                            .lineLimit(1)
                    }
                    if let team = entry.teamName, !team.isEmpty {
                        HStack(spacing: 5) {
                            if let resolved = UciResultsLogic.findMatchingTeam(team, teams: viewModel.teams) {
                                TeamColorBands(team: resolved)
                            }
                            Text(team)
                                .ccFont(.s12)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, ResultsTableMetrics.horizontalPadding)
        .padding(.vertical, ResultsTableMetrics.rowVerticalPadding)
        .frame(minHeight: 35)
    }

}

// MARK: - Popover hora oficial
// Aplica `onTapGesture` + `popover` solo cuando `enabled` (i.e. cuando la
// vista convierte a la hora del usuario). El popover muestra la hora oficial
// original de la sede — paridad con el tooltip `title=` de la web.
private struct OfficialTimeTapModifier: ViewModifier {
    let enabled: Bool
    @Binding var isPresented: Bool
    let officialTime: String
    let location: String

    func body(content: Content) -> some View {
        if enabled {
            content
                .onTapGesture { isPresented = true }
                .popover(isPresented: $isPresented) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(LocaleService.t("Hora oficial", "Race-local time"))
                            .ccFont(.s12)
                            .foregroundStyle(.secondary)
                        Text(officialTime)
                            .ccFont(.s20, weight: .semibold)
                            .monospacedDigit()
                        if !location.isEmpty {
                            Text(location)
                                .ccFont(.s13)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(14)
                    .presentationCompactAdaptation(.popover)
                }
        } else {
            content
        }
    }
}
