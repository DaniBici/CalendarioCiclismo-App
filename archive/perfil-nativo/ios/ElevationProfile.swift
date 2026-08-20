import Foundation

struct ElevationProfile: Codable {
    let distance: Double
    let elevationGain: Int?
    let elevationLoss: Int?
    let minElevation: Int?
    let maxElevation: Int?
    let points: [ElevationPoint]
}

struct ElevationPoint: Codable {
    let km: Double
    let alt: Int
}

struct ProfileSummit: Codable, Identifiable {
    var id: String { "\(km)-\(name ?? "")" }
    let name: String?
    let km: Double
    let altitude: Int?
    let category: String?
    let side: String?
}

struct ProfileWaypoint: Codable, Identifiable {
    var id: String { "\(km)-\(type)" }
    let name: String?
    let km: Double
    let type: String
    let lengthKm: Double?
}
