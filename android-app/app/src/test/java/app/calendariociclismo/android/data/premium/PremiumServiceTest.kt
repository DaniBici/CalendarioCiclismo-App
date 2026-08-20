package app.calendariociclismo.android.data.premium

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Tests "puros" del API de [PremiumService] — los enums [PaywallSource] y
 * [PremiumPlan] son contractuales con el cliente del paywall y con el
 * producto Amigo de Google Play y los consumibles. No se
 * instancia el servicio porque depende de Context + DataStore + Firebase
 * Analytics + BillingClient, que requieren un entorno Android — esos tests
 * se cubrirán como instrumentation tests si en el futuro hace falta.
 */
class PremiumServiceTest {

    @Test
    fun `paywallSource has all 5 expected values`() {
        val expected = setOf(
            "REGION",
            "NOTIFICATIONS",
            "RACE_CARDS",
            "RACE_NOTIFICATIONS",
            "GENERAL",
        )
        val actual = PremiumService.PaywallSource.entries.map { it.name }.toSet()
        assertEquals("Las sources deben coincidir con los CTAs cableados en la app", expected, actual)
    }

    @Test
    fun `paywallSource values are unique`() {
        val all = PremiumService.PaywallSource.entries
        assertEquals(all.size, all.toSet().size)
    }

    @Test
    fun `premiumPlan has monthly and yearly`() {
        val actual = PremiumService.PremiumPlan.entries.map { it.name }.toSet()
        assertEquals(setOf("MONTHLY", "YEARLY"), actual)
    }

    @Test
    fun `paywallSource lowercase names are stable for analytics`() {
        // Los eventos de analytics usan `name.lowercase()` (ver
        // PremiumService.subscribe / presentPaywall). Si esto cambia, hay
        // que actualizar el dashboard de Firebase y los reportes del panel.
        val expected = listOf(
            "region",
            "notifications",
            "race_cards",
            "race_notifications",
            "general",
        )
        val actual = PremiumService.PaywallSource.entries.map { it.name.lowercase() }
        assertEquals(expected, actual)
    }

    @Test
    fun `premiumPlan lowercase names are stable for analytics`() {
        val expected = listOf("monthly", "yearly")
        val actual = PremiumService.PremiumPlan.entries.map { it.name.lowercase() }
        assertEquals(expected, actual)
    }

    @Test
    fun `premiumPlan basePlanId matches Google Play subscription product config`() {
        // Estos IDs deben existir como base plans dentro del subscription
        // product `amigo` en Google Play Console. Si se renombran allí,
        // hay que renombrar también las constantes en BillingManager.
        assertEquals(BillingManager.BASE_PLAN_MONTHLY, PremiumService.PremiumPlan.MONTHLY.basePlanId)
        assertEquals(BillingManager.BASE_PLAN_YEARLY, PremiumService.PremiumPlan.YEARLY.basePlanId)
        assertEquals("monthly", PremiumService.PremiumPlan.MONTHLY.basePlanId)
        assertEquals("yearly", PremiumService.PremiumPlan.YEARLY.basePlanId)
    }

    @Test
    fun `billing product ids match the 4_3 store contract`() {
        assertEquals("amigo", BillingManager.FRIEND_PRODUCT_ID)
        assertEquals("premium", BillingManager.LEGACY_PREMIUM_PRODUCT_ID)
        assertEquals(
            listOf("aportacion_299", "aportacion_599", "aportacion_1199"),
            BillingManager.CONTRIBUTION_PRODUCT_IDS,
        )
    }
}
