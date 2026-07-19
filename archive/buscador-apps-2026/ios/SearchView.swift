import SwiftUI

/// Vista de búsqueda — equivalente a `buscar.html` + `buscar.js`.
struct SearchView: View {
    @State private var viewModel = SearchViewModel()
    @State private var localeService = LocaleService.shared

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.isLoading && viewModel.allRaces.isEmpty {
                LoadingView()
            } else {
                List {
                    if viewModel.query.isEmpty {
                        Section {
                            EmptyStateView(
                                icon: "magnifyingglass",
                                title: localeService.t("Busca en nuestra base de datos", "Search our database"),
                                subtitle: localeService.t("Localiza carreras, ciudades, puertos…", "Find races, cities, climbs…")
                            )
                            .frame(height: 200)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets())
                        }
                    } else if viewModel.results.isEmpty {
                        Section {
                            EmptyStateView(
                                icon: "magnifyingglass",
                                title: localeService.t("Sin resultados", "No results"),
                                subtitle: localeService.t("No se encontraron carreras para \"\(viewModel.query)\"", "No races found for \"\(viewModel.query)\"")
                            )
                            .frame(height: 200)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets())
                        }
                    } else {
                        Section(localeService.t("\(viewModel.results.count) resultado\(viewModel.results.count == 1 ? "" : "s")", "\(viewModel.results.count) result\(viewModel.results.count == 1 ? "" : "s")")) {
                            ForEach(viewModel.results) { hit in
                                NavigationLink(destination: searchDestination(for: hit.result)) {
                                    SearchResultRow(result: hit.result)
                                }
                                .accessibilityLabel(searchResultAccessibilityLabel(hit.result))
                                .accessibilityHint((hit.result.race.isStageRace ? hit.result.matchedRaceDayId : hit.result.oneDayRaceDayId) != nil
                                    ? localeService.t("Pulsa dos veces para ver la etapa", "Double tap to view the stage")
                                    : localeService.t("Pulsa dos veces para ver el detalle de la carrera", "Double tap to view race details"))
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .onAppear {
            AnalyticsService.shared.logScreenView("search", parameters: [
                "search_query": viewModel.query.isEmpty ? "" : viewModel.query,
            ])
        }
        .navigationTitle(localeService.t("Buscar", "Search"))
        .searchable(text: $viewModel.query, prompt: localeService.t("Busca por carrera, puerto, ciudad...", "Search races, climbs, cities..."))
        .accessibilityIdentifier(AccessibilityID.searchField)
        .task { await viewModel.loadRaces() }
        .onChange(of: viewModel.results.count) { _, newCount in
            if !viewModel.query.isEmpty {
                if newCount == 0 {
                    AccessibilityAnnouncement.announce(LocaleService.t("Sin resultados para \(viewModel.query)", "No results for \(viewModel.query)"))
                } else {
                    AccessibilityAnnouncement.announce(LocaleService.t("\(newCount) resultado\(newCount == 1 ? "" : "s")", "\(newCount) result\(newCount == 1 ? "" : "s")"))
                }
            }
        }
    }

    /// Jornada por etapas que casó una etapa concreta, o carrera de un día (su
    /// jornada única) → a la jornada. El resto (carrera por etapas que casó por
    /// nombre) → a competición. Una carrera de un día NUNCA navega a competición
    /// (lista de etapas, sin sentido sin etapas) — paridad con Android.
    @ViewBuilder
    private func searchDestination(for result: SearchResult) -> some View {
        let stageId = result.race.isStageRace ? result.matchedRaceDayId : result.oneDayRaceDayId
        if let stageId {
            StageDetailView(raceDayId: stageId)
        } else {
            RaceDetailView(raceId: result.race.id)
        }
    }

    private func searchResultAccessibilityLabel(_ result: SearchResult) -> String {
        let race = result.race
        var parts: [String] = [race.localizedName]

        if let country = AccessibilityCountryNames.name(for: race.countryCode), race.hideFlag != true {
            parts.append(country)
        }
        if let catDesc = AccessibilityCategoryLabel.description(for: race.uciCategory) {
            parts.append(catDesc)
        }

        let dateRange = DateFormatting.formatDateRange(start: race.startDate, end: race.endDate)
        if !dateRange.isEmpty {
            parts.append(dateRange)
        }

        if race.isStageRace {
            parts.append(LocaleService.t("por etapas", "stage race"))
        }

        if let location = result.matchLocation {
            parts.append(LocaleService.t("encontrado en: \(location.rawValue)", "found in: \(location.rawValue)"))
        }

        return parts.joined(separator: ", ")
    }
}

/// Fila de resultado de búsqueda.
private struct SearchResultRow: View {
    let result: SearchResult

    private var race: Race { result.race }

    var body: some View {
        HStack(spacing: 10) {
            RaceLogo(race.logoUrl, size: 32)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    if race.hideFlag != true {
                        CountryFlag(countryCode: race.countryCode)
                    }
                    Text(race.localizedName)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .lineLimit(1)
                }

                HStack(spacing: 6) {
                    CategoryBadge(category: race.uciCategory)

                    Text(DateFormatting.formatDateRange(start: race.startDate, end: race.endDate))
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if race.isStageRace {
                        Text(LocaleService.t("Por etapas", "Stage race"))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }

                // Indicación de dónde se encontró el término
                if let location = result.matchLocation {
                    Text(location.rawValue)
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .ignore)
    }
}
