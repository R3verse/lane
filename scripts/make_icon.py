from pathlib import Path
from PIL import Image, ImageDraw

target = Path(__file__).resolve().parents[1] / 'assets'
target.mkdir(exist_ok=True)
img = Image.new('RGBA', (512, 512))
d = ImageDraw.Draw(img)
d.rounded_rectangle((8, 8, 504, 504), radius=126, fill='#20372b')
d.rounded_rectangle((54, 54, 458, 458), radius=96, outline='#476043', width=3)
d.line((148, 360, 358, 150), fill='#cdebbd', width=47)
d.line((158, 150, 358, 150, 358, 350), fill='#cdebbd', width=47, joint='curve')
d.ellipse((119, 336, 166, 383), fill='#cdebbd')
img.save(target / 'icon.png')
img.save(target / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
