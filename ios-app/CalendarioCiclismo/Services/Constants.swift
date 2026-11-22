import Foundation
import SwiftUI

/// Constantes compartidas — equivalente a `js/services/constants.js`.
enum Constants {
    // MARK: - Categorías UCI

    /// Orden de importancia de las categorías UCI (menor = más importante).
    static let uciOrder: [String: Double] = [
        "WC": 1,
        "1.UWT": 2, "2.UWT": 3, "1.WWT": 4, "2.WWT": 5,
        "CC": 6,
        "1.Pro": 7, "2.Pro": 8,
        "1.1": 9, "2.1": 10,
        "CN": 12,
        "1.2": 13, "2.2": 14, "1.2U": 15, "2.2U": 16,
        "1.Ncup": 17, "2.Ncup": 18, "1.NE": 19, "2.NE": 20,
    ]

    // MARK: - Tipos de etapa

    /// Etiquetas localizadas para tipos de etapa.
    static var typeLabels: [String: String] {
        LocaleService.isEnglish ? [
            "flat": "Flat", "rolling": "Rolling", "cotas": "Hilly",
            "medium_mountain": "Medium mountain", "high_mountain": "High mountain",
            "cobbles": "Cobbles", "sterrato": "Sterrato", "itt": "ITT", "ttt": "TTT",
            "summit_finish": "Summit finish", "uphill_finish": "Uphill finish",
            "chrono_climb": "Chrono climb",
        ] : [
            "flat": "Llana", "rolling": "Sinuosa", "cotas": "Cotas",
            "medium_mountain": "Media montaña", "high_mountain": "Alta montaña",
            "cobbles": "Adoquines", "sterrato": "Sterrato", "itt": "CRI", "ttt": "CRE",
            "summit_finish": "Final en alto", "uphill_finish": "Final en repecho",
            "chrono_climb": "Cronoescalada",
        ]
    }

    /// Colores asociados a cada tipo de etapa (para gráficos/iconos).
    static let stageColors: [String: Color] = [
        "flat":            Color(hex: "3dba6f"),
        "rolling":         Color(hex: "a8e6bc"),
        "cotas":           Color(hex: "c7cf5e"),
        "medium_mountain": Color(hex: "e6b800"),
        "high_mountain":   Color(hex: "e63d3d"),
        "cobbles":         Color(hex: "8c8c8c"),
        "sterrato":        Color(hex: "c4975a"),
        "itt":             Color(hex: "1a5ca8"),
        "ttt":             Color(hex: "6aaee8"),
        "chrono_climb":    Color(hex: "1a5ca8"),
    ]

    // MARK: - Estado de TV

    static var tvStatusLabels: [String: String] {
        LocaleService.isEnglish
            ? ["pending": "TBC", "none": "No TV", "unavailable_es": "Not in Spain"]
            : ["pending": "Por conf", "none": "Sin TV", "unavailable_es": "No España"]
    }

    // MARK: - Assets

    static var assetTexts: [String: String] {
        LocaleService.isEnglish ? [
            "technicalGuide": "Technical Guide", "startOrder": "Start order", "roadbook": "Timetable", "profile": "Profile",
            "ports": "Climbs", "pave": "Pavé", "sterrato": "Sterrato",
            "ribinou": "Ribinou", "map": "Map", "live_text": "Live text",
        ] : [
            "technicalGuide": "Libro de ruta", "startOrder": "Orden de salida", "roadbook": "Rutómetro", "profile": "Perfil",
            "ports": "Puertos", "pave": "Pavé", "sterrato": "Sterrato",
            "ribinou": "Ribinou", "map": "Mapa", "live_text": "Live texto",
        ]
    }

    static let assetOrder = ["technicalGuide", "startOrder", "roadbook", "profile", "ports", "map", "live_text"]

}
