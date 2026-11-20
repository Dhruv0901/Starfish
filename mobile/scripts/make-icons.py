# Starfish icons: the mockup's star path (24-unit viewBox), drawn with supersampling.
import sys
from PIL import Image, ImageDraw
OUT = sys.argv[1]  # usage: py -I scripts/make-icons.py assets
STAR = [(12,3),(14.35,9.26),(21.04,9.56),(15.8,13.74),(17.58,20.19),(12,16.5),(6.42,20.19),(8.2,13.74),(2.96,9.56),(9.65,9.26)]
ORANGE, PALE = (194,65,12,255), (244,246,248,255)
def star(size, star_frac, fg, bg, ss=4):
    S = size*ss
    im = Image.new("RGBA", (S,S), bg)
    d = ImageDraw.Draw(im)
    scale = S*star_frac/24; off = (S - 24*scale)/2
    pts = [(x*scale+off, (y+0.4)*scale+off) for x,y in STAR]  # nudge down: the path's centroid sits high
    d.polygon(pts, fill=fg)
    d.line(pts[1:]+pts[:2], fill=fg, width=int(2.2*scale), joint="curve")  # rounded joins like the logo stroke
    return im.resize((size,size), Image.LANCZOS)
star(1024, 0.62, ORANGE, PALE).convert("RGB").save(f"{OUT}/icon.png")
star(1024, 0.40, ORANGE, (0,0,0,0)).save(f"{OUT}/android-icon-foreground.png")   # adaptive safe zone ~66%
Image.new("RGBA",(1024,1024),PALE).save(f"{OUT}/android-icon-background.png")
star(1024, 0.40, (0,0,0,255), (0,0,0,0)).save(f"{OUT}/android-icon-monochrome.png")
star(48, 0.8, ORANGE, PALE).save(f"{OUT}/favicon.png")
print("ok")
