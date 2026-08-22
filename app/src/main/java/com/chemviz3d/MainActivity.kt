package com.chemviz3d

import android.annotation.SuppressLint
import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val io = Executors.newCachedThreadPool()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val settingsName = "chemviz3d-settings"
    private val cacheDirectoryName = "chemviz-cache"
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingFileChooserParams: WebChromeClient.FileChooserParams? = null
    private var pendingCaptureUri: Uri? = null
    private var pendingNativeCamera = false
    private var nativeCaptureUri: Uri? = null
    private var nativeCaptureFile: File? = null

    companion object {
        private const val FILE_CHOOSER_REQUEST_CODE = 4101
        private const val CAMERA_PERMISSION_REQUEST_CODE = 4102
        private const val NATIVE_IMAGE_REQUEST_CODE = 4103
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.web_view)

        val webSettings = webView.settings
        webSettings.javaScriptEnabled = true
        webSettings.allowFileAccess = true
        webSettings.domStorageEnabled = true
        webSettings.mediaPlaybackRequiresUserGesture = false

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                filePath: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = filePath
                if (fileChooserParams == null) {
                    filePathCallback = null
                    return false
                }
                pendingFileChooserParams = fileChooserParams
                if (fileChooserParams.isCaptureEnabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val permissions = mutableListOf(Manifest.permission.CAMERA)
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
                        checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
                    ) permissions += Manifest.permission.WRITE_EXTERNAL_STORAGE
                    if (permissions.any { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }) {
                        requestPermissions(permissions.toTypedArray(), CAMERA_PERMISSION_REQUEST_CODE)
                    } else {
                        launchFileChooser(fileChooserParams)
                    }
                } else {
                    launchFileChooser(fileChooserParams)
                }
                return true
            }
        }

        // JavaScript interface for the web app to call back to Android. The
        // settings and cache methods use app-private storage, which works on
        // all supported Android versions without storage permissions.
        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun onReady() {}
            @JavascriptInterface
            fun onMeasurement(type: String, valuesJson: String) {}
            @JavascriptInterface
            fun onStatus(message: String) {}
            @JavascriptInterface
            fun onMoleculeInfo(infoJson: String?) {}
            @JavascriptInterface
            fun onConsoleLog(message: String) {}

            @JavascriptInterface
            fun saveScreenshot(filename: String, dataUrl: String): Boolean = saveScreenshotToGallery(filename, dataUrl)

            @JavascriptInterface
            fun getSettings(): String = getSharedPreferences(settingsName, MODE_PRIVATE)
                .getString("json", "{}") ?: "{}"

            @JavascriptInterface
            fun saveSettings(content: String): Boolean = try {
                JSONObject(content)
                getSharedPreferences(settingsName, MODE_PRIVATE).edit()
                    .putString("json", content).apply()
                true
            } catch (_: Exception) {
                false
            }

            @JavascriptInterface
            fun getCache(key: String): String = if (validCacheKey(key)) {
                cacheFile(key).takeIf { it.isFile }?.readText(Charsets.UTF_8) ?: ""
            } else ""

            @JavascriptInterface
            fun saveCache(key: String, content: String): Boolean = try {
                if (!validCacheKey(key)) {
                    false
                } else {
                    JSONObject(content)
                    val directory = File(cacheDir, cacheDirectoryName)
                    if (!directory.exists() && !directory.mkdirs()) {
                        false
                    } else {
                        val temporary = File(directory, ".${key}.tmp")
                        temporary.writeText(content, Charsets.UTF_8)
                        if (!temporary.renameTo(cacheFile(key))) {
                            temporary.delete()
                            false
                        } else true
                    }
                }
            } catch (_: Exception) {
                false
            }

            @JavascriptInterface
            fun deleteCache(key: String): Boolean = if (validCacheKey(key)) {
                cacheFile(key).delete() || !cacheFile(key).exists()
            } else false

            @JavascriptInterface
            fun clearCache(): Boolean = try {
                File(cacheDir, cacheDirectoryName).listFiles()?.forEach { it.delete() }
                true
            } catch (_: Exception) {
                false
            }

            @JavascriptInterface
            fun requestChatCompletions(requestId: String, url: String, apiKey: String, body: String) {
                io.execute {
                    val (status, responseBody) = performChatRequest(url, apiKey, body)
                    mainHandler.post {
                        val id = JSONObject.quote(requestId)
                        val result = JSONObject.quote(responseBody)
                        webView.evaluateJavascript(
                            "window.__chemvizAndroidChatResult && window.__chemvizAndroidChatResult($id,$status,$result)",
                            null,
                        )
                    }
                }
            }

            @JavascriptInterface
            fun openImageChooser() {
                mainHandler.post { showNativeImageChooser() }
            }
        }, "ChemVizAndroid")

        WebView.setWebContentsDebuggingEnabled(true)
        webView.loadUrl("file:///android_asset/webapp/index.html")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CAMERA_PERMISSION_REQUEST_CODE) return
        val params = pendingFileChooserParams
        pendingFileChooserParams = null
        if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED } && params != null) {
            launchFileChooser(params)
        } else if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED } && pendingNativeCamera) {
            pendingNativeCamera = false
            requestNativeCamera()
        } else {
            pendingNativeCamera = false
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
            Toast.makeText(this, "需要相机权限才能拍照", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == NATIVE_IMAGE_REQUEST_CODE) {
            val captureUri = nativeCaptureUri
            val captureFile = nativeCaptureFile
            nativeCaptureUri = null
            nativeCaptureFile = null
            val uri = if (resultCode == Activity.RESULT_OK) captureUri ?: data?.data else null
            if (resultCode != Activity.RESULT_OK) captureFile?.delete()
            if (uri == null) {
                notifyNativeImage("")
            } else {
                io.execute {
                    val dataUrl = encodeImageForWeb(uri) ?: ""
                    captureFile?.delete()
                    mainHandler.post { notifyNativeImage(dataUrl) }
                }
            }
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            val callback = filePathCallback
            filePathCallback = null
            pendingFileChooserParams = null
            val captureUri = pendingCaptureUri
            if (callback != null) {
                // Camera apps may return a thumbnail Intent alongside
                // EXTRA_OUTPUT. Always prefer the full-resolution output URI.
                val uris = when {
                    resultCode != Activity.RESULT_OK -> null
                    captureUri != null -> arrayOf(captureUri)
                    data?.clipData != null -> Array(data.clipData!!.itemCount) { index -> data.clipData!!.getItemAt(index).uri }
                    data?.data != null -> arrayOf(data.data!!)
                    else -> null
                }
                if (resultCode != Activity.RESULT_OK) captureUri?.let { contentResolver.delete(it, null, null) }
                if (resultCode == Activity.RESULT_OK && captureUri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    contentResolver.update(captureUri, ContentValues().apply {
                        put(MediaStore.Images.Media.IS_PENDING, 0)
                    }, null, null)
                }
                pendingCaptureUri = null
                callback.onReceiveValue(uris)
            }
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        pendingCaptureUri?.let { contentResolver.delete(it, null, null) }
        pendingCaptureUri = null
        nativeCaptureFile?.delete()
        nativeCaptureFile = null
        nativeCaptureUri = null
        io.shutdownNow()
        super.onDestroy()
    }

    private fun launchFileChooser(params: WebChromeClient.FileChooserParams) {
        try {
            val intent = if (params.isCaptureEnabled) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, "chemviz-capture-${System.currentTimeMillis()}.jpg")
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/ChemViz3D")
                        put(MediaStore.Images.Media.IS_PENDING, 1)
                    }
                }
                val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("camera output unavailable")
                pendingCaptureUri = uri
                Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    clipData = ClipData.newRawUri("ChemViz3D camera output", uri)
                }
            } else {
                params.createIntent().apply { addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            }
            if (intent.resolveActivity(packageManager) == null) throw IllegalStateException("no handler for image picker")
            startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE)
        } catch (_: Exception) {
            pendingCaptureUri?.let { contentResolver.delete(it, null, null) }
            pendingCaptureUri = null
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
            pendingFileChooserParams = null
            Toast.makeText(this, "无法打开相机或相册", Toast.LENGTH_SHORT).show()
        }
    }

    private fun requestNativeCamera() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            pendingNativeCamera = true
            requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST_CODE)
            return
        }
        try {
            val directory = File(cacheDir, "chemviz-image").apply { mkdirs() }
            val file = File(directory, "capture-${System.currentTimeMillis()}.jpg")
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            nativeCaptureFile = file
            nativeCaptureUri = uri
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = ClipData.newRawUri("ChemViz3D camera output", uri)
            }
            if (intent.resolveActivity(packageManager) == null) throw IllegalStateException("no camera app")
            startActivityForResult(intent, NATIVE_IMAGE_REQUEST_CODE)
        } catch (_: Exception) {
            nativeCaptureFile?.delete()
            nativeCaptureFile = null
            nativeCaptureUri = null
            notifyNativeImage("")
            Toast.makeText(this, "无法打开相机", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showNativeImageChooser() {
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setItems(arrayOf("拍照", "从相册选择")) { _, which ->
                if (which == 0) requestNativeCamera() else requestNativeGallery()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun requestNativeGallery() {
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                type = "image/*"
                addCategory(Intent.CATEGORY_OPENABLE)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }
            startActivityForResult(intent, NATIVE_IMAGE_REQUEST_CODE)
        } catch (_: Exception) {
            notifyNativeImage("")
            Toast.makeText(this, "无法打开相册", Toast.LENGTH_SHORT).show()
        }
    }

    private fun notifyNativeImage(dataUrl: String) {
        val value = JSONObject.quote(dataUrl)
        webView.evaluateJavascript("window.__chemvizAndroidImageResult && window.__chemvizAndroidImageResult($value)", null)
    }

    private fun encodeImageForWeb(uri: Uri): String? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val longest = maxOf(bounds.outWidth, bounds.outHeight)
        val sample = generateSequence(1) { it * 2 }.takeWhile { it * 2 <= longest / 1600 }.lastOrNull() ?: 1
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
        val scale = minOf(1f, 1600f / maxOf(bitmap.width, bitmap.height).toFloat())
        val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true) else bitmap
        val output = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 82, output)
        if (scaled !== bitmap) scaled.recycle()
        bitmap.recycle()
        return "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
    }

    private fun validCacheKey(key: String): Boolean = Regex("v1-[0-9a-f]{8}").matches(key)

    private fun cacheFile(key: String): File = File(File(cacheDir, cacheDirectoryName), "$key.json")

    private fun saveScreenshotToGallery(filename: String, dataUrl: String): Boolean {
        val encoded = dataUrl.substringAfter("base64,", "")
        if (encoded.isBlank()) return false
        val bytes = try {
            Base64.decode(encoded, Base64.DEFAULT)
        } catch (_: IllegalArgumentException) {
            return false
        }
        if (BitmapFactory.decodeByteArray(bytes, 0, bytes.size) == null) return false

        val safeName = filename.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
            .let { if (it.endsWith(".png", ignoreCase = true)) it else "$it.png" }
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, safeName)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/ChemViz3D")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }
        val resolver = contentResolver
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
        return try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IllegalStateException("image stream unavailable")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                resolver.update(uri, ContentValues().apply {
                    put(MediaStore.Images.Media.IS_PENDING, 0)
                }, null, null)
            }
            true
        } catch (_: Exception) {
            resolver.delete(uri, null, null)
            false
        }
    }

    private fun performChatRequest(urlString: String, apiKey: String, body: String): Pair<Int, String> {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL(urlString)
            connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 20_000
                readTimeout = 120_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                if (apiKey.isNotBlank()) setRequestProperty("Authorization", "Bearer $apiKey")
            }
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val response = stream?.let { BufferedInputStream(it).use { input -> input.readBytes().toString(Charsets.UTF_8) } } ?: ""
            status to response
        } catch (error: Exception) {
            599 to JSONObject().put("error", JSONObject().put("message", error.message ?: "Android network request failed")).toString()
        } finally {
            connection?.disconnect()
        }
    }
}
