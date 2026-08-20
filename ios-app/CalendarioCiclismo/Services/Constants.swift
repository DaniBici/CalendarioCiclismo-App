import Foundation
import SwiftUI

/// Constantes compartidas — equivalente a `js/services/constants.js`.
enum Constants {
    // MARK: - Categorías UCI

    /// Orden de importancia de las categorías UCI (menor = más importante).
    static let uciOrder: [String: Double] = [
        "WC": 1, "CC": 2,
        "1.UWT": 3, "2.UWT": 4,
        "CN": 4.5,
        "1.WWT": 5, "2.WWT": 6,
        "1.Pro": 7, "2.Pro": 8,
        "1.1": 9, "2.1": 10,
        "1.2": 11, "2.2": 12, "1.2U": 13, "2.2U": 14,
    ]

    /// Agrupación de categorías por tier.
    static let categoryTiers: [String: [String]] = [
        "WC":    ["WC", "CC"],
        "WT":    ["1.UWT", "2.UWT", "1.WWT", "2.WWT"],
        "PRO":   ["1.Pro", "2.Pro", "1.1", "2.1"],
        "MINOR": ["1.2", "2.2", "1.2U", "2.2U"],
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
            "technicalGuide": "Libro de Ruta", "startOrder": "Orden Salida", "roadbook": "Rutómetro", "profile": "Perfil",
            "ports": "Puertos", "pave": "Pavé", "sterrato": "Sterrato",
            "ribinou": "Ribinou", "map": "Mapa", "live_text": "Live texto",
        ]
    }

    static let assetOrder = ["technicalGuide", "startOrder", "roadbook", "profile", "ports", "map", "live_text"]

    // MARK: - Países europeos

    static let europeCountries: Set<String> = [
        "AD","AL","AT","BA","BE","BG","BY","CH","CY","CZ","DE","DK","EE","ES",
        "FI","FR","GB","GR","HR","HU","IE","IS","IT","LI","LT","LU","LV","MC",
        "MD","ME","MK","MT","NL","NO","PL","PT","RO","RS","RU","SE","SI","SK",
        "SM","TR","UA","VA","XK",
    ]

    /// Países asiáticos con tratamiento especial en rankings.
    static let asia1Countries: Set<String> = ["CN", "TH", "JP", "TW", "KR", "HK", "AZ"]

    // MARK: - Filtros de categoría

    enum CategoryFilter: String, CaseIterable, Identifiable {
        case all = "all"
        case pro = "pro"
        case uwt = "uwt"
        case wwt = "wwt"
        case male = "male"
        case female = "female"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .all:    return LocaleService.t("Todas", "All")
            case .pro:    return "Pro"
            case .uwt:    return "WT"
            case .wwt:    return "WWT"
            case .male:   return LocaleService.t("Masc", "Men")
            case .female: return LocaleService.t("Fem", "Women")
            }
        }
    }
}
