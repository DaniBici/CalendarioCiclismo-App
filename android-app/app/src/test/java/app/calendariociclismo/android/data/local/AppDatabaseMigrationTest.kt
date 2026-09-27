package app.calendariociclismo.android.data.local

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.calendariociclismo.android.data.local.entity.RaceDayEntity
import app.calendariociclismo.android.data.local.entity.CxMonthCacheEntity
import app.calendariociclismo.android.data.local.entity.CxDetailCacheEntity
import app.calendariociclismo.android.data.model.RaceDay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AppDatabaseMigrationTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val databaseName = "calendario_ciclismo.db"
    private val dateKey = "2026-09-06"
    private val realStart = "2026-09-06T11:15:00Z"

    @After
    fun tearDown() {
        context.deleteDatabase(databaseName)
    }

    @Test
    fun `actualizar desde v15 original conserva la jornada y permite guardar la salida real`() = runBlocking {
        createVersion15Fixture(schemaVersion = 15)

        withDatabase { database ->
            val cached = database.raceDaysDao().getById("cached-day")
            assertNotNull(cached)
            assertNull(cached!!.realStartTimeUtc)
            assertEquals(1234L, cached.cachedAt)
            assertEquals("2026-09-06T11:00:00Z", cached.neutralStartTimeUtc)
            assertEquals(18, database.openHelper.writableDatabase.version)
            database.raceDaysDao().upsertAll(listOf(cached.copy(realStartTimeUtc = realStart)))
        }

        assertReopensWithRealStart("cached-day")
    }

    @Test
    fun `actualizar desde instalacion nueva de build 510 conserva la columna y sus valores`() = runBlocking {
        // La build 510 creó el esquema actual con user_version todavía en 15.
        createVersion15Fixture(schemaVersion = 16, realStartTimeUtc = realStart)

        withDatabase { database ->
            val cached = database.raceDaysDao().getById("cached-day")
            assertNotNull(cached)
            assertEquals(realStart, cached!!.realStartTimeUtc)
            assertEquals(1234L, cached.cachedAt)
            assertEquals(18, database.openHelper.writableDatabase.version)
        }

        assertReopensWithRealStart("cached-day")
    }

    @Test
    fun `actualizar desde v16 conserva carretera y reabre los dos documentos CX`() = runBlocking {
        createVersion15Fixture(schemaVersion = 16, realStartTimeUtc = realStart, userVersion = 16)
        withDatabase { database ->
            assertEquals(realStart, database.raceDaysDao().getById("cached-day")!!.realStartTimeUtc)
            database.cxCacheDao().saveMonth(CxMonthCacheEntity("2026-27:2027-01", "2026-27", "2027-01", "[]", 5678L))
            database.cxCacheDao().saveDetail(CxDetailCacheEntity("cx-1", "prueba", "test", "{\"bonusSeconds\":null}", 5678L))
        }
        withDatabase { database ->
            assertEquals(18, database.openHelper.writableDatabase.version)
            assertEquals("[]", database.cxCacheDao().month("2026-27:2027-01")!!.payload)
            assertEquals("cx-1", database.cxCacheDao().detailBySlug("test")!!.id)
            assertEquals(5678L, database.cxCacheDao().detail("cx-1")!!.cachedAt)
            assertEquals(realStart, database.raceDaysDao().getById("cached-day")!!.realStartTimeUtc)
        }
    }

    @Test
    fun `instalacion nueva guarda la salida real y reabre la base`() = runBlocking {
        withDatabase { database ->
            val day = RaceDay(id = "new-day", dateKey = dateKey, realStartTimeUtc = realStart)
            database.raceDaysDao().upsertAll(listOf(RaceDayEntity.from(day, cachedAt = 1234L)))
            assertEquals(18, database.openHelper.writableDatabase.version)
        }

        assertReopensWithRealStart("new-day")
    }

    private suspend fun assertReopensWithRealStart(id: String) {
        withDatabase { database ->
            val days = database.raceDaysDao().getByDate(dateKey)
            assertEquals(listOf(id), days.map { it.id })
            assertEquals(realStart, days.single().realStartTimeUtc)
            assertEquals(1234L, days.single().cachedAt)
        }
    }

    private suspend fun withDatabase(block: suspend (AppDatabase) -> Unit) {
        val database = AppDatabase.create(context)
        try {
            block(database)
        } finally {
            database.close()
        }
    }

    private fun createVersion15Fixture(schemaVersion: Int, realStartTimeUtc: String? = null, userVersion: Int = 15) {
        val resource = "app.calendariociclismo.android.data.local.AppDatabase/$schemaVersion.json"
        val json = requireNotNull(javaClass.classLoader!!.getResourceAsStream(resource))
            .bufferedReader().use { it.readText() }
        val schema = JSONObject(json).getJSONObject("database")
        val expectedHash = if (schemaVersion == 15) {
            "fd0f7ed37c59b6a97a684bc90fce4802"
        } else {
            "37b95198f275ecd8dd0c1f93dc75cd7b"
        }
        assertEquals(expectedHash, schema.getString("identityHash"))

        context.openOrCreateDatabase(databaseName, Context.MODE_PRIVATE, null).use { database ->
            val entities = schema.getJSONArray("entities")
            for (i in 0 until entities.length()) {
                val entity = entities.getJSONObject(i)
                val tableName = entity.getString("tableName")
                database.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}", tableName))
                val indices = entity.optJSONArray("indices")
                if (indices != null) {
                    for (j in 0 until indices.length()) {
                        database.execSQL(indices.getJSONObject(j).getString("createSql")
                            .replace("\${TABLE_NAME}", tableName))
                    }
                }
            }
            val setupQueries = schema.getJSONArray("setupQueries")
            for (i in 0 until setupQueries.length()) database.execSQL(setupQueries.getString(i))
            database.execSQL(
                """
                INSERT INTO race_days (
                    id, dateKey, isRestDay, isCancelledDay, neutralStartTimeUtc,
                    editorialStatus, hasAssets, profileNotViewable, timingPolicy, cachedAt
                ) VALUES (?, ?, 0, 0, ?, 'published', 0, 0, 'standard', 1234)
                """.trimIndent(),
                arrayOf("cached-day", dateKey, "2026-09-06T11:00:00Z"),
            )
            if (realStartTimeUtc != null) {
                database.execSQL("UPDATE race_days SET realStartTimeUtc = ?", arrayOf(realStartTimeUtc))
            }
            database.version = userVersion
        }
    }
}
