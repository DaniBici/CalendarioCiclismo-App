import SwiftUI

/// Modal de resultados post-carrera: links a fuentes externas.
/// Equivalente a `openResultsModal` en `js/race-data-modal.js`.
struct ResultsSheet: View {
    let race: Race
    let raceDay: RaceDay
    let onDismiss: () -> Void

    @State private var safariUrl: URL?

    private var extUrlA: URL? { RaceLogic.buildExtUrlA(race: race, stageNumber: raceDay.stageNumber) }
    private var extUrlB: URL? { RaceLogic.buildExtUrlB(race: race, stageNumber: raceDay.stageNumber, stageSuffix: raceDay.stageSuffix) }

    private var title: String {
        race.isOneDay ? "Resultados" : "Resultados · \(raceDay.stageLabel)"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        if race.hideFlag != true {
                            CountryFlag(countryCode: raceDay.countryCode ?? race.countryCode)
                        }
                        Text(race.localizedName)
                            .font(.headline)
                            .lineLimit(2)
                    }
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button { onDismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Cerrar")
            }
            .padding()

            Divider()

            VStack(spacing: 12) {
                if let url = extUrlA {
                    ResultsLinkButton(label: "fuente externa", url: url, onOpen: { safariUrl = url })
                }
                if let url = extUrlB {
                    ResultsLinkButton(label: "fuente externa", url: url, onOpen: { safariUrl = url })
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 20)
        }
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.3), radius: 24, y: 12)
        .padding(.horizontal, 24)
        .safariSheet(url: $safariUrl)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }
}

private struct ResultsLinkButton: View {
    let label: String
    let url: URL
    let onOpen: () -> Void

    var body: some View {
        Button {
            onOpen()
        } label: {
            HStack {
                Text(label)
                    .font(.subheadline)
                    .fontWeight(.medium)
                Spacer()
                Image(systemName: "arrow.up.right.square")
                    .font(.caption)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 10))
            .foregroundStyle(.white)
        }
        .accessibilityLabel("\(label), abre en navegador")
    }
}

/// Wrapper that shows a ResultsSheet as an overlay.
struct ResultsSheetOverlay: ViewModifier {
    @Binding var item: ResultsSheetItem?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .overlay {
                if let item {
                    Color.black.opacity(0.4)
                        .ignoresSafeArea()
                        .onTapGesture { self.item = nil }
                        .accessibilityHidden(true)

                    ResultsSheet(
                        race: item.race,
                        raceDay: item.raceDay,
                        onDismiss: { self.item = nil }
                    )
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.95)))
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: item != nil)
    }
}

struct ResultsSheetItem: Identifiable {
    let id = UUID()
    let race: Race
    let raceDay: RaceDay
}

extension View {
    func resultsSheet(item: Binding<ResultsSheetItem?>) -> some View {
        modifier(ResultsSheetOverlay(item: item))
    }
}
