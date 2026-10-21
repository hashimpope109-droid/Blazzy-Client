package gg.blazzy.menu;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.lang.reflect.Type;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

final class BlazzyConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Type TYPE = new TypeToken<LinkedHashMap<String, Boolean>>() {}.getType();
    private static final Path PATH = FabricLoader.getInstance().getConfigDir().resolve("blazzy-modules.json");
    private static Map<String, Boolean> modules = defaults();

    private static Map<String, Boolean> defaults() {
        Map<String, Boolean> values = new LinkedHashMap<>();
        values.put("fps_boost", true);
        values.put("cps", false);
        values.put("keystrokes", true);
        values.put("toggle_sprint", true);
        values.put("zoom", true);
        values.put("hypixel", false);
        values.put("armor_status", true);
        values.put("apple_skin", true);
        values.put("better_f3", true);
        values.put("fullbright", false);
        values.put("iris", true);
        values.put("dynamic_fps", true);
        return values;
    }

    static void load() {
        try {
            if (Files.isRegularFile(PATH)) {
                Map<String, Boolean> loaded = GSON.fromJson(Files.readString(PATH), TYPE);
                if (loaded != null) modules.putAll(loaded);
            }
        } catch (Exception ignored) {
        }
        save();
    }

    static boolean enabled(String id) {
        return modules.getOrDefault(id, false);
    }

    static void toggle(String id) {
        modules.put(id, !enabled(id));
        save();
    }

    private static void save() {
        try {
            Files.createDirectories(PATH.getParent());
            Files.writeString(PATH, GSON.toJson(modules));
        } catch (IOException ignored) {
        }
    }
}
