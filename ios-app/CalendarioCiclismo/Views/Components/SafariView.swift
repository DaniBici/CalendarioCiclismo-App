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
