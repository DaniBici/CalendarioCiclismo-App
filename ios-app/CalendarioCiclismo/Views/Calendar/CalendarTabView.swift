import SwiftUI

/// Pestaña "Calendario" — fusión de Mes + Temporada (apps 3.1, fase F3).
/// Renderiza una de las dos vistas con un toggle en el toolbar para alternar;
/// la elección persiste en `calendar_subview` (espejo de Android).
struct CalendarTabView: View {
    @AppStorage("calendar_subview") private var sub: String = "month"

    var body: some View {
        if sub == "season" {
            SeasonView(switchAction: { sub = "month" })
        } else {
            MonthView(switchAction: { sub = "season" })
        }
    }
}
