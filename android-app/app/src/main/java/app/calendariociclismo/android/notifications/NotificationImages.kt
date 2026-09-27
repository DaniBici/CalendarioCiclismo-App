package app.calendariociclismo.android.notifications

import android.content.Context
import android.graphics.Bitmap
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.size.Precision
import coil3.size.Scale
import coil3.toBitmap

/** Comparte cachés con la app y limita la imagen enviada a RemoteViews. */
internal suspend fun loadNotificationBitmap(context: Context, data: Any): Bitmap? {
    val request = ImageRequest.Builder(context.applicationContext)
        .data(data)
        .size(1024, 1024)
        .scale(Scale.FIT)
        .precision(Precision.EXACT)
        .allowHardware(false)
        .build()
    val result = SingletonImageLoader.get(context.applicationContext).execute(request)
    return (result as? SuccessResult)?.image?.toBitmap()
}
