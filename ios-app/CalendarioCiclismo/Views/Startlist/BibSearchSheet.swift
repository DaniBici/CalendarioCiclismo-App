import SwiftUI

/// «Busca dorsal»: hoja de la tarjeta de Hoy con la jornada en curso. Se
/// teclea un dorsal y el corredor aparece sin confirmar, con su equipo y sus
/// compañeros. Lee la misma lista que la pantalla de inscritos.
struct BibSearchSheet: View {
    let race: Race
    /// Cierra la hoja y abre la lista completa de inscritos.
    let onShowFullList: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var viewModel = StartlistViewModel()
    @State private var query = ""
    @FocusState private var fieldFocused: Bool

    private struct Entry {
        let rider: StartlistRiderView
        let team: StartlistTeamWithRiders
    }

    /// Corredores con número, por dorsal. Ante un dorsal repetido vale el primero.
    private var entries: [Int: Entry] {
        var byBib: [Int: Entry] = [:]
        for team in viewModel.teamsList {
            for rider in team.riders {
                if let bib = rider.dorsal, bib > 0, byBib[bib] == nil {
                    byBib[bib] = Entry(rider: rider, team: team)
                }
            }
        }
        return byBib
    }

    private var isOneDay: Bool { race.isOneDay }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    field
                    result
                }
                .padding(.horizontal)
                .padding(.top, 8)
                .padding(.bottom)
            }
            .background(AppTheme.background)
            .navigationTitle(LocaleService.t("Busca dorsal", "Find bib"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(LocaleService.t("Lista completa", "Full startlist"), action: onShowFullList)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(LocaleService.t("Cerrar", "Close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task {
            fieldFocused = true
            await viewModel.load(raceId: race.id)
        }
    }

    private var field: some View {
        HStack(spacing: 12) {
            StartlistIcon(size: 24)
                .foregroundStyle(.secondary)
            TextField("", text: $query)
                .keyboardType(.numberPad)
                .ccFont(.s28, weight: .bold)
                .monospacedDigit()
                .focused($fieldFocused)
                .accessibilityLabel(LocaleService.t("Número de dorsal", "Bib number"))
                .onChange(of: query) { _, value in
                    // Solo cifras, sin ceros a la izquierda y con tres como máximo.
                    let digits = String(value.filter(\.isNumber).drop { $0 == "0" }.prefix(3))
                    if digits != value { query = digits }
                }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 52)
        .background(AppTheme.cardBackground, in: RoundedRectangle(cornerRadius: AppTheme.Radius.surface))
    }

    @ViewBuilder
    private var result: some View {
        let byBib = entries
        if viewModel.isLoading && byBib.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.top, 24)
        } else if byBib.isEmpty {
            note(viewModel.error != nil
                 ? LocaleService.t("No se han podido cargar los dorsales.", "The bib numbers could not be loaded.")
                 : LocaleService.t("Esta lista aún no tiene dorsales.", "This startlist has no bib numbers yet."))
        } else if query.isEmpty {
            note(LocaleService.t("Escribe el número que ves en pantalla.", "Type the number you see on screen."))
        } else if let bib = Int(query), let entry = byBib[bib] {
            hit(entry)
        } else {
            note(LocaleService.t("Sin corredor con el dorsal \(query).", "No rider with bib \(query)."))
            let near = byBib.keys.filter { String($0).hasPrefix(query) }.sorted().prefix(6)
            if !near.isEmpty {
                rows(near.compactMap { byBib[$0]?.rider })
            }
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .ccFont(.s14)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 4)
    }

    private func out(_ rider: StartlistRiderView) -> RiderOut? {
        rider.globalRiderId.flatMap { viewModel.ridersOut[$0] }
    }

    private func outReason(_ out: RiderOut) -> String {
        let label = UciResultsLogic.irmLabel(out.irm, isEn: LocaleService.shouldShowEnglishContent)
        guard let stage = out.stageNumber, !isOneDay else { return label }
        return stage == 0
            ? LocaleService.t("\(label) · prólogo", "\(label) · prologue")
            : LocaleService.t("\(label) · etapa \(stage)", "\(label) · stage \(stage)")
    }

    @ViewBuilder
    private func hit(_ entry: Entry) -> some View {
        let riderOut = out(entry.rider)
        let showsTeam = !entry.team.isNoTeamPlaceholder
        HStack(alignment: .center, spacing: 14) {
            Text("\(entry.rider.dorsal ?? 0)")
                .ccFont(.s36, weight: .bold)
                .monospacedDigit()
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    CountryFlag(countryCode: entry.rider.countryCode)
                    Text(entry.rider.fullName)
                        .ccFont(.s16, weight: .bold)
                        .strikethrough(riderOut != nil)
                        .lineLimit(2)
                }
                if showsTeam {
                    HStack(spacing: 6) {
                        if let team = entry.team.team { TeamColorBands(team: team) }
                        Text(entry.team.displayName)
                            .ccFont(.s13)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                if let riderOut {
                    Text(outReason(riderOut))
                        .ccFont(.s13)
                        .foregroundStyle(AppTheme.red)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)

        let mates = entry.team.riders.filter { $0.id != entry.rider.id && ($0.dorsal ?? 0) > 0 }
        if showsTeam, !mates.isEmpty {
            Text(race.isFemale ? LocaleService.t("Compañeras", "Teammates") : LocaleService.t("Compañeros", "Teammates"))
                .ccFont(.s12)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)
                .padding(.top, 4)
            rows(mates)
        }
    }

    private func rows(_ riders: [StartlistRiderView]) -> some View {
        VStack(spacing: 0) {
            ForEach(riders) { rider in
                StartlistRiderRowView(rider: rider, out: out(rider), isOneDay: isOneDay)
            }
        }
        .padding(.vertical, 4)
        .background(AppTheme.cardBackground)
        .ccCardSurface()
    }
}
