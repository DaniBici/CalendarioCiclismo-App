import SwiftUI

private extension Color {
    static func fromHex(_ hex: String) -> Color? {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count == 6 else { return nil }
        let scanner = Scanner(string: h)
        var rgb: UInt64 = 0
        guard scanner.scanHexInt64(&rgb) else { return nil }
        let r = Double((rgb >> 16) & 0xFF) / 255.0
        let g = Double((rgb >> 8) & 0xFF) / 255.0
        let b = Double(rgb & 0xFF) / 255.0
        return Color(red: r, green: g, blue: b)
    }
}

struct StartOrderView: View {
    @State private var viewModel = StartOrderViewModel()
    let raceDayId: String
    var showDismissButton: Bool = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header idéntico al de ElevationProfileView (paridad visual).
                    if let rd = viewModel.fullRaceDay {
                        StageInfoHeader(raceDay: rd, race: viewModel.race)
                    }

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
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding()
                    } else {
                        StartOrderTable(viewModel: viewModel)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical)
            }
            .refreshable {
                await viewModel.refresh(raceDayId: raceDayId)
            }

            if viewModel.isLoading && viewModel.raceDay == nil {
                LoadingView()
            } else if let error = viewModel.error {
                ErrorView(message: error, retry: {
                    Task { await viewModel.load(raceDayId: raceDayId) }
                })
            }
        }
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
}

// MARK: - Header
// El header del orden de salida ahora reusa `StageInfoHeader` (mismo que
// usa ElevationProfileView) para paridad visual con el resto de la app.
// Ver StageDetailView.swift::StageInfoHeader.

// MARK: - Filter bar

struct StartOrderFilterBar: View {
    @Bindable var viewModel: StartOrderViewModel

    var body: some View {
        HStack(spacing: 8) {
            chip(.all,  LocaleService.t("Todos", "All"))
            if viewModel.hasTtFilter { chip(.tt, LocaleService.t("Contrarrelojistas", "TT Specialists")) }
            if viewModel.hasGcFilter { chip(.gc, LocaleService.t("General", "GC")) }
            Spacer()
        }
    }

    private func chip(_ filter: StartOrderViewModel.Filter, _ label: String) -> some View {
        let isActive = viewModel.activeFilter == filter
        return Button { viewModel.activeFilter = filter } label: {
            Text(label)
                .font(.caption)
                .fontWeight(isActive ? .semibold : .regular)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                // Pill al patrón canónico (igual que los chips de Hoy/Mes/Temporada):
                // activo en azul de marca suave (15%) + texto azul, inactivo en
                // surfaceVariant. Antes azul sólido + blanco.
                .background(isActive ? Color.accentColor.opacity(0.15) : Color(.tertiarySystemBackground))
                .foregroundStyle(isActive ? Color.accentColor : Color(.secondaryLabel))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
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
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.gray.opacity(0.08))
            .cornerRadius(8)
    }
}

// MARK: - Table

struct StartOrderTable: View {
    @Bindable var viewModel: StartOrderViewModel

    var body: some View {
        VStack(spacing: 0) {
            // Header row — CRE muestra solo Salida + Equipo; CRI las 3 columnas.
            HStack(spacing: 10) {
                Text(LocaleService.t("Salida", "Start")).frame(width: 72, alignment: .leading)
                if viewModel.isTtt {
                    Text(LocaleService.t("Equipo", "Team")).frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(LocaleService.t("Dor.", "Bib")).frame(width: 36, alignment: .leading)
                    Text(LocaleService.t("Corredor", "Rider")).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            ForEach(viewModel.filteredEntries) { entry in
                StartOrderRow(entry: entry, viewModel: viewModel)
                Divider().opacity(0.4)
            }
        }
        .background(Color.gray.opacity(0.04))
        .cornerRadius(8)
    }
}

struct StartOrderRow: View {
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
        HStack(spacing: 10) {
            HStack(spacing: 3) {
                if let shift {
                    Text(shift)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.orange)
                }
                Text(timeStr)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(1)
            }
            .frame(width: 72, alignment: .leading)
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
                // CRE: solo el nombre del equipo (sin dorsal, sin bandera, sin corredor).
                Text(entry.teamName?.isEmpty == false ? entry.teamName! : "—")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(entry.teamName?.isEmpty == false ? .primary : .secondary)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("\(entry.dorsal)")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .frame(width: 36, alignment: .leading)

                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        if let cc = entry.countryCode, !cc.isEmpty {
                            CountryFlag(countryCode: cc)
                        }
                        Text(entry.riderName?.isEmpty == false ? entry.riderName! : "—")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundStyle(entry.riderName?.isEmpty == false ? .primary : .secondary)
                            .lineLimit(1)
                    }
                    if let team = entry.teamName, !team.isEmpty {
                        Text(team).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
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
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(officialTime)
                            .font(.title3)
                            .fontWeight(.semibold)
                            .monospacedDigit()
                        if !location.isEmpty {
                            Text(location)
                                .font(.caption)
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
