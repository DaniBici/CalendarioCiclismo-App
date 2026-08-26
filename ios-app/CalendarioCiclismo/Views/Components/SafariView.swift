import SwiftUI
import SafariServices

/// Wrapper de SFSafariViewController para abrir enlaces dentro de la app.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

/// Modifier para presentar SafariView como sheet.
struct SafariSheet: ViewModifier {
    @Binding var url: URL?

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: Binding(
                get: { url != nil },
                set: { if !$0 { url = nil } }
            )) {
                if let url {
                    SafariView(url: url)
                        .ignoresSafeArea()
                }
            }
    }
}

extension View {
    func safariSheet(url: Binding<URL?>) -> some View {
        modifier(SafariSheet(url: url))
    }
}

/// Intenta una app nativa solo mediante enlace universal. Al no existir una app
/// capaz de resolverlo, ejecuta el fallback proporcionado por la vista llamante.
@MainActor
enum NativeAppLinkOpener {
    static func openIfInstalled(_ url: URL, fallback: @escaping () -> Void) {
        guard RaceLogic.prefersNativeApp(url) else {
            fallback()
            return
        }
        UIApplication.shared.open(
            url,
            options: [.universalLinksOnly: true]
        ) { opened in
            if !opened { fallback() }
        }
    }
}
