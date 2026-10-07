import Foundation

/// Una fila de la instantánea sobrescribible `uci_team_rankings`.
struct UciTeamRankingRow: Codable, Identifiable {
    let gender: String
    let rank: Int
    let previousRank: Int?
    let uciTeamId: Int64
    let teamId: String?
    let teamCategory: String?
    let sourceName: String
    let displayName: String
    let teamCode: String?
    let countryCode: String?
    let points: Double
    let rankingDate: String
    let sourceUrl: String

    var id: String { "\(gender)-\(rank)" }

    var invitationSeason: Int {
        let rankingYear = Int(rankingDate.prefix(4))
        return (rankingYear ?? Calendar.current.component(.year, from: Date())) + 1
    }
}

enum UciTeamRankingTier: Equatable {
    case worldTour
    case allWorldTour
    case proSeries
    case womensWorldTour
    case standard
}

struct UciTeamRankingPresentation: Identifiable {
    let row: UciTeamRankingRow
    let invitationTier: UciTeamRankingTier
    let eligibleOrdinal: Int?
    let grandTourExcluded: Bool

    var id: String { row.id }

    /// Estilo de la etiqueta del puesto: nil = número sin etiqueta. «Sin
    /// Grandes Vueltas» prevalece sobre el nivel de invitación (como la web).
    var rankStyle: UciRankingKeyStyle? {
        if grandTourExcluded { return .excluded }
        switch invitationTier {
        case .worldTour: return .worldTour
        case .allWorldTour, .womensWorldTour: return .orange
        case .proSeries: return .green
        case .standard: return nil
        }
    }

    /// Aviso de la fila (espejo de `uciRankingRuleText`), sin la nota de
    /// proyección.
    func explanation(isEnglish: Bool) -> String {
        let season = row.invitationSeason
        var messages: [String] = []
        switch invitationTier {
        case .worldTour, .standard:
            break
        case .allWorldTour:
            messages.append(isEnglish
                ? "Mandatory invitation to every \(season) UCI WorldTour race, including the Grand Tours, and every \(season) UCI ProSeries race."
                : "Invitación obligatoria a todas las pruebas UCI WorldTour de \(season), incluidas las Grandes Vueltas, y a todas las pruebas UCI ProSeries de \(season).")
        case .proSeries:
            messages.append(isEnglish
                ? "Mandatory invitation to every \(season) UCI ProSeries race."
                : "Invitación obligatoria a todas las pruebas UCI ProSeries de \(season).")
        case .womensWorldTour:
            messages.append(isEnglish
                ? "Mandatory invitation to every \(season) UCI Women's WorldTour race."
                : "Invitación obligatoria a todas las pruebas UCI Women's WorldTour de \(season).")
        }
        if grandTourExcluded {
            messages.append(isEnglish
                ? "Outside the overall top 30, this UCI ProTeam is not currently eligible for a \(season) Grand Tour wildcard."
                : "Fuera del top-30 absoluto, este UCI ProTeam no puede recibir actualmente una invitación para una Gran Vuelta de \(season).")
        }
        return messages.joined(separator: " ")
    }
}

/// Color de la etiqueta del puesto y de la explicación: azul licencia
/// WorldTour, naranja invitación a todo el WorldTour o Women's WorldTour,
/// verde ProSeries, rojo sin Grandes Vueltas.
enum UciRankingKeyStyle: Equatable {
    case worldTour
    case orange
    case green
    case excluded
}

/// Entrada del panel «Invitaciones <año>» (espejo de `keyItems` en
/// `js/resultados-feed.js`).
struct UciRankingKeyItem: Identifiable, Equatable {
    let style: UciRankingKeyStyle
    let label: String
    let text: String
    var id: String { label }
}

enum UciTeamRankingLogic {
    static func decorate(
        _ rows: [UciTeamRankingRow],
        gender: String
    ) -> [UciTeamRankingPresentation] {
        let selected = rows
            .filter { $0.gender == gender }
            .sorted { $0.rank < $1.rank }
        let eligibleCategory = gender == "female" ? "PRW" : "PT"
        var eligibleOrdinal = 0

        return selected.map { row in
            if row.teamCategory == eligibleCategory { eligibleOrdinal += 1 }
            let ordinal = row.teamCategory == eligibleCategory ? eligibleOrdinal : nil
            let isWorldTour = gender == "female"
                ? row.teamCategory == "WWT"
                : row.teamCategory == "WT"
            let tier: UciTeamRankingTier
            if isWorldTour {
                tier = .worldTour
            } else if gender == "female", ordinal.map({ $0 <= 2 }) == true {
                tier = .womensWorldTour
            } else if gender == "male", ordinal.map({ $0 <= 3 }) == true {
                tier = .allWorldTour
            } else if gender == "male", ordinal.map({ $0 <= 5 }) == true {
                tier = .proSeries
            } else {
                tier = .standard
            }
            return UciTeamRankingPresentation(
                row: row,
                invitationTier: tier,
                eligibleOrdinal: ordinal,
                grandTourExcluded:
                    gender == "male" && row.teamCategory == "PT" && row.rank > 30
            )
        }
    }

    /// Año de las invitaciones: el del ránking + 1.
    static func invitationYear(_ rows: [UciTeamRankingPresentation]) -> Int {
        if let first = rows.first { return first.row.invitationSeason }
        return Calendar.current.component(.year, from: Date()) + 1
    }

    /// Explicación de cada etiqueta de puesto: solo los niveles presentes en
    /// el ránking seleccionado.
    static func keyItems(
        _ rows: [UciTeamRankingPresentation],
        isEnglish: Bool
    ) -> [UciRankingKeyItem] {
        let year = invitationYear(rows)
        let tiers = rows.map(\.invitationTier)
        var items: [UciRankingKeyItem] = []
        if tiers.contains(.worldTour) {
            items.append(UciRankingKeyItem(
                style: .worldTour,
                label: isEnglish ? "WorldTour licence" : "Licencia WorldTour",
                text: isEnglish
                    ? "Entitled and required to ride every UCI WorldTour race."
                    : "Derecho y obligación de correr todas las pruebas UCI WorldTour."
            ))
        }
        if tiers.contains(.allWorldTour) {
            items.append(UciRankingKeyItem(
                style: .orange,
                label: isEnglish ? "All WorldTour" : "Todo el WorldTour",
                text: isEnglish
                    ? "Invitation to every \(year) UCI WorldTour race, Grand Tours included, and every UCI ProSeries race."
                    : "Invitación a todas las pruebas UCI WorldTour de \(year), Grandes Vueltas incluidas, y a todas las UCI ProSeries."
            ))
        }
        if tiers.contains(.womensWorldTour) {
            items.append(UciRankingKeyItem(
                style: .orange,
                label: "Women's WorldTour",
                text: isEnglish
                    ? "Invitation to every \(year) UCI Women's WorldTour race."
                    : "Invitación a todas las pruebas UCI Women's WorldTour de \(year)."
            ))
        }
        if tiers.contains(.proSeries) {
            items.append(UciRankingKeyItem(
                style: .green,
                label: "ProSeries",
                text: isEnglish
                    ? "Invitation to every \(year) UCI ProSeries race."
                    : "Invitación a todas las pruebas UCI ProSeries de \(year)."
            ))
        }
        if rows.contains(where: \.grandTourExcluded) {
            items.append(UciRankingKeyItem(
                style: .excluded,
                label: isEnglish ? "No Grand Tours" : "Sin Grandes Vueltas",
                text: isEnglish
                    ? "Outside the overall top 30: not eligible for a \(year) Grand Tour wildcard."
                    : "Fuera del top-30 absoluto: sin opción a invitación para una Gran Vuelta de \(year)."
            ))
        }
        return items
    }

    /// Puntos enteros con separador de millares siempre, también con cuatro
    /// cifras («1.234»): es-ES no agrupa por defecto por debajo de 10.000.
    static func formatPoints(_ points: Double, isEnglish: Bool) -> String {
        let rounded = Int(points.rounded())
        let digits = String(abs(rounded))
        var chunks: [String] = []
        var end = digits.endIndex
        while end > digits.startIndex {
            let start = digits.index(end, offsetBy: -3, limitedBy: digits.startIndex) ?? digits.startIndex
            chunks.insert(String(digits[start..<end]), at: 0)
            end = start
        }
        return (rounded < 0 ? "-" : "") + chunks.joined(separator: isEnglish ? "," : ".")
    }
}
