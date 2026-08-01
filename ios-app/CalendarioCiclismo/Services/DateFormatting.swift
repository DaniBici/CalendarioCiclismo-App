import Foundation

/// Utilidades de formato de fecha/hora — equivalente a `js/services/dates.js`.
///
/// Locale: cada formateador con etiquetas de calendario (días/meses) lee
/// `LocaleService.shared.current.locale` en el momento de la llamada para
/// que la app cambie de idioma sin reiniciar. Hay UNA excepción:
/// `formatTimeMadrid` y `formatTimeLocal` solo emiten "HH:mm" — formato
/// 24h numérico igual en cualquier idioma — y mantienen `es_ES` como
/// optimización (no se necesita reactividad).
enum DateFormatting {

    // MARK: - Formateadores reutilizables

    /// Formato YYYY-MM-DD (dateKey).
    private static let dateKeyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        return f
    }()

    /// Crea un parser ISO 8601 para timestamps de Supabase.
    /// Se crea por invocación porque ISO8601DateFormatter (NSObject) no es thread-safe.
    private static func makeISOFormatter(fractionalSeconds: Bool = true) -> ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = fractionalSeconds
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        return f
    }

    /// Formateador de hora en zona Madrid (HH:mm). 24h numérico — locale fijo OK.
    private static let madridTimeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.timeZone = TimeZone(identifier: "Europe/Madrid")
        f.locale = Locale(identifier: "es_ES")
        return f
    }()

    /// Locale actual de la UI (español o inglés). Se resuelve en cada llamada
    /// leyendo directamente de UserDefaults — la fuente de verdad es la misma
    /// que usa `LocaleService` y la lectura es ~µs (cacheado por el sistema).
    /// No usa `LocaleService.shared` para evitar @MainActor isolation desde
    /// código background (workers, services).
    private static var nonIsolatedUILocale: Locale {
        let raw = UserDefaults.standard.string(forKey: "app_locale") ?? "es"
        return Locale(identifier: raw)
    }

    /// `true` si la UI está en español.
    private static var isSpanish: Bool {
        nonIsolatedUILocale.language.languageCode?.identifier == "es"
    }

    /// Locale del CONTENIDO (nombres de carrera, fechas de cabecera de etapa…),
    /// no del chrome de la UI. Sigue `shouldShowEnglishContent`: si los contenidos
    /// se muestran en inglés (app en EN o dispositivo no-español), la fecha también.
    /// Mismo criterio que el formateo del kilometraje (RaceDay.distanceFormatted).
    private static var contentLocale: Locale {
        Locale(identifier: LocaleService.shouldShowEnglishContent ? "en" : "es")
    }

    // MARK: - DateKey helpers

    /// Convierte Date a YYYY-MM-DD.
    static func toDateKey(_ date: Date) -> String {
        dateKeyFormatter.string(from: date)
    }

    /// Hoy como dateKey.
    static func todayKey() -> String {
        toDateKey(Date())
    }

    /// Parsea YYYY-MM-DD a Date.
    static func date(from dateKey: String) -> Date? {
        dateKeyFormatter.date(from: dateKey)
    }

    // MARK: - Etiquetas de fecha

    /// "Miércoles, 8 de abril" / "Wednesday, 8 April"
    static func formatDateLabel(_ dateKey: String) -> String {
        guard let date = date(from: dateKey) else { return dateKey }
        let f = DateFormatter()
        f.locale = nonIsolatedUILocale
        f.dateFormat = isSpanish ? "EEEE, d 'de' MMMM" : "EEEE, d MMMM"
        let str = f.string(from: date)
        return str.prefix(1).uppercased() + str.dropFirst()
    }

    /// "Mié 8 abr" / "Wed 8 Apr"
    static func formatDateShort(_ dateKey: String) -> String {
        guard let date = date(from: dateKey) else { return dateKey }
        let f = DateFormatter()
        f.locale = nonIsolatedUILocale
        f.dateFormat = "EEE d MMM"
        let str = f.string(from: date)
        return str.prefix(1).uppercased() + str.dropFirst()
    }

    /// "Miércoles, 8 de abril de 2026" / "Wednesday, 8 April 2026"
    static func formatDateLong(_ dateKey: String) -> String {
        formatDateLong(dateKey, locale: nonIsolatedUILocale)
    }

    /// Como `formatDateLong` pero en el idioma del CONTENIDO (no el chrome de la
    /// UI): la cabecera de etapa (nombre de carrera, ruta, km…) se muestra en EN
    /// cuando el contenido va en inglés, y la fecha debe acompañarla.
    /// Paridad con Android (`DateFormatting.formatDateLongContent`).
    static func formatDateLongContent(_ dateKey: String) -> String {
        formatDateLong(dateKey, locale: contentLocale)
    }

    /// Fecha canónica del ránking UCI, completa y con el mismo patrón por idioma.
    static func formatUciRankingUpdated(
        _ dateKey: String,
        isEnglish: Bool = LocaleService.shouldShowEnglishContent
    ) -> String {
        let prefix = isEnglish ? "Updated" : "Actualizado"
        guard let date = date(from: dateKey) else { return "\(prefix): \(dateKey)" }
        let f = DateFormatter()
        f.locale = Locale(identifier: isEnglish ? "en_GB" : "es_ES")
        f.dateFormat = isEnglish
            ? "EEEE, d MMMM yyyy"
            : "EEEE, d 'de' MMMM 'de' yyyy"
        return "\(prefix): \(f.string(from: date))"
    }

    /// Día de la semana + día + mes, SIN año, en el idioma del CONTENIDO
    /// ("Martes 24 de junio" / "Tuesday 24 June"). Para el feed del mercado de
    /// fichajes. Paridad con web (`dayHeading`) y Android.
    static func formatDateWeekdayNoYear(_ dateKey: String) -> String {
        guard let date = date(from: dateKey) else { return dateKey }
        let f = DateFormatter()
        f.locale = contentLocale
        let isEs = contentLocale.language.languageCode?.identifier == "es"
        f.dateFormat = isEs ? "EEEE d 'de' MMMM" : "EEEE d MMMM"
        let str = f.string(from: date)
        return str.prefix(1).uppercased() + str.dropFirst()
    }

    private static func formatDateLong(_ dateKey: String, locale: Locale) -> String {
        guard let date = date(from: dateKey) else { return dateKey }
        let f = DateFormatter()
        f.locale = locale
        let isEs = locale.language.languageCode?.identifier == "es"
        f.dateFormat = isEs ? "EEEE, d 'de' MMMM 'de' yyyy" : "EEEE, d MMMM yyyy"
        let str = f.string(from: date)
        return str.prefix(1).uppercased() + str.dropFirst()
    }

    /// Rango compacto: "6–27 jul" / "6–27 Jul" o "30 ago – 21 sep" / "30 Aug – 21 Sep".
    static func formatDateRange(start: String?, end: String?) -> String {
        guard let s = start, let startDate = date(from: s) else { return "" }
        let endDate = end.flatMap { date(from: $0) } ?? startDate

        let cal = Calendar.current
        let sDay = cal.component(.day, from: startDate)
        let sMonth = cal.component(.month, from: startDate)
        let sYear = cal.component(.year, from: startDate)
        let eDay = cal.component(.day, from: endDate)
        let eMonth = cal.component(.month, from: endDate)
        let eYear = cal.component(.year, from: endDate)

        let monthFmt = DateFormatter()
        monthFmt.locale = nonIsolatedUILocale
        monthFmt.dateFormat = "MMM"

        if s == (end ?? s) {
            return "\(sDay) \(monthFmt.string(from: startDate))"
        }
        if sMonth == eMonth && sYear == eYear {
            return "\(sDay)–\(eDay) \(monthFmt.string(from: endDate))"
        }
        if sYear == eYear {
            return "\(sDay) \(monthFmt.string(from: startDate)) – \(eDay) \(monthFmt.string(from: endDate))"
        }
        return "\(sDay) \(monthFmt.string(from: startDate)) \(sYear) – \(eDay) \(monthFmt.string(from: endDate)) \(eYear)"
    }

    /// "Abril de 2026" / "April 2026"
    static func formatMonthYear(year: Int, month: Int) -> String {
        guard let date = Calendar.current.date(from: DateComponents(year: year, month: month + 1, day: 1)) else { return "" }
        let f = DateFormatter()
        f.locale = nonIsolatedUILocale
        f.dateFormat = isSpanish ? "MMMM 'de' yyyy" : "MMMM yyyy"
        let str = f.string(from: date)
        return str.prefix(1).uppercased() + str.dropFirst()
    }

    /// Nombre corto del mes (1-based): "Ene"/"Jan", "Feb", etc.
    static func shortMonthName(_ month: Int) -> String {
        let f = DateFormatter()
        f.locale = nonIsolatedUILocale
        let symbols = f.shortMonthSymbols ?? []
        guard month >= 1, month <= symbols.count else { return "" }
        let name = symbols[month - 1]
        return name.prefix(1).uppercased() + name.dropFirst()
    }

    // MARK: - Hora

    /// Formatea timestamp ISO a hora Madrid "HH:mm".
    static func formatTimeMadrid(_ isoString: String) -> String? {
        guard let date = parseISO(isoString) else { return nil }
        return madridTimeFormatter.string(from: date)
    }

    /// Formatea timestamp ISO a "HH:mm" en la zona horaria pasada como
    /// parámetro (por defecto, la del dispositivo). Pensado para el widget
    /// "Hoy en el ciclismo", que renderiza para el usuario allá donde esté
    /// — a diferencia de `formatTimeMadrid`, que fija Europa/Madrid.
    ///
    /// Nota: se crea un `DateFormatter` por llamada porque el `TimeZone`
    /// puede variar entre invocaciones (viaje del usuario, pruebas). Si en
    /// el futuro esto pesa en un hot path, memorizar por `timeZone.identifier`.
    static func formatTimeLocal(_ isoString: String, timeZone: TimeZone = .current) -> String? {
        guard let date = parseISO(isoString) else { return nil }
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.timeZone = timeZone
        // 24h numérico — locale es irrelevante.
        f.locale = Locale(identifier: "es_ES")
        return f.string(from: date)
    }

    /// Convierte un ISO string a segundos desde epoch.
    static func timestampToSeconds(_ isoString: String) -> Double? {
        guard let date = parseISO(isoString) else { return nil }
        return date.timeIntervalSince1970
    }

    /// Parsea un string ISO 8601.
    static func parseISO(_ string: String) -> Date? {
        if let d = makeISOFormatter(fractionalSeconds: true).date(from: string) { return d }
        // Fallback sin fracciones de segundo
        return makeISOFormatter(fractionalSeconds: false).date(from: string)
    }

    // MARK: - Navegación de fechas

    /// DateKey del día anterior.
    static func previousDay(_ dateKey: String) -> String? {
        guard let date = date(from: dateKey) else { return nil }
        guard let prev = Calendar.current.date(byAdding: .day, value: -1, to: date) else { return nil }
        return toDateKey(prev)
    }

    /// DateKey del día siguiente.
    static func nextDay(_ dateKey: String) -> String? {
        guard let date = date(from: dateKey) else { return nil }
        guard let next = Calendar.current.date(byAdding: .day, value: 1, to: date) else { return nil }
        return toDateKey(next)
    }

    /// DateKey desplazado N días (positivo = futuro, negativo = pasado).
    static func dayOffset(from dateKey: String, by days: Int) -> String? {
        guard let date = date(from: dateKey) else { return nil }
        guard let result = Calendar.current.date(byAdding: .day, value: days, to: date) else { return nil }
        return toDateKey(result)
    }

    /// Rango de dateKeys: [dateKey-offset ... dateKey+offset].
    static func dateRange(around dateKey: String, offset: Int) -> [String] {
        guard let center = date(from: dateKey) else { return [dateKey] }
        return (-offset...offset).compactMap { delta in
            Calendar.current.date(byAdding: .day, value: delta, to: center)
                .map { toDateKey($0) }
        }
    }
}
