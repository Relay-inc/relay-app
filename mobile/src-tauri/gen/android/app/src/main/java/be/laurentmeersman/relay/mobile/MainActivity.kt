package be.laurentmeersman.relay.mobile

import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

// Android 17 (API 37) blocks connections to the local network without ACCESS_LOCAL_NETWORK, a runtime permission:
// the relay-server is on the LAN, so without it every connection times out. Asked at start, it is all the app does.
private const val LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= 37 && checkSelfPermission(LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED)
      requestPermissions(arrayOf(LOCAL_NETWORK), 1)
  }
}
