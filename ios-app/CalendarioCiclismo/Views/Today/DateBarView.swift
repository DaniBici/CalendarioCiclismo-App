import SwiftUI

/// Barra de navegación por fechas con scroll horizontal.
///
/// Arquitectura de 3 capas (ZStack):
/// - Capa 1: ScrollView scrollable con los días en texto oscuro.
/// - Capa 2: selección azul fija en el centro.
/// - Capa 3: DateBarItem en azul para el día bajo la selección.
///
/// La barra gestiona su propio rango de fechas interno (±45 días desde la
/// fecha seleccionada al inicializar). Este rango es FIJO y nunca se reordena
/// durante el uso normal, lo que evita el cascade loop que ocurría cuando el
/// padre actualizaba `dateBarKeys` en respuesta a un scroll:
///   scroll → onSelect → goToDate → dateBarKeys shifts → scrollPosition(id:)
///   picks wrong item at old offset → onSelect again → exponential drift.
///
/// `scrollPosition(id:anchor:.center)` es el único driver de scroll programático.
/// El centrado inicial se consigue con un cambio `nil → valor` diferido al
/// siguiente ciclo del run loop (DispatchQueue.main.async), ya que
/// `scrollPosition(id:)` ignora el valor inicial de `State` en el primer render.
/// Cada gesto queda limitado al día contiguo para que la inercia no avance una
/// página completa de siete días.
///
/// `lastDate` (último día de temporada, `TodaySeason`) recorta el rango: no se
/// genera ningún día posterior ni queda hueco a la derecha. El scroll centra
/// como máximo el cuarto día antes del cierre; en los tres últimos días la
/// barra se fija con `lastDate` en el extremo derecho y la capsule se desplaza
/// hasta el día seleccionado (tira fija de `DateBarWindow`). `firstDate`
/// (primer día de la temporada de ciclocross) aplica la misma regla al
/// inicio.
struct DateBarView: View {
    let selectedDate: String
    let firstDate: String?
    let lastDate: String?
    let onSelect: (String) -> Void

    private let visibleDayCount: CGFloat = 7
    private let itemHeight: CGFloat = 48
    private let horizontalPadding: CGFloat = 8
    private let windowOffset = 45

    /// Rango de fechas mostrado. Se genera una vez en init y solo se
    /// regenera si `selectedDate` cae fuera del rango (navegación extrema).
    @State private var dateRange: [String]

    /// Día actualmente centrado bajo la capsule.
    /// Empieza como `nil`: el cambio `nil → valor` en onAppear es lo que
    /// dispara el primer scroll al día correcto.
    @State private var scrollPosition: String?
    @State private var scrollLayoutGeneration = 0
    @State private var isRepositioning = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        selectedDate: String,
        firstDate: String? = nil,
        lastDate: String? = nil,
        onSelect: @escaping (String) -> Void
    ) {
        self.selectedDate = selectedDate
        self.firstDate = firstDate
        self.lastDate = lastDate
        self.onSelect = onSelect
        self._dateRange = State(
            initialValue: Self.range(around: selectedDate, firstDate: firstDate, lastDate: lastDate, offset: 45)
        )
    }

    private static func range(around dateKey: String, firstDate: String?, lastDate: String?, offset: Int) -> [String] {
        DateFormatting.dateRange(around: dateKey, offset: offset).filter { key in
            (firstDate.map { key >= $0 } ?? true) && (lastDate.map { key <= $0 } ?? true)
        }
    }

    /// Primer y último día que el scroll puede centrar: tres días dentro de
    /// cada extremo.
    private var firstCenterableDate: String? { DateBarWindow.firstCenterable(firstDate, count: Int(visibleDayCount)) }
    private var lastCenterableDate: String? { DateBarWindow.lastCenterable(lastDate, count: Int(visibleDayCount)) }

    /// Tira fija cuando el día seleccionado no puede centrarse; nil en el
    /// resto de casos.
    private var edgeStrip: [String]? {
        DateBarWindow.fixedStrip(selected: selectedDate, firstDate: firstDate, lastDate: lastDate, count: Int(visibleDayCount))
    }

    var body: some View {
        GeometryReader { geo in
            let availableWidth = max(1, geo.size.width)
            let dayWidth = availableWidth / visibleDayCount
            let capsuleWidth = max(1, dayWidth - 4)
            let displayedCenter = scrollPosition ?? selectedDate

            ZStack {
                if let strip = edgeStrip {
                    edgeStripView(strip, dayWidth: dayWidth, capsuleWidth: capsuleWidth)
                } else {
                    scrollingDays(dayWidth: dayWidth, capsuleWidth: capsuleWidth, displayedCenter: displayedCenter)
                }
            }
            .frame(width: availableWidth, height: itemHeight)
            .onChange(of: availableWidth) { oldWidth, newWidth in
                guard oldWidth > 1, abs(newWidth - oldWidth) > 1 else { return }
                // En un cambio de postura SwiftUI conserva el offset físico
                // del ScrollView aunque cambie el ancho de cada día. Recrear
                // la fila evita que otro día quede visualmente bajo la cápsula
                // mientras la capa seleccionada sigue mostrando selectedDate.
                recenter(on: selectedDate, rebuildingScrollView: true)
            }
            .onChange(of: selectedDate) { _, newValue in
                if !dateRange.contains(newValue) {
                    // Navegación extrema (> ±45 días): regenerar el rango y
                    // reposicionar con el truco nil → valor.
                    dateRange = Self.range(around: newValue, firstDate: firstDate, lastDate: lastDate, offset: windowOffset)
                    scrollPosition = nil
                    DispatchQueue.main.async {
                        scrollPosition = newValue
                    }
                } else {
                    // Cambio externo normal (botones prev/next, "ir a hoy").
                    guard scrollPosition != newValue else { return }
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
                        scrollPosition = newValue
                    }
                }
            }
        }
        .frame(height: itemHeight)
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .background(AppTheme.headerBackground)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(LocaleService.t("Selector de fecha", "Date picker"))
        .accessibilityIdentifier(AccessibilityID.dateBar)
    }

    @ViewBuilder
    private func scrollingDays(dayWidth: CGFloat, capsuleWidth: CGFloat, displayedCenter: String) -> some View {
        // ── Capa 1: días scrollables ──────────────────────────────
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(dateRange, id: \.self) { key in
                    Button {
                        guard key != scrollPosition else { return }
                        Haptics.play(.navigation)
                        // Los tres días de cada extremo no pueden centrarse:
                        // se seleccionan directamente y la barra pasa a la
                        // tira fija.
                        if let limit = lastCenterableDate, key > limit {
                            onSelect(key)
                            return
                        }
                        if let limit = firstCenterableDate, key < limit {
                            onSelect(key)
                            return
                        }
                        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
                            scrollPosition = key
                        }
                    } label: {
                        DateBarItem(dateKey: key, isSelected: false)
                            .frame(width: dayWidth, height: itemHeight)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .id(key)
                    .accessibilityLabel(DateBarItem.accessibilityDescription(
                        dateKey: key,
                        isSelected: key == selectedDate,
                        isToday: key == DateFormatting.todayKey()
                    ))
                    .accessibilityAddTraits(key == selectedDate ? [.isSelected] : [])
                    .accessibilityInputLabels(DateBarItem.inputLabels(dateKey: key))
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned(limitBehavior: .alwaysByOne))
        .scrollPosition(id: $scrollPosition, anchor: .center)
        .id(scrollLayoutGeneration)
        .onScrollPhaseChange { _, newPhase in
            // Propagar al padre solo al entrar en reposo para no
            // disparar loadDay() por cada día cruzado durante el drag.
            // Como dateRange nunca se desplaza durante un scroll de usuario,
            // scrollPosition(id:) no puede confundirse con el ítem erróneo
            // y el cascade loop es estructuralmente imposible.
            guard !isRepositioning,
                  newPhase == .idle,
                  let position = scrollPosition,
                  position != selectedDate else { return }
            onSelect(position)
        }
        .sensoryFeedback(.selection, trigger: scrollPosition)
        .onAppear {
            // scrollPosition(id:) no aplica el valor inicial del State
            // en el primer render. Diferir la asignación al siguiente
            // ciclo produce el cambio nil → valor que sí detecta.
            recenter(on: selectedDate, rebuildingScrollView: false)
        }

        // ── Capa 2: selección fija en el centro ───────────────────
        // Azul de marca suave (15 %), radio de superficie: único adorno
        // de la tira. El texto del día centrado (Capa 3) va en azul.
        RoundedRectangle(cornerRadius: AppTheme.Radius.surface)
            .fill(Color.accentColor.opacity(0.15))
            .frame(width: capsuleWidth, height: itemHeight)
            .allowsHitTesting(false)

        // ── Capa 3: texto del día centrado ────────────────────────
        DateBarItem(dateKey: displayedCenter, isSelected: true)
        .frame(width: capsuleWidth, height: itemHeight)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Tramo inicial o final de la temporada: siete días fijos que empiezan en
    /// `firstDate` o terminan en `lastDate`, con la capsule sobre el día
    /// seleccionado. Tocar un día lo selecciona; arrastrar hacia el centro de
    /// la temporada pasa al día contiguo.
    private func edgeStripView(_ keys: [String], dayWidth: CGFloat, capsuleWidth: CGFloat) -> some View {
        let atStart = keys.first == firstDate
        return HStack(spacing: 0) {
            ForEach(keys, id: \.self) { key in
                let selected = key == selectedDate
                Button {
                    guard !selected else { return }
                    Haptics.play(.navigation)
                    onSelect(key)
                } label: {
                    DateBarItem(dateKey: key, isSelected: selected)
                        .frame(width: capsuleWidth, height: itemHeight)
                        .background {
                            if selected {
                                RoundedRectangle(cornerRadius: AppTheme.Radius.surface)
                                    .fill(Color.accentColor.opacity(0.15))
                            }
                        }
                        .frame(width: dayWidth, height: itemHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(DateBarItem.accessibilityDescription(
                    dateKey: key,
                    isSelected: selected,
                    isToday: key == DateFormatting.todayKey()
                ))
                .accessibilityAddTraits(selected ? [.isSelected] : [])
                .accessibilityInputLabels(DateBarItem.inputLabels(dateKey: key))
            }
        }
        .gesture(
            DragGesture(minimumDistance: 20).onEnded { value in
                let width = value.translation.width
                guard abs(width) > 40, abs(width) > abs(value.translation.height),
                      atStart ? width < 0 : width > 0,
                      let target = DateFormatting.dayOffset(from: selectedDate, by: atStart ? 1 : -1) else { return }
                Haptics.play(.navigation)
                onSelect(target)
            }
        )
    }

    private func recenter(on target: String, rebuildingScrollView: Bool) {
        isRepositioning = true
        if rebuildingScrollView {
            scrollLayoutGeneration &+= 1
        }
        scrollPosition = nil
        DispatchQueue.main.async {
            scrollPosition = target
            DispatchQueue.main.async {
                isRepositioning = false
            }
        }
    }
}

// MARK: - DateBarWindow

/// Ventana de la barra de fechas en los extremos del rango navegable.
enum DateBarWindow {
    /// Primer día centrable: la mitad de la tira después de `firstDate`.
    static func firstCenterable(_ firstDate: String?, count: Int) -> String? {
        firstDate.flatMap { DateFormatting.dayOffset(from: $0, by: (count - 1) / 2) }
    }

    /// Último día centrable: la mitad de la tira antes de `lastDate`.
    static func lastCenterable(_ lastDate: String?, count: Int) -> String? {
        lastDate.flatMap { DateFormatting.dayOffset(from: $0, by: -(count - 1) / 2) }
    }

    /// `count` días fijos que empiezan en `firstDate` o terminan en `lastDate`
    /// cuando `selected` no puede centrarse sin mostrar días fuera de rango;
    /// nil cuando puede centrarse.
    static func fixedStrip(selected: String, firstDate: String?, lastDate: String?, count: Int) -> [String]? {
        if let firstDate, let limit = firstCenterable(firstDate, count: count), selected < limit {
            let keys = (0..<count).compactMap { DateFormatting.dayOffset(from: firstDate, by: $0) }
            return keys.count == count ? keys : nil
        }
        if let lastDate, let limit = lastCenterable(lastDate, count: count), selected > limit {
            let keys = (0..<count).reversed().compactMap { DateFormatting.dayOffset(from: lastDate, by: -$0) }
            return keys.count == count ? keys : nil
        }
        return nil
    }
}

// MARK: - DateBarItem

/// Elemento individual de la barra de fechas: abreviatura del día (mayúscula
/// inicial, sin punto) sobre el número. Un único formato en todos los anchos.
private struct DateBarItem: View {
    let dateKey: String
    let isSelected: Bool

    private var dayNumber: String {
        guard let date = DateFormatting.date(from: dateKey) else { return "" }
        return "\(Calendar.current.component(.day, from: date))"
    }

    private var weekday: String {
        guard let date = DateFormatting.date(from: dateKey) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: LocaleService.isEnglish ? "en_US" : "es_ES")
        f.dateFormat = "EEE"
        let short = f.string(from: date)
            .replacingOccurrences(of: ".", with: "")
            .prefix(3)
        return short.prefix(1).uppercased() + short.dropFirst()
    }

    static func accessibilityDescription(dateKey: String, isSelected: Bool, isToday: Bool) -> String {
        let label = DateFormatting.formatDateLabel(dateKey)
        var desc = label
        if isToday { desc += ", \(LocaleService.t("hoy", "today"))" }
        if isSelected { desc += ", \(LocaleService.t("seleccionado", "selected"))" }
        return desc
    }

    static func inputLabels(dateKey: String) -> [String] {
        guard let date = DateFormatting.date(from: dateKey) else { return [] }
        let day = "\(Calendar.current.component(.day, from: date))"
        let f = DateFormatter()
        f.locale = Locale(identifier: LocaleService.isEnglish ? "en_US" : "es_ES")
        f.dateFormat = "EEEE"
        return [f.string(from: date), day, DateFormatting.formatDateLabel(dateKey)]
    }

    var body: some View {
        VStack(spacing: 2) {
            Text(weekday)
                .ccFont(.s12, weight: isSelected ? .bold : .semibold)
                .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
            Text(dayNumber)
                .ccFont(.s16, weight: isSelected ? .bold : .semibold)
                .foregroundStyle(isSelected ? Color.accentColor : Color.primary)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 48)
        .contentShape(Rectangle())
        .accessibilityHidden(true)
    }
}
