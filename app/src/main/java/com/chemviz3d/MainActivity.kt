package com.chemviz3d

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

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

        // JavaScript interface for the web app to call back to Android
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
        }, "ChemVizAndroid")

        WebView.setWebContentsDebuggingEnabled(true)
        webView.loadUrl("file:///android_asset/webapp/index.html")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }
}
