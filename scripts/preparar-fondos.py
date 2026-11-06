"""
Prepara los fondos generados con IA (arte/fondos/*.png) para el overlay: public/arte/fondos/<n>.png.

Cada fondo se reduce, se recorta a la franja de la barra (BAND px de alto, con la superficie del suelo a
GROUND px del borde de abajo, que es donde pisan los héroes) y se hace repetible: los bordes izquierdo y
derecho se mezclan para que al ponerlos uno al lado del otro no se note el corte.

Uso (desde la raíz del repo):  python scripts/preparar-fondos.py
Necesita Pillow:               pip install pillow
"""
from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "arte" / "fondos"
DESTINO = RAIZ / "public" / "arte" / "fondos"

BAND = 120      # alto de la franja final (el de la barra por defecto)
GROUND = 18     # píxeles de suelo por debajo de donde pisan los héroes
SCALE = 0.25    # cuánto se reduce el original; más pequeño = se ve más escena en la barra
BLEND = 0.12    # parte del ancho que se mezcla para que se repita sin cortes

# Altura de la superficie del suelo, en fracción de la altura del original (se mira en arte/prueba/contacto.png).
SUPERFICIE = {
    "1-pradera": 0.845,
    "2-bosque": 0.815,
    "3-cueva": 0.805,
    "4-pantano": 0.825,
    "5-desierto": 0.805,
    "6-helada": 0.845,
    "7-volcan": 0.78,
    "8-castillo": 0.82,
}


def repetible(im: Image.Image) -> Image.Image:
    """Mezcla el borde derecho con el izquierdo (fundido) y recorta el tramo mezclado."""
    w, h = im.size
    b = max(8, int(w * BLEND))
    out = im.crop((0, 0, w - b, h)).convert("RGB")
    tail = im.crop((w - b, 0, w, h)).convert("RGB")
    head = out.crop((0, 0, b, h))
    # Máscara: en el borde izquierdo manda la "cola" del original y se funde hacia la imagen.
    mask = Image.linear_gradient("L").rotate(90).transpose(Image.FLIP_LEFT_RIGHT).resize((b, h))  # blanco (izq) a negro (der)
    blended = Image.composite(tail, head, mask)
    out.paste(blended, (0, 0))
    return out


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    for nombre, frac in SUPERFICIE.items():
        origen = ORIGEN / f"{nombre}.png"
        if not origen.exists():
            print("falta", origen)
            continue
        im = Image.open(origen).convert("RGB")
        im = im.resize((round(im.width * SCALE), round(im.height * SCALE)), Image.LANCZOS)
        y = round(im.height * frac)
        top = y - (BAND - GROUND)
        franja = im.crop((0, max(0, top), im.width, y + GROUND))
        if franja.height != BAND:  # por si el original es bajo: se estira lo justo
            franja = franja.resize((franja.width, BAND), Image.NEAREST)
        franja = repetible(franja)
        destino = DESTINO / f"{nombre.split('-')[0]}.png"
        franja.save(destino, optimize=True)
        print(destino.name, franja.size)


if __name__ == "__main__":
    main()
