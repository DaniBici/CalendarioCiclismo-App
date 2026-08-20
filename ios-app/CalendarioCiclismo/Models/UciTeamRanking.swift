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

    func explanation(isEnglish: Bool) -> String {
        let projection = isEnglish
            ? "Projection based on the current position."
            : "Proyección según la posición actual."
        var messages: [String] = []
        switch invitationTier {
        case .worldTour:
            break
        case .allWorldTour:
            messages.append(isEnglish
                ? "Mandatory invitation to every \(row.invitationSeason) UCI WorldTour race, including the Grand Tours, and every \(row.invitationSeason) UCI ProSeries race. \(projection)"
                : "Invitación obligatoria a todas las pruebas UCI WorldTour de \(row.invitationSeason), incluidas las Grandes Vueltas, y a todas las pruebas UCI ProSeries de \(row.invitationSeason). \(projection)")
        case .proSeries:
            messages.append(isEnglish
                ? "Mandatory invitation to every \(row.invitationSeason) UCI ProSeries race. \(projection)"
                : "Invitación obligatoria a todas las pruebas UCI ProSeries de \(row.invitationSeason). \(projection)")
        case .womensWorldTour:
            messages.append(isEnglish
                ? "Mandatory invitation to every \(row.invitationSeason) UCI Women's WorldTour race. \(projection)"
                : "Invitación obligatoria a todas las pruebas UCI Women's WorldTour de \(row.invitationSeason). \(projection)")
        case .standard:
            break
        }
        if grandTourExcluded {
            messages.append(isEnglish
                ? "Outside the overall top 30, this UCI ProTeam is not currently eligible for a \(row.invitationSeason) Grand Tour wildcard. \(projection)"
                : "Fuera del top-30 absoluto, este UCI ProTeam no puede recibir actualmente una invitación para una Gran Vuelta de \(row.invitationSeason). \(projection)")
        }
        return messages.joined(separator: " ")
    }
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
}
