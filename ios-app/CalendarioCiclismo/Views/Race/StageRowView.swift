import SwiftUI

/// Tarjeta de etapa dentro del detalle de carrera (vista de competición).
///
/// Misma "tarjeta canónica" (`CCCard`) que el cintillo "Hoy": el mini-perfil de
/// elevación se renderiza como franja a sangre (edge-to-edge) al fondo, con
/// relleno temporal cuando hay horas de salida/llegada (paridad con la web).
struct StageRowView: View {
    let item: EnrichedRaceDay
    let race: Race
    /// Llamada cuando el usuario pulsa el icono de resultados (trofeo). Nil = no
    /// mostrar. Se pasa solo cuando la etapa ya terminó (paridad con "Hoy").
    var onShowResults: (() -> Void)? = nil
    /// Llamada cuando el usuario pulsa el icono de Revive (TV). Nil = no mostrar.
    var onRevive: (() -> Void)? = nil

    @State private var premium = PremiumService.shared

    private var rd: RaceDay { item.raceDay }

    /// Modo terminado: hay resultados o revive disponibles. Igual que en "Hoy"
    /// (y que la web), cambia el accesorio derecho (chevron → iconos de
    /// resultados/revive) y completa el mini-perfil.
    private var isFinishedMode: Bool { onShowResults != nil || onRevive != nil }

    private var showsMiniProfile: Bool {
        guard premium.featuresUnlocked else { return false }
        guard !rd.isRestDay, !rd.isCancelledDay else { return false }
        guard let pts = rd.elevationProfile?.points, pts.count >= 2 else { return false }
        return true
    }

    /// Altura de la franja del mini-perfil (a sangre, al fondo de la tarjeta).
    private var miniProfileBandHeight: CGFloat {
        switch rd.primaryType {
        case "high_mountain", "summit_finish", "chrono_climb": return 54
        case "medium_mountain": return 46
        case "cotas", "uphill_finish", "rolling", "cobbles", "sterrato": return 40
        default: return 34
        }
    }

    private var miniProfileTint: Color {
        if let hex = race.colorHex, !hex.isEmpty { return Color(hex: hex) }
        return .accentColor
    }

    var body: some View {
        CCCard(
            accent: miniProfileTint,
            accentAlpha: 0.04,
            cornerRadius: 14,
            showShadow: false
        ) {
            VStack(spacing: 0) {
                contentRow
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                    .padding(.bottom, showsMiniProfile ? 8 : 12)

                if showsMiniProfile, let profile = rd.elevationProfile {
                    miniProfileBand(profile)
                }
            }
        }
        // La jornada cancelada NO se atenúa: su aviso ya lo dice y su ficha
        // (recorrido, perfil, documentación) sigue siendo accesible. Paridad
        // con Hoy, la web y Android.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(AccessibilityRaceDescription.stageRowLabel(item: item))
        .accessibilityHint(rd.isRestDay ? "" : "Pulsa dos veces para ver el detalle")
        .accessibilityIdentifier(AccessibilityID.stageRow(item.id))
    }

    // MARK: - Fila de contenido

    private var contentRow: some View {
        HStack(spacing: 10) {
            // Número de etapa / icono descanso / cancelada
            VStack {
                if rd.isRestDay {
                    Image(systemName: "moon.zzz")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                } else if rd.isCancelledDay {
                    Image(systemName: "xmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(AppTheme.red)
                        .accessibilityHidden(true)
                } else {
                    Text(rd.stageLabelShort.isEmpty ? "—" : rd.stageLabelShort)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 36)

            // Info
            VStack(alignment: .leading, spacing: 3) {
                if rd.isRestDay {
                    Text("Jornada de descanso")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    Text(DateFormatting.formatDateShort(rd.dateKey))
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    if let route = rd.routeDescription {
                        Text(route)
                            .font(.subheadline)
                            .lineLimit(1)
                    }

                    HStack(spacing: 4) {
                        if rd.isCancelledDay {
                            Text("Etapa cancelada")
                                .font(.caption2)
                                .foregroundStyle(AppTheme.red)
                        } else if !showsMiniProfile || rd.primaryType == "itt" || rd.primaryType == "ttt" {
                            StageTypeBadge(primaryType: rd.primaryType, secondaryType: rd.secondaryType, countryCode: rd.countryCode ?? race.countryCode)
                        }

                        if let dist = rd.distanceFormatted {
                            Text(dist)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if rd.distanceFormatted != nil && rd.elevationGainFormatted != nil {
                            Text("·")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if let elev = rd.elevationGainFormatted {
                            Text(elev)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Spacer(minLength: 0)

            if isFinishedMode {
                finishedIconsColumn
            } else if !rd.isRestDay && !rd.isCancelledDay {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
    }

    // MARK: - Iconos de resultados/revive (modo terminado)

    private var finishedIconsColumn: some View {
        HStack(spacing: 4) {
            if let onShowResults {
                Button {
                    onShowResults()
                } label: {
                    Image(systemName: "trophy")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(LocaleService.t("Resultados", "Results"))
            }
            if let onRevive {
                Button {
                    onRevive()
                } label: {
                    Image(systemName: "tv")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(LocaleService.t("Revive la carrera", "Relive the race"))
            }
        }
    }

    // MARK: - Franja de perfil a sangre

    /// Franja de perfil a sangre (edge-to-edge) al fondo de la tarjeta. La
    /// `CCCard` recorta las esquinas inferiores. Lleva las horas de salida/
    /// llegada para el relleno temporal (gris → teñido según % transcurrido).
    @ViewBuilder
    private func miniProfileBand(_ profile: ElevationProfile) -> some View {
        MiniElevationProfile(
            profile: profile,
            summits: rd.profileSummits ?? [],
            waypoints: rd.profileWaypoints ?? [],
            tint: miniProfileTint,
            height: miniProfileBandHeight,
            primaryType: rd.primaryType,
            startTime: rd.neutralStartTimeUtc.flatMap(DateFormatting.parseISO),
            endTime: rd.estimatedFinishTimeUtc.flatMap(DateFormatting.parseISO),
            isTimeTrial: rd.primaryType == "itt" || rd.primaryType == "ttt",
            usesLineFallbackWithoutTimeTrialSchedule: true,
            forceCompleted: isFinishedMode
        )
    }
}
