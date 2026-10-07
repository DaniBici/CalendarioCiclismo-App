import SwiftUI

/// Símbolos de Calendario Ciclismo sin fondo ni tratamiento de botón.
struct CCHeaderMarkView: View {
    var width: CGFloat = 46

    var body: some View {
        Image("HeaderLogo")
            .resizable()
            .scaledToFit()
            .frame(width: width, height: width * 32 / 74)
            .accessibilityHidden(true)
    }
}

/// Firma completa de la cabecera de Hoy, equivalente a la marca de la web.
struct CCHeaderBrandView: View {
    var title: String = "Calendario Ciclismo"
    var markWidth: CGFloat = 60

    var body: some View {
        HStack(spacing: 8) {
            CCHeaderMarkView(width: markWidth)
            Text(title)
                .font(.custom("GoogleSans-Medium", size: 20, relativeTo: .title3))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .fixedSize(horizontal: true, vertical: false)
    }
}
