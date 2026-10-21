package gg.blazzy.menu;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.lwjgl.glfw.GLFW;

public final class BlazzyClientMod implements ClientModInitializer {
    private static KeyBinding openMenu;

    @Override
    public void onInitializeClient() {
        BlazzyConfig.load();
        openMenu = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "key.blazzy.open_menu",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_RIGHT_SHIFT,
            "key.categories.blazzy"
        ));
        ClientTickEvents.END_CLIENT_TICK.register(BlazzyClientMod::onEndTick);
    }

    private static void onEndTick(MinecraftClient client) {
        while (openMenu.wasPressed()) {
            client.setScreen(new BlazzyDashboardScreen(client.currentScreen));
        }
        if (client.player != null && BlazzyConfig.enabled("toggle_sprint")
            && client.options.forwardKey.isPressed() && !client.player.isSneaking()) {
            client.player.setSprinting(true);
        }
    }
}
