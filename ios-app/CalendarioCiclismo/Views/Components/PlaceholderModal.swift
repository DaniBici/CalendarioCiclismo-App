import SwiftUI

/// Modal para carreras sin información extra (no clickables / placeholders).
/// Equivalente a `#ph-banner` del website.
struct PlaceholderModal: View {
    let race: Race
    let raceDay: RaceDay?
    let onDismiss: () -> Void
    var websiteUrl: String? = nil

    @Environment(\.openURL) private var openURL

    private var message: String {
        if let rd = raceDay, rd.isCancelledDay {
            return "Etapa cancelada"
        }
        let todayStr = DateFormatting.todayKey()
        let dateKey = raceDay?.dateKey ?? race.startDate ?? ""
        if todayStr < dateKey {
            return "Por ahora sin información extra"
        }
        return "Sin información extra"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        if race.hideFlag != true {
                            CountryFlag(countryCode: race.countryCode)
                        }
                        Text(race.localizedName)
                            .font(.headline)
                            .lineLimit(2)
                    }

                    HStack(spacing: 6) {
                        if let rd = raceDay, !rd.stageLabel.isEmpty {
                            Text(rd.stageLabel)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let rd = raceDay {
                            Text(DateFormatting.formatDateLong(rd.dateKey))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text(DateFormatting.formatDateRange(start: race.startDate, end: race.endDate))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Spacer()

                Button {
                    onDismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Cerrar")
            }
            .padding()

            Divider()

            // Body
            VStack(spacing: 16) {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 16)

                if let urlStr = websiteUrl, let url = URL(string: urlStr) {
                    Button {
                        openURL(url)
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "globe")
                            Text(LocaleService.t("Web oficial", "Official website"))
                        }
                        .font(.caption)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                    }
                    .accessibilityLabel(LocaleService.t("Web oficial", "Official website"))
                }

                Button("Cerrar") {
                    onDismiss()
                }
                .buttonStyle(.bordered)
                .padding(.bottom, 16)
            }
            .padding(.horizontal)
        }
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.3), radius: 24, y: 12)
        .padding(.horizontal, 24)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }
}

/// Wrapper that shows a PlaceholderModal as an overlay.
struct PlaceholderModalOverlay: ViewModifier {
    @Binding var item: PlaceholderModalItem?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .overlay {
                if let item {
                    Color.black.opacity(0.4)
                        .ignoresSafeArea()
                        .onTapGesture { self.item = nil }
                        .accessibilityHidden(true)

                    PlaceholderModal(
                        race: item.race,
                        raceDay: item.raceDay,
                        onDismiss: { self.item = nil },
                        websiteUrl: item.websiteUrl
                    )
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.95)))
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: item != nil)
    }
}

/// Data for the placeholder modal.
struct PlaceholderModalItem: Identifiable {
    let id = UUID()
    let race: Race
    let raceDay: RaceDay?
    let websiteUrl: String?

    init(race: Race, raceDay: RaceDay?, websiteUrl: String? = nil) {
        self.race = race
        self.raceDay = raceDay
        self.websiteUrl = websiteUrl
    }
}

extension View {
    func placeholderModal(item: Binding<PlaceholderModalItem?>) -> some View {
        modifier(PlaceholderModalOverlay(item: item))
    }
}
