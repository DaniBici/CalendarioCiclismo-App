package app.calendariociclismo.android.ui.adaptive

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AdaptiveLayoutPolicyTest {
    private val compact = AdaptiveLayoutInfo(AdaptiveWidthClass.Compact, false, 0.dp, 0.dp)
    private val medium = AdaptiveLayoutInfo(AdaptiveWidthClass.Medium, false, 0.dp, 0.dp)
    private val compactHeight = AdaptiveLayoutInfo(AdaptiveWidthClass.Expanded, true, 0.dp, 0.dp)

    @Test
    fun `feed columns require a non compact window and enough container width`() {
        assertEquals(1, AdaptiveLayoutPolicy.feedColumns(900f, compact))
        assertEquals(1, AdaptiveLayoutPolicy.feedColumns(599f, medium))
        assertEquals(2, AdaptiveLayoutPolicy.feedColumns(600f, medium))
        assertEquals(1, AdaptiveLayoutPolicy.feedColumns(900f, compactHeight))
    }

    @Test
    fun `startlist columns are bounded from one to three`() {
        assertEquals(1, AdaptiveLayoutPolicy.startlistColumns(900f, compact))
        assertEquals(2, AdaptiveLayoutPolicy.startlistColumns(620f, medium))
        assertEquals(3, AdaptiveLayoutPolicy.startlistColumns(920f, medium))
        assertEquals(3, AdaptiveLayoutPolicy.startlistColumns(1_600f, medium))
    }

    @Test
    fun `featured items span and interrupt paired rows`() {
        val rows = AdaptiveLayoutPolicy.rows(listOf(1, 2, 3, 4), 2) { it == 3 }
        assertEquals(listOf(listOf(1, 2), listOf(3), listOf(4)), rows.map { it.items })
        assertEquals(listOf(false, true, false), rows.map { it.spansAllColumns })
    }

    @Test
    fun `wide detail starts at the configured threshold`() {
        assertFalse(AdaptiveLayoutPolicy.usesWideDetail(839f, medium))
        assertTrue(AdaptiveLayoutPolicy.usesWideDetail(840f, medium))
    }

    @Test
    fun `balanced break can divide an oversized category`() {
        assertEquals(
            AdaptiveLayoutPolicy.BalancedBreak(1, 3),
            AdaptiveLayoutPolicy.balancedBreak(listOf(2, 7, 1)),
        )
    }

    @Test
    fun `balanced block break preserves sections and minimizes column difference`() {
        assertEquals(2, AdaptiveLayoutPolicy.balancedBlockBreak(listOf(3, 4, 2, 6)))
        assertEquals(1, AdaptiveLayoutPolicy.balancedBlockBreak(listOf(10, 1)))
    }
}
