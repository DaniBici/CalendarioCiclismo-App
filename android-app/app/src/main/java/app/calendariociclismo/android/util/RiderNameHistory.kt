package app.calendariociclismo.android.util

import app.calendariociclismo.android.data.model.RiderNameHistoryRow

/**
 * Nombre de un corredor en una carrera cuando cambió de nombre (p. ej., de
 * apellido). La ficha guarda el nombre actual; cada fila del historial es un
 * nombre anterior y su último día vigente (`validTo`). Misma regla que la vista
 * `startlist_riders_resolved` y que `riderNameAt` de `js/rider-name-history.js`.
 */
object RiderNameHistory {
    /**
     * Nombre completo vigente el día [date] (YYYY-MM-DD, inicio de la carrera):
     * el de la fila con la menor `validTo` mayor o igual que la fecha. null si no
     * hay ninguna (o falta la fecha): vale el nombre de la ficha.
     */
    fun nameAt(rows: List<RiderNameHistoryRow>?, date: String?): String? {
        if (rows.isNullOrEmpty() || date == null) return null
        val row = rows.filter { it.validTo >= date }.minByOrNull { it.validTo } ?: return null
        return "${row.firstName} ${row.lastName}".trim()
    }
}
