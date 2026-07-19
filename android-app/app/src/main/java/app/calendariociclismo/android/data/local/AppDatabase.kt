package app.calendariociclismo.android.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import app.calendariociclismo.android.data.local.dao.AssetsDao
import app.calendariociclismo.android.data.local.dao.BroadcastsDao
import app.calendariociclismo.android.data.local.dao.RaceDaysDao
import app.calendariociclismo.android.data.local.dao.RacesDao
import app.calendariociclismo.android.data.local.entity.AssetEntity
import app.calendariociclismo.android.data.local.entity.BroadcastEntity
import app.calendariociclismo.android.data.local.entity.RaceDayEntity
import app.calendariociclismo.android.data.local.entity.RaceEntity

@Database(
    entities = [
        RaceEntity::class,
        RaceDayEntity::class,
        BroadcastEntity::class,
        AssetEntity::class,
    ],
    version = 14,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun racesDao(): RacesDao
    abstract fun raceDaysDao(): RaceDaysDao
    abstract fun broadcastsDao(): BroadcastsDao
    abstract fun assetsDao(): AssetsDao

    companion object {
        private const val DB_NAME = "calendario_ciclismo.db"

        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun get(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room
                    .databaseBuilder(
                        context.applicationContext,
                        AppDatabase::class.java,
                        DB_NAME,
                    )
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
