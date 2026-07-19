import Foundation

/// Equipo ficticio "Individual": lo siembra resolve_uci_startlist (mig. 084)
/// para los corredores cuya fila de resultados UCI no trae equipo. teamId NULL
/// + nombre 'Individual'. Se OCULTA cosméticamente (espejo de la web/Android):
/// corredores visibles, pero sin cabecera en la startlist y sin equipo/chapa/
/// filtro en resultados.
func isIndividualPlaceholderTeam(teamId: String?, teamName: String?) -> Bool {
    teamId == nil
        && (teamName ?? "").trimmingCharacters(in: .whitespaces).lowercased() == "individual"
}


