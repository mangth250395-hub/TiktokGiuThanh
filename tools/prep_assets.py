"""Copies the pictures the game uses out of the "Tiny Swords" packs (assets_src/) into web/public/ts/.

Two packs by Pixel Frog (https://pixelfrog-assets.itch.io/tiny-swords): the current free pack, and the old version
(CC0). Run again after changing what the game uses:  python tools/prep_assets.py
"""
import os
import shutil

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEW = os.path.join(ROOT, "assets_src", "tiny-swords", "Tiny Swords (Free Pack)")
OLD = os.path.join(ROOT, "assets_src", "tiny-swords-old", "Tiny Swords (Update 010)")
OUT = os.path.join(ROOT, "web", "public", "ts")


def cp(src, dst):
    os.makedirs(os.path.dirname(os.path.join(OUT, dst)), exist_ok=True)
    shutil.copyfile(src, os.path.join(OUT, dst))


def stitch(src, dst, xs, ys, size=64):
    """The pieces of a 9-slice (or 3-slice) drawn apart in the pack, put side by side."""
    im = Image.open(src).convert("RGBA")
    out = Image.new("RGBA", (size * len(xs), size * len(ys)), (0, 0, 0, 0))
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            out.alpha_composite(im.crop((x, y, x + size, y + size)), (i * size, j * size))
    os.makedirs(os.path.dirname(os.path.join(OUT, dst)), exist_ok=True)
    out.save(os.path.join(OUT, dst))


def trimmed(src, dst, pad=4):
    im = Image.open(src).convert("RGBA")
    x0, y0, x1, y1 = im.getbbox()
    side = max(x1 - x0, y1 - y0) + pad * 2
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.alpha_composite(im.crop((x0, y0, x1, y1)), ((side - (x1 - x0)) // 2, (side - (y1 - y0)) // 2))
    os.makedirs(os.path.dirname(os.path.join(OUT, dst)), exist_ok=True)
    out.save(os.path.join(OUT, dst))


def strip(src, dst, row, n, size=192):
    """One row of a sheet of several rows, as a sheet of its own (the game draws rows of frames)."""
    im = Image.open(src).convert("RGBA")
    os.makedirs(os.path.dirname(os.path.join(OUT, dst)), exist_ok=True)
    im.crop((0, row * size, n * size, (row + 1) * size)).save(os.path.join(OUT, dst))


def main():
    units = os.path.join(NEW, "Units")
    for colour in ["Blue", "Red", "Yellow"]:
        c, u = colour.lower(), os.path.join(units, f"{colour} Units")
        for name, src in [("warrior_idle", "Warrior/Warrior_Idle"), ("warrior_run", "Warrior/Warrior_Run"), ("warrior_attack", "Warrior/Warrior_Attack1"),
                          ("warrior_attack2", "Warrior/Warrior_Attack2"), ("lancer_idle", "Lancer/Lancer_Idle"), ("lancer_run", "Lancer/Lancer_Run"),
                          ("lancer_attack", "Lancer/Lancer_Right_Attack")]:
            cp(os.path.join(u, src + ".png"), f"{c}/{name}.png")
        if colour == "Yellow":
            continue
        for name, src in [("pawn_idle", "Pawn/Pawn_Idle Hammer"), ("pawn_run", "Pawn/Pawn_Run Hammer"), ("pawn_attack", "Pawn/Pawn_Interact Hammer"),
                          ("pawnaxe_idle", "Pawn/Pawn_Idle Axe"), ("pawnaxe_run", "Pawn/Pawn_Run Axe"), ("pawnaxe_attack", "Pawn/Pawn_Interact Axe"),
                          ("pawnknife_idle", "Pawn/Pawn_Idle Knife"), ("pawnknife_run", "Pawn/Pawn_Run Knife"), ("pawnknife_attack", "Pawn/Pawn_Interact Knife"),
                          ("pawnpick_idle", "Pawn/Pawn_Idle Pickaxe"), ("pawnpick_run", "Pawn/Pawn_Run Pickaxe"), ("pawnpick_attack", "Pawn/Pawn_Interact Pickaxe"),
                          ("archer_idle", "Archer/Archer_Idle"), ("archer_run", "Archer/Archer_Run"), ("archer_attack", "Archer/Archer_Shoot"), ("arrow", "Archer/Arrow"),
                          ("monk_idle", "Monk/Idle"), ("monk_run", "Monk/Run"), ("monk_attack", "Monk/Heal")]:
            cp(os.path.join(u, src + ".png"), f"{c}/{name}.png")
        b = os.path.join(NEW, "Buildings", f"{colour} Buildings")
        for f in ["Castle", "Tower", "Barracks", "House1", "House2", "House3", "Archery", "Monastery"]:
            cp(os.path.join(b, f + ".png"), f"{c}/{f.lower()}.png")
    cp(os.path.join(units, "Blue Units", "Monk", "Heal_Effect.png"), "fx/heal.png")
    for f in ["Dust_01", "Dust_02", "Explosion_01", "Explosion_02", "Fire_01", "Fire_02", "Fire_03"]:
        cp(os.path.join(NEW, "Particle FX", f + ".png"), f"fx/{f.lower()}.png")
    t = os.path.join(NEW, "Terrain")
    cp(os.path.join(t, "Tileset", "Tilemap_color1.png"), "deco/tiles.png")
    for i in range(1, 5):
        cp(os.path.join(t, "Resources", "Wood", "Trees", f"Tree{i}.png"), f"deco/tree{i}.png")
        cp(os.path.join(t, "Decorations", "Bushes", f"Bushe{i}.png"), f"deco/bush{i}.png")
        cp(os.path.join(t, "Decorations", "Rocks", f"Rock{i}.png"), f"deco/rock{i}.png")
    for i, n in enumerate(["01", "03", "06"], 1):
        cp(os.path.join(t, "Decorations", "Clouds", f"Clouds_{n}.png"), f"deco/cloud{i}.png")
    cp(os.path.join(t, "Resources", "Meat", "Sheep", "Sheep_Idle.png"), "deco/sheep.png")
    cp(os.path.join(t, "Resources", "Meat", "Sheep", "Sheep_Grass.png"), "deco/sheep_grass.png")
    cp(os.path.join(t, "Resources", "Gold", "Gold Resource", "Gold_Resource.png"), "deco/gold.png")

    # ---- the old pack (CC0): the fallen, ruins, wooden towers, thatched houses, small things on the ground ----
    k = os.path.join(OLD, "Factions", "Knights")
    cp(os.path.join(k, "Troops", "Dead", "Dead.png"), "fx/dead.png")
    cp(os.path.join(k, "Buildings", "Castle", "Castle_Destroyed.png"), "old/castle_destroyed.png")
    cp(os.path.join(k, "Buildings", "Tower", "Tower_Destroyed.png"), "old/tower_destroyed.png")
    cp(os.path.join(k, "Buildings", "House", "House_Blue.png"), "old/house_blue.png")
    cp(os.path.join(k, "Buildings", "House", "House_Red.png"), "old/house_red.png")
    g = os.path.join(OLD, "Factions", "Goblins", "Buildings")
    cp(os.path.join(g, "Wood_Tower", "Wood_Tower_Red.png"), "old/woodtower_red.png")
    cp(os.path.join(g, "Wood_House", "Goblin_House.png"), "old/tent.png")
    for i in range(1, 19):
        cp(os.path.join(OLD, "Deco", f"{i:02d}.png"), f"old/deco{i:02d}.png")
    # the two giants of the match of fury: the hooded goblin with a torch, in the colour of each team
    for colour in ["Blue", "Red"]:
        t = os.path.join(OLD, "Factions", "Goblins", "Troops", "Torch", colour, f"Torch_{colour}.png")
        c = colour.lower()
        strip(t, f"old/giant_{c}_idle.png", 0, 7)
        face = Image.open(t).convert("RGBA").crop((58, 52, 134, 128))        # the hood and the eyes, for the bar of its strength
        os.makedirs(os.path.join(OUT, "ui"), exist_ok=True)
        face.save(os.path.join(OUT, "ui", f"giant_{c}.png"))
        strip(t, f"old/giant_{c}_attack.png", 2, 6)       # a swing of fire to the side
    ui_old = os.path.join(OLD, "UI")
    cp(os.path.join(ui_old, "Banners", "Carved_9Slides.png"), "ui/parchment.png")
    for colour in ["Blue", "Red", "Yellow"]:
        cp(os.path.join(ui_old, "Ribbons", f"Ribbon_{colour}_3Slides.png"), f"ui/ribbon_{colour.lower()}.png")

    # ---- the panels of the current pack ----
    ui = os.path.join(NEW, "UI Elements", "UI Elements")
    three = [0, 128, 256]
    stitch(os.path.join(ui, "Papers", "SpecialPaper.png"), "ui/slate.png", three, three)
    stitch(os.path.join(ui, "Papers", "RegularPaper.png"), "ui/paper.png", three, three)
    stitch(os.path.join(ui, "Buttons", "BigBlueButton_Regular.png"), "ui/btn_blue.png", three, three)
    stitch(os.path.join(ui, "Buttons", "BigRedButton_Regular.png"), "ui/btn_red.png", three, three)
    stitch(os.path.join(ui, "Bars", "BigBar_Base.png"), "ui/bar.png", three, [0])
    cp(os.path.join(ui, "Bars", "BigBar_Fill.png"), "ui/bar_fill.png")
    cp(os.path.join(ui, "Wood Table", "WoodTable_Slots.png"), "ui/wood.png")
    for n, name in [("05", "sword"), ("06", "shield"), ("01", "hammer"), ("02", "wood"), ("03", "coin"), ("07", "up")]:
        cp(os.path.join(ui, "Icons", f"Icon_{n}.png"), f"ui/icon_{name}.png")
    # the faces of the kinds of character: 5 colours x (warrior, lancer, archer, monk, pawn)
    for ci, colour in enumerate(["blue", "red", "yellow"]):
        for j, kind in enumerate(["warrior", "lancer", "archer", "monk", "pawn"]):
            trimmed(os.path.join(ui, "Human Avatars", f"Avatars_{ci * 5 + j + 1:02d}.png"), f"ui/face_{colour}_{kind}.png")
    n = sum(len(fs) for _, _, fs in os.walk(OUT))
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    print(f"{n} files, {size // 1024} KB in {OUT}")


if __name__ == "__main__":
    main()
