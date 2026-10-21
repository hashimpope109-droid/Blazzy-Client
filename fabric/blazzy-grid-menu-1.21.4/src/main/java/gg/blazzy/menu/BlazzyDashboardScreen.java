package gg.blazzy.menu;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;

import java.util.List;
import java.util.Locale;

final class BlazzyDashboardScreen extends Screen {
    private static final int ORANGE = 0xFFFF7417;
    private static final int GREEN = 0xFF20C878;
    private static final int RED = 0xFFD94264;
    private static final List<Module> MODULES = List.of(
        new Module("fps_boost", "FPS", "Performance preset", "⚡"),
        new Module("cps", "CPS", "Clicks per second", "◉"),
        new Module("keystrokes", "Keystrokes", "WASD input HUD", "⌨"),
        new Module("toggle_sprint", "Toggle Sprint", "Automatic sprint", "➜"),
        new Module("zoom", "Zoom", "Smooth camera zoom", "⌕"),
        new Module("hypixel", "Hypixel Mods", "Server utilities", "H"),
        new Module("armor_status", "Armor Status", "Equipment HUD", "◇"),
        new Module("apple_skin", "AppleSkin", "Food saturation HUD", "●"),
        new Module("better_f3", "BetterF3", "Clean debug screen", "F3"),
        new Module("fullbright", "Fullbright", "Brighter worlds", "☀"),
        new Module("iris", "Iris Shaders", "Shader controls", "◈"),
        new Module("dynamic_fps", "Dynamic FPS", "Idle FPS saver", "▥")
    );

    private final Screen parent;
    private TextFieldWidget search;
    private String filter = "";

    BlazzyDashboardScreen(Screen parent) {
        super(Text.literal("Blazzy Client"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        clearChildren();
        int panelWidth = Math.min(760, width - 30);
        int left = (width - panelWidth) / 2;
        search = new TextFieldWidget(textRenderer, left + panelWidth - 184, 18, 150, 20, Text.literal("Search modules"));
        search.setPlaceholder(Text.literal("Search modules..."));
        search.setText(filter);
        search.setChangedListener(value -> {
            filter = value;
            rebuildCards();
        });
        addDrawableChild(search);
        rebuildCards();
    }

    private void rebuildCards() {
        children().stream().filter(child -> child instanceof ButtonWidget).toList().forEach(this::remove);
        int panelWidth = Math.min(760, width - 30);
        int left = (width - panelWidth) / 2;
        int cardGap = 8;
        int cardWidth = (panelWidth - 32 - cardGap * 2) / 3;
        int index = 0;
        String query = filter.trim().toLowerCase(Locale.ROOT);
        for (Module module : MODULES) {
            if (!query.isEmpty() && !module.name.toLowerCase(Locale.ROOT).contains(query)) continue;
            int col = index % 3;
            int row = index / 3;
            int x = left + 16 + col * (cardWidth + cardGap);
            int y = 72 + row * 82;
            boolean enabled = BlazzyConfig.enabled(module.id);
            addDrawableChild(ButtonWidget.builder(
                Text.literal(enabled ? "ENABLED" : "DISABLED"),
                button -> {
                    BlazzyConfig.toggle(module.id);
                    rebuildCards();
                }
            ).position(x + 8, y + 55).size(cardWidth - 16, 18).build());
            index++;
        }
        addDrawableChild(ButtonWidget.builder(Text.literal("X"), button -> close())
            .position(left + panelWidth - 26, 18).size(20, 20).build());
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        context.fill(0, 0, width, height, 0xC8050609);
        int panelWidth = Math.min(760, width - 30);
        int left = (width - panelWidth) / 2;
        int bottom = Math.min(height - 12, 72 + 4 * 82);
        context.fill(left, 8, left + panelWidth, bottom, 0xF20B0C11);
        context.fill(left, 8, left + panelWidth, 11, ORANGE);
        context.drawTextWithShadow(textRenderer, Text.literal("BLAZZY CLIENT"), left + 16, 23, 0xFFFFFFFF);
        context.drawText(textRenderer, Text.literal("MODS"), left + 16, 46, ORANGE, false);
        context.drawText(textRenderer, Text.literal("SETTINGS"), left + 64, 46, 0xFF777982, false);
        context.drawText(textRenderer, Text.literal("WAYPOINTS"), left + 130, 46, 0xFF777982, false);

        int cardGap = 8;
        int cardWidth = (panelWidth - 32 - cardGap * 2) / 3;
        int index = 0;
        String query = filter.trim().toLowerCase(Locale.ROOT);
        for (Module module : MODULES) {
            if (!query.isEmpty() && !module.name.toLowerCase(Locale.ROOT).contains(query)) continue;
            int col = index % 3;
            int row = index / 3;
            int x = left + 16 + col * (cardWidth + cardGap);
            int y = 72 + row * 82;
            boolean enabled = BlazzyConfig.enabled(module.id);
            boolean hovered = mouseX >= x && mouseX < x + cardWidth && mouseY >= y && mouseY < y + 76;
            context.fill(x, y, x + cardWidth, y + 76, hovered ? 0xFF22242C : 0xFF17181E);
            context.fill(x, y, x + 3, y + 76, enabled ? GREEN : RED);
            context.drawTextWithShadow(textRenderer, Text.literal(module.icon), x + 10, y + 9, enabled ? ORANGE : 0xFF9A9CA5);
            context.drawTextWithShadow(textRenderer, Text.literal(module.name), x + 30, y + 9, 0xFFFFFFFF);
            context.drawText(textRenderer, Text.literal(module.description), x + 10, y + 29, 0xFF8E9099, false);
            context.drawText(textRenderer, Text.literal("OPTIONS  ⚙"), x + cardWidth - 65, y + 43, 0xFF777982, false);
            index++;
        }
        super.render(context, mouseX, mouseY, delta);
    }

    @Override
    public void close() {
        if (client != null) client.setScreen(parent);
    }

    private record Module(String id, String name, String description, String icon) {}
}
