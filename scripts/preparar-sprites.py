"""
Prepara los sprites generados con IA (arte/sprites/*.png) para el overlay: public/arte/sprites/<nombre>.png.

Quita el fondo magenta liso (#FF00FF) con un borde suave, recorta al contenido y reduce al ancho que
tendrá en la barra.

Uso (desde la raíz del repo):  python scripts/preparar-sprites.py
Necesita Pillow:               pip install pillow
"""
from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "arte" / "sprites"
DESTINO = RAIZ / "public" / "arte" / "sprites"

# nombre -> ancho final en píxeles de la escena de 1920 (el alto sale de la proporción)
SPRITES = {
    "taberna": 150,
}


def quitar_magenta(im: Image.Image) -> Image.Image:
    """Alfa según lo lejos que está cada píxel del magenta: 0 si es magenta, 255 si no se parece."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            # Distancia al magenta: el verde manda (el magenta tiene g=0; casi nada del juego es rosa fuerte).
            d = ((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) ** 0.5
            if d < 90:
                px[x, y] = (r, g, b, 0)
            elif d < 150:
                a = int(255 * (d - 90) / 60)
                # Quita el tinte rosa del borde para que no quede un halo.
                k = 1 - a / 255
                px[x, y] = (max(0, int(r - 255 * k * 0.6)), g, max(0, int(b - 255 * k * 0.6)), a)
    return im


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    for nombre, ancho in SPRITES.items():
        origen = ORIGEN / f"{nombre}.png"
        if not origen.exists():
            print("falta", origen)
            continue
        im = quitar_magenta(Image.open(origen))
        caja = im.getchannel("A").point(lambda a: 255 if a > 40 else 0).getbbox()
        im = im.crop(caja)
        alto = round(im.height * ancho / im.width)
        im = im.resize((ancho, alto), Image.LANCZOS)
        destino = DESTINO / f"{nombre}.png"
        im.save(destino, optimize=True)
        print(destino.name, im.size, "caja original", caja)


if __name__ == "__main__":
    main()
