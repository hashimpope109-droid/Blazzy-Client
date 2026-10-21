package gg.blazzy.menu;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import org.lwjgl.glfw.GLFW;

public final class BlazzyClientMod implements ClientModInitializer {
    private static KeyMapping openMenu;

    @Override
    public void onInitializeClient() {
        BlazzyConfig.load();
        openMenu = KeyMappingHelper.registerKeyMapping(new KeyMapping(
            "key.blazzy.open_menu",
            InputConstants.Type.KEYSYM,
            GLFW.GLFW_KEY_RIGHT_SHIFT,
            KeyMapping.Category.MISC
        ));
        ClientTickEvents.END_CLIENT_TICK.register(BlazzyClientMod::onEndTick);
    }

    private static void onEndTick(Minecraft minecraft) {
        while (openMenu.consumeClick()) {
            minecraft.gui.setScreen(new BlazzyDashboardScreen(minecraft.gui.screen()));
        }
    }
}
