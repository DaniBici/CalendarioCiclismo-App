import SwiftUI
import WebKit

/// Reproductor de YouTube integrado (`youtube-nocookie`), sin reproducción
/// automática: el usuario pulsa reproducir. Lo comparten la ficha CX, el panel
/// Vídeos de la jornada, la columna de resultados y la sección Vídeos. Al
/// retirarlo de la jerarquía, el vídeo deja de sonar.
struct YouTubeInlinePlayer: UIViewRepresentable {
    let id: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.scrollView.isScrollEnabled = false
        view.isOpaque = false
        view.backgroundColor = .black
        view.loadHTMLString("""
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;width:100%;height:100%;background:#000}iframe{width:100%;height:100%;border:0}</style>
        </head><body><iframe src="https://www.youtube-nocookie.com/embed/\(id)?playsinline=1"
        title="YouTube" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe></body></html>
        """, baseURL: URL(string: "https://calendariociclismo.app"))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}

/// Filas de vídeos en acordeón (docs/plans/videos-5-2.md, D10): una fila por
/// vídeo en el orden de `StageVideoLogic`; la abierta, en seminegrita y sin
/// rótulo de estado, muestra el reproductor bajo su fila; abrir otra pliega la
/// abierta. Los vídeos que no se insertan llevan «<plataforma> ↗».
/// Espejo de `videoRowsHtml` (js/stage/videos-html.js).
struct StageVideoList: View {
    let entries: [StageVideoLogic.Entry]
    let oneDay: Bool
    /// `true`: el primer vídeo insertable nace abierto (jornada, resultados).
    var openFirst: Bool = true
    let onExternal: (URL) -> Void

    @State private var openId: String?
    @State private var didSetInitial = false
    @State private var localeService = LocaleService.shared

    private var firstEmbeddable: String? {
        entries.first { StageVideoLogic.embeddedYouTubeId($0) != nil }?.id
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                if index > 0 { Divider() }
                row(entry)
            }
        }
        .onAppear {
            guard !didSetInitial else { return }
            didSetInitial = true
            if openFirst { openId = firstEmbeddable }
        }
    }

    @ViewBuilder
    private func row(_ entry: StageVideoLogic.Entry) -> some View {
        let title = StageVideoLogic.title(entry, oneDay: oneDay, english: LocaleService.isEnglish)
        if let youtubeId = StageVideoLogic.embeddedYouTubeId(entry) {
            let isOpen = openId == entry.id
            VStack(spacing: 0) {
                Button {
                    Haptics.play(.selection)
                    withAnimation(.easeInOut(duration: 0.2)) { openId = isOpen ? nil : entry.id }
                    if !isOpen { AnalyticsService.shared.logEvent("video_open", parameters: ["platform": "youtube", "video_kind": entry.kind]) }
                } label: {
                    HStack(spacing: 12) {
                        labels(title: title, channel: entry.channel, isOpen: isOpen)
                        Spacer(minLength: 8)
                        if !isOpen {
                            Text(localeService.t("Ver", "Watch"))
                                .ccFont(.s13, weight: .semibold)
                                .foregroundStyle(Color.accentColor)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isOpen ? [.isSelected] : [])
                .accessibilityHint(isOpen ? "" : localeService.t("Muestra el reproductor", "Shows the player"))
                if isOpen {
                    YouTubeInlinePlayer(id: youtubeId)
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .padding(.horizontal, 12)
                        .padding(.bottom, 12)
                        .transition(.opacity)
                }
            }
        } else {
            HStack(spacing: 12) {
                labels(title: title, channel: entry.channel, isOpen: false)
                Spacer(minLength: 8)
                if let url = URL(string: entry.url) {
                    Button("\(StageVideoLogic.platformLabel(entry.url)) ↗") {
                        AnalyticsService.shared.logEvent("video_open", parameters: ["platform": Self.platformKey(entry.url), "video_kind": entry.kind])
                        onExternal(url)
                    }
                    .stagePanelAction()
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
    }

    private func labels(title: String, channel: String?, isOpen: Bool) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .ccFont(.s14, weight: isOpen ? .semibold : .regular)
                .foregroundStyle(.primary)
                .lineLimit(1)
            if let channel, !channel.isEmpty {
                Text(channel)
                    .ccFont(.s13)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    /// Plataforma del evento `video_open`, con los valores de la web.
    static func platformKey(_ url: String) -> String {
        switch StageVideoLogic.platformLabel(url) {
        case "YouTube": return "youtube"
        case "RTVE Play": return "rtve_play"
        case "ETB On": return "etb_on"
        case "RaiPlay": return "raiplay"
        case "Auvio": return "auvio"
        default: return "other"
        }
    }
}

/// Panel «Vídeos» de la jornada terminada (docs/plans/videos-5-2.md, D9).
struct StageVideosPanel: View {
    let entries: [StageVideoLogic.Entry]
    let oneDay: Bool
    let onExternal: (URL) -> Void

    var body: some View {
        StagePanel {
            StagePanelTitle(LocaleService.t("Vídeos", "Videos"))
        } content: {
            StageVideoList(entries: entries, oneDay: oneDay, onExternal: onExternal)
        }
        .id("videos")
        .accessibilityIdentifier(AccessibilityID.stageVideosSection)
    }
}
