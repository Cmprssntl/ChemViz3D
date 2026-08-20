package com.chemviz3d

import android.annotation.SuppressLint
import android.content.ContentValues
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.io.BufferedInputStream
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
                    val directory = File(filesDir, cacheDirectoryName)
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
                File(filesDir, cacheDirectoryName).listFiles()?.forEach { it.delete() }
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
        }, "ChemVizAndroid")

        WebView.setWebContentsDebuggingEnabled(true)
        webView.loadUrl("file:///android_asset/webapp/index.html")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }

    private fun validCacheKey(key: String): Boolean = Regex("v1-[0-9a-f]{8}").matches(key)

    private fun cacheFile(key: String): File = File(File(filesDir, cacheDirectoryName), "$key.json")

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
