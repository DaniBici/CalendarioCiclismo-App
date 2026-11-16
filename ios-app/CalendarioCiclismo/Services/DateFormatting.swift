import Foundation

/// Utilidades de formato de fecha/hora — equivalente a `js/services/dates.js`.
///
/// Locale: cada formateador con etiquetas de calendario (días/meses) lee
/// `LocaleService.shared.current.locale` en el momento de la llamada para
/// que la app cambie de idioma sin reiniciar. Hay UNA excepción:
/// `formatTimeLocal` solo emite "HH:mm" — formato 24h numérico igual en
/// cualquier idioma — y mantiene `es_ES` (no se necesita reactividad).
enum DateFormatting {

    // MARK: - Mes inicial del Calendario

    /// Primer mes que puede abrir el Calendario (Mes y Temporada). Terminada
    /// la temporada de carretera 2026, el Calendario abre en 2027.
    static let calendarEarliestStart = (year: 2027, month: 1)

    /// Año y mes con los que abre el Calendario: el mes en curso o, si es
    /// anterior a `calendarEarliestStart`, ese mes. Espejo de
    /// `CalendarStart.initial` en Android.
    static func calendarStart(now: Date = Date(), calendar: Calendar = .current) -> (year: Int, month: Int) {
        let year = calendar.component(.year, from: now)
        let month = calendar.component(.month, from: now)
        let earliest = calendarEarliestStart
        if year < earliest.year || (year == earliest.year && month < earliest.month) {
            return earliest
        }
        return (year, month)
    }

    // MARK: - Formateadores reutilizables

    /// Formato YYYY-MM-DD (dateKey).
    private static let dateKeyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
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

    /// Parsea YYYY-MM-DD a Date. Las vistas lo llaman varias veces por día y por
    /// pintura (barra de fechas, etiquetas): los resultados se memorizan.
    static func date(from dateKey: String) -> Date? {
        DateKeyMemo.shared.date(from: dateKey, using: dateKeyFormatter)
    }

    /// Formateador reutilizado por idioma, formato y zona horaria. Crear un
    /// `DateFormatter` cuesta del orden de 0,1 ms y las listas lo hacían por
    /// fila y por pintura. Los formateadores del caché no se modifican después
    /// de crearlos, por lo que pueden usarse desde varios hilos.
    static func formatter(locale: Locale, format: String, timeZone: TimeZone = .current) -> DateFormatter {
        DateFormatterCache.shared.formatter(locale: locale, format: format, timeZone: timeZone)
    }

    // MARK: - Etiquetas de fecha

    /// "Miércoles, 8 de abril" / "Wednesday, 8 April"
    static func formatDateLabel(_ dateKey: String) -> String {
        guard let date = date(from: dateKey) else { return dateKey }
        let f = formatter(locale: nonIsolatedUILocale, format: isSpanish ? "EEEE, d 'de' MMMM" : "EEEE, d MMMM")
        let str = f.string(from: date)
        return str.prefix(1).uppercased() + str.dropFirst()
    }

    /// "8 de abril" / "8 April". Fila de la fecha de Hoy, donde la tira de días
    /// ya muestra el día de la semana.
    static func formatDayMonth(_ dateKey: String) -> String {
        guard let date = date(from: dateKey) else { return dateKey }
        let f = formatter(locale: nonIsolatedUILocale, format: isSpanish ? "d 'de' MMMM" : "d MMMM")
        return f.string(from: date)
    }

    /// "Mié 8 abr" / "Wed 8 Apr"
    static func formatDateShort(_ dateKey: String) -> String {
        guard let date = date(from: dateKey) else { return dateKey }
        let f = formatter(locale: nonIsolatedUILocale, format: "EEE d MMM")
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
        let f = formatter(
            locale: Locale(identifier: isEnglish ? "en_GB" : "es_ES"),
            format: isEnglish ? "EEEE, d MMMM yyyy" : "EEEE, d 'de' MMMM 'de' yyyy"
        )
        return "\(prefix): \(f.string(from: date))"
    }

    /// Día de la semana + día + mes, SIN año, en el idioma del CONTENIDO
    /// ("Martes 24 de junio" / "Tuesday 24 June"). Para el feed del mercado de
    /// fichajes. Paridad con web (`dayHeading`) y Android.
    static func formatDateWeekdayNoYear(_ dateKey: String) -> String {
        guard let date = date(from: dateKey) else { return dateKey }
        let locale = contentLocale
        let isEs = locale.language.languageCode?.identifier == "es"
        let f = formatter(locale: locale, format: isEs ? "EEEE d 'de' MMMM" : "EEEE d MMMM")
        let str = f.string(from: date)
        return str.prefix(1).uppercased() + str.dropFirst()
    }

    private static func formatDateLong(_ dateKey: String, locale: Locale) -> String {
        guard let date = date(from: dateKey) else { return dateKey }
        let isEs = locale.language.languageCode?.identifier == "es"
        let f = formatter(locale: locale, format: isEs ? "EEEE, d 'de' MMMM 'de' yyyy" : "EEEE, d MMMM yyyy")
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

        let monthFmt = formatter(locale: nonIsolatedUILocale, format: "MMM")

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
        let f = formatter(locale: nonIsolatedUILocale, format: isSpanish ? "MMMM 'de' yyyy" : "MMMM yyyy")
        let str = f.string(from: date)
        return str.prefix(1).uppercased() + str.dropFirst()
    }

    /// Nombre corto del mes (1-based): "Ene"/"Jan", "Feb", etc.
    static func shortMonthName(_ month: Int) -> String {
        let symbols = formatter(locale: nonIsolatedUILocale, format: "MMM").shortMonthSymbols ?? []
        guard month >= 1, month <= symbols.count else { return "" }
        let name = symbols[month - 1]
        return name.prefix(1).uppercased() + name.dropFirst()
    }

    // MARK: - Hora

    /// Formatea timestamp ISO a "HH:mm" en la zona horaria pasada como
    /// parámetro (por defecto, la del dispositivo). Pensado para el widget
    /// "Hoy en el ciclismo", que renderiza para el usuario allá donde esté.
    ///
    /// El formateador se memoriza por zona horaria (`timeZone.identifier`):
    /// un viaje del usuario o una prueba con otra zona usan otro formateador.
    static func formatTimeLocal(_ isoString: String, timeZone: TimeZone = .current) -> String? {
        guard let date = parseISO(isoString) else { return nil }
        // 24h numérico — locale es irrelevante.
        let f = formatter(locale: Locale(identifier: "es_ES"), format: "HH:mm", timeZone: timeZone)
        return f.string(from: date)
    }

    /// Abreviatura del día ("sáb." / "Sat") cuando la hora, en la zona pasada
    /// (por defecto, la del dispositivo), cae en otra fecha que `dateKey`, la
    /// fecha en que aparece la jornada: salidas de Asia u Oceanía la víspera
    /// en Europa, llegadas pasada la medianoche. `nil` si es la misma fecha.
    /// Paridad con `formatTimeUser` (js/shared.js) y Android.
    static func otherDayLabel(
        _ isoString: String,
        dateKey: String,
        timeZone: TimeZone = .current,
        isEnglish: Bool = LocaleService.shouldShowEnglishContent
    ) -> String? {
        guard let date = parseISO(isoString) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day, .weekday], from: date)
        guard let year = c.year, let month = c.month, let day = c.day, let weekday = c.weekday else { return nil }
        guard String(format: "%04d-%02d-%02d", year, month, day) != dateKey else { return nil }
        let names = isEnglish
            ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            : ["dom.", "lun.", "mar.", "mié.", "jue.", "vie.", "sáb."]
        return names[weekday - 1]
    }

    /// Última lectura de una clasificación en hora local: "11 oct, 06:22" /
    /// "11 Oct, 06:22", en el idioma del contenido. Paridad con la web
    /// (`showPublication` en js/resultados.js) y Android.
    static func formatResultsSyncedAt(_ isoString: String, timeZone: TimeZone = .current) -> String? {
        guard let date = parseISO(isoString) else { return nil }
        let f = formatter(locale: contentLocale, format: "d MMM, HH:mm", timeZone: timeZone)
        return f.string(from: date).replacingOccurrences(of: ".", with: "")
    }

    /// Convierte un ISO string a segundos desde epoch.
    static func timestampToSeconds(_ isoString: String) -> Double? {
        guard let date = parseISO(isoString) else { return nil }
        return date.timeIntervalSince1970
    }

    /// Parsea un string ISO 8601 (con fracciones de segundo y, si no, sin ellas).
    /// Las vistas y las ordenaciones lo llaman cientos de veces por pintura con
    /// las mismas horas: usa un parser compartido con memoria de resultados.
    static func parseISO(_ string: String) -> Date? {
        ISOInstantParser.shared.parse(string)
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

/// Parser compartido de instantes ISO 8601 de Supabase. `ISO8601DateFormatter`
/// cuesta unos 0,3 ms de creación y no es seguro entre hilos: un parser propio
/// por llamada saturaba el hilo principal al abrir Hoy y Vídeos (miles de
/// llamadas por pintura). Dos formateadores únicos bajo un cerrojo y una
/// memoria acotada de resultados (las horas se repiten entre pintura y
/// pintura) dan el mismo resultado sin recrearlos.
private final class ISOInstantParser: @unchecked Sendable {
    static let shared = ISOInstantParser()

    private let lock = NSLock()
    private let fractional: ISO8601DateFormatter
    private let plain: ISO8601DateFormatter
    private var results: [String: Date?] = [:]
    private static let capacity = 4096

    private init() {
        fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
    }

    func parse(_ string: String) -> Date? {
        lock.lock()
        defer { lock.unlock() }
        if let known = results[string] { return known }
        let date = fractional.date(from: string) ?? plain.date(from: string)
        if results.count >= Self.capacity { results.removeAll(keepingCapacity: true) }
        results[string] = .some(date)
        return date
    }
}

/// Caché de `DateFormatter` por idioma, formato y zona horaria (ver
/// `DateFormatting.formatter`).
private final class DateFormatterCache: @unchecked Sendable {
    static let shared = DateFormatterCache()

    private let lock = NSLock()
    private var formatters: [String: DateFormatter] = [:]

    func formatter(locale: Locale, format: String, timeZone: TimeZone) -> DateFormatter {
        let key = "\(locale.identifier)|\(format)|\(timeZone.identifier)"
        lock.lock()
        defer { lock.unlock() }
        if let known = formatters[key] { return known }
        let created = DateFormatter()
        created.locale = locale
        created.timeZone = timeZone
        created.dateFormat = format
        formatters[key] = created
        return created
    }
}

/// Memoria de `YYYY-MM-DD` → `Date` (ver `DateFormatting.date(from:)`).
private final class DateKeyMemo: @unchecked Sendable {
    static let shared = DateKeyMemo()

    private let lock = NSLock()
    private var results: [String: Date?] = [:]
    private static let capacity = 4096

    func date(from key: String, using formatter: DateFormatter) -> Date? {
        lock.lock()
        defer { lock.unlock() }
        if let known = results[key] { return known }
        let date = formatter.date(from: key)
        if results.count >= Self.capacity { results.removeAll(keepingCapacity: true) }
        results[key] = .some(date)
        return date
    }
}
