import Foundation

/// Cifras de un tramo del perfil entre dos puntos kilométricos.
struct ProfileSegmentStats: Equatable {
    let from: Double
    let to: Double
    let distance: Double
    let ascent: Double
    let descent: Double
    let startAlt: Double
    let endAlt: Double
    /// Pendiente media en %: (altitud final − inicial) / (distancia · 1000) · 100.
    let gradient: Double
}

/// Medición de un tramo del perfil: distancia, desnivel positivo y negativo
/// acumulados y pendiente media. Los extremos se interpolan sobre la
/// polilínea; los vértices intermedios se recorren en orden.
///
/// Espejo de `profileSegmentStats` (`js/stage/profile-segment.js`) y de
/// `ProfileSegment.kt`.
enum ProfileSegment {
    /// Admite el tramo marcado de derecha a izquierda; un tramo sin longitud
    /// devuelve `nil`.
    static func stats(
        points: [ElevationPoint],
        from kmA: Double,
        to kmB: Double,
        interpolateAlt: (Double) -> Double
    ) -> ProfileSegmentStats? {
        guard points.count >= 2 else { return nil }
        let from = min(kmA, kmB), to = max(kmA, kmB)
        let distance = to - from
        guard distance > 0 else { return nil }
        var altitudes = [interpolateAlt(from)]
        for point in points where point.km > from && point.km < to {
            altitudes.append(Double(point.alt))
        }
        altitudes.append(interpolateAlt(to))
        var ascent = 0.0, descent = 0.0
        for index in 1..<altitudes.count {
            let diff = altitudes[index] - altitudes[index - 1]
            if diff > 0 { ascent += diff } else { descent -= diff }
        }
        let startAlt = altitudes[0], endAlt = altitudes[altitudes.count - 1]
        return ProfileSegmentStats(
            from: from, to: to, distance: distance, ascent: ascent, descent: descent,
            startAlt: startAlt, endAlt: endAlt,
            gradient: (endAlt - startAlt) / (distance * 1000) * 100
        )
    }

    /// Altitud sobre la polilínea en un kilómetro; fuera del recorrido, la del
    /// extremo más próximo. Espejo de `interpolateAlt` (`elevation-profile.js`).
    static func interpolateAlt(points: [ElevationPoint], km: Double) -> Double {
        guard let first = points.first, let last = points.last else { return 0 }
        if km <= first.km { return Double(first.alt) }
        if km >= last.km { return Double(last.alt) }
        for index in 0..<(points.count - 1) {
            let a = points[index], b = points[index + 1]
            if km >= a.km && km <= b.km {
                let span = b.km - a.km
                if span <= 0 { return Double(a.alt) }
                return Double(a.alt) + (km - a.km) / span * Double(b.alt - a.alt)
            }
        }
        return Double(last.alt)
    }

    /// Pendiente media del puerto (pie → cima) sobre el perfil, o `nil` sin
    /// perfil o sin pie anterior a la cima.
    static func climbGradient(points: [ElevationPoint], footKm: Double, summitKm: Double) -> Double? {
        stats(points: points, from: footKm, to: summitKm) {
            interpolateAlt(points: points, km: $0)
        }?.gradient
    }
}

/// Cifras del perfil con los separadores del idioma de contenido (como
/// `RaceDay.distanceFormatted`): kilómetros con un decimal como máximo,
/// metros con separador de millares siempre («1.250») y pendiente con un
/// decimal y signo menos tipográfico («−2,4»).
enum ProfileFormat {
    private static var english: Bool { LocaleService.shouldShowEnglishContent }

    static func km(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        if rounded == rounded.rounded() { return String(Int(rounded)) }
        return decimal(rounded)
    }

    static func meters(_ value: Double) -> String {
        let number = Int(value.rounded())
        let digits = String(abs(number))
        var grouped = ""
        for (index, character) in digits.enumerated() {
            if index > 0 && (digits.count - index) % 3 == 0 { grouped.append(english ? "," : ".") }
            grouped.append(character)
        }
        return (number < 0 ? "\u{2212}" : "") + grouped
    }

    static func gradient(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        let text = decimal(abs(rounded))
        return rounded < 0 ? "\u{2212}\(text)" : text
    }

    private static func decimal(_ value: Double) -> String {
        let raw = String(format: "%.1f", value)
        return english ? raw : raw.replacingOccurrences(of: ".", with: ",")
    }
}
