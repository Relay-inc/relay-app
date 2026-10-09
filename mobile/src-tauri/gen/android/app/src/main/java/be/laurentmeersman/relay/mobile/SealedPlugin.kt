package be.laurentmeersman.relay.mobile

// The phone's secrets at rest (mobile/src-tauri/src/sealed.rs): AES-256-GCM with a key made in the Android Keystore.
// The key never leaves the Keystore (hardware-backed where the phone has it), so the files in the app's folder hold
// ciphertext only, and a copy of that folder (a backup, a rooted read) opens nowhere else.
import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class SealArgs {
    lateinit var data: String // base64
}

@TauriPlugin
class SealedPlugin(private val activity: Activity) : Plugin(activity) {
    private val alias = "relay-secrets"

    // the Keystore's key, made the first time
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as SecretKey?)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private fun reply(invoke: Invoke, bytes: ByteArray) {
        val ret = JSObject()
        ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
        invoke.resolve(ret)
    }

    /** The data sealed: a fresh 12-byte nonce, then the ciphertext with its tag. */
    @Command
    fun seal(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SealArgs::class.java)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            reply(invoke, cipher.iv + cipher.doFinal(Base64.decode(args.data, Base64.NO_WRAP)))
        } catch (e: Exception) {
            invoke.reject("seal: ${e.message}")
        }
    }

    /** Sealed data opened; fails when it was changed or sealed with another key (another phone, a reinstall). */
    @Command
    fun open(invoke: Invoke) {
        try {
            val sealed = Base64.decode(invoke.parseArgs(SealArgs::class.java).data, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
            reply(invoke, cipher.doFinal(sealed, 12, sealed.size - 12))
        } catch (e: Exception) {
            invoke.reject("open: ${e.message}")
        }
    }
}
