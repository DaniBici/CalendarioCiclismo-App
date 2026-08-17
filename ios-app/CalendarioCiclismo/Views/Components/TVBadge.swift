import SwiftUI

/// Badge de estado de TV con hora de emisión si está disponible.
/// Clicable cuando hay una URL de emisión o de live texto disponible
/// (misma prioridad que la web: YouTube > otras redes sociales > RTVE.es > resto).
struct TVBadge: View {
    let tvStatus: String?
    let broadcasts: [Broadcast]
    var neutralStartTimeUtc: String? = nil
    var liveTextUrl: String? = nil
    @Environment(\.accessibilityShowButtonShapes) private var showButtonShapes
    @Environment(\.openURL) private var openURL
    @State private var regionService = RegionService.shared

    private var isHighContrast: Bool { showButtonShapes }

    /// Broadcasts visibles para la región del usuario. TODO el badge (label, icono,
    /// "hay TV", hora de referencia y enlace) se calcula sobre esta lista, no sobre
    /// la cruda: si no, un usuario de España vería "TV 14:00" de una emisión solo
    /// de Bélgica aunque el enlace estuviera (correctamente) suprimido. La web ya
    /// pre-filtra los broadcasts antes de pintar el badge; aquí filtramos en sitio.
    private var regionBroadcasts: [Broadcast] {
        RaceLogic.filterBroadcastsByRegion(
            broadcasts,
            allowedGroups: regionService.current.allowedBroadcastGroups
        )
    }

    /// True si HABÍA emisiones pero NINGUNA es accesible en la región del usuario
    /// (todas filtradas). En ese caso el usuario no puede ver nada → no mostramos el
    /// badge "TV" genérico que vendría de `tvStatus='confirmed'`. (Sin emisiones en
    /// absoluto, el badge sigue saliendo de `tvStatus`: cobertura sin canal aún.)
    private var regionBlocked: Bool { !broadcasts.isEmpty && regionBroadcasts.isEmpty }

    /// True si se debe mostrar "Live texto" en vez del estado TV.
    private var showLiveText: Bool {
        guard let url = liveTextUrl, !url.isEmpty else { return false }
        let status = tvStatus ?? ""
        return status == "none" || status == "unavailable_es" || status == "pending"
            || (status.isEmpty && regionBroadcasts.isEmpty)
    }

    /// True si la emisión ya está EN DIRECTO (su hora de inicio ya pasó).
    private func isBroadcastLive(_ b: Broadcast) -> Bool {
        guard let ts = b.startTimeUtc, let date = DateFormatting.parseISO(ts) else { return false }
        return Date() >= date
    }

    /// Broadcast seleccionado para el enlace: filtrado por región. Una emisión YA EN
    /// DIRECTO gana SIEMPRE a una que aún no ha empezado, aunque esta última sea de
    /// mayor tier (p. ej. Eurosport ya emitiendo vs RTVE por empezar → enlaza a
    /// Eurosport, lo accesible AHORA). A igualdad de estado manda el tier (YouTube >
    /// otras redes sociales > RTVE.es > resto; Eurosport / HBO Max son "una cadena
    /// más") y luego el sortOrder. Sin ninguna en directo se conserva el tier puro.
    private var selectedBroadcast: Broadcast? {
        if showLiveText { return nil }
        return regionBroadcasts
            .filter { b in b.url.map { !$0.isEmpty } == true }
            .sorted {
                let l0 = isBroadcastLive($0) ? 0 : 1, l1 = isBroadcastLive($1) ? 0 : 1
                if l0 != l1 { return l0 < l1 }
                let t0 = RaceLogic.broadcastLinkPriority($0.url), t1 = RaceLogic.broadcastLinkPriority($1.url)
                if t0 != t1 { return t0 < t1 }
                return ($0.sortOrder ?? 0) < ($1.sortOrder ?? 0)
            }
            .first
    }

    /// Broadcast con hora más temprana (fallback cuando no hay broadcast con URL).
    private var earliestTimedBroadcast: Broadcast? {
        regionBroadcasts
            .compactMap { b -> (Broadcast, Double)? in
                guard let ts = b.startTimeUtc else { return nil }
                return (b, DateFormatting.timestampToSeconds(ts) ?? 0)
            }
            .sorted { $0.1 < $1.1 }
            .first
            .map(\.0)
    }

    /// True si la carrera ya ha comenzado (neutralStart alcanzado).
    private var raceStarted: Bool {
        guard let ts = neutralStartTimeUtc,
              let date = DateFormatting.parseISO(ts) else { return false }
        return Date() >= date
    }

    /// True si la emisión de referencia (la más temprana accesible) ya ha comenzado.
    private var broadcastStarted: Bool {
        guard let ts = earliestTimedBroadcast?.startTimeUtc, let date = DateFormatting.parseISO(ts) else { return false }
        return Date() >= date
    }

    /// True si el badge debe mostrarse como "Live" (verde, retransmisión en curso).
    private var showLive: Bool {
        tvStatus == "confirmed_time" && broadcastStarted
    }

    /// True si hay que mostrar el chip "Live texto" JUNTO al badge de TV: la carrera ya empezó
    /// pero la emisión de referencia aún no ha comenzado (hora futura). Paridad con la web
    /// (`liveTextAlongside` en `tvBadgeCard`, js/app.js). No aplica cuando `showLiveText` ya
    /// sustituye al badge de TV (casos sin TV: none / pending / sin broadcasts).
    private var showLiveTextAlongside: Bool {
        guard !showLiveText,
              let url = liveTextUrl, !url.isEmpty,
              raceStarted else { return false }
        guard let ts = earliestTimedBroadcast?.startTimeUtc, let date = DateFormatting.parseISO(ts) else { return false }
        return Date() < date
    }

    private var label: String {
        // Prioridad: live texto cuando no hay TV
        if showLiveText { return LocaleService.t("Live texto", "Live text") }

        // Retransmisión en vivo: la hora de inicio ya ha pasado
        if showLive { return "Live" }

        // Comprobar estados "sin TV" ANTES de broadcasts (misma lógica que web)
        switch tvStatus {
        case "none": return LocaleService.t("Sin TV", "No TV")
        case "unavailable_es":
            // Ese estado solo importa al usuario en España (en EN la app sirve
            // a europeos sin restricción geográfica). Ocultar devolviendo "".
            return LocaleService.isEnglish ? "" : "No TV España"
        case "pending": return LocaleService.t("Sin confirmar", "Unconfirmed")
        default: break
        }

        // Hora del badge = la emisión accesible que ANTES empieza (independiente del
        // enlace): si una emisión global (ALL) empieza antes que las de tu grupo, su
        // hora manda. El enlace (tap) sigue por prioridad de tier vía `tappableUrl`.
        let refBroadcast = earliestTimedBroadcast
        if let ref = refBroadcast, let broadcastTs = ref.startTimeUtc {
            if let neutralTs = neutralStartTimeUtc,
               let neutralDate = DateFormatting.parseISO(neutralTs),
               let broadcastDate = DateFormatting.parseISO(broadcastTs),
               broadcastDate <= neutralDate {
                return LocaleService.t("Íntegra", "Full Race")
            }
            // La web muestra solo la hora: mantener la misma etiqueta en las apps.
            if let time = ref.startTimeLocal { return time }
        }
        if !regionBroadcasts.isEmpty { return "TV" }

        // TV confirmada pero toda fuera de la región del usuario → sin badge.
        if regionBlocked { return "" }

        if tvStatus == "confirmed" { return "TV" }

        // Sin tvStatus y sin broadcasts
        return ""
    }

    private var iconName: String {
        if showLiveText { return "text.bubble" }
        if !regionBroadcasts.isEmpty || tvStatus == "confirmed" { return "tv" }
        if tvStatus == "pending" { return "tv" }
        if tvStatus == "unavailable_es" { return "tv.slash" }
        if tvStatus == "none" { return "tv.slash" }
        return "tv.slash"
    }

    /// URL a abrir al pulsar el badge (derivada de `selectedBroadcast`).
    private var tappableUrl: URL? {
        if showLiveText, let urlStr = liveTextUrl, !urlStr.isEmpty {
            return URL(string: urlStr)
        }
        guard let urlStr = selectedBroadcast?.url else { return nil }
        return URL(string: urlStr)
    }

    @ViewBuilder
    private func badgeShape(text: String, iconName: String, colors: AppTheme.BadgeColor, accessibilityLabel: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: iconName)
                .font(.system(size: 9))
            Text(text)
                .font(.caption2)
                .fontWeight(.medium)
                .textCase(.uppercase)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(colors.background)
        .foregroundStyle(colors.foreground)
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .overlay(
            isHighContrast
                ? RoundedRectangle(cornerRadius: 3).strokeBorder(colors.foreground, lineWidth: 1)
                : nil
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    /// Chip independiente de "Live texto" (icono burbuja + enlace). Verde si la carrera ya empezó,
    /// azul ("pre") si aún no. Se usa tanto cuando sustituye al badge de TV (`showLiveText`) como
    /// cuando acompaña al badge de TV (`showLiveTextAlongside`).
    @ViewBuilder
    private var liveTextChip: some View {
        let key = raceStarted ? "livetext" : "livetext_pre"
        let colors = AppTheme.tvStatusColor(for: key, hasBroadcasts: false, highContrast: isHighContrast)
        let shape = badgeShape(
            text: LocaleService.t("Live texto", "Live text"),
            iconName: "text.bubble",
            colors: colors,
            accessibilityLabel: LocaleService.t("Live texto disponible", "Live text available")
        )
        if let urlStr = liveTextUrl, let url = URL(string: urlStr) {
            Button { openURL(url) } label: { shape }
                .buttonStyle(.plain)
        } else {
            shape
        }
    }

    var body: some View {
        if showLiveText {
            // Caso sin TV con live texto: el chip de live texto SUSTITUYE al badge de TV.
            liveTextChip
        } else {
            let text = label
            if !text.isEmpty {
                let hasBroadcasts = !regionBroadcasts.isEmpty
                let colors: AppTheme.BadgeColor = showLive
                    ? AppTheme.tvStatusColor(for: "tv_live", hasBroadcasts: hasBroadcasts, highContrast: isHighContrast)
                    : AppTheme.tvStatusColor(for: tvStatus, hasBroadcasts: hasBroadcasts, highContrast: isHighContrast)
                let accessibilityLabel = showLive
                    ? "Live"
                    : (AccessibilityTVStatus.description(tvStatus: tvStatus, broadcasts: regionBroadcasts) ?? text)
                let tvBadge = badgeShape(text: text, iconName: iconName, colors: colors, accessibilityLabel: accessibilityLabel)

                // Carrera empezada y TV aún en reposo → "Live texto" junto al badge de TV (paridad web).
                HStack(spacing: 4) {
                    if let url = tappableUrl {
                        Button { openURL(url) } label: { tvBadge }
                            .buttonStyle(.plain)
                    } else {
                        tvBadge
                    }
                    if showLiveTextAlongside {
                        liveTextChip
                    }
                }
            }
        }
    }
}
