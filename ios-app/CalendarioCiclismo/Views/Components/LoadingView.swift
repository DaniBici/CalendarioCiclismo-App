import SwiftUI

/// Vista de estado de carga.
struct LoadingView: View {
    var message: String = "Cargando..."
    var branded: Bool = false
    /// `false` retira el perfil inferior (ciclocross) y mantiene la identidad
    /// y la señal de carga.
    var showProfile: Bool = true

    var body: some View {
        Group {
            if branded {
                // En los cargadores de pantalla completa el perfil replica el
                // comportamiento de la web: ocupa todo el ancho y descansa en
                // el borde inferior, en lugar de quedar centrado con el texto.
                VStack(spacing: 0) {
                    // Bloques independientes: la identidad se centra en el
                    // espacio disponible y el perfil ocupa su propia franja
                    // inferior, sin poder pasar por detrás de ella.
                    VStack(spacing: 0) {
                        BrandedLogoView()
                            .padding(.bottom, 12)
                        Text(message)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        PulsingDotsView()
                            .padding(.top, 10)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    if showProfile {
                        AnimatedRouteProfile()
                            .frame(maxWidth: .infinity)
                            .frame(height: 150)
                    }
                }
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.regular)
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(message)
    }
}

/// Perfil de carga compartido por los estados de espera y el splash propio.
/// Usa una copia local del perfil de la etapa 20 de La Vuelta 2026, sin red.
struct AnimatedRouteProfile: View {
    var lineColor: Color = .accentColor
    var fillColor: Color? = nil
    var riderColor: Color? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var startedAt = Date()

    // La Vuelta 2026, etapa 20: La Calahorra → Collado del Alguacil (186,8 km).
    // 350 muestras del perfil publicado: la-vuelta-2026-etapa-20.
    // Distancia normalizada a 0…1; altitud 683…1884 m dentro de la franja 0,86…0,14.
    // Copia local para que el arranque no dependa de una consulta de red.
    private static let points: [CGPoint] = [
        CGPoint(x: 0.00000, y: 0.56085), CGPoint(x: 0.00289, y: 0.56025), CGPoint(x: 0.00573, y: 0.55905),
        CGPoint(x: 0.00862, y: 0.55785), CGPoint(x: 0.01146, y: 0.55545), CGPoint(x: 0.01435, y: 0.54766),
        CGPoint(x: 0.01718, y: 0.54646), CGPoint(x: 0.02007, y: 0.54586), CGPoint(x: 0.02291, y: 0.53507),
        CGPoint(x: 0.02580, y: 0.52248), CGPoint(x: 0.02864, y: 0.51709), CGPoint(x: 0.03153, y: 0.51948),
        CGPoint(x: 0.03437, y: 0.52428), CGPoint(x: 0.03726, y: 0.52668), CGPoint(x: 0.04010, y: 0.52308),
        CGPoint(x: 0.04299, y: 0.52008), CGPoint(x: 0.04582, y: 0.51828), CGPoint(x: 0.04872, y: 0.52308),
        CGPoint(x: 0.05155, y: 0.53027), CGPoint(x: 0.05444, y: 0.53987), CGPoint(x: 0.05728, y: 0.55066),
        CGPoint(x: 0.06017, y: 0.56025), CGPoint(x: 0.06306, y: 0.56385), CGPoint(x: 0.06590, y: 0.56565),
        CGPoint(x: 0.06879, y: 0.57344), CGPoint(x: 0.07163, y: 0.58003), CGPoint(x: 0.07452, y: 0.58543),
        CGPoint(x: 0.07736, y: 0.59202), CGPoint(x: 0.08025, y: 0.59982), CGPoint(x: 0.08308, y: 0.60461),
        CGPoint(x: 0.08597, y: 0.60881), CGPoint(x: 0.08881, y: 0.61301), CGPoint(x: 0.09170, y: 0.61660),
        CGPoint(x: 0.09454, y: 0.62140), CGPoint(x: 0.09743, y: 0.62500), CGPoint(x: 0.10027, y: 0.62739),
        CGPoint(x: 0.10316, y: 0.62799), CGPoint(x: 0.10600, y: 0.62979), CGPoint(x: 0.10889, y: 0.64238),
        CGPoint(x: 0.11172, y: 0.66336), CGPoint(x: 0.11461, y: 0.67415), CGPoint(x: 0.11745, y: 0.69454),
        CGPoint(x: 0.12034, y: 0.70713), CGPoint(x: 0.12323, y: 0.70893), CGPoint(x: 0.12607, y: 0.71432),
        CGPoint(x: 0.12896, y: 0.72271), CGPoint(x: 0.13180, y: 0.72391), CGPoint(x: 0.13469, y: 0.72152),
        CGPoint(x: 0.13753, y: 0.72571), CGPoint(x: 0.14042, y: 0.72751), CGPoint(x: 0.14325, y: 0.72811),
        CGPoint(x: 0.14615, y: 0.72691), CGPoint(x: 0.14898, y: 0.72391), CGPoint(x: 0.15187, y: 0.71972),
        CGPoint(x: 0.15471, y: 0.70953), CGPoint(x: 0.15760, y: 0.69873), CGPoint(x: 0.16044, y: 0.71492),
        CGPoint(x: 0.16333, y: 0.73291), CGPoint(x: 0.16617, y: 0.73890), CGPoint(x: 0.16906, y: 0.73291),
        CGPoint(x: 0.17190, y: 0.71792), CGPoint(x: 0.17479, y: 0.70233), CGPoint(x: 0.17768, y: 0.68734),
        CGPoint(x: 0.18051, y: 0.67356), CGPoint(x: 0.18340, y: 0.67236), CGPoint(x: 0.18624, y: 0.66816),
        CGPoint(x: 0.18913, y: 0.65437), CGPoint(x: 0.19197, y: 0.64598), CGPoint(x: 0.19486, y: 0.65197),
        CGPoint(x: 0.19770, y: 0.64658), CGPoint(x: 0.20059, y: 0.64238), CGPoint(x: 0.20343, y: 0.65737),
        CGPoint(x: 0.20632, y: 0.67475), CGPoint(x: 0.20915, y: 0.67415), CGPoint(x: 0.21204, y: 0.67176),
        CGPoint(x: 0.21488, y: 0.68495), CGPoint(x: 0.21777, y: 0.68555), CGPoint(x: 0.22061, y: 0.67775),
        CGPoint(x: 0.22350, y: 0.67176), CGPoint(x: 0.22634, y: 0.66336), CGPoint(x: 0.22923, y: 0.65677),
        CGPoint(x: 0.23207, y: 0.64838), CGPoint(x: 0.23496, y: 0.63998), CGPoint(x: 0.23785, y: 0.62859),
        CGPoint(x: 0.24069, y: 0.61840), CGPoint(x: 0.24358, y: 0.60461), CGPoint(x: 0.24641, y: 0.58843),
        CGPoint(x: 0.24930, y: 0.56804), CGPoint(x: 0.25214, y: 0.55425), CGPoint(x: 0.25503, y: 0.54406),
        CGPoint(x: 0.25787, y: 0.53627), CGPoint(x: 0.26076, y: 0.52968), CGPoint(x: 0.26360, y: 0.52248),
        CGPoint(x: 0.26649, y: 0.51409), CGPoint(x: 0.26933, y: 0.49670), CGPoint(x: 0.27222, y: 0.49910),
        CGPoint(x: 0.27505, y: 0.51289), CGPoint(x: 0.27794, y: 0.53387), CGPoint(x: 0.28078, y: 0.55066),
        CGPoint(x: 0.28367, y: 0.54946), CGPoint(x: 0.28651, y: 0.54646), CGPoint(x: 0.28940, y: 0.55965),
        CGPoint(x: 0.29224, y: 0.57104), CGPoint(x: 0.29513, y: 0.57943), CGPoint(x: 0.29802, y: 0.58963),
        CGPoint(x: 0.30086, y: 0.60221), CGPoint(x: 0.30375, y: 0.61540), CGPoint(x: 0.30658, y: 0.62320),
        CGPoint(x: 0.30948, y: 0.63459), CGPoint(x: 0.31231, y: 0.63039), CGPoint(x: 0.31520, y: 0.63219),
        CGPoint(x: 0.31804, y: 0.62679), CGPoint(x: 0.32093, y: 0.62320), CGPoint(x: 0.32377, y: 0.63579),
        CGPoint(x: 0.32666, y: 0.65257), CGPoint(x: 0.32950, y: 0.66097), CGPoint(x: 0.33239, y: 0.67895),
        CGPoint(x: 0.33522, y: 0.68674), CGPoint(x: 0.33812, y: 0.69454), CGPoint(x: 0.34095, y: 0.70713),
        CGPoint(x: 0.34384, y: 0.72691), CGPoint(x: 0.34668, y: 0.74609), CGPoint(x: 0.34957, y: 0.76528),
        CGPoint(x: 0.35241, y: 0.77307), CGPoint(x: 0.35530, y: 0.77847), CGPoint(x: 0.35819, y: 0.78206),
        CGPoint(x: 0.36103, y: 0.78626), CGPoint(x: 0.36392, y: 0.78926), CGPoint(x: 0.36676, y: 0.78986),
        CGPoint(x: 0.36965, y: 0.79346), CGPoint(x: 0.37248, y: 0.79885), CGPoint(x: 0.37537, y: 0.80425),
        CGPoint(x: 0.37821, y: 0.81084), CGPoint(x: 0.38110, y: 0.81684), CGPoint(x: 0.38394, y: 0.81923),
        CGPoint(x: 0.38683, y: 0.81684), CGPoint(x: 0.38967, y: 0.82163), CGPoint(x: 0.39256, y: 0.82463),
        CGPoint(x: 0.39540, y: 0.82523), CGPoint(x: 0.39829, y: 0.82703), CGPoint(x: 0.40112, y: 0.83302),
        CGPoint(x: 0.40401, y: 0.84082), CGPoint(x: 0.40685, y: 0.84441), CGPoint(x: 0.40974, y: 0.85161),
        CGPoint(x: 0.41263, y: 0.85700), CGPoint(x: 0.41547, y: 0.86000), CGPoint(x: 0.41836, y: 0.86000),
        CGPoint(x: 0.42120, y: 0.85341), CGPoint(x: 0.42409, y: 0.84861), CGPoint(x: 0.42693, y: 0.84921),
        CGPoint(x: 0.42982, y: 0.84441), CGPoint(x: 0.43266, y: 0.84022), CGPoint(x: 0.43555, y: 0.83542),
        CGPoint(x: 0.43838, y: 0.83302), CGPoint(x: 0.44127, y: 0.83002), CGPoint(x: 0.44411, y: 0.81384),
        CGPoint(x: 0.44700, y: 0.79166), CGPoint(x: 0.44984, y: 0.78087), CGPoint(x: 0.45273, y: 0.78866),
        CGPoint(x: 0.45557, y: 0.78626), CGPoint(x: 0.45846, y: 0.78206), CGPoint(x: 0.46130, y: 0.76588),
        CGPoint(x: 0.46419, y: 0.72931), CGPoint(x: 0.46702, y: 0.69574), CGPoint(x: 0.46991, y: 0.66276),
        CGPoint(x: 0.47281, y: 0.63339), CGPoint(x: 0.47564, y: 0.60042), CGPoint(x: 0.47853, y: 0.57044),
        CGPoint(x: 0.48137, y: 0.54526), CGPoint(x: 0.48426, y: 0.52188), CGPoint(x: 0.48710, y: 0.49610),
        CGPoint(x: 0.48999, y: 0.47092), CGPoint(x: 0.49283, y: 0.44035), CGPoint(x: 0.49572, y: 0.41757),
        CGPoint(x: 0.49855, y: 0.42536), CGPoint(x: 0.50145, y: 0.41757), CGPoint(x: 0.50428, y: 0.38160),
        CGPoint(x: 0.50717, y: 0.40678), CGPoint(x: 0.51001, y: 0.42956), CGPoint(x: 0.51290, y: 0.45054),
        CGPoint(x: 0.51574, y: 0.46193), CGPoint(x: 0.51863, y: 0.47752), CGPoint(x: 0.52147, y: 0.49790),
        CGPoint(x: 0.52436, y: 0.51709), CGPoint(x: 0.52719, y: 0.53987), CGPoint(x: 0.53009, y: 0.56385),
        CGPoint(x: 0.53298, y: 0.58663), CGPoint(x: 0.53581, y: 0.61001), CGPoint(x: 0.53870, y: 0.63039),
        CGPoint(x: 0.54154, y: 0.64778), CGPoint(x: 0.54443, y: 0.65557), CGPoint(x: 0.54727, y: 0.66456),
        CGPoint(x: 0.55016, y: 0.68854), CGPoint(x: 0.55300, y: 0.71432), CGPoint(x: 0.55589, y: 0.73950),
        CGPoint(x: 0.55873, y: 0.76468), CGPoint(x: 0.56162, y: 0.78926), CGPoint(x: 0.56445, y: 0.80784),
        CGPoint(x: 0.56734, y: 0.81564), CGPoint(x: 0.57018, y: 0.82403), CGPoint(x: 0.57307, y: 0.83182),
        CGPoint(x: 0.57591, y: 0.83482), CGPoint(x: 0.57880, y: 0.83842), CGPoint(x: 0.58164, y: 0.84201),
        CGPoint(x: 0.58453, y: 0.84441), CGPoint(x: 0.58737, y: 0.83782), CGPoint(x: 0.59026, y: 0.83482),
        CGPoint(x: 0.59315, y: 0.84142), CGPoint(x: 0.59599, y: 0.83902), CGPoint(x: 0.59888, y: 0.83362),
        CGPoint(x: 0.60171, y: 0.82823), CGPoint(x: 0.60460, y: 0.82643), CGPoint(x: 0.60744, y: 0.82403),
        CGPoint(x: 0.61033, y: 0.81204), CGPoint(x: 0.61317, y: 0.79166), CGPoint(x: 0.61606, y: 0.77667),
        CGPoint(x: 0.61890, y: 0.77907), CGPoint(x: 0.62179, y: 0.77727), CGPoint(x: 0.62463, y: 0.77547),
        CGPoint(x: 0.62752, y: 0.76528), CGPoint(x: 0.63035, y: 0.73470), CGPoint(x: 0.63324, y: 0.69993),
        CGPoint(x: 0.63608, y: 0.66636), CGPoint(x: 0.63897, y: 0.63099), CGPoint(x: 0.64181, y: 0.60221),
        CGPoint(x: 0.64470, y: 0.57104), CGPoint(x: 0.64759, y: 0.54466), CGPoint(x: 0.65043, y: 0.52068),
        CGPoint(x: 0.65332, y: 0.49430), CGPoint(x: 0.65616, y: 0.46973), CGPoint(x: 0.65905, y: 0.43735),
        CGPoint(x: 0.66188, y: 0.40918), CGPoint(x: 0.66478, y: 0.41097), CGPoint(x: 0.66761, y: 0.41277),
        CGPoint(x: 0.67050, y: 0.38160), CGPoint(x: 0.67334, y: 0.39599), CGPoint(x: 0.67623, y: 0.42057),
        CGPoint(x: 0.67907, y: 0.44215), CGPoint(x: 0.68196, y: 0.46013), CGPoint(x: 0.68480, y: 0.47212),
        CGPoint(x: 0.68769, y: 0.49131), CGPoint(x: 0.69052, y: 0.50809), CGPoint(x: 0.69342, y: 0.53147),
        CGPoint(x: 0.69625, y: 0.55366), CGPoint(x: 0.69914, y: 0.57704), CGPoint(x: 0.70198, y: 0.60042),
        CGPoint(x: 0.70487, y: 0.62200), CGPoint(x: 0.70776, y: 0.64418), CGPoint(x: 0.71060, y: 0.66756),
        CGPoint(x: 0.71349, y: 0.68914), CGPoint(x: 0.71633, y: 0.71252), CGPoint(x: 0.71922, y: 0.73470),
        CGPoint(x: 0.72206, y: 0.75629), CGPoint(x: 0.72495, y: 0.78027), CGPoint(x: 0.72778, y: 0.80065),
        CGPoint(x: 0.73067, y: 0.79885), CGPoint(x: 0.73351, y: 0.78566), CGPoint(x: 0.73640, y: 0.77787),
        CGPoint(x: 0.73924, y: 0.75988), CGPoint(x: 0.74213, y: 0.73590), CGPoint(x: 0.74497, y: 0.71012),
        CGPoint(x: 0.74786, y: 0.68974), CGPoint(x: 0.75070, y: 0.68435), CGPoint(x: 0.75359, y: 0.67715),
        CGPoint(x: 0.75642, y: 0.65737), CGPoint(x: 0.75931, y: 0.64298), CGPoint(x: 0.76215, y: 0.62320),
        CGPoint(x: 0.76504, y: 0.62320), CGPoint(x: 0.76793, y: 0.62200), CGPoint(x: 0.77077, y: 0.62380),
        CGPoint(x: 0.77366, y: 0.62859), CGPoint(x: 0.77650, y: 0.60881), CGPoint(x: 0.77939, y: 0.60042),
        CGPoint(x: 0.78223, y: 0.61241), CGPoint(x: 0.78512, y: 0.62739), CGPoint(x: 0.78796, y: 0.64298),
        CGPoint(x: 0.79085, y: 0.63459), CGPoint(x: 0.79368, y: 0.62080), CGPoint(x: 0.79657, y: 0.58963),
        CGPoint(x: 0.79941, y: 0.55246), CGPoint(x: 0.80230, y: 0.51589), CGPoint(x: 0.80514, y: 0.48411),
        CGPoint(x: 0.80803, y: 0.45294), CGPoint(x: 0.81087, y: 0.42716), CGPoint(x: 0.81376, y: 0.40198),
        CGPoint(x: 0.81660, y: 0.37620), CGPoint(x: 0.81949, y: 0.35402), CGPoint(x: 0.82232, y: 0.33424),
        CGPoint(x: 0.82521, y: 0.31206), CGPoint(x: 0.82810, y: 0.29047), CGPoint(x: 0.83094, y: 0.27669),
        CGPoint(x: 0.83383, y: 0.28028), CGPoint(x: 0.83667, y: 0.30366), CGPoint(x: 0.83956, y: 0.32525),
        CGPoint(x: 0.84240, y: 0.33724), CGPoint(x: 0.84529, y: 0.34443), CGPoint(x: 0.84813, y: 0.35282),
        CGPoint(x: 0.85102, y: 0.37021), CGPoint(x: 0.85385, y: 0.38759), CGPoint(x: 0.85675, y: 0.40978),
        CGPoint(x: 0.85958, y: 0.43136), CGPoint(x: 0.86247, y: 0.45114), CGPoint(x: 0.86531, y: 0.46373),
        CGPoint(x: 0.86820, y: 0.47992), CGPoint(x: 0.87104, y: 0.49970), CGPoint(x: 0.87393, y: 0.51948),
        CGPoint(x: 0.87677, y: 0.54346), CGPoint(x: 0.87966, y: 0.56684), CGPoint(x: 0.88255, y: 0.59142),
        CGPoint(x: 0.88539, y: 0.61301), CGPoint(x: 0.88828, y: 0.63519), CGPoint(x: 0.89111, y: 0.65737),
        CGPoint(x: 0.89400, y: 0.68075), CGPoint(x: 0.89684, y: 0.70293), CGPoint(x: 0.89973, y: 0.72631),
        CGPoint(x: 0.90257, y: 0.74909), CGPoint(x: 0.90546, y: 0.77187), CGPoint(x: 0.90830, y: 0.79765),
        CGPoint(x: 0.91119, y: 0.80125), CGPoint(x: 0.91403, y: 0.79286), CGPoint(x: 0.91692, y: 0.78266),
        CGPoint(x: 0.91975, y: 0.77067), CGPoint(x: 0.92264, y: 0.74849), CGPoint(x: 0.92548, y: 0.72331),
        CGPoint(x: 0.92837, y: 0.69754), CGPoint(x: 0.93121, y: 0.68794), CGPoint(x: 0.93410, y: 0.68195),
        CGPoint(x: 0.93694, y: 0.66816), CGPoint(x: 0.93983, y: 0.65137), CGPoint(x: 0.94272, y: 0.63639),
        CGPoint(x: 0.94556, y: 0.62020), CGPoint(x: 0.94845, y: 0.63039), CGPoint(x: 0.95128, y: 0.62500),
        CGPoint(x: 0.95418, y: 0.62919), CGPoint(x: 0.95701, y: 0.62200), CGPoint(x: 0.95990, y: 0.59562),
        CGPoint(x: 0.96274, y: 0.56565), CGPoint(x: 0.96563, y: 0.53567), CGPoint(x: 0.96847, y: 0.50689),
        CGPoint(x: 0.97136, y: 0.47752), CGPoint(x: 0.97420, y: 0.44874), CGPoint(x: 0.97709, y: 0.41517),
        CGPoint(x: 0.97993, y: 0.38100), CGPoint(x: 0.98282, y: 0.34683), CGPoint(x: 0.98565, y: 0.31505),
        CGPoint(x: 0.98854, y: 0.28148), CGPoint(x: 0.99138, y: 0.24671), CGPoint(x: 0.99427, y: 0.21134),
        CGPoint(x: 0.99711, y: 0.17537), CGPoint(x: 1.00000, y: 0.14000),
    ]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { context in
            let elapsed = max(0, context.date.timeIntervalSince(startedAt))
            let cycle = elapsed.truncatingRemainder(dividingBy: 5.2)
            let progress = reduceMotion ? 1.0 : min(cycle / 4.6, 1)
            let traceOpacity = reduceMotion ? 1.0 : min(1, max(0, (5.2 - cycle) / 0.6))
            Canvas { graphics, size in
                guard size.width > 0, size.height > 0 else { return }
                let scaled = Self.points.map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) }
                let profile = smoothProfile(scaled)

                let tint = fillColor ?? lineColor.opacity(0.16)
                graphics.fill(area(under: profile, size: size), with: .linearGradient(
                    Gradient(colors: [tint, tint.opacity(0.08)]),
                    startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)
                ))
                graphics.stroke(profile, with: .color(lineColor.opacity(0.28)),
                                style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))

                // La línea y el marcador usan la misma curva, sin recortar el círculo.
                let travelled = profile.trimmedPath(from: 0, to: progress)
                var trace = graphics
                trace.opacity = traceOpacity
                trace.stroke(travelled, with: .color(lineColor.opacity(0.10)),
                             style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round))
                trace.stroke(travelled, with: .color(lineColor),
                             style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

                guard !reduceMotion, let rider = travelled.currentPoint else { return }
                let marker = riderColor ?? lineColor
                trace.fill(Path(ellipseIn: CGRect(x: rider.x - 9, y: rider.y - 9, width: 18, height: 18)),
                           with: .color(lineColor.opacity(0.14)))
                trace.fill(Path(ellipseIn: CGRect(x: rider.x - 3.5, y: rider.y - 3.5, width: 7, height: 7)),
                           with: .color(marker))
            }
        }
        .accessibilityHidden(true)
    }

    private func smoothProfile(_ points: [CGPoint]) -> Path {
        var path = Path()
        guard let first = points.first, let last = points.last else { return path }
        path.move(to: first)
        for index in 1..<points.count {
            let previous = points[index - 1]
            let current = points[index]
            let midpoint = CGPoint(x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2)
            path.addQuadCurve(to: midpoint, control: previous)
        }
        path.addQuadCurve(to: last, control: last)
        return path
    }

    private func area(under profile: Path, size: CGSize) -> Path {
        var fill = profile
        fill.addLine(to: CGPoint(x: size.width, y: size.height))
        fill.addLine(to: CGPoint(x: 0, y: size.height))
        fill.closeSubpath()
        return fill
    }
}

/// Marca oficial compartida con las cabeceras de la aplicación.
struct BrandedLogoView: View {
    @ScaledMetric(relativeTo: .title) private var logoWidth: CGFloat = 74

    var body: some View {
        CCHeaderMarkView(width: logoWidth)
    }
}

/// Tres puntos pulsantes animados.
struct PulsingDotsView: View {
    var color: Color = .accentColor
    var size: CGFloat = 6
    var spacing: CGFloat = 5
    @State private var animating = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: spacing) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(color)
                    .frame(width: size, height: size)
                    // Animación ACOTADA a escala/opacidad (animation(_:body:)).
                    // Con `.animation(value:)` a secas, el repeatForever también
                    // animaba la POSICIÓN cuando la vista se recolocaba (cambio
                    // de pestaña / swap loading→contenido) → los puntos volaban
                    // cruzándose por el medio de la pantalla.
                    .animation(
                        reduceMotion ? nil :
                            .easeInOut(duration: 0.6)
                                .repeatForever(autoreverses: true)
                                .delay(Double(i) * 0.2)
                    ) { content in
                        content
                            .scaleEffect(animating ? 1.3 : 1.0)
                            .opacity(animating ? 1.0 : 0.3)
                    }
            }
        }
        .accessibilityHidden(true)
        .onAppear { animating = true }
    }
}

/// Vista de estado vacío.
struct EmptyStateView: View {
    let icon: String
    let title: String
    let subtitle: String?
    @ScaledMetric(relativeTo: .largeTitle) private var iconSize: CGFloat = 40

    init(icon: String = "calendar", title: String, subtitle: String? = nil) {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: iconSize))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .accessibilityElement(children: .combine)
    }
}

/// Vista de error con opción de reintentar.
struct ErrorView: View {
    let message: String
    let retry: (() -> Void)?
    @ScaledMetric(relativeTo: .largeTitle) private var iconSize: CGFloat = 40

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: iconSize))
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            Text("Error")
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let retry {
                Button("Reintentar") { retry() }
                    .buttonStyle(.bordered)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .accessibilityElement(children: .combine)
    }
}
