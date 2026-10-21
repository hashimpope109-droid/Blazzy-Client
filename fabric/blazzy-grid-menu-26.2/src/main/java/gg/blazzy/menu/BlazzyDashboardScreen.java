package gg.blazzy.menu;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;

final class BlazzyDashboardScreen extends Screen {
    private static final int ORANGE = 0xFFFF7417;
    private static final int GREEN = 0xFF20C878;
    private static final int RED = 0xFFD94264;
    private static final int PAGE_SIZE = 12;
    private static final List<Module> MODULES = List.of(
        new Module("fps_boost", "FPS", "Performance preset", "⚡"),
        new Module("cps", "CPS", "Clicks per second", "◉"),
        new Module("keystrokes", "Keystrokes", "WASD input HUD", "⌨"),
        new Module("toggle_sprint", "Toggle Sprint", "Automatic sprint", "➜"),
        new Module("zoom", "Zoom", "Smooth camera zoom", "⌕"),
        new Module("armor_status", "Armor Status", "Equipment HUD", "◇"),
        new Module("ping", "Ping Display", "Network latency HUD", "↔"),
        new Module("coordinates", "Coordinates", "Position and biome HUD", "⌖"),
        new Module("combo", "Combo Counter", "Consecutive hits", "×"),
        new Module("potions", "Potion HUD", "Active effect timers", "+"),
        new Module("fullbright", "Fullbright", "Brighter worlds", "☀"),
        new Module("crosshair", "Crosshair", "Shape and hit colour", "+"),
        new Module("motion_blur", "Motion Blur", "Adjustable camera blur", "≈"),
        new Module("block_overlay", "Block Overlay", "Selection colour", "□"),
        new Module("damage_indicator", "Damage Indicator", "Combat health display", "♥"),
        new Module("waypoints", "Waypoints", "Saved world markers", "◆")
    );

    private final Screen parent;
    private final List<AbstractWidget> moduleButtons = new ArrayList<>();
    private int page;

    BlazzyDashboardScreen(Screen parent) {
        super(Component.literal("Blazzy Client"));
        this.parent = parent;
    }

    @Override
    protected void init() { rebuildButtons(); }

    private void rebuildButtons() {
        for (AbstractWidget widget : moduleButtons) removeWidget(widget);
        moduleButtons.clear();
        int panelWidth = Math.min(760, width - 30);
        int left = (width - panelWidth) / 2;
        int cardGap = 8;
        int cardWidth = (panelWidth - 32 - cardGap * 2) / 3;
        int pages = Math.max(1, (MODULES.size() + PAGE_SIZE - 1) / PAGE_SIZE);
        page = Math.max(0, Math.min(page, pages - 1));
        int start = page * PAGE_SIZE;
        int end = Math.min(MODULES.size(), start + PAGE_SIZE);
        for (int index = 0; index < end - start; index++) {
            Module module = MODULES.get(start + index);
            int x = left + 16 + (index % 3) * (cardWidth + cardGap);
            int y = 72 + (index / 3) * 82;
            Button button = Button.builder(Component.literal(BlazzyConfig.enabled(module.id) ? "ENABLED" : "DISABLED"), ignored -> {
                BlazzyConfig.toggle(module.id);
                rebuildButtons();
            }).pos(x + 8, y + 55).size(cardWidth - 16, 18).build();
            moduleButtons.add(addRenderableWidget(button));
        }
        int pagerY = Math.min(height - 30, 402);
        moduleButtons.add(addRenderableWidget(Button.builder(Component.literal("‹"), ignored -> { page--; rebuildButtons(); })
            .pos(left + panelWidth / 2 - 54, pagerY).size(24, 18).build()));
        moduleButtons.add(addRenderableWidget(Button.builder(Component.literal((page + 1) + " / " + pages), ignored -> {})
            .pos(left + panelWidth / 2 - 27, pagerY).size(54, 18).build()));
        moduleButtons.add(addRenderableWidget(Button.builder(Component.literal("›"), ignored -> { page++; rebuildButtons(); })
            .pos(left + panelWidth / 2 + 30, pagerY).size(24, 18).build()));
        moduleButtons.add(addRenderableWidget(Button.builder(Component.literal("X"), ignored -> onClose())
            .pos(left + panelWidth - 26, 18).size(20, 20).build()));
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        int panelWidth = Math.min(760, width - 30);
        int left = (width - panelWidth) / 2;
        graphics.fill(0, 0, width, height, 0xC8050609);
        graphics.fill(left, 8, left + panelWidth, Math.min(height - 6, 426), 0xF20B0C11);
        graphics.fill(left, 8, left + panelWidth, 11, ORANGE);
        graphics.text(font, Component.literal("BLAZZY CLIENT"), left + 16, 23, 0xFFFFFFFF, true);
        graphics.text(font, Component.literal("MODS"), left + 16, 46, ORANGE, false);
        graphics.text(font, Component.literal("SETTINGS"), left + 64, 46, 0xFF777982, false);
        graphics.text(font, Component.literal("WAYPOINTS"), left + 130, 46, 0xFF777982, false);
        int cardGap = 8;
        int cardWidth = (panelWidth - 32 - cardGap * 2) / 3;
        int start = page * PAGE_SIZE;
        int end = Math.min(MODULES.size(), start + PAGE_SIZE);
        for (int index = 0; index < end - start; index++) {
            Module module = MODULES.get(start + index);
            int x = left + 16 + (index % 3) * (cardWidth + cardGap);
            int y = 72 + (index / 3) * 82;
            boolean enabled = BlazzyConfig.enabled(module.id);
            graphics.fill(x, y, x + cardWidth, y + 76, 0xFF17181E);
            graphics.fill(x, y, x + 3, y + 76, enabled ? GREEN : RED);
            graphics.text(font, Component.literal(module.icon), x + 10, y + 9, enabled ? ORANGE : 0xFF9A9CA5, true);
            graphics.text(font, Component.literal(module.name), x + 30, y + 9, 0xFFFFFFFF, true);
            graphics.text(font, Component.literal(module.description), x + 10, y + 29, 0xFF8E9099, false);
            graphics.text(font, Component.literal("OPTIONS  ⚙"), x + cardWidth - 65, y + 43, 0xFF777982, false);
        }
        super.extractRenderState(graphics, mouseX, mouseY, delta);
    }

    @Override
    public void onClose() { minecraft.gui.setScreen(parent); }

    private record Module(String id, String name, String description, String icon) {}
}
