package io.github.lyjsyyds.novelstudio;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryNotEmptyException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;

@CapacitorPlugin(name = "NovelNative")
public class NovelNative extends Plugin {
    private static final int LIMIT = 64 * 1024 * 1024;
    private static final String KEY_ALIAS = "novel-studio-model-key";
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private final ExecutorService network = Executors.newCachedThreadPool();
    private final Map<String, ProviderRequest> providers = new ConcurrentHashMap<>();
    private Path root;

    @Override
    public void load() {
        root = getContext().getFilesDir().toPath().resolve("studio");
        try {
            for (String directory : new String[]{"library", "settings", "transfer"}) {
                Files.createDirectories(root.resolve(directory));
            }
        } catch (IOException error) {
            throw new IllegalStateException("无法打开应用数据目录。", error);
        }
    }

    @PluginMethod
    public void invoke(PluginCall call) {
        String action = call.getString("action", "");
        switch (action) {
            case "openFile":
            case "saveFile":
                pickDocument(call, action.equals("saveFile"));
                return;
            case "providerStart": {
                String id = call.getString("id", "");
                ProviderRequest request = new ProviderRequest();
                providers.put(id, request);
                String scope = call.getString("scope", "default");
                URL address;
                JSObject body = call.getObject("body", new JSObject());
                try {
                    address = providerAddress(call.getString("address", ""), scope, "chat/completions");
                    String model = body.optString("model");
                    if ("openrouter".equals(scope) && !"openrouter/free".equals(model) && !model.matches("[\\w.-]+/[\\w.-]+:free")) {
                        throw new IOException("此入口仅调用免费模型。");
                    }
                } catch (IOException error) {
                    providers.remove(id);
                    call.reject(error.getMessage());
                    return;
                }
                network.execute(() -> runProvider(id, request, address, body.toString(), scope));
                call.resolve();
                return;
            }
            case "providerCancel": {
                ProviderRequest request = providers.get(call.getString("id", ""));
                if (request != null) request.cancel();
                call.resolve();
                return;
            }
            case "providerModels":
                network.execute(() -> listModels(call));
                return;
            case "external":
                try {
                    Uri url = Uri.parse(call.getString("url", ""));
                    if ("https".equals(url.getScheme()) || "http".equals(url.getScheme())) {
                        getActivity().startActivity(new Intent(Intent.ACTION_VIEW, url));
                    }
                    call.resolve();
                } catch (Exception error) {
                    call.reject(error.getMessage());
                }
                return;
            default:
                files.execute(() -> work(call, action));
        }
    }

    private void work(PluginCall call, String action) {
        try {
            JSObject result = new JSObject();
            switch (action) {
                case "files": result = operate(call); break;
                case "secretStatus": result.put("configured", !modelSecret(call.getString("scope", "default")).isEmpty()); break;
                case "secretSet": storeSecret(call.getString("value", ""), call.getString("scope", "default")); break;
                default: throw new IOException("未知操作。");
            }
            call.resolve(result);
        } catch (Exception error) {
            if ("files".equals(action)) {
                String code = error instanceof NoSuchFileException ? "ENOENT"
                    : error instanceof FileAlreadyExistsException ? "EEXIST"
                    : error instanceof DirectoryNotEmptyException ? "ENOTEMPTY" : "EIO";
                call.resolve(new JSObject().put("code", code).put("message", error.getMessage()));
            } else {
                call.reject(error.getMessage());
            }
        }
    }

    private Path fileAt(String name) throws IOException {
        if (name == null || !name.matches("/(?:library|settings|transfer)(?:/.*)?") || name.contains("\\") || name.contains(":")) {
            throw new IOException("文件位置无效。");
        }
        Path current = root;
        for (String part : name.substring(1).split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new IOException("文件位置无效。");
            current = current.resolve(part);
            if (Files.isSymbolicLink(current)) throw new IOException("应用数据中不能包含符号链接。");
        }
        return current;
    }

    private JSObject operate(PluginCall call) throws IOException {
        String name = call.getString("path");
        Path target = fileAt(name);
        switch (call.getString("op", "")) {
            case "list": {
                JSArray array = new JSArray();
                try (var listing = Files.newDirectoryStream(target)) {
                    for (Path child : listing) {
                        if (Files.isSymbolicLink(child)) continue;
                        array.put(new JSObject().put("name", child.getFileName().toString())
                            .put("directory", Files.isDirectory(child, LinkOption.NOFOLLOW_LINKS)));
                    }
                }
                return new JSObject().put("entries", array);
            }
            case "stat": {
                BasicFileAttributes info = Files.readAttributes(target, BasicFileAttributes.class);
                return new JSObject().put("directory", info.isDirectory()).put("size", info.size())
                    .put("mtimeMs", info.lastModifiedTime().toMillis());
            }
            case "read":
                try (InputStream in = Files.newInputStream(target)) {
                    return new JSObject().put("base64", encode(readBounded(in)));
                }
            case "write": {
                byte[] content = Base64.decode(call.getString("base64", ""), Base64.DEFAULT);
                if (content.length > LIMIT) throw new IOException("文件超过 64 MB。");
                atomicWrite(target, content);
                break;
            }
            case "mkdir":
                if (Boolean.TRUE.equals(call.getBoolean("recursive"))) Files.createDirectories(target);
                else Files.createDirectory(target);
                break;
            case "rename":
                Files.move(target, fileAt(call.getString("to")), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                break;
            case "copy":
                Files.copy(target, fileAt(call.getString("to")), StandardCopyOption.REPLACE_EXISTING);
                break;
            case "remove":
                if (!name.substring(1).contains("/")) throw new IOException("不能删除应用数据根目录。");
                if (Boolean.TRUE.equals(call.getBoolean("force")) && !Files.exists(target)) break;
                if (Boolean.TRUE.equals(call.getBoolean("recursive"))) {
                    try (var walk = Files.walk(target)) {
                        for (Path child : walk.sorted(Comparator.reverseOrder()).toArray(Path[]::new)) Files.delete(child);
                    }
                } else Files.delete(target);
                break;
            default: throw new IOException("未知文件操作。");
        }
        return new JSObject();
    }

    private void atomicWrite(Path path, byte[] bytes) throws IOException {
        Path pending = Files.createTempFile(path.getParent(), ".pending-", ".tmp");
        try {
            Files.write(pending, bytes);
            Files.move(pending, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(pending);
        }
    }

    private static byte[] readBounded(InputStream input) throws IOException {
        if (input == null) throw new IOException("无法读取文件。");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] chunk = new byte[16384];
        int count;
        while ((count = input.read(chunk)) != -1) {
            if (output.size() + count > LIMIT) throw new IOException("文件超过 64 MB。");
            output.write(chunk, 0, count);
        }
        return output.toByteArray();
    }

    private static String encode(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    private void pickDocument(PluginCall call, boolean save) {
        Intent intent = new Intent(save ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(save ? "application/octet-stream" : "*/*");
        if (save) intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "Novel Studio.zip"));
        startActivityForResult(call, intent, "onDocument");
    }

    @ActivityCallback
    private void onDocument(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.resolve(new JSObject().put("canceled", true));
            return;
        }
        files.execute(() -> {
            try {
                var resolver = getContext().getContentResolver();
                if ("saveFile".equals(call.getString("action"))) {
                    try (var stream = resolver.openOutputStream(uri, "wt")) {
                        if (stream == null) throw new IOException("无法写入所选文件。");
                        stream.write(Base64.decode(call.getString("base64", ""), Base64.DEFAULT));
                    }
                    call.resolve(new JSObject().put("name", call.getString("name")));
                } else {
                    String name = "作品";
                    try (var cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                    }
                    try (var stream = resolver.openInputStream(uri)) {
                        call.resolve(new JSObject().put("name", name).put("base64", encode(readBounded(stream))));
                    }
                }
            } catch (Exception error) {
                call.reject(error.getMessage());
            }
        });
    }

    private synchronized SecretKey key() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        if (keys.containsAlias(KEY_ALIAS)) return (SecretKey) keys.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    private Path secretFile(String scope) throws IOException {
        return switch (scope) {
            case "default" -> root.resolve("model-key.bin");
            case "openrouter" -> root.resolve("openrouter-key.bin");
            default -> throw new IOException("未知的密钥配置。");
        };
    }

    private URL providerAddress(String input, String scope, String endpoint) throws IOException {
        secretFile(scope);
        URL address = new URL(input);
        if (!"https".equals(address.getProtocol()) || address.getUserInfo() != null || address.getQuery() != null || address.getRef() != null) {
            throw new IOException("模型接口需使用 HTTPS。");
        }
        if ("openrouter".equals(scope) && !("https://openrouter.ai/api/v1/" + endpoint).equals(address.toString())) {
            throw new IOException("免费模型需使用 OpenRouter 官方端点。");
        }
        return address;
    }

    private String modelSecret(String scope) throws Exception {
        Path path = secretFile(scope);
        if (!Files.exists(path)) return "";
        byte[] bytes = Files.readAllBytes(path);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOf(bytes, 12)));
        return new String(cipher.doFinal(bytes, 12, bytes.length - 12), StandardCharsets.UTF_8);
    }

    private void storeSecret(String value, String scope) throws Exception {
        Path path = secretFile(scope);
        if (value.isEmpty()) {
            Files.deleteIfExists(path);
            return;
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.write(cipher.getIV());
        output.write(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        atomicWrite(path, output.toByteArray());
    }

    private static class ProviderRequest {
        private volatile HttpURLConnection connection;
        private volatile boolean canceled;

        void cancel() {
            canceled = true;
            if (connection != null) connection.disconnect();
        }
    }

    private void emit(String id, JSObject data) {
        notifyListeners("provider", data.put("id", id));
    }

    private void listModels(PluginCall call) {
        HttpURLConnection connection = null;
        try {
            String scope = call.getString("scope", "default");
            URL address = providerAddress(call.getString("address", ""), scope, "models");
            connection = (HttpURLConnection) address.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(16000);
            connection.setReadTimeout(18000);
            String candidateKey = call.getString("value", "");
            connection.setRequestProperty("Authorization", "Bearer " + (candidateKey.isEmpty() ? modelSecret(scope) : candidateKey));
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException("模型列表返回 HTTP " + status);
            try (var in = connection.getInputStream()) {
                JSONArray models = new JSObject(new String(readBounded(in), StandardCharsets.UTF_8)).optJSONArray("data");
                if (models == null) throw new IOException("接口没有返回模型列表。");
                JSArray limited = new JSArray();
                for (int i = 0; i < models.length() && limited.length() < 1000; i++) {
                    var entry = models.optJSONObject(i);
                    if (entry != null && (!"openrouter".equals(scope) || entry.optString("id").endsWith(":free"))) limited.put(entry);
                }
                call.resolve(new JSObject().put("models", limited));
            }
        } catch (Exception error) {
            call.reject(error.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void runProvider(String id, ProviderRequest request, URL address, String body, String scope) {
        try {
            HttpURLConnection connection = (HttpURLConnection) address.openConnection();
            request.connection = connection;
            if (request.canceled) return;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(120000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + modelSecret(scope));
            try (var out = connection.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException(status == 429
                ? "当前服务额度用完或调用过快。请稍后重试。" : "模型接口返回 HTTP " + status);
            if (connection.getContentType() == null || !connection.getContentType().contains("text/event-stream")) {
                throw new IOException("模型接口没有返回 SSE 流。");
            }
            try (var in = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while (!request.canceled && (line = in.readLine()) != null) {
                    emit(id, new JSObject().put("chunk", line + "\n"));
                }
            }
            emit(id, new JSObject().put("done", true));
        } catch (Exception error) {
            emit(id, new JSObject().put("error", request.canceled ? "已取消" : error.getMessage()));
        } finally {
            if (request.connection != null) request.connection.disconnect();
            providers.remove(id, request);
        }
    }
}
