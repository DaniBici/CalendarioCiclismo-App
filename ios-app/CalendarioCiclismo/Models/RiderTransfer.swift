import Foundation

/// Movimiento del mercado de fichajes (tabla `rider_transfers`, mig. 122).
///
/// Convención por `type` (espejo del CHECK de la migración):
///  - `transfer`   → fromTeam* = equipo que deja, toTeam* = equipo al que va.
///  - `renewal`    → toTeamId  = equipo con el que renueva (fromTeam* NULL).
///  - `retirement` → fromTeam* = equipo que deja (toTeam* NULL).
///
/// `fromTeamName`/`toTeamName` son texto libre para equipos fuera del catálogo
/// (júniors, amateurs, destinos sin catalogar). `status` `rumor` y `doubt` NO
/// aparecen en el feed de confirmaciones; en el detalle de equipo salen con
/// badge Rumor / en la sección "En duda".
struct RiderTransfer: Codable, Identifiable, Hashable {
    let id: String
    let season: Int
    let riderId: String
    let riderGender: String          // "male" | "female" → tabla riders_*
    let fromTeamId: String?
    let fromTeamName: String?
    let toTeamId: String?
    let toTeamName: String?
    let type: String                 // "transfer" | "renewal" | "retirement"
    // "confirmed" | "rumor" | "doubt" (mig. 123). `doubt` = renovación incierta
    // (no se sabe si sigue); un CHECK en BD lo restringe a type='renewal'.
    let status: String
    let contractUntil: Int?          // año de fin del contrato anunciado
    let announcedAt: String?         // YYYY-MM-DD (ordena el feed)
    /// false → fuera del feed de últimos, pero cuenta en el detalle de equipo
    /// (mig. 123). Default true = el comportamiento previo a la columna.
    let dateVisible: Bool
    /// Fichaje efectivo durante la temporada en curso (mig. 136).
    let midSeason: Bool
    let createdAt: String?

    // Init propio: `dateVisible` cae a `true` si la clave no viene (columna
    // NOT NULL con default, pero así un select que la omita no tumba la
    // decodificación de toda la pantalla).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        season = try c.decode(Int.self, forKey: .season)
        riderId = try c.decode(String.self, forKey: .riderId)
        riderGender = try c.decode(String.self, forKey: .riderGender)
        fromTeamId = try c.decodeIfPresent(String.self, forKey: .fromTeamId)
        fromTeamName = try c.decodeIfPresent(String.self, forKey: .fromTeamName)
        toTeamId = try c.decodeIfPresent(String.self, forKey: .toTeamId)
        toTeamName = try c.decodeIfPresent(String.self, forKey: .toTeamName)
        type = try c.decode(String.self, forKey: .type)
        status = try c.decode(String.self, forKey: .status)
        contractUntil = try c.decodeIfPresent(Int.self, forKey: .contractUntil)
        announcedAt = try c.decodeIfPresent(String.self, forKey: .announcedAt)
        dateVisible = try c.decodeIfPresent(Bool.self, forKey: .dateVisible) ?? true
        midSeason = try c.decodeIfPresent(Bool.self, forKey: .midSeason) ?? false
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }

    /// Init de memberwise (tests y previews).
    init(
        id: String, season: Int, riderId: String, riderGender: String,
        fromTeamId: String? = nil, fromTeamName: String? = nil,
        toTeamId: String? = nil, toTeamName: String? = nil,
        type: String, status: String, contractUntil: Int? = nil,
        announcedAt: String? = nil, dateVisible: Bool = true, midSeason: Bool = false,
        createdAt: String? = nil
    ) {
        self.id = id
        self.season = season
        self.riderId = riderId
        self.riderGender = riderGender
        self.fromTeamId = fromTeamId
        self.fromTeamName = fromTeamName
        self.toTeamId = toTeamId
        self.toTeamName = toTeamName
        self.type = type
        self.status = status
        self.contractUntil = contractUntil
        self.announcedAt = announcedAt
        self.dateVisible = dateVisible
        self.midSeason = midSeason
        self.createdAt = createdAt
    }
}

/// Ficha mínima de `riders_men`/`riders_women` para la pantalla de Fichajes:
/// nombre + bandera + equipo actual + fin de contrato (mig. 122).
struct TransferRider: Codable, Identifiable, Hashable {
    let id: String
    let firstName: String?
    let lastName: String?
    let nationality: String?         // ISO-2 minúscula
    let currentTeamId: String?
    let contractUntil: Int?

    var fullName: String {
        "\(firstName ?? "") \(lastName ?? "")".trimmingCharacters(in: .whitespaces)
    }

    /// Copia con el contrato sobreescrito (el de la afiliación 2027 manda sobre
    /// el de la ficha en la vista de equipo del mercado).
    func withContractUntil(_ year: Int?) -> TransferRider {
        TransferRider(id: id, firstName: firstName, lastName: lastName,
                      nationality: nationality, currentTeamId: currentTeamId, contractUntil: year)
    }
}
