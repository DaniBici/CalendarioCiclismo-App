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

    /// La chapa solo se considera disponible cuando los colores del maillot
    /// dejan de ser la paleta predeterminada del catálogo.
    var hasVisibleBadge: Bool {
        guard let center = Self.normalizedBadgeColor(badgeTorsoCenter),
              let sides = Self.normalizedBadgeColor(badgeTorsoSides),
              let shorts = Self.normalizedBadgeColor(badgeShorts) else {
            return false
        }

        let innerRaw = badgeInnerCircle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !innerRaw.isEmpty {
            return Self.normalizedBadgeColor(innerRaw) != nil
        }

        return center != "#ffffff"
            || !["#000000", "#111111"].contains(sides)
            || !["#000000", "#111111"].contains(shorts)
    }

    private static func normalizedBadgeColor(_ value: String?) -> String? {
        guard let value else { return nil }
        let color = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if color.count == 7,
           color.first == "#",
           color.dropFirst().allSatisfy({ $0.isHexDigit }) {
            return color
        }
        if color.count == 4,
           color.first == "#",
           color.dropFirst().allSatisfy({ $0.isHexDigit }) {
            let digits = Array(color.dropFirst())
            return "#" + digits.map { String(repeating: String($0), count: 2) }.joined()
        }
        return nil
    }

    /// Render temporal: devuelve una copia con los atributos VISUALES de la temporada
    /// sobrescritos cuando la season los aporta (no nulos). Si `season` es nil, devuelve
    /// el equipo intacto. `teams` es siempre el fallback; la paleta por defecto
    /// continúa sin producir una chapa visible.
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
