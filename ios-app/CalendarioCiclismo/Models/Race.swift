import Foundation

/// Carrera profesional de ciclismo (tabla `races` en Supabase).
struct Race: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let nameEn: String?
    let abbrev: String?
    let uciCategory: String?
    let gender: String?
    let raceFormat: String?
    let countryCode: String?
    let colorHex: String?
    let logoUrl: String?
    let websiteUrl: String?
    let fcId: Int?
    let pcsSlug: String?
    let hideFlag: Bool
    let isGrandTour: Bool
    let isCancelled: Bool
    let startDate: String?   // YYYY-MM-DD
    let endDate: String?     // YYYY-MM-DD
    let year: Int?
    let slug: String?
    let originalName: String?
    let startlistImportedAt: String?
    let startlistProvisional: Bool?
    let enrichedStartlist: Bool?

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Race, rhs: Race) -> Bool {
        lhs.id == rhs.id
    }

    // MARK: - Computed

    var isStageRace: Bool { raceFormat == "stage_race" }
    var isOneDay: Bool { raceFormat == "one_day" }
    var isFemale: Bool { gender == "female" }

    /// Nombre localizado según el idioma activo o el idioma del dispositivo.
    /// Muestra `nameEn` si el usuario tiene Premium+inglés O si el dispositivo
    /// está configurado en un idioma no español.
    var localizedName: String {
        if LocaleService.shouldShowEnglishContent, let en = nameEn, !en.isEmpty { return en }
        return name
    }

    /// Duración en días de la carrera.
    var durationDays: Int? {
        guard let s = startDate, let e = endDate,
              let start = DateFormatting.date(from: s),
              let end = DateFormatting.date(from: e) else { return nil }
        return Calendar.current.dateComponents([.day], from: start, to: end).day.map { $0 + 1 }
    }
}
