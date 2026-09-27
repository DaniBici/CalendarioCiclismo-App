import AppIntents
import WidgetKit

/// Qué carreras muestra el widget.
enum WidgetScope: String, AppEnum {
    /// El filtro fijado en Hoy y en la agenda CX de la app.
    case appFilter
    /// Todas las carreras publicadas.
    case all
    /// Solo las carreras, etapas y pruebas CX seguidas en la app.
    case followed

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Carreras"
    static let caseDisplayRepresentations: [WidgetScope: DisplayRepresentation] = [
        .appFilter: "Filtro de la app",
        .all: "Todas",
        .followed: "Seguidas",
    ]
}

enum WidgetDiscipline: String, AppEnum {
    case both
    case road
    case cyclocross

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Disciplina"
    static let caseDisplayRepresentations: [WidgetDiscipline: DisplayRepresentation] = [
        .both: "Carretera y ciclocross",
        .road: "Carretera",
        .cyclocross: "Ciclocross",
    ]

    var rpcValue: [String] {
        switch self {
        case .both: ["road", "cx"]
        case .road: ["road"]
        case .cyclocross: ["cx"]
        }
    }
}

struct TodayWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Carreras de hoy"
    static let description = IntentDescription("Elige qué carreras muestra el widget.")

    @Parameter(title: "Carreras", default: .appFilter)
    var scope: WidgetScope

    @Parameter(title: "Disciplina", default: .both)
    var discipline: WidgetDiscipline

    init() {}

    init(scope: WidgetScope, discipline: WidgetDiscipline) {
        self.scope = scope
        self.discipline = discipline
    }
}
