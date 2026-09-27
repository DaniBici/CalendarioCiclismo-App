import WidgetKit

struct WidgetEntry: TimelineEntry {
    let date: Date
    let response: WidgetDayResponse?
    let fromCache: Bool
    let scope: WidgetScope

    var text: WidgetText { WidgetText(locale: response?.locale ?? WidgetSettings.load().locale) }

    /// Jornada correspondiente al día local de la entrada.
    var day: WidgetDay? { response?.day(for: WidgetDates.key(date)) }

    /// Datos antiguos: sin red y generados hace más de 3 horas.
    var isStale: Bool {
        guard fromCache, let generated = response?.generatedAt else { return false }
        return date.timeIntervalSince(generated) > 3 * 3600
    }
}

struct WidgetProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> WidgetEntry {
        WidgetEntry(date: .now, response: WidgetSample.response(), fromCache: false, scope: .appFilter)
    }

    func snapshot(for configuration: TodayWidgetIntent, in context: Context) async -> WidgetEntry {
        if context.isPreview {
            return WidgetEntry(date: .now, response: WidgetSample.response(), fromCache: false, scope: configuration.scope)
        }
        let result = await WidgetDataSource.load(scope: configuration.scope, discipline: configuration.discipline)
        return WidgetEntry(date: .now, response: result?.response, fromCache: result?.fromCache ?? false, scope: configuration.scope)
    }

    func timeline(for configuration: TodayWidgetIntent, in context: Context) async -> Timeline<WidgetEntry> {
        let now = Date()
        let result = await WidgetDataSource.load(scope: configuration.scope, discipline: configuration.discipline, now: now)
        let response = result?.response
        let fromCache = result?.fromCache ?? false

        // Una entrada en cada cambio visible (salida, TV, meta, mangas CX) y
        // otra a medianoche, que pasa a la jornada siguiente ya descargada.
        let horizon = now.addingTimeInterval(26 * 3600)
        var dates: Set<Date> = [now, WidgetDates.nextMidnight(after: now)]
        for day in response?.days ?? [] {
            for item in day.items {
                for date in item.transitionDates where date > now && date < horizon {
                    dates.insert(date)
                }
            }
        }
        let entries = dates.sorted().prefix(40).map {
            WidgetEntry(date: $0, response: response, fromCache: fromCache, scope: configuration.scope)
        }
        return Timeline(entries: entries, policy: .after(nextRefresh(now: now, response: response, fromCache: fromCache)))
    }

    /// Recarga cada 20 minutos mientras haya carreras en curso o a la espera
    /// de resultados; cada 2 horas en el resto de casos. Sin red, reintenta en 30.
    private func nextRefresh(now: Date, response: WidgetDayResponse?, fromCache: Bool) -> Date {
        if response == nil || fromCache { return now.addingTimeInterval(30 * 60) }
        let today = response?.day(for: WidgetDates.key(now))?.items ?? []
        let pending = today.contains { item in
            let state = item.raceState(at: now)
            if state == .live || state == .awaiting { return true }
            // Arranque próximo: refrescar poco antes para recoger cambios de horario.
            if state == .scheduled, let start = item.startUtc ?? item.tv?.startUtc {
                return start.timeIntervalSince(now) < 90 * 60
            }
            return false
        }
        let interval: TimeInterval = pending ? 20 * 60 : 2 * 3600
        return min(now.addingTimeInterval(interval), WidgetDates.nextMidnight(after: now).addingTimeInterval(5 * 60))
    }
}
