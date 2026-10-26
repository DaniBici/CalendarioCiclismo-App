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
    /// Identidad de selección (`selection`/`club`, `national`/`regional`) y su
    /// código: `countryCode` ISO en minúscula o, sin país, `selectionCode`.
    var teamKind: String? = nil
    var selectionScope: String? = nil
    var countryCode: String? = nil
    var selectionCode: String? = nil

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
            category: s.category ?? category,
            teamKind: teamKind,
            selectionScope: selectionScope,
            countryCode: countryCode,
            selectionCode: selectionCode
        )
    }

    // MARK: - Selecciones nacionales

    /// Denominaciones fijas: las que difieren del nombre del sistema y las que
    /// cambiaron entre versiones de CLDR. Clave: countryCode o selectionCode.
    private static let nationalNamesEs: [String: String] = [
        "ain": "Deportistas Individuales Neutrales",
        "ci": "Costa de Marfil",
        "cz": "República Checa",
        "gb": "Gran Bretaña",
        "hk": "Hong Kong",
        "mk": "Macedonia del Norte",
        "mo": "Macao",
    ]

    /// Selecciones nacionales: el catálogo guarda el nombre UCI en inglés
    /// («France»). En castellano se muestra el país en castellano a partir del
    /// código de la ficha («Francia»); en inglés, `name` sin cambio. Solo afecta
    /// a fichas `selection`/`national`. `name` es el texto que se mostraría sin
    /// traducir; de él se conserva la categoría de edad («Canada U23» →
    /// «Canadá sub23»). Espejo de `localizedTeamName` en
    /// `js/services/national-team-name.js`.
    static func localizedName(_ name: String, team: Team?, isEnglish: Bool) -> String {
        guard let team else { return name }
        return localizedName(
            name, teamKind: team.teamKind, selectionScope: team.selectionScope,
            countryCode: team.countryCode, selectionCode: team.selectionCode, isEnglish: isEnglish
        )
    }

    static func localizedName(
        _ name: String, teamKind: String?, selectionScope: String?,
        countryCode: String?, selectionCode: String?, isEnglish: Bool
    ) -> String {
        guard !isEnglish, teamKind == "selection", selectionScope == "national" else { return name }
        let code = ([countryCode, selectionCode].compactMap { $0 }.first { !$0.isEmpty } ?? "").lowercased()
        var country = nationalNamesEs[code]
        if country == nil, code.count == 2, code.allSatisfy({ $0.isASCII && $0.isLetter }),
           let label = Locale(identifier: "es").localizedString(forRegionCode: code.uppercased()),
           label.uppercased() != code.uppercased() {
            country = label
        }
        guard let country else { return name }
        if let age = name.range(of: #"\bU\d{2}\b"#, options: [.regularExpression, .caseInsensitive]) {
            return "\(country) sub\(name[age].dropFirst())"
        }
        return country
    }
}
