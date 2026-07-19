import SwiftUI

/// Destino de deep link para `mapa/{raceDayId}` (notificaciones / enlaces).
///
/// `RouteMapView` necesita el objeto `RaceDay` completo (con su `routeGpxUrl`),
/// no solo un id, así que esta vista contenedora lo carga por `raceDayId`
/// reutilizando `StageDetailViewModel` y luego presenta el mapa. Mientras carga
/// muestra un spinner; si la jornada no tiene mapa (`routeGpxUrl` nulo), cae al
/// detalle de la jornada (destino sensato en vez de pantalla vacía). Espejo de
/// `ProfileDestinationView`.
struct RouteMapDestinationView: View {
    let raceDayId: String

    @State private var viewModel = StageDetailViewModel()

    var body: some View {
        Group {
            if let rd = viewModel.raceDay {
                if rd.routeGpxUrl?.isEmpty == false {
                    RouteMapView(raceDay: rd, race: viewModel.race)
                } else {
                    StageDetailView(raceDayId: raceDayId)
                }
            } else if viewModel.error != nil {
                StageDetailView(raceDayId: raceDayId)
            } else {
                LoadingView()
            }
        }
        .task { await viewModel.load(raceDayId: raceDayId) }
    }
}
