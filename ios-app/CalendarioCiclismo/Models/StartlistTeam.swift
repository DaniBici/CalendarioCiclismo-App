import Foundation

/// Estados emitidos por fuentes UCI para corredores sin equipo. La fila de
/// startlist se conserva para mantener el vínculo con sus corredores, pero se
/// oculta cosméticamente en inscritos y resultados.
func isNoTeamPlaceholderTeam(teamId: String?, teamName: String?) -> Bool {
    guard teamId == nil else { return false }
    let normalized = (teamName ?? "")
        .replacingOccurrences(of: "-", with: " ")
        .split(whereSeparator: { $0.isWhitespace })
        .joined(separator: " ")
        .lowercased()
    return ["individual", "private member", "sin equipo", "un", "un attached leinster"]
        .contains(normalized)
}

func isIndividualPlaceholderTeam(teamId: String?, teamName: String?) -> Bool {
    isNoTeamPlaceholderTeam(teamId: teamId, teamName: teamName)
        && (teamName ?? "").trimmingCharacters(in: .whitespaces).lowercased() == "individual"
}

