import Foundation

/// Modo Campeonatos — configuración (Campeonatos Nacionales 2026).
/// Port nativo de `js/campeonatos-config.js`: único punto con los literales
/// anuales (fechas, orden de países, slots, etiquetas y clasificación de slot).
/// El año siguiente = editar este archivo.
enum ChampionshipsConfig {
    static let year = 2026

    /// Semana grande de Campeonatos (22-28 jun). Gobierna el cintillo, el
    /// selector de días, el filtro "Hoy" forzado y el takeover de la vista Hoy.
    /// NO ampliar: define la "semana de campeonatos" visible.
    static let rangeStart = "2026-06-22"
    static let rangeEnd = "2026-06-28"
    static let dates: Set<String> = [
        "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25",
        "2026-06-26", "2026-06-27", "2026-06-28",
    ]

    /// Ventana de CARGA de la pantalla de Campeonatos: qué carreras CN entran en
    /// la rejilla. Más ancha que la semana grande para recoger campeonatos fuera
    /// de ella (Ecuador, EEUU, los sub23 reunidos en Luxemburgo). Solo la usa la
    /// query de datos; todo lo demás usa rangeStart/rangeEnd. Espejo de `js/campeonatos-config.js`.
    static let queryStart = "2026-06-01"
    static let queryEnd = "2026-07-15"

    /// Filtro "Hoy" de la rejilla: solo del 24 al 28 de junio (ambos inclusive).
    /// Los dos primeros días apenas hay pruebas → es superfluo; a mitad de semana
    /// se solapan y filtrar por la jornada del día facilita la tarea del usuario.
    /// El fin del rango coincide con `rangeEnd`. Espejo de `js/campeonatos-config.js`.
    static let todayFilterStart = "2026-06-24"

    /// `true` si hoy (fecha real del dispositivo) cae en el rango del filtro "Hoy".
    static func isTodayFilterActive(today: String = DateFormatting.todayKey()) -> Bool {
        today >= todayFilterStart && today <= rangeEnd
    }

    /// `true` si hoy (fecha real del dispositivo) cae en la semana de Campeonatos
    /// (22-28 jun, ventana completa). Durante esta ventana la vista "Hoy" impone el
    /// filtro Masculino por defecto y solo ofrece cuatro filtros (Todas/Pro/Masc/Fem),
    /// sin posibilidad de fijar otro predeterminado. Espejo de `js/campeonatos-config.js`.
    static func isChampWeekFilterLock(today: String = DateFormatting.todayKey()) -> Bool {
        today >= rangeStart && today <= rangeEnd
    }

    /// Filtros visibles en la vista "Hoy" durante la semana de Campeonatos (sin WT/WWT).
    static let champWeekHoyFilters: [Constants.CategoryFilter] = [.all, .pro, .male, .female]

    /// Filtro forzado por defecto en la vista "Hoy" durante la semana de Campeonatos.
    static let champWeekHoyDefault: Constants.CategoryFilter = .male

    /// Filtros visibles en la rejilla: `today` solo se ofrece en su rango.
    static var visibleFilters: [Filter] {
        isTodayFilterActive() ? Filter.allCases : Filter.allCases.filter { $0 != .today }
    }

    /// Filtro predeterminado: `today` cuando está activo (primero), si no `all`.
    static var defaultFilter: Filter { isTodayFilterActive() ? .today : .all }

    /// Orden de filas (ISO-3166-1 alpha-2, mayúscula). UCI Nation Ranking con los
    /// seis primeros forzados (ES, FR, IT, BE, NL, PT). Países presentes en datos
    /// pero ausentes de esta lista se añaden al final, ordenados por código.
    static let countryOrder: [String] = [
        "ES", "FR", "IT", "BE", "NL", "PT",
        "DK", "SI", "GB", "AU", "US", "NO", "CH", "DE", "CO", "MX",
        "AT", "NZ", "ER", "IE", "CZ", "EC", "PL", "KZ", "UY", "CA",
        "LV", "SK", "EE", "VE", "ZA", "SE", "CR", "LU", "GR", "IL",
        "DZ", "PA", "MN", "RS", "CN", "MU", "UZ", "JP", "UA", "GT",
        "BR", "AE", "AR", "BZ", "TH", "RO", "RW", "HU", "BM", "ID",
        "MT", "HN", "JM", "ET", "TR", "CL", "DO", "HK", "LT", "CY",
        "KR", "BO", "BG", "MA", "FI", "VN", "MC", "XK", "TT", "PR",
        "PE", "PH", "TW", "BJ", "SV", "MY", "ZW", "JO", "IR", "NA",
        "EG", "BA", "SG", "CM", "MK", "UG", "CU", "ME", "HR", "IN",
        "MD", "AG", "AL", "CV", "IS", "TN", "LA", "AO", "VG", "MO",
        "GD", "KY", "GU", "SZ", "VC", "DM", "BF", "KG", "AZ", "PY",
        "KE", "CI", "SX", "CW", "GY", "TZ", "BH", "SY", "CD", "IQ", "SA",
    ]

    /// 8 eventos en orden fijo de columna. Por pares (línea, CRI) de cada
    /// categoría: masc, fem, sub23 masc, sub23 fem.
    enum Slot: String, CaseIterable, Hashable {
        case lineaMasc = "linea_masc"
        case criMasc = "cri_masc"
        case lineaFem = "linea_fem"
        case criFem = "cri_fem"
        case lineaSub23M = "linea_sub23_m"
        case criSub23M = "cri_sub23_m"
        case lineaSub23F = "linea_sub23_f"
        case criSub23F = "cri_sub23_f"

        var label: String {
            switch self {
            case .lineaMasc:    return LocaleService.t("Línea masc", "Men's RR")
            case .criMasc:      return LocaleService.t("CRI masc", "Men's ITT")
            case .lineaFem:     return LocaleService.t("Línea fem", "Women's RR")
            case .criFem:       return LocaleService.t("CRI fem", "Women's ITT")
            case .lineaSub23M:  return LocaleService.t("Línea sub23 masc", "Men's U23 RR")
            case .criSub23M:    return LocaleService.t("CRI sub23 masc", "Men's U23 ITT")
            case .lineaSub23F:  return LocaleService.t("Línea sub23 fem", "Women's U23 RR")
            case .criSub23F:    return LocaleService.t("CRI sub23 fem", "Women's U23 ITT")
            }
        }

        /// Etiqueta compacta para las celdas de la rejilla (género + disciplina).
        var shortLabel: String {
            switch self {
            case .lineaMasc:    return LocaleService.t("M · Línea", "M · RR")
            case .criMasc:      return LocaleService.t("M · CRI", "M · ITT")
            case .lineaFem:     return LocaleService.t("F · Línea", "F · RR")
            case .criFem:       return LocaleService.t("F · CRI", "F · ITT")
            case .lineaSub23M:  return LocaleService.t("M23 · Línea", "M23 · RR")
            case .criSub23M:    return LocaleService.t("M23 · CRI", "M23 · ITT")
            case .lineaSub23F:  return LocaleService.t("F23 · Línea", "F23 · RR")
            case .criSub23F:    return LocaleService.t("F23 · CRI", "F23 · ITT")
            }
        }

        var isFemale: Bool {
            self == .lineaFem || self == .criFem || self == .lineaSub23F || self == .criSub23F
        }
    }

    /// Filtros de la pantalla (Todas/Pro/Masc/Fem) → qué slots se muestran.
    /// `pro` = solo elite (sin sub23); `male`/`female` = solo elite de ese género.
    enum Filter: String, CaseIterable, Identifiable {
        case today = "today"
        case all = "all"
        case pro = "pro"
        case male = "male"
        case female = "female"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .today:  return LocaleService.t("Hoy", "Today")
            case .all:    return LocaleService.t("Todas", "All")
            case .pro:    return "Pro"
            case .male:   return LocaleService.t("Masc", "Men")
            case .female: return LocaleService.t("Fem", "Women")
            }
        }

        /// Slots permitidos por el filtro de género. `today` no restringe slots
        /// (filtra por fecha en `ChampionshipCountry.visibleSlots`) → todos.
        var slots: [Slot] {
            switch self {
            case .today:  return Slot.allCases
            case .all:    return Slot.allCases
            case .pro:    return [.lineaMasc, .criMasc, .lineaFem, .criFem]
            case .male:   return [.lineaMasc, .criMasc]
            case .female: return [.lineaFem, .criFem]
            }
        }
    }

    static var title: String { LocaleService.t("Campeonatos Nacionales", "National Championships") }

    /// Deduce el slot de una carrera país-evento a partir de su nombre (señal
    /// primaria) con respaldo en `primaryType`/`gender`. Siempre devuelve un slot.
    /// Port 1:1 de `championshipSlot` en `js/campeonatos-config.js`.
    static func slot(race: Race, rd: RaceDay) -> Slot {
        let n = race.name
        let u23 = matches(n, #"\bsub-?23\b|\bu-?23\b"#)
        // Tipo: CRI por nombre; respaldo en primaryType (itt/ttt). Si el nombre dice 'línea', es ruta.
        let itt = matches(n, #"\bcri\b|contrarreloj"#)
            || ((rd.primaryType == "itt" || rd.primaryType == "ttt") && !matches(n, #"\bl[ií]nea\b"#))
        // Género: por nombre; respaldo en race.gender.
        let fem = matches(n, #"\bfemenin"#) || (race.gender == "female" && !matches(n, #"\bmasculin"#))

        if u23 {
            return fem ? (itt ? .criSub23F : .lineaSub23F)
                       : (itt ? .criSub23M : .lineaSub23M)
        }
        return fem ? (itt ? .criFem : .lineaFem)
                   : (itt ? .criMasc : .lineaMasc)
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    // ── Clasificación de una CN para los filtros de categoría (Pro/Masc/Fem) ──
    // Misma señal que slot() (nombre con respaldo en gender). Una CN élite cuenta
    // como "pro"; las sub23 quedan fuera de Pro/Masc/Fem (igual que 1.2U/2.2U).
    // Masc/Fem además respetan el género de la prueba.

    /// ¿Es una CN de categoría sub23? (línea o CRI; masc o fem)
    static func isU23Championship(_ race: Race?) -> Bool {
        guard let race, isChampionship(race) else { return false }
        return matches(race.name, #"\bsub-?23\b|\bu-?23\b"#)
    }

    /// Género de una CN: femenino si el nombre lo dice o gender=='female'
    /// (sin que el nombre diga masculino); masculino en otro caso.
    static func isFemaleChampionship(_ race: Race?) -> Bool {
        guard let race else { return false }
        return matches(race.name, #"\bfemenin"#)
            || (race.gender == "female" && !matches(race.name, #"\bmasculin"#))
    }

    // ── Orden interno de la categoría CN en Hoy/Mes ───────────────────
    // Cuando dos jornadas son Campeonatos Nacionales (uciCategory == "CN") se
    // ordenan entre sí por: (1) país según countryOrder, (2) LÍNEA antes que CRI
    // (toda la línea por delante de toda la CRI), (3) elite masc, elite fem,
    // sub23 masc, sub23 fem. Distinto del orden de columnas de la página (que
    // intercala línea/CRI por categoría). Espejo de `js/campeonatos-config.js`.

    private static let countryIndexMap: [String: Int] =
        Dictionary(uniqueKeysWithValues: countryOrder.enumerated().map { ($1, $0) })

    /// Índice de país; los ausentes van al final (mismo criterio que la rejilla).
    static func countryIndex(_ countryCode: String?) -> Int {
        countryIndexMap[(countryCode ?? "").uppercased()] ?? countryOrder.count
    }

    /// Prioridad de slot dentro de un país: línea primero (todas), luego CRI;
    /// dentro de cada bloque elite masc → elite fem → sub23 masc → sub23 fem.
    private static let cnSlotRank: [Slot: Int] = [
        .lineaMasc: 0, .lineaFem: 1, .lineaSub23M: 2, .lineaSub23F: 3,
        .criMasc: 4, .criFem: 5, .criSub23M: 6, .criSub23F: 7,
    ]

    static func isChampionship(_ race: Race?) -> Bool { race?.uciCategory == "CN" }

    /// Comparador parcial para dos CN: país → línea/CRI → categoría. Devuelve un
    /// número (≠0 ⇒ orden decidido; 0 ⇒ desempate al comparador genérico) o `nil`
    /// si alguna no es CN (no aplica este orden).
    static func compare(_ rA: Race?, _ rdA: RaceDay, _ rB: Race?, _ rdB: RaceDay) -> Int? {
        guard isChampionship(rA), isChampionship(rB), let rA, let rB else { return nil }
        let ci = countryIndex(rA.countryCode) - countryIndex(rB.countryCode)
        if ci != 0 { return ci }
        let sA = cnSlotRank[slot(race: rA, rd: rdA)] ?? 8
        let sB = cnSlotRank[slot(race: rB, rd: rdB)] ?? 8
        return sA - sB
    }
}
