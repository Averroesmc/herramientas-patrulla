"""
Prepara los sprites generados con IA (arte/sprites/*.png) para el overlay: public/arte/sprites/<nombre>.png.

- Quita el fondo magenta liso (#FF00FF) con un borde suave.
- Las hojas con varias poses (héroe, enemigos) se trocean y se juntan en una tira de celdas iguales, con
  los pies alineados abajo, a la altura con la que se ven en la barra.
- La taberna (una sola imagen) se recorta al contenido.

Uso (desde la raíz del repo):  python scripts/preparar-sprites.py
Necesita Pillow:               pip install pillow
"""
from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "arte" / "sprites"
DESTINO = RAIZ / "public" / "arte" / "sprites"

# Imágenes sueltas: nombre -> ancho final en píxeles de la escena de 1920 (el alto sale de la proporción).
SUELTOS = {"taberna": 150}

# Filas de arriba (del original) que se borran: el humo de la chimenea va animado en el juego.
CORTE_ARRIBA = {"taberna": 228}

# Hojas de poses: nombre -> (cuántas poses, alto final en píxeles de la escena).
# El número de poses y estas alturas están también en src/overlay/sprites.ts.
HOJAS = {
    "heroe": (4, 56),       # parado, paso, paso contrario, ataque
    "slime": (2, 40),
    "murcielago": (2, 46),
    "seta": (2, 60),
    "goblin": (2, 66),
    "esqueleto": (2, 76),
}


def quitar_magenta(im: Image.Image) -> Image.Image:
    """Alfa según lo lejos que está cada píxel del magenta: 0 si es magenta, 255 si no se parece."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            d = ((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) ** 0.5
            if d < 90:
                px[x, y] = (r, g, b, 0)
            elif d < 150:
                a = int(255 * (d - 90) / 60)
                k = 1 - a / 255  # quita el tinte rosa del borde para que no quede un halo
                px[x, y] = (max(0, int(r - 255 * k * 0.6)), g, max(0, int(b - 255 * k * 0.6)), a)
    return im


def grupos_de_columnas(im: Image.Image, n: int) -> list[tuple[int, int]]:
    """Los tramos de columnas con dibujo, separados por huecos vacíos. Si no salen n, se reparte a partes iguales."""
    alfa = im.getchannel("A").point(lambda a: 255 if a > 40 else 0)
    ancho, alto = alfa.size
    datos = alfa.load()
    ocupada = [any(datos[x, y] for y in range(alto)) for x in range(ancho)]
    tramos, ini = [], None
    for x, o in enumerate(ocupada + [False]):
        if o and ini is None:
            ini = x
        elif not o and ini is not None:
            tramos.append((ini, x))
            ini = None
    # Une los tramos separados por huecos pequeños (una espada o un ala suelta) y quita las motas.
    unidos: list[tuple[int, int]] = []
    for t in tramos:
        if unidos and t[0] - unidos[-1][1] < 24:
            unidos[-1] = (unidos[-1][0], t[1])
        else:
            unidos.append(t)
    unidos = [t for t in unidos if t[1] - t[0] > 20]
    if len(unidos) == n:
        return unidos
    print(f"  aviso: {len(unidos)} tramos en vez de {n}; se reparte a partes iguales")
    return [(round(i * ancho / n), round((i + 1) * ancho / n)) for i in range(n)]


def hoja(nombre: str, n: int, alto_final: int):
    origen = ORIGEN / f"{nombre}.png"
    if not origen.exists():
        print("falta", origen)
        return
    im = quitar_magenta(Image.open(origen))
    cajas = []
    for x0, x1 in grupos_de_columnas(im, n):
        poses = im.crop((x0, 0, x1, im.height))
        caja = poses.getchannel("A").point(lambda a: 255 if a > 40 else 0).getbbox()
        cajas.append(poses.crop(caja))
    alto = max(c.height for c in cajas)
    ancho = max(c.width for c in cajas)
    escala = alto_final / alto
    celda_w = max(1, round(ancho * escala))
    tira = Image.new("RGBA", (celda_w * n, alto_final), (0, 0, 0, 0))
    for i, c in enumerate(cajas):
        p = c.resize((max(1, round(c.width * escala)), max(1, round(c.height * escala))), Image.LANCZOS)
        # Centrada en su celda y con los pies (el borde de abajo) alineados.
        tira.alpha_composite(p, (i * celda_w + (celda_w - p.width) // 2, alto_final - p.height))
    destino = DESTINO / f"{nombre}.png"
    tira.save(destino, optimize=True)
    print(destino.name, f"{n} poses de {celda_w}x{alto_final}")


def suelto(nombre: str, ancho: int):
    origen = ORIGEN / f"{nombre}.png"
    if not origen.exists():
        print("falta", origen)
        return
    im = quitar_magenta(Image.open(origen))
    corte = CORTE_ARRIBA.get(nombre, 0)
    if corte:
        im.paste((0, 0, 0, 0), (0, 0, im.width, corte))
    caja = im.getchannel("A").point(lambda a: 255 if a > 40 else 0).getbbox()
    im = im.crop(caja)
    im = im.resize((ancho, round(im.height * ancho / im.width)), Image.LANCZOS)
    destino = DESTINO / f"{nombre}.png"
    im.save(destino, optimize=True)
    print(destino.name, im.size)


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    for nombre, ancho in SUELTOS.items():
        suelto(nombre, ancho)
    for nombre, (n, alto) in HOJAS.items():
        hoja(nombre, n, alto)


if __name__ == "__main__":
    main()
