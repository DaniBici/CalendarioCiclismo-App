package app.calendariociclismo.android.ui.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import app.calendariociclismo.android.data.prefs.AppPreferences
import app.calendariociclismo.android.data.repository.CalendarRepository

class TodayViewModelFactory(
    private val repo: CalendarRepository,
    private val prefs: AppPreferences,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return TodayViewModel(repo, prefs) as T
    }
}
