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
    /// Sin título, solo los símbolos: deja sitio al conmutador «CX | Ruta».
    var showsTitle = true

    var body: some View {
        HStack(spacing: 8) {
            CCHeaderMarkView(width: markWidth)
            if showsTitle {
                Text(title)
                    .font(.custom("GoogleSans-Medium", size: 20, relativeTo: .title3))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }
}

/// Disciplina que muestra la pestaña Ciclocross mientras Hoy de carretera está
/// retirada (`RoadTodayAvailability`): su agenda o Hoy de carretera.
enum HomeDiscipline {
    case cyclocross, road
}

/// Conmutador «CX | Ruta» de la cabecera, a la izquierda de Ajustes: control
/// segmentado nativo, como el de Fichajes y Resultados. Mientras existe, la
/// firma de la cabecera muestra solo los símbolos. Espejo de
/// `HomeDisciplineSwitch` en Android y de `js/components/discipline-switch.js`.
struct HomeDisciplineSwitch: View {
    let selection: HomeDiscipline
    let onSelect: (HomeDiscipline) -> Void

    var body: some View {
        Picker(
            LocaleService.t("Disciplina", "Discipline"),
            selection: Binding(
                get: { selection },
                set: { value in
                    guard value != selection else { return }
                    Haptics.play(.selection)
                    onSelect(value)
                }
            )
        ) {
            Text("CX")
                .accessibilityLabel(LocaleService.t("Ciclocross", "Cyclocross"))
                .tag(HomeDiscipline.cyclocross)
            Text(LocaleService.t("Ruta", "Road"))
                .accessibilityLabel(LocaleService.t("Carretera", "Road"))
                .tag(HomeDiscipline.road)
        }
        .pickerStyle(.segmented)
        .fixedSize()
    }
}
