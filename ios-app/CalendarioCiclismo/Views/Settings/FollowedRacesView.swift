import SwiftUI

/// Lista de carreras seguidas individualmente para notificaciones push.
/// Accesible desde Ajustes → Notificaciones → Carreras → Seleccionadas.
struct FollowedRacesView: View {
    @State private var raceFollow = RaceFollowService.shared
    @State private var races: [Race] = []
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading {
                LoadingView()
            } else if let error {
                ErrorView(message: error) {
                    Task { await loadRaces() }
                }
            } else if races.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "bell.slash")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text("Sin carreras seguidas")
                        .font(.headline)
                    Text("Pulsa Notificaciones en cualquier carrera para añadirla.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(races) { race in
                        HStack(spacing: 12) {
                            RaceLogo(race.logoUrl, size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(race.localizedName)
                                    .font(.subheadline)
                                if let cat = race.uciCategory {
                                    Text(cat)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }
                    .onDelete { indexSet in
                        for index in indexSet {
                            let race = races[index]
                            raceFollow.setFollowing(race.id, following: false)
                        }
                        races.remove(atOffsets: indexSet)
                    }
                }
            }
        }
        .navigationTitle("Carreras seguidas")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadRaces() }
        .onChange(of: raceFollow.followedRaceIds) { _, _ in
            Task { await loadRaces() }
        }
    }

    private func loadRaces() async {
        guard !raceFollow.followedRaceIds.isEmpty else {
            races = []
            return
        }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let ids = Array(raceFollow.followedRaceIds)
            races = try await SupabaseService.shared.races(byIds: ids)
            races.sort { $0.name < $1.name }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
