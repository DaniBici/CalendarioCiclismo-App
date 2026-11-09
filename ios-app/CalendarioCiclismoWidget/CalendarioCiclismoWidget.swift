import SwiftUI
import WidgetKit

/// Widget «Carreras de hoy»: carretera y ciclocross del día con TV, estado en
/// directo, ganador y próxima cita. Datos de la RPC `widget_day`.
struct CalendarioCiclismoWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: WidgetShared.kind, intent: TodayWidgetIntent.self, provider: WidgetProvider()) { entry in
            WidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Carreras de hoy")
        .description("Carretera y ciclocross del día: TV, directo, ganadores y próxima cita.")
        // `systemExtraLarge` solo existe en la pantalla de inicio del iPad.
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge,
                            .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

#Preview(as: .systemMedium) {
    CalendarioCiclismoWidget()
} timeline: {
    WidgetEntry(date: .now, response: WidgetSample.response(), fromCache: false, scope: .appFilter)
}

#Preview(as: .systemLarge) {
    CalendarioCiclismoWidget()
} timeline: {
    WidgetEntry(date: .now, response: WidgetSample.response(), fromCache: false, scope: .appFilter)
}

#Preview(as: .systemExtraLarge) {
    CalendarioCiclismoWidget()
} timeline: {
    WidgetEntry(date: .now, response: WidgetSample.response(), fromCache: false, scope: .appFilter)
}
