package app.calendariociclismo.android.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import app.calendariociclismo.android.data.local.dao.AssetsDao
import app.calendariociclismo.android.data.local.dao.BroadcastsDao
import app.calendariociclismo.android.data.local.dao.RaceDaysDao
import app.calendariociclismo.android.data.local.dao.RacesDao
import app.calendariociclismo.android.data.local.entity.AssetEntity
import app.calendariociclismo.android.data.local.entity.BroadcastEntity
import app.calendariociclismo.android.data.local.entity.RaceDayEntity
import app.calendariociclismo.android.data.local.entity.RaceEntity
import app.calendariociclismo.android.data.local.entity.CxMonthCacheEntity
import app.calendariociclismo.android.data.local.entity.CxDetailCacheEntity
import app.calendariociclismo.android.data.local.dao.CxCacheDao

@Database(
    entities = [
        RaceEntity::class,
        RaceDayEntity::class,
        BroadcastEntity::class,
        AssetEntity::class,
        CxMonthCacheEntity::class,
        CxDetailCacheEntity::class,
    ],
    version = 18,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun racesDao(): RacesDao
    abstract fun raceDaysDao(): RaceDaysDao
    abstract fun broadcastsDao(): BroadcastsDao
    abstract fun assetsDao(): AssetsDao
    abstract fun cxCacheDao(): CxCacheDao

    companion object {
        private const val DB_NAME = "calendario_ciclismo.db"

        private val MIGRATION_15_16 = object : Migration(15, 16) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // La build 510 añadió esta columna sin incrementar la versión de Room.
                // Existen bases v15 con ambos esquemas; conservar sus datos en los dos casos.
                val columns = db.query("PRAGMA table_info(`race_days`)").use { cursor ->
                    val nameIndex = cursor.getColumnIndexOrThrow("name")
                    buildSet {
                        while (cursor.moveToNext()) add(cursor.getString(nameIndex))
                    }
                }
                if ("realStartTimeUtc" !in columns) {
                    db.execSQL("ALTER TABLE `race_days` ADD COLUMN `realStartTimeUtc` TEXT")
                }
            }
        }

        private val MIGRATION_16_17 = object : Migration(16, 17) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `cx_month_cache` (`key` TEXT NOT NULL, `seasonKey` TEXT NOT NULL, `monthKey` TEXT NOT NULL, `payload` TEXT NOT NULL, `cachedAt` INTEGER NOT NULL, PRIMARY KEY(`key`))")
                db.execSQL("CREATE TABLE IF NOT EXISTS `cx_detail_cache` (`id` TEXT NOT NULL, `slug` TEXT NOT NULL, `slugEn` TEXT, `payload` TEXT NOT NULL, `cachedAt` INTEGER NOT NULL, PRIMARY KEY(`id`))")
            }
        }

        private val MIGRATION_17_18 = object : Migration(17, 18) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Se retiran los identificadores de fuentes externas de resultados
                // (extId/extSlug). Room no soporta DROP COLUMN en todo el parque
                // Android → recrear la tabla conservando las filas.
                db.execSQL("CREATE TABLE IF NOT EXISTS `races_new` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, `nameEn` TEXT, `abbrev` TEXT, `uciCategory` TEXT, `gender` TEXT, `raceFormat` TEXT, `countryCode` TEXT, `colorHex` TEXT, `logoUrl` TEXT, `websiteUrl` TEXT, `hideFlag` INTEGER NOT NULL, `isGrandTour` INTEGER NOT NULL, `isNoClickable` INTEGER NOT NULL, `isCancelled` INTEGER NOT NULL, `startDate` TEXT, `endDate` TEXT, `year` INTEGER, `slug` TEXT, `originalName` TEXT, `startlistImportedAt` TEXT, `startlistProvisional` INTEGER NOT NULL, `createdAt` TEXT, `cachedAt` INTEGER NOT NULL, PRIMARY KEY(`id`))")
                db.execSQL("INSERT INTO `races_new` SELECT `id`,`name`,`nameEn`,`abbrev`,`uciCategory`,`gender`,`raceFormat`,`countryCode`,`colorHex`,`logoUrl`,`websiteUrl`,`hideFlag`,`isGrandTour`,`isNoClickable`,`isCancelled`,`startDate`,`endDate`,`year`,`slug`,`originalName`,`startlistImportedAt`,`startlistProvisional`,`createdAt`,`cachedAt` FROM `races`")
                db.execSQL("DROP TABLE `races`")
                db.execSQL("ALTER TABLE `races_new` RENAME TO `races`")
            }
        }

        @Volatile
        private var INSTANCE: AppDatabase? = null

        internal fun create(context: Context): AppDatabase = Room
            .databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                DB_NAME,
            )
            .addMigrations(MIGRATION_15_16, MIGRATION_16_17, MIGRATION_17_18)
            .fallbackToDestructiveMigration()
            .build()

        fun get(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: create(context).also { INSTANCE = it }
            }
        }
    }
}
