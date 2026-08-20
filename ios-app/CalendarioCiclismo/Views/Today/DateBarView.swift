import SwiftUI

/// Barra de navegación por fechas con scroll horizontal.
///
/// Arquitectura de 3 capas (ZStack):
/// - Capa 1: ScrollView scrollable con los días en texto oscuro.
/// - Capa 2: Capsule azul fija en el centro (decorativa).
/// - Capa 3: DateBarItem con texto blanco para el día bajo la capsule.
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
struct DateBarView: View {
    let selectedDate: String
    let isToday: Bool
    let onSelect: (String) -> Void
    let onToday: () -> Void

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

    init(
        selectedDate: String,
        isToday: Bool,
        onSelect: @escaping (String) -> Void,
        onToday: @escaping () -> Void
    ) {
        self.selectedDate = selectedDate
        self.isToday = isToday
        self.onSelect = onSelect
        self.onToday = onToday
        self._dateRange = State(
            initialValue: DateFormatting.dateRange(around: selectedDate, offset: 45)
        )
    }

    var body: some View {
        GeometryReader { geo in
            let availableWidth = max(1, geo.size.width)
            let dayWidth = availableWidth / visibleDayCount
            let capsuleWidth = max(1, dayWidth - 4)
            let displayedCenter = scrollPosition ?? selectedDate

            ZStack {
                // ── Capa 1: días scrollables ──────────────────────────────
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 0) {
                        ForEach(dateRange, id: \.self) { key in
                            DateBarItem(
                                dateKey: key,
                                isSelected: false,
                                isToday: key == DateFormatting.todayKey()
                            )
                            .frame(width: dayWidth, height: itemHeight)
                            .id(key)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                guard key != scrollPosition else { return }
                                Haptics.play(.navigation)
                                withAnimation(.easeInOut(duration: 0.3)) {
                                    scrollPosition = key
                                }
                            }
                            .accessibilityLabel(DateBarItem.accessibilityDescription(
                                dateKey: key,
                                isSelected: key == selectedDate,
                                isToday: key == DateFormatting.todayKey()
                            ))
                            .accessibilityAddTraits(
                                key == selectedDate ? [.isButton, .isSelected] : [.isButton]
                            )
                            .accessibilityInputLabels(DateBarItem.inputLabels(dateKey: key))
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .scrollPosition(id: $scrollPosition, anchor: .center)
                .onScrollPhaseChange { _, newPhase in
                    // Propagar al padre solo al entrar en reposo para no
                    // disparar loadDay() por cada día cruzado durante el drag.
                    // Como dateRange nunca se desplaza durante un scroll de usuario,
                    // scrollPosition(id:) no puede confundirse con el ítem erróneo
                    // y el cascade loop es estructuralmente imposible.
                    guard newPhase == .idle,
                          let position = scrollPosition,
                          position != selectedDate else { return }
                    onSelect(position)
                }
                .sensoryFeedback(.selection, trigger: scrollPosition)
                .onAppear {
                    // scrollPosition(id:) no aplica el valor inicial del State
                    // en el primer render. Diferir la asignación al siguiente
                    // ciclo produce el cambio nil → valor que sí detecta.
                    let target = selectedDate
                    DispatchQueue.main.async {
                        scrollPosition = target
                    }
                }

                // ── Capa 2: capsule fija en el centro ─────────────────────
                // Azul de marca suave (15%) en lugar de azul sólido — mismo
                // gesto que los chips de filtro y el cintillo "Hoy". El texto
                // del día centrado (Capa 3) va en azul, no en blanco.
                Capsule()
                    .fill(Color.accentColor.opacity(0.15))
                    .frame(width: capsuleWidth, height: itemHeight)
                    .allowsHitTesting(false)

                // ── Capa 3: texto blanco del día centrado ─────────────────
                DateBarItem(
                    dateKey: displayedCenter,
                    isSelected: true,
                    isToday: displayedCenter == DateFormatting.todayKey()
                )
                .frame(width: capsuleWidth, height: itemHeight)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .frame(width: availableWidth, height: itemHeight)
            .onChange(of: selectedDate) { _, newValue in
                if !dateRange.contains(newValue) {
                    // Navegación extrema (> ±45 días): regenerar el rango y
                    // reposicionar con el truco nil → valor.
                    dateRange = DateFormatting.dateRange(around: newValue, offset: windowOffset)
                    scrollPosition = nil
                    DispatchQueue.main.async {
                        scrollPosition = newValue
                    }
                } else {
                    // Cambio externo normal (botones prev/next, "ir a hoy").
                    guard scrollPosition != newValue else { return }
                    withAnimation(.easeInOut(duration: 0.3)) {
                        scrollPosition = newValue
                    }
                }
            }
        }
        .frame(height: itemHeight)
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .background(Color(.systemBackground))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(LocaleService.t("Selector de fecha", "Date picker"))
        .accessibilityIdentifier(AccessibilityID.dateBar)
    }
}

// MARK: - DateBarItem

/// Elemento individual de la barra de fechas.
private struct DateBarItem: View {
    let dateKey: String
    let isSelected: Bool
    let isToday: Bool
    @ScaledMetric(relativeTo: .caption2) private var weekdaySize: CGFloat = 10
    @ScaledMetric(relativeTo: .body) private var dayNumberSize: CGFloat = 16

    private var dayNumber: String {
        guard let date = DateFormatting.date(from: dateKey) else { return "" }
        return "\(Calendar.current.component(.day, from: date))"
    }

    private var weekday: String {
        guard let date = DateFormatting.date(from: dateKey) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: LocaleService.isEnglish ? "en_US" : "es_ES")
        f.dateFormat = "EEE"
        return f.string(from: date).prefix(3).uppercased()
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
                .font(.system(size: weekdaySize, weight: .medium))
                .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
            Text(dayNumber)
                .font(.system(size: dayNumberSize, weight: isSelected ? .bold : .medium))
                .foregroundStyle(isSelected ? Color.accentColor : Color.primary)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 48)
        .background {
            if isToday && !isSelected {
                Capsule().fill(Color.accentColor.opacity(0.1))
            }
        }
        .overlay(
            isToday && !isSelected
                ? Capsule().strokeBorder(Color.accentColor.opacity(0.3), lineWidth: 1)
                : nil
        )
        .contentShape(Rectangle())
        .accessibilityHidden(true)
    }
}
