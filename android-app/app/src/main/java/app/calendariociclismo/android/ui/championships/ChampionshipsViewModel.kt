package app.calendariociclismo.android.ui.championships

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import app.calendariociclismo.android.data.model.ChampionshipCountry
import app.calendariociclismo.android.data.repository.CalendarRepository
import app.calendariociclismo.android.util.ChampionshipsConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel del Modo Campeonatos — equivalente a `js/campeonatos.js`.
 * Carga la rejilla una vez; el filtro (Todas/Pro/Masc/Fem) es estado local
 * sin persistencia.
 */
class ChampionshipsViewModel(
    private val repo: CalendarRepository,
) : ViewModel() {

    data class State(
        val isLoading: Boolean = true,
        val error: String? = null,
        val countries: List<ChampionshipCountry> = emptyList(),
        val filter: ChampionshipsConfig.Filter = ChampionshipsConfig.defaultFilter(),
        /** Claves `raceId#stage|final` de pruebas con resultados in-house (keepForWeb):
         *  su trofeo lleva a la pantalla NATIVA de resultados. */
        val inhouseKeys: Set<String> = emptySet(),
    ) {
        /** Países con al menos una prueba visible bajo el filtro activo. */
        val displayCountries: List<ChampionshipCountry>
            get() = countries.filter { it.visibleSlots(filter).isNotEmpty() }
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init { load() }

    fun setFilter(filter: ChampionshipsConfig.Filter) {
        _state.value = _state.value.copy(filter = filter)
    }

    fun load() {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            runCatching { repo.loadChampionships() }
                .onSuccess { countries ->
                    _state.value = _state.value.copy(isLoading = false, countries = countries, error = null)
                    // Resultados in-house (no bloqueante): reetiqueta los trofeos a la
                    // pantalla nativa cuando aparezcan (un volcado PDF/UCI puede activarlo).
                    val raceIds = countries.flatMap { c -> c.slots.values.mapNotNull { it.race?.id } }
                    if (raceIds.isNotEmpty()) {
                        val keys = repo.inhouseStageKeys(raceIds)
                        if (keys.isNotEmpty()) _state.value = _state.value.copy(inhouseKeys = keys)
                    }
                }
                .onFailure { _state.value = _state.value.copy(isLoading = false, error = it.message ?: "") }
        }
    }
}

class ChampionshipsViewModelFactory(
    private val repo: CalendarRepository,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return ChampionshipsViewModel(repo) as T
    }
}
