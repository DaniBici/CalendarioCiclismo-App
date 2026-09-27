import SwiftUI
import WebKit

struct CxMapView: View {
    let url: URL
    /// Imagen precargada durante la pantalla de carga de la jornada, si la
    /// hay: evita una segunda descarga asíncrona.
    var preloaded: UIImage? = nil
    /// Tope de altura de la imagen: la columna lateral de resultados muestra
    /// el mapa en pequeño, como la web.
    var maxImageHeight: CGFloat? = nil
    @State private var image: UIImage?
    @State private var failed = false
    @State private var expanded = false
    @State private var attempt = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(CyclocrossPresentation.t("Mapa", "Map")).font(.headline)
            if let image {
                Button { expanded = true } label: {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: maxImageHeight)
                        .background(.white)
                }.buttonStyle(.plain)
                    .accessibilityLabel(CyclocrossPresentation.t("Ampliar mapa", "Expand map"))
            } else if failed {
                Text(CyclocrossPresentation.t("No se ha podido cargar el mapa.", "The map could not be loaded."))
                    .foregroundStyle(.secondary)
                HStack {
                    Button(CyclocrossPresentation.t("Reintentar", "Retry")) { attempt += 1 }
                    Link(CyclocrossPresentation.t("Abrir mapa", "Open map"), destination: url)
                }.buttonStyle(.bordered)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 220)
            }
        }.padding().ccCardSurface()
            .task(id: "\(url.absoluteString):\(attempt)") { await load() }
            .sheet(isPresented: $expanded) {
                NavigationStack {
                    CxMapWebView(url: url).ignoresSafeArea(edges: .bottom)
                        .navigationTitle(CyclocrossPresentation.t("Mapa", "Map"))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Link(destination: url) { Image(systemName: "arrow.up.right.square") }
                                    .accessibilityLabel(CyclocrossPresentation.t("Abrir mapa", "Open map"))
                            }
                            ToolbarItem(placement: .topBarTrailing) {
                                Button(CyclocrossPresentation.t("Cerrar", "Close")) { expanded = false }
                            }
                        }
                }
            }
    }

    private func load() async {
        if let preloaded { image = preloaded; failed = false; return }
        image = nil
        failed = false
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            try Task.checkCancellation()
            guard let preview = UIImage(data: data) else { throw URLError(.cannotDecodeContentData) }
            // Decodificada fuera del hilo principal, como la precarga.
            image = await preview.byPreparingForDisplay() ?? preview
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }
}

private struct CxMapWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView()
        view.backgroundColor = .white
        view.scrollView.backgroundColor = .white
        let source = url.absoluteString.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        view.loadHTMLString("""
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=8">
        <style>html,body{margin:0;background:#fff}img{display:block;width:100%;height:auto}</style>
        </head><body><img src="\(source)" alt=""></body></html>
        """, baseURL: nil)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}
