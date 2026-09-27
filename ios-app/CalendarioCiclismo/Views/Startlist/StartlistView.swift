import SwiftUI
import QuickLook
import WebKit

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
    @State private var contentWidth: CGFloat = 0
    let raceId: String
    var showDismissButton: Bool = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var pdfExporter = StartlistPDFExporter()
    @State private var pdfURL: URL?
    @State private var isExportingPDF = false
    @State private var pdfError: String?

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
                        .background(AppTheme.background)
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
                                let count = AdaptiveLayoutPolicy.startlistColumns(
                                    width: max(0, contentWidth - 32),
                                    isRegular: horizontalSizeClass == .regular
                                )
                                LazyVGrid(
                                    columns: Array(
                                        repeating: GridItem(.flexible(minimum: 0), spacing: 12, alignment: .top),
                                        count: count
                                    ),
                                    alignment: .leading,
                                    spacing: 12
                                ) {
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
                .onGeometryChange(for: CGFloat.self) { geometry in
                    geometry.size.width
                } action: { width in
                    contentWidth = width
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
        .background(AppTheme.background.ignoresSafeArea())
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
            if viewModel.race != nil && !viewModel.teamsList.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await exportPDF() }
                    } label: {
                        if isExportingPDF {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.down.doc")
                        }
                    }
                    .disabled(isExportingPDF)
                    .accessibilityLabel(LocaleService.t("Descargar PDF", "Download PDF"))
                }
            }
        }
        // Vista previa del sistema: guardar en Archivos, imprimir o compartir.
        .quickLookPreview($pdfURL)
        .alert(
            LocaleService.t("No se pudo generar el PDF", "Couldn't generate the PDF"),
            isPresented: Binding(get: { pdfError != nil }, set: { if !$0 { pdfError = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(pdfError ?? "")
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

// MARK: - PDF

extension StartlistView {
    /// Genera el PDF con el mismo generador que la web y lo abre en Vista Rápida.
    fileprivate func exportPDF() async {
        guard !isExportingPDF else { return }
        isExportingPDF = true
        defer { isExportingPDF = false }
        do {
            pdfURL = try await pdfExporter.export(raceId: raceId)
            AnalyticsService.shared.logEvent("startlist_pdf", parameters: ["race_id": raceId])
        } catch {
            pdfError = LocaleService.t(
                "Comprueba la conexión e inténtalo de nuevo.",
                "Check your connection and try again."
            )
        }
    }
}

/// Carga en una vista web invisible `inscritos-pdf.html`, que genera el PDF con
/// `js/inscritos-pdf.js` (fuente única del diseño, compartida con la web y
/// Android) y lo devuelve en base64 por el manejador `ccStartlistPdf`.
@MainActor
final class StartlistPDFExporter: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    enum ExportError: Error {
        case failed(String)
        case timeout
    }

    private static let pageURL = "https://calendariociclismo.app/inscritos-pdf.html"
    private static let handlerName = "ccStartlistPdf"
    private var webView: WKWebView?
    private var continuation: CheckedContinuation<URL, Error>?
    private var timeoutTask: Task<Void, Never>?

    func export(raceId: String) async throws -> URL {
        finish(.failure(ExportError.failed("cancelled")))
        var components = URLComponents(string: Self.pageURL)!
        components.queryItems = [
            URLQueryItem(name: "race", value: raceId),
            URLQueryItem(name: "lang", value: LocaleService.isEnglish ? "en" : "es"),
        ]
        guard let url = components.url else { throw ExportError.failed("url") }

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .nonPersistent()
            configuration.userContentController.add(WeakScriptMessageHandler(self), name: Self.handlerName)
            let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 800), configuration: configuration)
            webView.navigationDelegate = self
            // Dentro de la ventana (transparente) para que WebKit no suspenda el JS.
            webView.alpha = 0
            webView.isUserInteractionEnabled = false
            if let window = UIApplication.shared.connectedScenes
                .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first {
                window.insertSubview(webView, at: 0)
            }
            self.webView = webView
            webView.load(URLRequest(url: url))
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(45))
                guard !Task.isCancelled else { return }
                self?.finish(.failure(ExportError.timeout))
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        guard type == "pdf",
              let fileName = body["fileName"] as? String,
              let base64 = body["base64"] as? String,
              let data = Data(base64Encoded: base64) else {
            finish(.failure(ExportError.failed(body["message"] as? String ?? "error")))
            return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        do {
            try data.write(to: url, options: .atomic)
            finish(.success(url))
        } catch {
            finish(.failure(error))
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(.failure(error))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(.failure(error))
    }

    private func finish(_ result: Result<URL, Error>) {
        timeoutTask?.cancel()
        timeoutTask = nil
        if let webView {
            webView.stopLoading()
            webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName)
            webView.removeFromSuperview()
        }
        webView = nil
        continuation?.resume(with: result)
        continuation = nil
    }
}

/// Evita el ciclo de retención entre WKUserContentController y el exportador.
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
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
        .background(AppTheme.cardBackground)
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
            // Los estados sin equipo van SIN cabecera (ocultación cosmética,
            // espejo de la web/Android): solo se listan sus corredores.
            if !team.isNoTeamPlaceholder {
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
            .background(AppTheme.cardBackground)
        }
        .ccCardSurface(cornerRadius: 0, showShadow: false)
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
        .background(AppTheme.cardBackground)
    }
}

// MARK: - Team colors

/// Tres bandas cromáticas de la equipación efectiva. Resultados y orden de
/// salida usan esta marca lineal. Las chapas circulares se han retirado de las apps.
struct TeamColorBands: View {
    let team: Team
    var width: CGFloat = 15
    var height: CGFloat = 16

    var body: some View {
        if team.hasVisibleBadge {
            HStack(spacing: 0) {
                Color.fromHex(team.badgeTorsoSides) ?? .clear
                Color.fromHex(team.badgeTorsoCenter) ?? .clear
                Color.fromHex(team.badgeShorts) ?? .clear
            }
            .frame(width: width, height: height)
            .clipShape(RoundedRectangle(cornerRadius: 2))
            .overlay {
                RoundedRectangle(cornerRadius: 2)
                    .stroke(AppTheme.borderLight, lineWidth: 1)
            }
            .accessibilityHidden(true)
        }
    }
}

// MARK: - Helpers


#Preview {
    NavigationStack {
        StartlistView(raceId: "test-race")
    }
}
