import Foundation

/// Lógica pura de la pantalla de Fichajes (apps 4.0) — espejo 1:1 de
/// `TransfersLogic.kt` (Android) y `js/fichajes.js` (web). Testeada en
/// `TransfersLogicTests`.
///
/// Reglas de producto (decisión Dani):
///  - El feed lista SOLO confirmaciones; los rumores y las dudas no aparecen en
///    él. Tampoco los movimientos con la fecha oculta (`dateVisible=false`,
///    mig. 123): la carga inicial del mercado mete de golpe anuncios de hace
///    semanas que llenarían el feed de días viejos, pero SÍ deben contar en el
///    detalle de equipo.
///  - En el detalle de equipo, una salida registrada (confirmada O rumoreada)
///    saca al corredor de "continúan" y lo pinta en "se marchan" (con badge
///    Rumor si procede); en el destino aparece en "llegan · Rumor".
///  - Cuarta situación: una renovación EN DUDA (`status='doubt'`, solo válido en
///    `type='renewal'`) = no se sabe si sigue. Saca al corredor de "continúan" y
///    lo lleva a su sección "En duda" (2ª, antes de se marchan/llegan). Una duda
///    sobre ir a OTRO equipo no es esto: eso es un fichaje con `status='rumor'`.
///  - El contrato de una renovación registrada gana al `contractUntil` de la
///    ficha; una renovación rumoreada marca la fila de "continúan" como Rumor.
///    Una DUDA no toca el contrato (no es un hecho: no puede pisar el de la ficha).
enum TransfersLogic {

    /// Temporada del mercado activo. Al abrir el mercado 2028, subir aquí
    /// (y en Android + web).
    static let marketSeason = 2027

    /// Las 4 divisiones del mercado, en el orden de los botones.
    static let divisions = ["WT", "PT", "WWT", "PRW"]

    /// Equipos con vista propia en el mercado: los de las 4 divisiones. Un
    /// equipo de otra categoría con fila team_seasons (filial, continental) no
    /// enlaza.
    static func marketTeamIds(_ seasons: [TeamSeason]) -> Set<String> {
        Set(seasons.filter { divisions.contains($0.category ?? "") }.map(\.teamId))
    }

    /// Género de la tabla riders_* por división (para cargar la plantilla).
    static func divisionGender(_ category: String?) -> String? {
        switch category {
        case "WT", "PT", "CT", "NTM", "CLUBM": return "male"
        case "WWT", "PRW", "CTW", "NTW", "CLUBW": return "female"
        default: return nil
        }
    }

    /// Payload de la carga inicial (lo monta `SupabaseService+Transfers`).
    struct MarketData {
        let transfers: [RiderTransfer]
        let seasons: [TeamSeason]
        let ridersById: [String: TransferRider]
        /// teamId → nombre en la temporada del mercado (destino de un fichaje).
        let teamNameById: [String: String]
        /// teamId → nombre en la temporada en curso (origen: el equipo que el
        /// corredor deja, que se llama como se llama ESTA temporada).
        var teamNamePrev: [String: String] = [:]
        /// teamId → fila team_seasons de la temporada EN CURSO (2026). Sus colores
        /// son los "antiguos" que se muestran mientras los colores del mercado no
        /// están publicados. Un equipo NUEVO (nacido en la temporada del mercado) no tiene
        /// entrada aquí → sin colores (mig. 129).
        var prevSeasonsByTeamId: [String: TeamSeason] = [:]

        /// Datos actuales con solo uno de los dos listados puesto al día: las
        /// renovaciones (`renewals`) o el resto de movimientos, que alimentan
        /// Fichajes. El otro listado conserva lo que ya mostraba.
        func replacingFeed(renewals: Bool, with fresh: MarketData) -> MarketData {
            let kept = transfers.filter { ($0.type == "renewal") != renewals }
            let updated = fresh.transfers.filter { ($0.type == "renewal") == renewals }
            return MarketData(
                transfers: kept + updated,
                seasons: seasons,
                ridersById: ridersById.merging(fresh.ridersById) { _, new in new },
                teamNameById: teamNameById.merging(fresh.teamNameById) { _, new in new },
                teamNamePrev: teamNamePrev.merging(fresh.teamNamePrev) { _, new in new },
                prevSeasonsByTeamId: prevSeasonsByTeamId
            )
        }
    }

    /// Lado del movimiento del que se pide el nombre de un equipo.
    enum TeamSide { case from, to }

    /// Colores EFECTIVOS de un equipo del mercado (decisión Dani
    /// 2026-07-18), que dan fondo y texto a su tarjeta y a su cabecera
    /// (`teamColorStyle` en `js/fichajes-html.js`):
    ///  - Colores del mercado PUBLICADOS (`badgeVisible == true`) → la fila del
    ///    mercado (2027).
    ///  - Sin publicar pero el equipo YA existía la temporada anterior → su fila
    ///    ANTERIOR (2026): los colores que la gente ya conoce, hasta que se
    ///    anuncie el kit.
    ///  - Sin publicar y SIN identidad anterior (equipo nacido este año) → nil
    ///    (superficie neutra).
    ///  - Sin publicar y con `prevColorsHidden` (denominación sin confirmar) →
    ///    nil (superficie neutra).
    static func badgeSeason(for season: TeamSeason, prev: [String: TeamSeason]) -> TeamSeason? {
        if season.badgeVisible == true { return season }
        if season.prevColorsHidden == true { return nil }
        return prev[season.teamId]
    }

    /// Marcador de "baja sin destino conocido" en el texto libre de destino.
    static let unknownDest = "?"

    /// Un FICHAJE REAL: corredor que cambia de equipo (`transfer` con destino
    /// conocido). Las renovaciones, retiradas y fines de contrato sin destino
    /// (`transfer` con `toTeamName='?'`) NO son fichajes → fuera del feed.
    static func isRealSigning(_ x: RiderTransfer) -> Bool {
        x.type == "transfer" && (x.toTeamId != nil || (x.toTeamName != nil && x.toTeamName != unknownDest))
    }

    /// Orden alfabético de nombres de corredor y de equipo: no distingue
    /// mayúsculas ni diacríticos (Á ordena junto a A) y conserva la ñ como
    /// letra propia en castellano. Equivale a `localeCompare('es', { sensitivity:
    /// 'base' })` de `js/fichajes.js`.
    static func alphabeticallyPrecedes(_ a: String, _ b: String) -> Bool {
        a.compare(
            b, options: [.caseInsensitive, .diacriticInsensitive],
            range: nil, locale: Locale(identifier: "es")
        ) == .orderedAscending
    }

    /// PRW es la clave persistida para la categoría PTW (Women's ProTeam).
    private static let feedCategoryRank = ["WT": 0, "PT": 1, "WWT": 2, "PRW": 3, "PTW": 3]

    private static func feedPrecedes(
        _ a: RiderTransfer,
        _ b: RiderTransfer,
        categoryByTeamId: [String: String],
        teamNameById: [String: String]
    ) -> Bool {
        let dateA = a.announcedAt ?? ""
        let dateB = b.announcedAt ?? ""
        if dateA != dateB { return dateA > dateB }

        // Próximas temporadas primero; mitad de temporada siempre en el bloque final.
        if a.midSeason != b.midSeason { return !a.midSeason }

        let rankA = a.toTeamId.flatMap { categoryByTeamId[$0] }.flatMap { feedCategoryRank[$0] } ?? 90
        let rankB = b.toTeamId.flatMap { categoryByTeamId[$0] }.flatMap { feedCategoryRank[$0] } ?? 90
        if rankA != rankB { return rankA < rankB }

        func teamName(_ x: RiderTransfer) -> String {
            x.toTeamId.flatMap { teamNameById[$0] } ?? x.toTeamName ?? x.toTeamId ?? ""
        }
        let byTeam = teamName(a).compare(
            teamName(b), options: [.caseInsensitive, .diacriticInsensitive],
            range: nil, locale: Locale(identifier: "es")
        )
        if byTeam != .orderedSame { return byTeam == .orderedAscending }

        let creationA = a.createdAt ?? ""
        let creationB = b.createdAt ?? ""
        if creationA != creationB { return creationA > creationB }
        return a.id < b.id
    }

    // MARK: - Filtros del feed

    /// Filtros de Fichajes y Renovaciones, espejo de `FILTER_GROUPS` en
    /// `js/fichajes-html.js`: categoría (género del corredor) y división del
    /// equipo de destino (en una renovación, el propio equipo). Dentro de un
    /// grupo es O y entre grupos, Y. Empiezan con todo activo.
    struct FeedFilters: Equatable, Codable {
        static let allGenders = ["male", "female"]
        static let allDivisions = ["world", "pro"]

        var genders = Set(allGenders)
        var divisions = Set(allDivisions)

        /// Algún chip apagado.
        var isActive: Bool {
            genders.count < Self.allGenders.count || divisions.count < Self.allDivisions.count
        }

        /// Cambia un chip. Un grupo nunca queda vacío: sin ninguna opción
        /// equivaldría a ocultarlo todo, así que vuelve a activarse entero.
        mutating func toggleGender(_ value: String) {
            Self.toggle(&genders, value, all: Self.allGenders)
        }

        mutating func toggleDivision(_ value: String) {
            Self.toggle(&divisions, value, all: Self.allDivisions)
        }

        private static func toggle(_ set: inout Set<String>, _ value: String, all: [String]) {
            if set.contains(value) { set.remove(value) } else { set.insert(value) }
            if set.isEmpty { set = Set(all) }
        }

        /// Selección recordada, como en la web (`cc_transfer_filters`).
        static let storageKey = "transfer_filters"

        static func load() -> FeedFilters {
            guard let data = UserDefaults.standard.data(forKey: storageKey),
                  let value = try? JSONDecoder().decode(FeedFilters.self, from: data) else { return FeedFilters() }
            return value
        }

        func save() {
            guard isActive, let data = try? JSONEncoder().encode(self) else {
                UserDefaults.standard.removeObject(forKey: Self.storageKey)
                return
            }
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        }
    }

    /// División del destino agrupada en los dos chips; PTW es el alias de PRW.
    static let divisionGroup = ["WT": "world", "WWT": "world", "PT": "pro", "PRW": "pro", "PTW": "pro"]

    /// Un grupo con algún chip apagado exige que el valor conocido del
    /// movimiento esté entre los activos; un valor desconocido solo se oculta
    /// entonces. Sin filtros, todo pasa.
    static func matches(
        _ x: RiderTransfer,
        filters: FeedFilters?,
        categoryByTeamId: [String: String]
    ) -> Bool {
        guard let filters else { return true }
        if filters.genders.count < FeedFilters.allGenders.count,
           !filters.genders.contains(x.riderGender) { return false }
        if filters.divisions.count < FeedFilters.allDivisions.count {
            guard let group = x.toTeamId.flatMap({ categoryByTeamId[$0] }).flatMap({ divisionGroup[$0] }),
                  filters.divisions.contains(group) else { return false }
        }
        return true
    }

    /// Feed público: solo FICHAJES confirmados CON fecha visible, cronológico
    /// inverso. `dateVisible=false` es un flag de publicación, no una fecha
    /// ausente: el movimiento sigue contando en el detalle de equipo.
    static func confirmedFeed(
        _ transfers: [RiderTransfer],
        categoryByTeamId: [String: String] = [:],
        teamNameById: [String: String] = [:],
        filters: FeedFilters? = nil
    ) -> [RiderTransfer] {
        transfers.filter {
            $0.status == "confirmed" && $0.dateVisible && isRealSigning($0)
                && matches($0, filters: filters, categoryByTeamId: categoryByTeamId)
        }
            .sorted {
                feedPrecedes($0, $1, categoryByTeamId: categoryByTeamId, teamNameById: teamNameById)
            }
    }

    /// Feed público de renovaciones confirmadas con fecha visible.
    static func renewalFeed(
        _ transfers: [RiderTransfer],
        categoryByTeamId: [String: String] = [:],
        teamNameById: [String: String] = [:],
        filters: FeedFilters? = nil
    ) -> [RiderTransfer] {
        transfers.filter {
            $0.status == "confirmed" && $0.dateVisible && $0.type == "renewal"
                && matches($0, filters: filters, categoryByTeamId: categoryByTeamId)
        }
            .sorted {
                feedPrecedes($0, $1, categoryByTeamId: categoryByTeamId, teamNameById: teamNameById)
            }
    }

    /// Corte del feed de Fichajes y Renovaciones: hasta `maxDays` fechas
    /// distintas O `maxItems` movimientos, lo que se alcance antes (el feed
    /// viene ordenado cronológico inverso). En teléfono se usa el corte corto;
    /// en pantallas anchas la lista tiene altura fija con desplazamiento y
    /// admite el corte largo (`feedHtml` en `js/fichajes.js`). No hay "cargar
    /// más": el mercado completo se ve por equipo.
    static let feedMaxDays = 5
    static let feedMaxItems = 8
    static let feedScrollMaxDays = 30
    static let feedScrollMaxItems = 60
    static func limitedFeed(
        _ feed: [RiderTransfer],
        maxDays: Int = feedMaxDays,
        maxItems: Int = feedMaxItems
    ) -> [RiderTransfer] {
        var out: [RiderTransfer] = []
        var lastDay: String? = nil
        var daysShown = 0
        for x in feed {
            let day = x.announcedAt ?? ""
            let newDay = day != lastDay
            if newDay && daysShown >= maxDays { break }
            if out.count >= maxItems { break }
            if newDay { lastDay = day; daysShown += 1 }
            out.append(x)
        }
        return out
    }

    /// Agrupa el feed por día de anuncio conservando el orden de entrada.
    static func groupByDay(_ feed: [RiderTransfer]) -> [(day: String, moves: [RiderTransfer])] {
        var out: [(day: String, moves: [RiderTransfer])] = []
        for t in feed {
            let key = t.announcedAt ?? ""
            if let last = out.last, last.day == key {
                out[out.count - 1].moves.append(t)
            } else {
                out.append((day: key, moves: [t]))
            }
        }
        return out
    }

    /// Equipos de una división, alfabético.
    static func divisionTeams(_ seasons: [TeamSeason], division: String) -> [TeamSeason] {
        seasons.filter { $0.category == division }
            .sorted { alphabeticallyPrecedes($0.name ?? "", $1.name ?? "") }
    }

    /// Fila de la sección "continúan".
    struct StayingRow: Identifiable {
        let rider: TransferRider
        let contractUntil: Int?
        let isRumor: Bool
        var id: String { rider.id }
    }

    /// Fila de la sección "en duda". `rider` puede ser nil si el corredor ya no
    /// está en la plantilla y no se pudo hidratar su ficha → se cae al riderId.
    struct DoubtRow: Identifiable {
        let rider: TransferRider?
        let riderId: String
        let contractUntil: Int?
        var id: String { riderId }
    }

    /// Fila de la plantilla del mercado: quien continúa o una llegada
    /// confirmada. `rider` puede faltar en una llegada sin ficha hidratada.
    struct SquadRow: Identifiable {
        let rider: TransferRider?
        let riderId: String
        let contractUntil: Int?
        let isRumor: Bool
        let isArrival: Bool
        var id: String { riderId }
    }

    struct TeamDetail {
        let staying: [StayingRow]
        let doubtful: [DoubtRow]
        let contractEnds: [RiderTransfer]
        let arrivals: [RiderTransfer]
        let departures: [RiderTransfer]
        /// Plantilla de la temporada del mercado: los que continúan más las
        /// llegadas confirmadas, por año de contrato descendente y apellido.
        /// Espejo de la sección «Plantilla» de `teamViewHtml` (web).
        var squad: [SquadRow] = []

        /// Ciclistas confirmados de la plantilla (sin renovación rumoreada).
        var confirmedCount: Int { squad.filter { !$0.isRumor }.count }
    }

    /// Tinte de la fila de plantilla según el año de fin de contrato respecto
    /// a la temporada del mercado: dos o más años de margen, verde; uno,
    /// amarillo; vence esa temporada (o antes), rojo. Sin año, sin tinte.
    enum ContractTint { case green, yellow, red }

    static func contractTint(_ year: Int?) -> ContractTint? {
        guard let year else { return nil }
        if year >= marketSeason + 2 { return .green }
        return year == marketSeason + 1 ? .yellow : .red
    }

    /// Un "fin de contrato sin destino": acaba contrato sin equipo conocido
    /// (`transfer` con `toTeamName='?'` y sin `toTeamId`) → sección "Terminan
    /// contrato", no "Se marchan".
    static func isContractEnd(_ x: RiderTransfer) -> Bool {
        x.type == "transfer" && x.toTeamId == nil && x.toTeamName == unknownDest
    }

    /// Deriva las secciones del detalle de equipo. `roster` = plantilla 2027
    /// MATERIALIZADA (rider_team_affiliations year=market), con el contractUntil
    /// de la afiliación. Los cambios de equipo ya no tienen afiliación aquí (no
    /// entran en el roster); las dudas SÍ (siguen afiliadas) y se separan a su
    /// bucket. Orden de secciones: continúan → en duda → terminan contrato →
    /// llegan → se marchan.
    static func teamDetail(
        transfers: [RiderTransfer],
        roster: [TransferRider],
        teamId: String,
        ridersById: [String: TransferRider] = [:],
        categoryByTeamId: [String: String] = [:],
        teamNameById: [String: String] = [:]
    ) -> TeamDetail {
        // Los fichajes efectivos durante la temporada se muestran en el feed,
        // pero no forman parte del mercado de la plantilla siguiente.
        let marketTransfers = transfers.filter { !$0.midSeason }
        // Llegan (fichajes): primero los CONFIRMADOS, luego los rumores; dentro
        // de cada grupo, alfabético por apellido.
        func arrivalName(_ x: RiderTransfer) -> String {
            let r = ridersById[x.riderId]
            return "\(r?.lastName ?? "") \(r?.firstName ?? "")"
        }
        func arrivalGroup(_ x: RiderTransfer) -> Int { x.status == "rumor" ? 1 : 0 }
        let arrivals = marketTransfers.filter { $0.type == "transfer" && $0.toTeamId == teamId }
            .sorted { a, b in
                let ga = arrivalGroup(a), gb = arrivalGroup(b)
                if ga != gb { return ga < gb }
                return alphabeticallyPrecedes(arrivalName(a), arrivalName(b))
            }
        let allDepartures = marketTransfers.filter {
            ($0.type == "transfer" || $0.type == "retirement") && $0.fromTeamId == teamId
        }
        // Fin de contrato sin destino → su propia sección (alfabético por
        // apellido); el resto (fichaje con destino o retirada) se marcha.
        func riderKey(_ x: RiderTransfer) -> String {
            let r = ridersById[x.riderId]
            return "\(r?.lastName ?? "") \(r?.firstName ?? "")"
        }
        let contractEnds = allDepartures.filter { isContractEnd($0) }
            .sorted { alphabeticallyPrecedes(riderKey($0), riderKey($1)) }
        // Se marchan: por categoría del destino (WT→WWT→PT→PRW→resto), luego
        // alfabético por nombre del equipo; los retiros al final.
        let catRank = ["WT": 0, "WWT": 1, "PT": 2, "PRW": 3]
        func depKey(_ x: RiderTransfer) -> (Int, Int, String) {
            if x.type == "retirement" { return (1, 99, "") }
            let cat = x.toTeamId.flatMap { categoryByTeamId[$0] }
            let rank = cat.flatMap { catRank[$0] } ?? 90
            let name = x.toTeamId.flatMap { teamNameById[$0] } ?? (x.toTeamName ?? "")
            return (0, rank, name)
        }
        let departures = allDepartures.filter { !isContractEnd($0) }
            .sorted { a, b in
                let ka = depKey(a), kb = depKey(b)
                if ka.0 != kb.0 { return ka.0 < kb.0 }
                if ka.1 != kb.1 { return ka.1 < kb.1 }
                return alphabeticallyPrecedes(ka.2, kb.2)
            }
        // Renovación más reciente por corredor (transfers llega en orden desc).
        // Las EN DUDA van a su propio bucket: no anotan contrato ni "continúan".
        var renewalsByRider: [String: RiderTransfer] = [:]
        var doubtsByRider: [String: RiderTransfer] = [:]
        for t in marketTransfers where t.type == "renewal" && t.toTeamId == teamId {
            if t.status == "doubt" {
                if doubtsByRider[t.riderId] == nil { doubtsByRider[t.riderId] = t }
            } else if renewalsByRider[t.riderId] == nil {
                renewalsByRider[t.riderId] = t
            }
        }

        // "Continúan" = solo quien YA estaba en el equipo en la temporada en
        // curso (currentTeamId = equipo). Un fichaje de fuera también tiene
        // afiliación al año del mercado, pero su currentTeamId es otro equipo →
        // va a "Llegan", no aquí.
        // "gone" = toda salida (fichaje, retirada Y fin de contrato): nadie de
        // ellos continúa.
        let gone = Set(allDepartures.map(\.riderId))
        let staying = roster.filter { $0.currentTeamId == teamId && !gone.contains($0.id) && doubtsByRider[$0.id] == nil }
            .map { rider -> StayingRow in
                let renewal = renewalsByRider[rider.id]
                return StayingRow(
                    rider: rider,
                    contractUntil: renewal?.contractUntil ?? rider.contractUntil,
                    isRumor: renewal?.status == "rumor"
                )
            }
            // Por año de contrato DESC (2030 → … → sin año al final), alfabético
            // como desempate.
            .sorted { a, b in
                if a.contractUntil != b.contractUntil {
                    return (a.contractUntil ?? 0) > (b.contractUntil ?? 0)
                }
                let ka = "\(a.rider.lastName ?? "") \(a.rider.firstName ?? "")"
                let kb = "\(b.rider.lastName ?? "") \(b.rider.firstName ?? "")"
                return alphabeticallyPrecedes(ka, kb)
            }

        // En duda: la ficha de la plantilla manda; si el corredor ya no está en
        // ella, se pinta con lo que haya (nombre del movimiento en la UI).
        let byId = Dictionary(uniqueKeysWithValues: roster.map { ($0.id, $0) })
        let doubtful = doubtsByRider.values
            .filter { !gone.contains($0.riderId) }
            .map { t in
                DoubtRow(rider: byId[t.riderId], riderId: t.riderId, contractUntil: byId[t.riderId]?.contractUntil)
            }
            .sorted { a, b in
                let ka = a.rider.map { "\($0.lastName ?? "") \($0.firstName ?? "")" } ?? a.riderId
                let kb = b.rider.map { "\($0.lastName ?? "") \($0.firstName ?? "")" } ?? b.riderId
                return alphabeticallyPrecedes(ka, kb)
            }

        // Plantilla: los que continúan MÁS las llegadas CONFIRMADAS (un rumor
        // no entra; la llegada sigue también en «Llegan»).
        let stayingIds = Set(staying.map(\.rider.id))
        var squad = staying.map {
            SquadRow(rider: $0.rider, riderId: $0.rider.id, contractUntil: $0.contractUntil, isRumor: $0.isRumor, isArrival: false)
        }
        for x in arrivals where x.status == "confirmed" && !stayingIds.contains(x.riderId) && doubtsByRider[x.riderId] == nil
            && !squad.contains(where: { $0.riderId == x.riderId }) {
            squad.append(SquadRow(rider: ridersById[x.riderId], riderId: x.riderId, contractUntil: x.contractUntil, isRumor: false, isArrival: true))
        }
        return TeamDetail(staying: staying, doubtful: doubtful, contractEnds: contractEnds, arrivals: arrivals, departures: departures, squad: sortedSquad(squad))
    }

    /// Orden de la plantilla: por año de contrato descendente (sin año al
    /// final) y apellido o, con `alphabetical`, solo por apellido. Espejo del
    /// `squadOrder` de `teamViewHtml` (web).
    static func sortedSquad(_ rows: [SquadRow], alphabetical: Bool = false) -> [SquadRow] {
        rows.sorted { a, b in
            if !alphabetical, a.contractUntil != b.contractUntil { return (a.contractUntil ?? 0) > (b.contractUntil ?? 0) }
            let ka = "\(a.rider?.lastName ?? "") \(a.rider?.firstName ?? "")"
            let kb = "\(b.rider?.lastName ?? "") \(b.rider?.firstName ?? "")"
            return alphabeticallyPrecedes(ka, kb)
        }
    }

    /// Nombre a mostrar de un equipo referenciado (catálogo > texto libre > fallback).
    /// `side`: `.from` = el equipo que el corredor deja, con el nombre de la
    /// temporada en curso; `.to` = aquel con el que va a correr, con el de la
    /// temporada del mercado.
    static func teamLabel(
        teamId: String?,
        freeText: String?,
        names: [String: String],
        unknownLabel: String,
        side: TeamSide = .to,
        namesPrev: [String: String] = [:]
    ) -> String {
        if let id = teamId {
            let primary = side == .from ? namesPrev : names
            let fallback = side == .from ? names : namesPrev
            return primary[id] ?? fallback[id] ?? id
        }
        if let text = freeText, !text.isEmpty { return text }
        return unknownLabel
    }
}
