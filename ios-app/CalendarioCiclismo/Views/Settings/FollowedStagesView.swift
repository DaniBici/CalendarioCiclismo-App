import SwiftUI

/// Lista de jornadas seguidas individualmente para notificaciones push.
/// Accesible desde Ajustes → Notificaciones → Carreras y jornadas → Jornadas seguidas.
struct FollowedStagesView: View {
    @State private var raceFollow = RaceFollowService.shared
    @State private var stages: [RaceDay] = []
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading {
                LoadingView()
            } else if let error {
                ErrorView(message: error) {
                    Task { await loadStages() }
                }
            } else if stages.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "bell.slash")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text("Sin jornadas seguidas")
                        .font(.headline)
                    Text("Pulsa Notificaciones en cualquier jornada para añadirla.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(stages) { stage in
                        VStack(alignment: .leading, spacing: 2) {
                            let label = stage.stageLabel.isEmpty ? stage.dateKey : stage.stageLabel
                            Text(label)
                                .font(.subheadline)
                            if let routeDesc = stage.routeDescription, !routeDesc.isEmpty {
                                Text(routeDesc)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .onDelete { indexSet in
                        for index in indexSet {
                            let stage = stages[index]
                            raceFollow.setFollowingStage(stage.id, following: false)
                        }
                        stages.remove(atOffsets: indexSet)
                    }
                }
            }
        }
        .navigationTitle("Jornadas seguidas")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadStages() }
        .onChange(of: raceFollow.followedStageIds) { _, _ in
            Task { await loadStages() }
        }
    }

    private func loadStages() async {
        guard !raceFollow.followedStageIds.isEmpty else {
            stages = []
            return
        }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let ids = Array(raceFollow.followedStageIds)
            stages = try await SupabaseService.shared.raceDays(byIds: ids)
            stages.sort { ($0.dateKey) < ($1.dateKey) }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
