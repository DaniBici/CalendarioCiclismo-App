import SwiftUI

/// Destinos de vídeo de una jornada terminada con clasificaciones propias
/// (docs/plans/videos-5-2.md, fase 7): `hasVideos` (vídeos propios distintos de
/// la emisión íntegra; abren la jornada en su panel Vídeos) y `revive` (la
/// emisión íntegra). Espejo de `cardVideoActions` (js/services/stage-videos.js).
struct FinishedVideoTargets {
    let hasVideos: Bool
    let reviveURL: URL?

    @MainActor init(item: EnrichedRaceDay, hasResults: Bool) {
        guard hasResults else { hasVideos = false; reviveURL = nil; return }
        let videos = StageVideoLogic.filterByRegion(item.videos ?? [], allowedGroups: RegionService.shared.allowedBroadcastGroups)
        let actions = StageVideoLogic.cardActions(broadcasts: item.broadcasts, videos: videos)
        hasVideos = actions.hasVideos
        reviveURL = actions.revive.flatMap { URL(string: $0.url ?? "") }
    }
}

/// Acción de vídeo de la tarjeta terminada: con vídeos y emisión íntegra, un
/// menú «Vídeos» / «Completa» («Videos» / «Broadcast»); con uno de los dos, su
/// botón. Glifo de TV, como la web (`finishedVideoActionHtml`).
struct FinishedVideoAction: View {
    var onShowVideos: (() -> Void)?
    var onRevive: (() -> Void)?
    var font: Font
    var size: CGSize
    var alignment: Alignment = .center

    var body: some View {
        if let onShowVideos, let onRevive {
            Menu {
                Button(LocaleService.t("Vídeos", "Videos"), action: onShowVideos)
                Button(LocaleService.t("Completa", "Broadcast"), action: onRevive)
            } label: {
                glyph(LocaleService.t("Vídeos o emisión completa", "Videos or full broadcast"))
            }
            .buttonStyle(.plain)
        } else if let onShowVideos {
            Button(action: onShowVideos) { glyph(LocaleService.t("Vídeos", "Videos")) }
                .buttonStyle(.plain)
        } else if let onRevive {
            Button(action: onRevive) { glyph(LocaleService.t("Revive la carrera", "Relive the race")) }
                .buttonStyle(.plain)
        }
    }

    private func glyph(_ label: String) -> some View {
        Label(label, systemImage: "tv")
            .labelStyle(.iconOnly)
            .font(font)
            .foregroundStyle(.secondary)
            .frame(width: size.width, height: size.height, alignment: alignment)
            .contentShape(Rectangle())
    }
}

/// Jornada abierta en su panel Vídeos desde una tarjeta o la sección Vídeos.
struct StageVideosRoute: Hashable, Identifiable {
    let raceDayId: String
    let raceId: String?
    let title: String?
    var id: String { raceDayId }
}
