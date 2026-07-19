import Foundation

/// Versión de un equipo en una temporada concreta (tabla `team_seasons`).
/// El render de inscritos prefiere estos atributos visuales sobre los de `teams`
/// cuando existe una fila para el año de la carrera; si no existe, se mantiene
/// `teams` como fallback (ver `Team.applyingSeason`). En 2026 ambos coinciden.
struct TeamSeason: Codable {
    let teamId: String
    let year: Int
    let name: String?
    /// Override de categoría por temporada (mismo criterio que SEASON_VISUAL en
    /// la web: corredor.js/equipo.js aplican `category` de la season si existe).
    let category: String?
    let badgeTorsoCenter: String?
    let badgeTorsoSides: String?
    let badgeShorts: String?
    let badgeInnerCircle: String?
    let headerBg: String?
    let headerText: String?
    let gender: String?
    /// Chapa ocultable por temporada (mig. 122): las filas 2027 nacen ocultas
    /// porque los kits no se anuncian hasta dentro de meses; el panel la activa
    /// en equipos estables. Solo la consume la pantalla de Fichajes.
    let badgeVisible: Bool?
    /// Continuidad del equipo en duda (mig. 123): sigue listado en su división,
    /// con chip y aviso (ej.: sin sponsor todavía). Distinto de la AUSENCIA de
    /// fila, que sigue significando "no continúa". Solo Fichajes lo consume.
    let continuityDoubt: Bool?
}
