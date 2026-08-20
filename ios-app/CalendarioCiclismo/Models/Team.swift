import Foundation

/// Equipo global (tabla `teams`) con colores y estilos para inscritos enriquecidos.
struct Team: Codable, Identifiable {
    let id: String
    let name: String
    let badgeTorsoCenter: String
    let badgeTorsoSides: String
    let badgeShorts: String
    let badgeInnerCircle: String?
    let headerBg: String
    let headerText: String
    /// Alias de matching (uno por línea) — para casar nombres crudos de fuentes
    /// externas (UCI/Tissot) por nombre, como `findMatchingTeam` en la web.
    let nameAliases: String?
    /// Categoría UCI del equipo (WT/WWT/PT/PRW/CT/…). `var` con default para que
    /// el init memberwise existente (tests, applyingSeason) siga compilando.
    var category: String? = nil

    /// Render temporal: devuelve una copia con los atributos VISUALES de la temporada
    /// sobrescritos cuando la season los aporta (no nulos). Si `season` es nil, devuelve
    /// el equipo intacto. `teams` es siempre el fallback → nunca se pierde la chapa.
    func applyingSeason(_ season: TeamSeason?) -> Team {
        guard let s = season else { return self }
        return Team(
            id: id,
            name: s.name ?? name,
            badgeTorsoCenter: s.badgeTorsoCenter ?? badgeTorsoCenter,
            badgeTorsoSides: s.badgeTorsoSides ?? badgeTorsoSides,
            badgeShorts: s.badgeShorts ?? badgeShorts,
            badgeInnerCircle: s.badgeInnerCircle ?? badgeInnerCircle,
            headerBg: s.headerBg ?? headerBg,
            headerText: s.headerText ?? headerText,
            nameAliases: nameAliases,
            category: s.category ?? category
        )
    }
}
