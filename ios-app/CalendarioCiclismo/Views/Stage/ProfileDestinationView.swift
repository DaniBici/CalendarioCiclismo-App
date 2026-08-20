import SwiftUI

/// Destino de deep link para `perfil/{raceDayId}` (notificaciones).
///
/// `ElevationProfileView` necesita el objeto `RaceDay` completo (con su
/// `elevationProfile`), no solo un id, así que esta vista contenedora lo carga
/// por `raceDayId` reutilizando `StageDetailViewModel` y luego presenta el
/// perfil. Mientras carga muestra un spinner; si la jornada no tiene perfil de
/// elevación, cae al detalle de la jornada (destino sensato en vez de pantalla
/// vacía).
struct ProfileDestinationView: View {
    let raceDayId: String

    @State private var viewModel = StageDetailViewModel()

    var body: some View {
        Group {
            if let rd = viewModel.raceDay {
                if rd.elevationProfile?.points.isEmpty == false {
                    ElevationProfileView(raceDay: rd, race: viewModel.race)
                } else {
                    // Sin perfil cargado → mostrar el detalle de la jornada.
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
