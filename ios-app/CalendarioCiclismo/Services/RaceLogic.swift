import Foundation

/// Lógica de negocio de carreras — equivalente a `js/services/races.js`.
enum RaceLogic {

    // MARK: - Resultados post-carrera

    /// Comprueba si la hora actual supera `estimatedFinishTimeUtc + offsetMinutes`.
    /// Fallback: `dateKey` 18:00 UTC + offset.
    static func raceTimeCheck(rd: RaceDay, offsetMinutes: Int) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let formatterBasic = ISO8601DateFormatter()

        if let finish = rd.estimatedFinishTimeUtc,
           let date = formatter.date(from: finish) ?? formatterBasic.date(from: finish) {
            let parts = rd.dateKey.split(separator: "-").compactMap { Int($0) }
            var validFinish = true
            if parts.count == 3 {
                var c = DateComponents()
                c.timeZone = TimeZone(identifier: "UTC")
                c.year = parts[0]; c.month = parts[1]; c.day = parts[2]
                var cal = Calendar(identifier: .gregorian)
                cal.timeZone = TimeZone(identifier: "UTC")!
                if let midnight = cal.date(from: c), date < midnight { validFinish = false }
            }
            if validFinish { return Date() >= date.addingTimeInterval(Double(offsetMinutes) * 60) }
        }
        let parts = rd.dateKey.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return false }
        var comps = DateComponents()
        comps.year = parts[0]; comps.month = parts[1]; comps.day = parts[2]
        comps.hour = 18; comps.minute = 0; comps.second = 0
        comps.timeZone = TimeZone(identifier: "UTC")
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        guard let fallback = cal.date(from: comps) else { return false }
        return Date() >= fallback.addingTimeInterval(Double(offsetMinutes) * 60)
    }

    /// True si mostrar botones de resultados en las race cards: >=30 min DESPUÉS de la llegada.
    static func shouldShowResults(rd: RaceDay, race: Race?) -> Bool {
        guard !rd.isRestDay, !rd.isCancelledDay else { return false }
        guard race?.fcId != nil || race?.pcsSlug != nil else { return false }
        return raceTimeCheck(rd: rd, offsetMinutes: 30)
    }

    /// True si mostrar botones de resultados en la ficha de jornada: >=30 min ANTES de la llegada.
    static func shouldShowResultsDetail(rd: RaceDay, race: Race?) -> Bool {
        guard !rd.isRestDay, !rd.isCancelledDay else { return false }
        guard race?.fcId != nil || race?.pcsSlug != nil else { return false }
        return raceTimeCheck(rd: rd, offsetMinutes: -30)
    }

    /// True si mostrar "Así está la carrera" — resultados de la etapa anterior:
    /// la etapa previa ha terminado y los resultados de la actual aún no están visibles.
    static func shouldShowPreviousResults(prevRd: RaceDay, currentRd: RaceDay, race: Race?) -> Bool {
        guard race?.raceFormat != "one_day" else { return false }
        guard race?.fcId != nil || race?.pcsSlug != nil else { return false }
        guard !shouldShowResultsDetail(rd: currentRd, race: race) else { return false }
        return raceTimeCheck(rd: prevRd, offsetMinutes: 0)
    }

    /// Baseline gratuito heredado de 1.4.4 — `ALL + ES + EUROPA`. Se usa como
    /// default cuando el caller no tiene acceso a la preferencia regional del
    /// usuario, así no degradamos lo gratis (Apple Guideline 3.1.2(a)).
    static let defaultBroadcastGroups: Set<String> = ["ALL", "ES", "EUROPA"]

    /// Filtra broadcasts según los grupos de país permitidos por la preferencia
    /// regional del usuario. Los broadcasts sin `country` se consideran globales
    /// y siempre se muestran (compatibilidad con datos antiguos antes de que
    /// existiera la columna).
    ///
    /// El default preserva el comportamiento gratuito previo a 2.0 (ALL+ES+EUROPA).
    /// Los callers que quieren respetar la preferencia premium del usuario deben
    /// pasar `RegionService.shared.current.allowedBroadcastGroups`.
    static func filterBroadcastsByRegion(
        _ broadcasts: [Broadcast],
        allowedGroups: Set<String> = defaultBroadcastGroups
    ) -> [Broadcast] {
        broadcasts.filter { b in
            guard let c = b.country, !c.isEmpty else { return true }
            return allowedGroups.contains(c)
        }
    }

    /// Prioridad del enlace del badge de TV en directo (Hoy / Competición). Decide a qué
    /// emisión enlaza el badge cuando hay varias. Orden:
    ///   0) YouTube
    ///   1) otras redes sociales (Facebook, Instagram, X/Twitter, TikTok, Twitch, Kick)
    ///   2) RTVE.es (pública estatal, por delante del resto de cadenas españolas)
    ///   3) otras TV públicas en abierto: RTP1, CCMA (TV3 / Esport3 / 3Cat), EITB (ETB)
    ///   4) resto de cadenas
    /// Eurosport / HBO Max / Max son "una cadena más" (tier 4, sin trato especial).
    /// Espejo de `broadcastLinkPriority` en `js/broadcast-priority.js` (web) y Android.
    static func broadcastLinkPriority(_ url: String?) -> Int {
        let u = (url ?? "").lowercased()
        if u.contains("youtube.com") || u.contains("youtu.be") { return 0 }
        // `x.com` se ancla con `//` o `.` delante para no capturar `play.max.com`.
        if u.contains("facebook.com") || u.contains("fb.watch") || u.contains("instagram.com")
            || u.contains("tiktok.com") || u.contains("twitch.tv") || u.contains("kick.com")
            || u.contains("twitter.com") || u.contains("//x.com") || u.contains(".x.com") { return 1 }
        if u.contains("rtve.es") { return 2 }
        if u.contains("rtp.pt") || u.contains("ccma.cat") || u.contains("3cat.cat") || u.contains("eitb.") { return 3 }
        return 4
    }

    /// True si la sección de TV debe mostrarse como "Revive": la carrera terminó >=30 min
    /// y hay al menos un broadcast de Eurosport, HBO Max o YouTube.
    static func hasReviveBroadcasts(_ broadcasts: [Broadcast], rd: RaceDay) -> Bool {
        guard rd.estimatedFinishTimeUtc != nil else { return false }
        guard raceTimeCheck(rd: rd, offsetMinutes: 30) else { return false }
        return reviveUrl(from: broadcasts) != nil
    }

    /// Filtra los broadcasts para modo Revive (Eurosport, HBO Max, YouTube, o showInRevive=true).
    static func reviveBroadcasts(from broadcasts: [Broadcast]) -> [Broadcast] {
        broadcasts.filter { b in
            guard let url = b.url, !url.isEmpty else { return false }
            if b.showInRevive == true { return true }
            let channel = (b.channel ?? "").lowercased()
            return channel.contains("eurosport") || channel.contains("hbo max")
                || url.contains("youtube.com") || url.contains("youtu.be")
        }
    }

    /// True si la carrera ya concluyó: >=30 min tras la hora estimada de llegada,
    /// con FALLBACK a `dateKey` 18:00 UTC cuando no hay hora de meta (lo aporta
    /// `raceTimeCheck`). Espejo FIEL de la `isRaceConcluded(rd)` EXPORTADA en
    /// `js/race-data-modal.js`, que NO exige `estimatedFinishTimeUtc`: los
    /// Campeonatos Nacionales no tienen hora de meta curada y aun así deben
    /// mostrar los resultados FC/PCS al terminar (la rejilla de Campeonatos usa
    /// esta función). El guard antiguo de `estimatedFinishTimeUtc != nil` los
    /// dejaba como "no concluidos" para siempre → nunca aparecía el botón.
    static func isRaceConcluded(rd: RaceDay) -> Bool {
        guard !rd.isRestDay, !rd.isCancelledDay else { return false }
        return raceTimeCheck(rd: rd, offsetMinutes: 30)
    }

    /// Estado del badge de TV en una celda compacta del Modo Campeonatos.
    /// Versión reducida de `tvBadge` (js/race-assets.js) para una sola línea:
    /// no distingue canales sociales ni estados `none/pending/unavailable_es`
    /// (la rejilla solo entra aquí cuando ya hay cobertura de TV).
    enum ChampionshipTvState: Equatable {
        case live              // la hora de inicio de la TV ya pasó → "Live"
        case time(String)      // hay hora futura de TV → la mostramos
        case label             // hay TV pero sin hora → "TV"
    }

    /// Decide qué mostrar en la celda cuando hay cobertura de TV. `refTs` = la
    /// hora de inicio (`startTimeUtc`) más temprana de los broadcasts; si ya
    /// pasó → `.live`; si es futura → `.time`; si no hay ninguna → `.label`.
    static func championshipTvState(broadcasts: [Broadcast]) -> ChampionshipTvState {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fBasic = ISO8601DateFormatter()
        // Conservamos el ISO original junto a su Date para formatear sin
        // re-serializar (formatTimeLocal espera el string ISO).
        let pairs: [(ts: String, date: Date)] = broadcasts.compactMap { b in
            guard let ts = b.startTimeUtc, let d = f.date(from: ts) ?? fBasic.date(from: ts) else { return nil }
            return (ts, d)
        }
        guard let earliest = pairs.min(by: { $0.date < $1.date }) else { return .label }
        if earliest.date <= Date() { return .live }
        guard let display = DateFormatting.formatTimeLocal(earliest.ts) else { return .label }
        return .time(display)
    }

    /// True si la carrera ya terminó pero no tiene fcId/pcsSlug (solo Revive).
    static func noIdsAndPastDeadline(rd: RaceDay, race: Race?) -> Bool {
        guard !rd.isRestDay, !rd.isCancelledDay else { return false }
        guard race?.fcId == nil, race?.pcsSlug == nil else { return false }
        return raceTimeCheck(rd: rd, offsetMinutes: 0)
    }

    /// URL de FirstCycling para la etapa dada.
    static func buildFcUrl(race: Race, stageNumber: Int?) -> URL? {
        guard let fcId = race.fcId, let year = race.year else { return nil }
        var s = "https://firstcycling.com/race.php?r=\(fcId)&y=\(year)"
        if let sn = stageNumber { s += "&e=\(String(format: "%02d", sn))" }
        return URL(string: s)
    }

    /// URL de ProCyclingStats para la etapa dada.
    static func buildPcsUrl(race: Race, stageNumber: Int?, stageSuffix: String? = nil) -> URL? {
        guard let slug = race.pcsSlug, let year = race.year else { return nil }
        let base = "https://www.procyclingstats.com/race/\(slug)/\(year)"
        guard let sn = stageNumber else { return URL(string: "\(base)/result") }
        if sn == 0 { return URL(string: "\(base)/prologue/result") }
        let suffix = stageSuffix?.lowercased() ?? ""
        return URL(string: "\(base)/stage-\(sn)\(suffix)/result")
    }

    /// Primer URL de un broadcast Revive (Eurosport, HBO Max, YouTube, o showInRevive=true).
    static func reviveUrl(from broadcasts: [Broadcast]) -> URL? {
        let sorted = broadcasts.sorted { ($0.sortOrder ?? 0) < ($1.sortOrder ?? 0) }
        for b in sorted {
            guard let urlStr = b.url else { continue }
            if b.showInRevive == true { return URL(string: urlStr) }
            let channel = (b.channel ?? "").lowercased()
            if channel.contains("eurosport") || channel.contains("hbo max")
                || urlStr.contains("youtube.com") || urlStr.contains("youtu.be") {
                return URL(string: urlStr)
            }
        }
        return nil
    }

    // MARK: - Tipo de etapa

    /// Etiqueta para un tipo de etapa.
    static func typeLabel(_ type: String?) -> String {
        Constants.typeLabels[type ?? ""] ?? type ?? ""
    }

    /// Resuelve combinaciones de tipo primario + secundario.
    /// - Parameter countryCode: Código de país ISO-2 de la carrera (ej. "FR"). Opcional.
    static func resolveTypeLabel(primary: String?, secondary: String?, countryCode: String? = nil) -> String {
        if primary == "sterrato" && countryCode?.uppercased() == "FR" { return "Ribinou" }
        if primary == "flat" && secondary == "summit_finish" { return LocaleService.shouldShowEnglishContent ? "One-Climb" : "Monopuerto" }
        if primary == "itt" && (secondary == "chrono_climb" || secondary == "summit_finish") {
            return typeLabel("chrono_climb")
        }
        let pLabel = typeLabel(primary)
        if primary == "itt" || primary == "ttt" { return pLabel }
        if let sec = secondary, !sec.isEmpty {
            return "\(pLabel) · \(typeLabel(sec))"
        }
        return pLabel
    }

    // MARK: - Rankings UCI

    /// Ranking UCI con excepciones especiales para Grand Tours y países asiáticos.
    static func uciRank(category: String?, name: String?, country: String?) -> Double {
        let n = name ?? ""
        if n.localizedCaseInsensitiveContains("giro de italia") { return 0.1 }
        if n.localizedCaseInsensitiveContains("tour de francia") { return 0.2 }
        if n.localizedCaseInsensitiveContains("la vuelta") { return 0.3 }

        let cat = category ?? ""
        let cc = (country ?? "").uppercased()

        if (cat == "1.2U" || cat == "2.2U") && n.localizedCaseInsensitiveContains("tour del porvenir") { return 8.5 }
        if cat == "CC" && !n.localizedCaseInsensitiveContains("europa") && !n.localizedCaseInsensitiveContains("europe") { return 14.5 }
        if ["1.Pro","2.Pro","1.1","2.1"].contains(cat)
            && isAsiaCountry(cc)
            && !n.localizedCaseInsensitiveContains("japan cup") { return 10.5 }

        return Constants.uciOrder[cat] ?? 99
    }

    /// Nivel pro simplificado.
    static func proLevel(category: String?, name: String?, country: String?) -> Double {
        let n = name ?? ""
        if n.localizedCaseInsensitiveContains("giro de italia") { return 0.1 }
        if n.localizedCaseInsensitiveContains("tour de francia") { return 0.2 }
        if n.localizedCaseInsensitiveContains("la vuelta") { return 0.3 }

        let cat = category ?? ""
        let cc = (country ?? "").uppercased()

        if ["1.Pro","2.Pro","1.1","2.1"].contains(cat)
            && isAsiaCountry(cc)
            && !n.localizedCaseInsensitiveContains("japan cup") { return 10.5 }

        let map: [String: Double] = [
            "WC":1,"CC":2,"1.UWT":3,"2.UWT":4,"1.WWT":5,"2.WWT":6,
            "1.Pro":7,"2.Pro":8,"1.1":9,"2.1":10,"1.2":11,"2.2":12,"1.2U":13,"2.2U":14,
        ]
        return map[cat] ?? 99
    }

    private static func isAsiaCountry(_ cc: String) -> Bool {
        ["CN","TH","JP","TW","KR","HK","AZ"].contains(cc)
    }

    static func genderRank(_ gender: String?) -> Int {
        gender == "female" ? 2 : 1
    }

    static func grandTourRank(_ race: Race?) -> Int {
        (race?.isGrandTour ?? false) ? 0 : 1
    }

    /// Tier de categoría UCI.
    static func categoryTier(_ uci: String?) -> String? {
        guard let uci else { return nil }
        if Constants.categoryTiers["WC"]?.contains(uci) == true { return "wc" }
        if Constants.categoryTiers["WT"]?.contains(uci) == true { return "wt" }
        if Constants.categoryTiers["PRO"]?.contains(uci) == true { return "pro" }
        if Constants.categoryTiers["MINOR"]?.contains(uci) == true { return "2" }
        return uci.isEmpty ? nil : "1"
    }

    // MARK: - Ordenación

    /// Comparador estándar por categoría UCI.
    static func sortByCategory(_ a: EnrichedRaceDay, _ b: EnrichedRaceDay) -> Bool {
        let phA = (a.isPlaceholder || a.race?.isCancelled == true) ? 1 : 0
        let phB = (b.isPlaceholder || b.race?.isCancelled == true) ? 1 : 0
        if phA != phB { return phA < phB }

        let rA = a.race, rB = b.race
        // Dos Campeonatos Nacionales: orden interno por país → línea/CRI → categoría.
        if let cn = ChampionshipsConfig.compare(rA, a.raceDay, rB, b.raceDay), cn != 0 {
            return cn < 0
        }
        let gtA = grandTourRank(rA), gtB = grandTourRank(rB)
        if gtA != gtB { return gtA < gtB }

        // Con miniperfil por delante de las que no lo tienen (dentro de su grupo, sigue el orden por categoría).
        let profA = a.raceDay.hasElevationProfile ? 0 : 1
        let profB = b.raceDay.hasElevationProfile ? 0 : 1
        if profA != profB { return profA < profB }

        let lvlA = proLevel(category: rA?.uciCategory, name: rA?.name, country: rA?.countryCode)
        let lvlB = proLevel(category: rB?.uciCategory, name: rB?.name, country: rB?.countryCode)
        if lvlA != lvlB { return lvlA < lvlB }

        let genA = genderRank(rA?.gender), genB = genderRank(rB?.gender)
        if genA != genB { return genA < genB }

        let catA = uciRank(category: rA?.uciCategory, name: rA?.name, country: rA?.countryCode)
        let catB = uciRank(category: rB?.uciCategory, name: rB?.name, country: rB?.countryCode)
        if catA != catB { return catA < catB }

        // Doble sector (misma carrera, mismo día): la etapa MÁS TEMPRANA primero.
        // Desempate por hora de salida; si falta, por el sufijo A/B (asignado en
        // orden cronológico por annotateDoubleSectors).
        let tA = a.raceDay.neutralStartTimeUtc.flatMap { DateFormatting.timestampToSeconds($0) } ?? Double.greatestFiniteMagnitude
        let tB = b.raceDay.neutralStartTimeUtc.flatMap { DateFormatting.timestampToSeconds($0) } ?? Double.greatestFiniteMagnitude
        if tA != tB { return tA < tB }
        let sfxA = a.raceDay.stageSuffix ?? "", sfxB = b.raceDay.stageSuffix ?? ""
        if sfxA != sfxB { return sfxA < sfxB }

        return (rA?.name ?? "") < (rB?.name ?? "")
    }

    /// Hora más temprana de broadcast en un item.
    static func earliestTvSeconds(_ item: EnrichedRaceDay) -> Double? {
        let times = item.broadcasts
            .compactMap(\.startTimeUtc)
            .compactMap { DateFormatting.timestampToSeconds($0) }
        return times.isEmpty ? nil : times.min()
    }

    /// Tier de TV para ordenación: 0=con hora, 1=con TV sin hora, 2=pending, 3=sin TV.
    static func tvSortTier(_ item: EnrichedRaceDay) -> Int {
        let tv = item.raceDay.tvStatus ?? ""
        let hasBroadcasts = !item.broadcasts.isEmpty
        if earliestTvSeconds(item) != nil { return 0 }
        if tv == "pending" { return 2 }
        if tv == "confirmed" || hasBroadcasts { return 1 }
        return 3
    }

    /// Comparador por hora de TV.
    static func sortByTvTime(_ a: EnrichedRaceDay, _ b: EnrichedRaceDay) -> Bool {
        let phA = (a.isPlaceholder || a.race?.isCancelled == true) ? 1 : 0
        let phB = (b.isPlaceholder || b.race?.isCancelled == true) ? 1 : 0
        if phA != phB { return phA < phB }

        let tierA = tvSortTier(a), tierB = tvSortTier(b)
        if tierA != tierB { return tierA < tierB }

        if tierA == 0 {
            let hA = earliestTvSeconds(a) ?? 999999
            let hB = earliestTvSeconds(b) ?? 999999
            if hA != hB { return hA < hB }
        }
        return sortByCategory(a, b)
    }

    /// Comparador por hora de meta.
    static func sortByFinishTime(_ a: EnrichedRaceDay, _ b: EnrichedRaceDay) -> Bool {
        let phA = (a.isPlaceholder || a.race?.isCancelled == true) ? 1 : 0
        let phB = (b.isPlaceholder || b.race?.isCancelled == true) ? 1 : 0
        if phA != phB { return phA < phB }

        let fA = a.raceDay.estimatedFinishTimeUtc.flatMap { DateFormatting.timestampToSeconds($0) }
        let fB = b.raceDay.estimatedFinishTimeUtc.flatMap { DateFormatting.timestampToSeconds($0) }

        if (fA == nil) != (fB == nil) { return fA != nil }
        if let fA, let fB, fA != fB { return fA < fB }
        return sortByCategory(a, b)
    }

    // MARK: - Filtros de categoría

    /// True si el nombre corresponde al Tour del Porvenir (excepción para 1.2U/2.2U).
    private static func isTourDelPorvenir(_ name: String) -> Bool {
        name.localizedCaseInsensitiveContains("tour del porvenir")
    }

    /// Comprueba si una carrera coincide con un filtro de categoría (mismas reglas que web).
    static func matchesCategory(_ race: Race, filter: Constants.CategoryFilter) -> Bool {
        guard filter != .all else { return true }
        let cat = race.uciCategory ?? ""
        let gender = race.gender ?? ""
        let cc = (race.countryCode ?? "").uppercased()
        let name = race.name

        // Campeonatos Nacionales: las élite (masc/fem) cuentan como "pro"; las
        // sub23 quedan fuera de Pro/Masc/Fem (igual que 1.2U/2.2U). Masc/Fem
        // respetan el género de la prueba. uwt/wwt no aplican a CN.
        if cat == "CN" {
            if ChampionshipsConfig.isU23Championship(race) { return false }
            switch filter {
            case .pro: return true
            case .male: return !ChampionshipsConfig.isFemaleChampionship(race)
            case .female: return ChampionshipsConfig.isFemaleChampionship(race)
            default: return false
            }
        }

        let baseMatch: Bool
        switch filter {
        case .all: baseMatch = true
        case .pro:
            baseMatch = cat != "1.2" && cat != "2.2"
                && (cat != "1.2U" && cat != "2.2U" || isTourDelPorvenir(name))
        case .uwt:
            baseMatch = cat == "1.UWT" || cat == "2.UWT"
        case .wwt:
            baseMatch = cat == "1.WWT" || cat == "2.WWT"
        case .male:
            baseMatch = (gender != "female" || cat == "WC" || cat == "CC")
                && cat != "1.2" && cat != "2.2"
                && (cat != "1.2U" && cat != "2.2U" || isTourDelPorvenir(name))
        case .female:
            baseMatch = (gender == "female" || cat == "WC" || cat == "CC")
                && (cat != "1.2U" && cat != "2.2U" || isTourDelPorvenir(name))
                && ((cat != "1.2" && cat != "2.2") || Constants.europeCountries.contains(cc))
        }

        guard baseMatch else { return false }

        // Ocultar WC/CC que no sean Campeonato de Europa/Mundo
        if cat == "WC" || cat == "CC" {
            return name.localizedCaseInsensitiveContains("europa")
                || name.localizedCaseInsensitiveContains("europe")
                || name.localizedCaseInsensitiveContains("mundo")
        }
        return true
    }

    /// Filtra items según categoría activa (usa las mismas reglas que matchesCategory).
    static func filterByCategory(_ items: [EnrichedRaceDay], category: Constants.CategoryFilter) -> [EnrichedRaceDay] {
        guard category != .all else { return items }
        return items.filter { item in
            guard let race = item.race else { return true }
            return matchesCategory(race, filter: category)
        }
    }

    // MARK: - Color helpers

    /// Determina si un color hex es oscuro.
    static func isColorDark(_ hex: String?) -> Bool {
        guard let hex, hex.count >= 7 else { return true }
        let h = hex.dropFirst() // quitar #
        guard h.count == 6,
              let r = UInt8(h.prefix(2), radix: 16),
              let g = UInt8(h.dropFirst(2).prefix(2), radix: 16),
              let b = UInt8(h.dropFirst(4).prefix(2), radix: 16) else { return true }
        return (Double(r) * 299 + Double(g) * 587 + Double(b) * 114) / 1000 < 128
    }

    /// Determina si un nombre indica carrera femenina.
    private static let femaleKeywords = [
        "femenino", "femenina", "féminas", "femeninos", "féminin", "féminine", "féminines",
        // "feminin" (sin acento) cubre feminina/feminino/feminine (portugués/italiano),
        // espejo del patrón f[eé]minin[e]? de la web.
        "feminin",
        "femmes", "women", "ladies", "donne", "dames", "elite women",
        "emakumeen", "women's elite", "pour dames"
    ]

    static func nameImpliesFemale(_ name: String?) -> Bool {
        guard let name else { return false }
        let lower = name.lowercased()
        return Self.femaleKeywords.contains { lower.contains($0) }
    }

    /// Determina si mostrar indicador femenino (para carreras femeninas sin indicador en el nombre).
    static func shouldShowFemaleIndicator(_ race: Race?) -> Bool {
        guard let race, race.isFemale else { return false }
        return !nameImpliesFemale(race.name)
    }

    // MARK: - Doble sector

    /// Detecta dobles sectores: dos jornadas de la misma carrera, mismo día,
    /// mismo stageNumber. Asigna `stageSuffix` ("A", "B", …) ordenando
    /// por hora de inicio (neutralStartTimeUtc).
    static func annotateDoubleSectors(_ days: inout [RaceDay]) {
        var groups: [String: [Int]] = [:]
        for (index, rd) in days.enumerated() {
            guard let sn = rd.stageNumber, !rd.isRestDay, !rd.isCancelledDay else { continue }
            let key = "\(rd.raceId ?? "")-\(rd.dateKey)-\(sn)"
            groups[key, default: []].append(index)
        }

        let suffixes = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        for (_, indices) in groups {
            guard indices.count > 1 else { continue }
            let sorted = indices.sorted { a, b in
                let tA = days[a].neutralStartTimeUtc.flatMap { DateFormatting.timestampToSeconds($0) } ?? Double.greatestFiniteMagnitude
                let tB = days[b].neutralStartTimeUtc.flatMap { DateFormatting.timestampToSeconds($0) } ?? Double.greatestFiniteMagnitude
                return tA < tB
            }
            for (suffixIdx, arrayIdx) in sorted.enumerated() {
                days[arrayIdx].stageSuffix = suffixIdx < suffixes.count ? String(suffixes[suffixIdx]) : ""
            }
        }
    }

    // MARK: - Número de etapa teórico (placeholders)

    /// Calcula el índice de lunes (1-based) de `dateKey` dentro de la carrera, o 0 si no es lunes.
    private static func mondayIndex(race: Race, dateKey: String) -> Int {
        guard let targetDate = DateFormatting.date(from: dateKey) else { return 0 }
        let cal = Calendar.current
        // Comprobar que es lunes (weekday == 2 en Calendar)
        guard cal.component(.weekday, from: targetDate) == 2 else { return 0 }
        guard let startDate = race.startDate.flatMap({ DateFormatting.date(from: $0) }) else { return 0 }

        var count = 0
        var d = startDate
        while d <= targetDate {
            if cal.component(.weekday, from: d) == 2 {
                count += 1
            }
            guard let next = cal.date(byAdding: .day, value: 1, to: d) else { break }
            d = next
        }
        return count
    }

    /// True si `dateKey` es día de carrera (no es día de descanso en grandes vueltas).
    static func isRaceDay(race: Race, dateKey: String) -> Bool {
        guard let start = race.startDate, let end = race.endDate else { return false }
        guard dateKey >= start, dateKey <= end else { return false }

        let durationDays = race.durationDays ?? 0
        let isGrandTourFormat = race.isStageRace && durationDays > 13

        if isGrandTourFormat {
            let mi = mondayIndex(race: race, dateKey: dateKey)
            if mi > 0 {
                // ≤23 días: el primer lunes es etapa; resto son descanso
                // >23 días: todos los lunes son descanso
                if durationDays <= 23 && mi == 1 { return true }
                return false
            }
        }
        return true
    }

    /// Calcula el número de etapa teórico para una fecha dada en una carrera por etapas.
    /// Equivalente a `theoreticalStageNumber()` en `js/app.js`.
    static func theoreticalStageNumber(race: Race, dateKey: String) -> Int? {
        guard race.isStageRace else { return nil }
        guard let startDate = race.startDate.flatMap({ DateFormatting.date(from: $0) }) else { return nil }
        guard let targetDate = DateFormatting.date(from: dateKey) else { return nil }

        let cal = Calendar.current
        var stage = 0
        var d = startDate
        while d <= targetDate {
            let dk = DateFormatting.toDateKey(d)
            if isRaceDay(race: race, dateKey: dk) {
                stage += 1
            }
            guard let next = cal.date(byAdding: .day, value: 1, to: d) else { break }
            d = next
        }
        return stage > 0 ? stage : nil
    }

    // MARK: - Limpieza de nombres femeninos

    /// Nombres de carreras que NO deben limpiarse (excepciones).
    private static let femaleNameExceptions = [
        "women cycling pro", "sanremo women", "tour de feminin"
    ]

    /// Limpia los sufijos femeninos del nombre cuando se aplica filtro WWT/Femenino.
    /// Equivalente al regex de `temporada.js`.
    static func cleanFeminineDisplayName(_ name: String) -> String {
        let lower = name.lowercased()
        if femaleNameExceptions.contains(where: { lower.contains($0) }) { return name }

        // Patrón: palabras clave femeninas con posibles espacios alrededor
        let pattern = #"\s*\b(women'?s?\s+elite|femenino|femenina|féminas|femeninos|féminin|féminine|femmes|women'?s?|ladies|donne|dames|elite women|emakumeen|pour dames)\b\s*"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return name }
        var cleaned = regex.stringByReplacingMatches(in: name, range: NSRange(name.startIndex..., in: name), withTemplate: " ")
        // Limpiar espacios dobles y guiones al inicio/final
        cleaned = cleaned.replacingOccurrences(of: "  +", with: " ", options: .regularExpression)
        cleaned = cleaned.trimmingCharacters(in: .whitespaces)
        cleaned = cleaned.replacingOccurrences(of: "^[\\s\\-–]+|[\\s\\-–]+$", with: "", options: .regularExpression)
        return cleaned.isEmpty ? name : cleaned
    }
}
