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

struct StartlistView: View {
    @State private var viewModel = StartlistViewModel()
    let raceId: String
    var showDismissButton: Bool = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            // La cabecera de carrera queda FIJA arriba (no scrollea con la lista
            // de equipos), igual que en Android y que la pantalla de resultados.
            VStack(spacing: 0) {
                if let race = viewModel.race {
                    StartlistHeaderView(race: race, teamCount: viewModel.teamCount, riderCount: viewModel.riderCount)
                        .padding(.horizontal)
                        .padding(.top, 12)
                        .padding(.bottom, 12)
                        .background(Color(.systemBackground))
                }

                ScrollView {
                    VStack(spacing: 16) {
                        if viewModel.race != nil {
                            if viewModel.isProvisional {
                                StartlistDisclaimerView(type: .provisional)
                            }

                            if viewModel.teamsList.isEmpty && !viewModel.isLoading {
                                Text(LocaleService.t("No hay inscritos registrados", "No startlist available for this race"))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .padding()
                            } else {
                                // Separación entre tarjetas de equipo (antes pegadas).
                                VStack(spacing: 8) {
                                    ForEach(viewModel.teamsList) { team in
                                        StartlistTeamCard(
                                            team: team,
                                            isProvisional: viewModel.isProvisional,
                                            ridersOut: viewModel.ridersOut,
                                            isOneDay: viewModel.race?.raceFormat == "one_day"
                                        )
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom)
                }
                .refreshable {
                    await viewModel.refresh(raceId: raceId)
                }
            }

            if viewModel.isLoading && viewModel.race == nil {
                LoadingView()
            } else if let error = viewModel.error {
                ErrorView(message: error, retry: {
                    Task {
                        await viewModel.load(raceId: raceId)
                    }
                })
            }
        }
        .navigationTitle(viewModel.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if showDismissButton {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel(LocaleService.t("Cerrar", "Close"))
                }
            }
        }
        .task {
            await viewModel.load(raceId: raceId)
            AnalyticsService.shared.logScreenView("startlist", parameters: [
                "race_name": viewModel.race?.name ?? "",
                "race_id": raceId,
            ])
        }
    }
}

// MARK: - Header

struct StartlistHeaderView: View {
    let race: Race
    let teamCount: Int
    let riderCount: Int

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                if let logoUrl = race.logoUrl, let url = URL(string: logoUrl) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image
                                .resizable()
                                .scaledToFit()
                                .frame(height: 48)
                        } else {
                            Image(systemName: "photo")
                                .frame(width: 48, height: 48)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(race.localizedName)
                        .font(.system(.headline, design: .default))
                        .fontWeight(.bold)
                        .lineLimit(2)

                    if let countryCode = race.countryCode {
                        CountryFlag(countryCode: countryCode)
                    }
                }

                Spacer()
            }

            HStack(spacing: 16) {
                // Sin equipos reales (startlist 100% ficticio "Individual") no se
                // muestra "Equipos: 0": solo el total de corredores.
                if teamCount > 0 {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(LocaleService.t("Equipos", "Teams"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("\(teamCount)")
                            .font(.title3)
                            .fontWeight(.semibold)
                    }

                    // Acotado en alto: con la cabecera FIJA (fuera del ScrollView),
                    // un Divider vertical sin límite hace la fila codiciosa en
                    // altura y el header se estira hasta repartirse la pantalla con
                    // la lista. Dentro del ScrollView no pasaba (alto "ideal").
                    Divider()
                        .frame(maxHeight: 32)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(LocaleService.t(race.isFemale ? "Corredoras" : "Corredores", "Riders"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("\(riderCount)")
                        .font(.title3)
                        .fontWeight(.semibold)
                }

                Spacer()
            }
            .padding(.horizontal, 8)
        }
        .padding(12)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Disclaimer

enum DisclaimerType {
    case provisional
}

struct StartlistDisclaimerView: View {
    let type: DisclaimerType

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !title.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "info.circle.fill")
                        .foregroundStyle(type == .provisional ? Color.accentColor : .orange)

                    Text(title)
                        .font(.subheadline)
                        .fontWeight(.semibold)

                    Spacer()
                }
            }

            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(backgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var title: String {
        switch type {
        case .provisional:
            return LocaleService.t("Lista provisional", "Provisional Startlist")
        }
    }

    private var message: String {
        switch type {
        case .provisional:
            return LocaleService.t(
                "No se considera definitiva hasta la reunión de directores. Esta indicación desaparecerá cuando sea oficial.",
                "Not considered final until the team managers' meeting. This notice will disappear once it is official."
            )
        }
    }

    private var backgroundColor: Color {
        switch type {
        case .provisional:
            return Color.accentColor.opacity(0.1)
        }
    }
}

// MARK: - Team Card

struct StartlistTeamCard: View {
    let team: StartlistTeamWithRiders
    let isProvisional: Bool
    /// Corredores fuera de carrera por globalRiderId (tachado de abandonos).
    var ridersOut: [String: RiderOut] = [:]
    var isOneDay: Bool = false

    var body: some View {
        // Tarjeta de equipo en CCCard: la superficie pulida (esquinas, hairline,
        // sombra) envuelve el header con el color del equipo y la lista de
        // corredores. `.ccCardSurface` recorta el contenido a la forma, así que
        // el header coloreado queda enrasado con las esquinas redondeadas.
        VStack(spacing: 0) {
            // El ficticio "Individual" va SIN cabecera (ocultación cosmética,
            // espejo de la web/Android): solo se listan sus corredores.
            if !team.isIndividualPlaceholder {
                StartlistTeamHeaderView(team: team, isProvisional: isProvisional)
            }

            VStack(spacing: 0) {
                ForEach(team.riders) { rider in
                    StartlistRiderRowView(
                        rider: rider,
                        out: rider.globalRiderId.flatMap { ridersOut[$0] },
                        isOneDay: isOneDay
                    )
                }
            }
            .background(Color(.systemBackground))
        }
        .ccCardSurface(showShadow: false)
    }
}

// MARK: - Team Header

struct StartlistTeamHeaderView: View {
    let team: StartlistTeamWithRiders
    let isProvisional: Bool

    var body: some View {
        let textColor: Color = team.team.flatMap { Color.fromHex($0.headerText) } ?? .primary
        let bgColor: Color = team.team.flatMap { Color.fromHex($0.headerBg) } ?? Color(.systemGray6)

        HStack(spacing: 10) {
            if let globalTeam = team.team {
                TeamBadgeView(team: globalTeam, size: 24)
            }

            Text(team.displayName)
                .font(.subheadline)
                .fontWeight(.semibold)
                .lineLimit(1)
                .foregroundStyle(textColor)

            Spacer()

            if isProvisional {
                ZStack {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(team.isConfirmed ? Color.accentColor : (Color.fromHex("#6B7280") ?? .gray))
                    Image(systemName: team.isConfirmed ? "checkmark" : "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                }
                .frame(width: 18, height: 18)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(bgColor)
    }
}

// MARK: - Rider Row

struct StartlistRiderRowView: View {
    let rider: StartlistRiderView
    /// Fuera de carrera (abandono/no-salida/fuera de control/descalificación).
    var out: RiderOut? = nil
    var isOneDay: Bool = false

    var body: some View {
        rowContent
    }

    private var rowContent: some View {
        let isOut = out != nil
        // Fuera de carrera → fila atenuada (opacidad, no color → dark-mode safe).
        return HStack(spacing: 10) {
            // Dorsal — misma tipografía que Orden de salida (.caption, no
            // monoespaciada), conservando el fondo gris en recuadro.
            if let dorsal = rider.dorsal, dorsal > 0 {
                Text("\(dorsal)")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .frame(width: 28, alignment: .center)
                    .padding(.vertical, 2)
                    .padding(.horizontal, 4)
                    .background(Color(.systemGray5))
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                    .foregroundStyle(.secondary)
            } else {
                Color.clear
                    .frame(width: 28, height: 20)
            }

            // Flag (solo si existe countryCode)
            CountryFlag(countryCode: rider.countryCode)

            // Nombre (tachado si fuera de carrera) + motivo como subtítulo.
            VStack(alignment: .leading, spacing: 1) {
                Text(rider.fullName)
                    .font(.subheadline)
                    .lineLimit(2)
                    .strikethrough(isOut)
                if let out {
                    let label = UciResultsLogic.irmLabel(out.irm, isEn: LocaleService.shouldShowEnglishContent)
                    let reason: String = {
                        if let sn = out.stageNumber, !isOneDay {
                            if sn == 0 {
                                return LocaleService.t("\(label) · prólogo", "\(label) · prologue")
                            }
                            return LocaleService.t("\(label) · etapa \(sn)",
                                                   "\(label) · stage \(sn)")
                        }
                        return label
                    }()
                    Text(reason)
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .lineLimit(1)
                }
            }

            Spacer()
        }
        .opacity(isOut ? 0.55 : 1)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(.systemBackground))
    }
}

// MARK: - Team Badge

struct TeamBadgeView: View {
    let team: Team
    let size: Int

    var body: some View {
        let torsoColor: Color = Color.fromHex(team.badgeTorsoCenter) ?? .blue
        let sidesColor: Color = Color.fromHex(team.badgeTorsoSides) ?? .gray
        let shortsColor: Color = Color.fromHex(team.badgeShorts) ?? .black
        let helmetColor: Color = Color.fromHex("#8a8d91") ?? .gray
        let innerColor: Color? = team.badgeInnerCircle.flatMap { Color.fromHex($0) }

        Canvas { context, _ in
            let s = CGFloat(size)
            let cx = s / 2
            let cy = s / 2
            let rOuter = s * 0.48
            let rInner = s * 0.38

            // Polígono exterior (casco)
            var path = Path()
            for i in 0..<22 {
                let angle = (CGFloat.pi * 2 * CGFloat(i)) / 22 - CGFloat.pi / 2
                let x = cx + rOuter * cos(angle)
                let y = cy + rOuter * sin(angle)
                if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                else { path.addLine(to: CGPoint(x: x, y: y)) }
            }
            path.closeSubpath()
            context.stroke(path, with: .color(.gray), lineWidth: s * 0.02)
            context.fill(path, with: .color(helmetColor))

            // Círculo interior — clip para franjas y pantalón
            let innerCircle = Path(ellipseIn: CGRect(x: cx - rInner, y: cy - rInner, width: rInner * 2, height: rInner * 2))
            let stripeW = rInner * 1.4
            let divideY = cy + rInner * 0.4

            context.drawLayer { ctx in
                ctx.clip(to: innerCircle)

                let rectShorts = Path(roundedRect: CGRect(x: 0, y: divideY, width: s, height: s - divideY + 1), cornerRadius: 0)
                ctx.fill(rectShorts, with: .color(shortsColor))

                let rectSides = Path(roundedRect: CGRect(x: 0, y: 0, width: s, height: divideY), cornerRadius: 0)
                ctx.fill(rectSides, with: .color(sidesColor))

                let rectCenter = Path(roundedRect: CGRect(x: cx - stripeW / 2, y: 0, width: stripeW, height: divideY), cornerRadius: 0)
                ctx.fill(rectCenter, with: .color(torsoColor))

                if let ic = innerColor {
                    let innerCy = cy - rInner * 0.35
                    let innerR = rInner * 0.22
                    let circle = Path(ellipseIn: CGRect(x: cx - innerR, y: innerCy - innerR, width: innerR * 2, height: innerR * 2))
                    ctx.fill(circle, with: .color(ic))
                }
            }

            // Borde interior (fuera del clip)
            context.stroke(innerCircle, with: .color(.black.opacity(0.25)), lineWidth: s * 0.018)
        }
        .frame(width: CGFloat(size), height: CGFloat(size))
    }
}

// MARK: - Helpers


#Preview {
    NavigationStack {
        StartlistView(raceId: "test-race")
    }
}
