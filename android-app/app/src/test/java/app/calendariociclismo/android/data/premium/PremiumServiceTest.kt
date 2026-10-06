package app.calendariociclismo.android.data.premium

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Tests "puros" del API de [PremiumService] — el enum [PremiumPlan] es
 * contractual con la hoja de apoyo y con el producto Amigo de Google Play,
 * igual que los consumibles. No se
 * instancia el servicio porque depende de Context + DataStore + Firebase
 * Analytics + BillingClient, que requieren un entorno Android — esos tests
 * se cubrirán como instrumentation tests si en el futuro hace falta.
 */
class PremiumServiceTest {

    @Test
    fun `product ids and base plans match the Google Play store contract`() {
        // Estos IDs deben existir en Google Play Console: base plans dentro del
        // subscription product `amigo`, producto Premium heredado y consumibles
        // de aportación. Si se renombran allí, hay que renombrar también las
        // constantes en BillingManager.
        assertEquals(BillingManager.BASE_PLAN_MONTHLY, PremiumService.PremiumPlan.MONTHLY.basePlanId)
        assertEquals(BillingManager.BASE_PLAN_YEARLY, PremiumService.PremiumPlan.YEARLY.basePlanId)
        assertEquals("monthly", PremiumService.PremiumPlan.MONTHLY.basePlanId)
        assertEquals("yearly", PremiumService.PremiumPlan.YEARLY.basePlanId)
        assertEquals("amigo", BillingManager.FRIEND_PRODUCT_ID)
        assertEquals("premium", BillingManager.LEGACY_PREMIUM_PRODUCT_ID)
        assertEquals(
            listOf("aportacion_299", "aportacion_599", "aportacion_1199"),
            BillingManager.CONTRIBUTION_PRODUCT_IDS,
        )
    }
}
