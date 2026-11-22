import SwiftUI
import TipKit

// Burbujas de la primera visita a Hoy (5.2.4), con TipKit: primero «Filtros»
// y después «Ordenar», en un grupo ordenado por disciplina. Hoy de carretera y
// Hoy de Ciclocross tienen cada uno su primera vez. Solo aparecen con el
// arranque y la bienvenida terminados (`appReady`); al pulsar «Siguiente» o
// «Entendido» la burbuja se retira y no vuelve. Espejo de `TodayTips.kt`
// (Android). Últimos resultados tiene la suya, `ResultsFiltersTip`.

enum TodayTipDiscipline: String {
    case road, cyclocross
}

struct TodayFiltersTip: Tip {
    let discipline: TodayTipDiscipline

    /// Arranque y bienvenida terminados (lo actualiza `CalendarioCiclismoApp`).
    @Parameter static var appReady: Bool = false
    /// Hoy de cada disciplina a la vista (lo actualiza `ScreenTipModifier`). Con
    /// la pantalla fuera de la vista la burbuja no es elegible: TipKit no la da
    /// por vista ni la presenta, y la retira si se sale con ella abierta.
    @Parameter static var roadVisible: Bool = false
    @Parameter static var cyclocrossVisible: Bool = false

    static func setVisible(_ visible: Bool, _ discipline: TodayTipDiscipline) {
        switch discipline {
        case .road: roadVisible = visible
        case .cyclocross: cyclocrossVisible = visible
        }
    }

    var id: String { "today-filters-\(discipline.rawValue)" }
    var title: Text { Text(LocaleService.t("Filtros", "Filters")) }
    var message: Text? {
        switch discipline {
        case .road:
            return Text(LocaleService.t(
                "Elige si quieres ver las pruebas masculinas o femeninas del WorldTour, el resto de pruebas profesionales (ProSeries, .1, Nacionales) o las carreras .2. Puedes mezclarlas y lo que elijas se guarda.",
                "Choose whether you want to see men's or women's WorldTour races, the rest of professional races (ProSeries, .1, Nationals) or .2 races. You can mix them and your choice is saved."
            ))
        case .cyclocross:
            return Text(LocaleService.t(
                "Elige si quieres ver los grandes torneos (Big), el resto de pruebas UCI o las pruebas Nacionales españolas. Puedes mezclarlas y lo que elijas se guarda.",
                "Choose whether you want to see the big series (Big) or the rest of UCI races. You can mix them and your choice is saved."
            ))
        }
    }
    var image: Image? { Image(systemName: "line.3.horizontal.decrease.circle") }
    var rules: [Rule] {
        switch discipline {
        case .road: [#Rule(Self.$appReady) { $0 }, #Rule(Self.$roadVisible) { $0 }]
        case .cyclocross: [#Rule(Self.$appReady) { $0 }, #Rule(Self.$cyclocrossVisible) { $0 }]
        }
    }
    var actions: [Action] { [Action(id: "next", title: LocaleService.t("Siguiente", "Next"))] }
}

struct TodaySortTip: Tip {
    let discipline: TodayTipDiscipline

    var id: String { "today-sort-\(discipline.rawValue)" }
    var title: Text { Text(LocaleService.t("Ordenar", "Sort")) }
    var message: Text? {
        Text(LocaleService.t(
            "Organiza las carreras que has elegido por categoría, por hora de final o por hora de TV (las que la tengan). También se queda guardado.",
            "Arrange the races you have chosen by category, by end time or by TV time (for those that have it). It is saved too."
        ))
    }
    var image: Image? { Image(systemName: "arrow.up.arrow.down") }
    var rules: [Rule] {
        switch discipline {
        case .road: [#Rule(TodayFiltersTip.$roadVisible) { $0 }]
        case .cyclocross: [#Rule(TodayFiltersTip.$cyclocrossVisible) { $0 }]
        }
    }
    var actions: [Action] { [Action(id: "done", title: LocaleService.t("Entendido", "Got it"))] }
}

/// Burbuja de «Filtros» de Últimos resultados: una sola vez, la primera vez
/// que se abre Resultados. Los filtros son los de Hoy y Calendario.
struct ResultsFiltersTip: Tip {
    /// Resultados a la vista (lo actualiza `ScreenTipModifier`).
    @Parameter static var visible: Bool = false

    var id: String { "results-filters" }
    var title: Text { Text(LocaleService.t("Filtros", "Filters")) }
    var message: Text? {
        Text(LocaleService.t(
            "Los filtros que apliques en las secciones Hoy o Calendario se trasladan a Resultados. Así solo ves las clasificaciones que te interesan.",
            "The filters you apply in the Today or Calendar sections carry over to Results. That way you only see the classifications you care about."
        ))
    }
    var image: Image? { Image(systemName: "line.3.horizontal.decrease.circle") }
    var rules: [Rule] { [#Rule(TodayFiltersTip.$appReady) { $0 }, #Rule(Self.$visible) { $0 }] }
    var actions: [Action] { [Action(id: "done", title: LocaleService.t("Entendido", "Got it"))] }
}

enum TodayTips {
    /// Grupo ordenado de una disciplina: Filtros y después Ordenar.
    static func group(_ discipline: TodayTipDiscipline) -> TipGroup {
        TipGroup(.ordered) {
            TodayFiltersTip(discipline: discipline)
            TodaySortTip(discipline: discipline)
        }
    }

    /// El popover abierto, si lo hay (las burbujas de TipKit lo son).
    @MainActor private static func openPopover() -> UIViewController? {
        let root = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.rootViewController
        var top = root
        while let presented = top?.presentedViewController { top = presented }
        guard let top, top !== root, top.modalPresentationStyle == .popover else { return nil }
        return top
    }

    /// Cierra el popover que haya abierto. El cambio de pestaña por código
    /// (enlace profundo, notificación) no lo cierra y quedaba sobre la pantalla
    /// nueva. La burbuja no se da por vista: su regla de elegibilidad vuelve a
    /// cumplirse al regresar a su pantalla.
    @MainActor static func dismissPopovers() {
        openPopover()?.dismiss(animated: false)
    }

    /// Retira el popover abierto cuando una navegación por código (enlace
    /// profundo, widget, notificación) empuja otra pantalla encima de Hoy: la
    /// burbuja se quedaba sobre la pantalla nueva. Cerrarlo mientras la
    /// pantalla se empuja deja la barra superior sin título, de modo que se
    /// oculta al instante y se cierra cuando la navegación ha terminado.
    @MainActor static func retirePopovers() {
        guard let popover = openPopover() else { return }
        popover.presentationController?.containerView?.alpha = 0
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            if popover.presentingViewController != nil { popover.dismiss(animated: false) }
        }
    }

    /// Una vez por arranque, antes de mostrar ninguna burbuja.
    static func configure() {
        try? Tips.configure([.displayFrequency(.immediate)])
    }
}

/// Contenido de la burbuja: el de TipKit (icono, título, texto, cierre y
/// acción) con el botón de radio de control de la app en lugar de la cápsula.
struct TodayTipStyle: TipViewStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 14) {
                configuration.image?
                    .font(.title2)
                    .foregroundStyle(Color.accentColor)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    configuration.title?
                        .ccFont(.s16, weight: .semibold)
                    configuration.message?
                        .ccFont(.s14)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Button {
                    configuration.tip.invalidate(reason: .tipClosed)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(LocaleService.t("Cerrar", "Close"))
            }
            ForEach(configuration.actions) { action in
                Button(action: action.handler) {
                    action.label()
                        .ccFont(.s16, weight: .semibold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: AppTheme.Radius.control))
            }
        }
        // Margen interior más amplio que el de TipKit: el texto no roza el
        // borde de la burbuja ni el botón su base.
        .padding(.horizontal, 24)
        .padding(.top, 22)
        .padding(.bottom, 24)
    }
}

private struct TabSelectedKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// `false` en las pestañas que no están a la vista (lo fija `ContentView`).
    var isTabSelected: Bool {
        get { self[TabSelectedKey.self] }
        set { self[TabSelectedKey.self] = newValue }
    }
}

/// Burbuja anclada a una vista, que solo es elegible con su pantalla a la
/// vista: pestaña seleccionada y vista en pantalla. Sin esto, una pestaña que
/// SwiftUI monta sin estar seleccionada (arranque directo a otra sección o
/// enlace profundo) presentaba su burbuja fuera de su pantalla y TipKit la
/// daba por vista: la burbuja debe salir la primera vez que se abre su vista,
/// se venga de donde se venga.
private struct ScreenTipModifier<T: Tip>: ViewModifier {
    let tip: T?
    let setVisible: (Bool) -> Void
    let onAction: () -> Void
    @Environment(\.isTabSelected) private var isTabSelected
    @State private var isOnScreen = false

    func body(content: Content) -> some View {
        let isVisible = isTabSelected && isOnScreen
        // La regla de elegibilidad retira la burbuja del estado de TipKit, pero
        // no cierra un popover ya abierto: de eso se encarga
        // `TodayTips.dismissPopovers` al cambiar de pestaña.
        content
            .popoverTip(isVisible ? tip : nil, arrowEdge: .top) { _ in
                onAction()
            }
            .tipViewStyle(TodayTipStyle())
            .onAppear { isOnScreen = true }
            .onDisappear { isOnScreen = false }
            .onChange(of: isVisible, initial: true) { _, visible in setVisible(visible) }
    }
}

extension View {
    /// Burbuja de `tips` anclada a esta vista cuando el grupo está en el paso
    /// `T`; la acción la retira y da paso a la siguiente. Solo con la pantalla
    /// a la vista.
    func todayTip<T: Tip>(_ tips: TipGroup, _ type: T.Type, discipline: TodayTipDiscipline) -> some View {
        modifier(ScreenTipModifier(
            tip: tips.currentTip as? T,
            setVisible: { TodayFiltersTip.setVisible($0, discipline) },
            onAction: { tips.currentTip?.invalidate(reason: .actionPerformed) }
        ))
    }

    /// Burbuja de «Filtros» de Últimos resultados, solo con Resultados a la vista.
    func resultsTip(_ tip: ResultsFiltersTip) -> some View {
        modifier(ScreenTipModifier(
            tip: tip,
            setVisible: { ResultsFiltersTip.visible = $0 },
            onAction: { tip.invalidate(reason: .actionPerformed) }
        ))
    }
}
