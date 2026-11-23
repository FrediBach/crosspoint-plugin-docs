# make_sleep.py: needs `pip install pillow`; run it daily (cron)
from PIL import Image, ImageDraw, ImageFont
import datetime
W, H = 480, 800                     # X4/X3 portrait; adjust for your device
img = Image.new("L", (W, H), 255)
d = ImageDraw.Draw(img)
font = ImageFont.load_default(size=64)
d.text((W // 2, H // 2), datetime.date.today().strftime("%A\n%d %B"),
       fill=0, font=font, anchor="mm", align="center")
img.convert("1").save("sleep.bmp")  # keep it well under 1 MB
