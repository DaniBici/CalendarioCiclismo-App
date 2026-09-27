import Foundation

/// Datos de muestra para la galería de widgets y el placeholder.
enum WidgetSample {
    static func response(now: Date = Date()) -> WidgetDayResponse {
        let english = WidgetSettings.load().locale == "en"
        func t(_ es: String, _ en: String) -> String { english ? en : es }
        let calendar = Calendar.current
        func at(_ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(bySettingHour: hour, minute: minute, second: 0, of: now) ?? now
        }
        let key = WidgetDates.key(now)
        let items = [
            WidgetItem(
                kind: "road", id: "sample-1", raceId: nil, link: "calendariociclismo://tab/today",
                name: t("Vuelta a España", "La Vuelta"), countryCode: "es", category: "2.UWT", gender: "male",
                grandTour: true, state: "race", stageNumber: 15, stageLabel: t("Etapa 15", "Stage 15"),
                primaryType: "high_mountain", typeLabel: t("Alta montaña", "High mountain"), distanceKm: 172.4,
                route: "Vielha – Cerler", tournament: nil, startUtc: at(12, 10), finishUtc: at(17, 25),
                raceStatus: nil, tv: WidgetTV(status: "time", channel: "La 1", channels: ["La 1", "Eurosport"], startUtc: at(14, 5)),
                liveTextUrl: "https://calendariociclismo.app", hasResults: false, resultsLink: nil, reviveUrl: nil, sessions: nil),
            WidgetItem(
                kind: "road", id: "sample-2", raceId: nil, link: "calendariociclismo://tab/today",
                name: "Il Lombardia", countryCode: "it", category: "1.UWT", gender: "male",
                grandTour: false, state: "race", stageNumber: nil, stageLabel: nil,
                primaryType: "medium_mountain", typeLabel: t("Media montaña", "Medium mountain"), distanceKm: 241,
                route: "Como – Bergamo", tournament: nil, startUtc: at(10, 20), finishUtc: at(16, 35),
                raceStatus: nil, tv: WidgetTV(status: "time", channel: "Eurosport", channels: ["Eurosport"], startUtc: at(13, 0)),
                liveTextUrl: nil, hasResults: true, resultsLink: "calendariociclismo://tab/results",
                reviveUrl: "https://www.youtube.com", sessions: nil),
            WidgetItem(
                kind: "cx", id: "sample-3", raceId: nil, link: "calendariociclismo://tab/cyclocross",
                name: "Koppenbergcross", countryCode: "be", category: "C1", gender: nil,
                grandTour: false, state: "race", stageNumber: nil, stageLabel: nil,
                primaryType: nil, typeLabel: nil, distanceKm: nil, route: nil, tournament: "X2O Badkamers Trofee",
                startUtc: at(13, 30), finishUtc: at(16, 0), raceStatus: nil,
                tv: WidgetTV(status: "time", channel: "Sporza", channels: ["Sporza"], startUtc: at(13, 25)),
                liveTextUrl: nil, hasResults: false, resultsLink: nil, reviveUrl: nil,
                sessions: [
                    WidgetSession(category: "WE", label: t("Élite fem.", "Women Elite"), elite: true, startUtc: at(13, 30),
                                  finishUtc: at(14, 20), cancelled: false, hasResults: false),
                    WidgetSession(category: "ME", label: t("Élite masc.", "Men Elite"), elite: true, startUtc: at(15, 0),
                                  finishUtc: at(16, 0), cancelled: false, hasResults: false),
                ]),
        ]
        return WidgetDayResponse(version: 1, generatedAt: now, locale: english ? "en" : "es",
                                 days: [WidgetDay(date: key, items: items, next: nil)])
    }
}
