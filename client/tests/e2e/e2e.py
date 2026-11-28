"""E2E di Chrome sungguhan terhadap fake-server.ts.
Pakai: python3 -I client/tests/e2e/e2e.py <port-dev> <port-log> <folder-screenshot>"""
import json, sys, urllib.request
from playwright.sync_api import sync_playwright

dev, logp, out = sys.argv[1], sys.argv[2], sys.argv[3]
def server_log():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{logp}/__log"))

fails = []
def check(cond, msg):
    print(("OK   " if cond else "GAGAL"), msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1100, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and "404" not in m.text and errors.append(m.text))
    pg.goto(f"http://localhost:{dev}/login.html")
    pg.click("#tab-register")
    pg.fill("#growid", "dev"); pg.fill("#password", "rahasia1"); pg.fill("#confirm", "rahasia1")
    pg.click("#go")
    pg.wait_for_selector("#game:not([hidden])", timeout=15000)
    pg.wait_for_function("document.getElementById('chat').textContent.includes('items.dat dimuat')", timeout=15000)
    check(True, "login -> kanvas tampil, items.dat dimuat")
    check("16480 item" in pg.inner_text("#chat"), "16480 item terbaca di browser")

    pg.fill("#world", "start"); pg.click("#join")
    pg.wait_for_function("document.getElementById('chat').textContent.includes('masuk dunia START (20x12)')", timeout=10000)
    pg.wait_for_function("document.getElementById('chat').textContent.includes('budi: halo dev')", timeout=5000)
    check(True, "dunia dimuat, chat pemain lain tampil")
    pg.wait_for_function("document.querySelectorAll('#hotbar .slot').length > 0", timeout=5000)
    check("Dirt" in pg.inner_text("#hotbar"), "hotbar berisi Dirt dari inventori")
    pg.wait_for_timeout(600)
    pg.screenshot(path=f"{out}/e2e_world.png")

    box = pg.locator("#screen").bounding_box()
    def at(tx, ty):  # tengah tile (tx,ty) dalam koordinat halaman, dihitung dari kamera dan ukuran pandang aktual
        v = pg.evaluate("({cx: gtView.cam.x, cy: gtView.cam.y, vw: gtView.vw, vh: gtView.vh})")
        k = box["width"] / v["vw"]
        return box["x"] + (tx * 32 + 16 - v["cx"]) * k, box["y"] + (ty * 32 + 16 - v["cy"]) * (box["height"] / v["vh"])

    # gerak: tahan D sebentar, posisi baru harus dilaporkan ke server
    n0 = len([l for l in server_log() if l.startswith("state:")])
    pg.keyboard.down("KeyD"); pg.wait_for_timeout(500); pg.keyboard.up("KeyD"); pg.wait_for_timeout(300)
    states = [l for l in server_log() if l.startswith("state:")]
    check(len(states) > n0, f"posisi dilaporkan ke server ({len(states) - n0} paket)")

    # pukul tile tanah di sebelah kaki pemain
    x, y = at(3, 8)
    pg.mouse.move(x, y); pg.mouse.down(); pg.wait_for_timeout(330)
    pg.screenshot(path=f"{out}/e2e_cracked.png")
    pg.wait_for_timeout(450); pg.mouse.up(); pg.wait_for_timeout(300)
    check(any(l.startswith("punch:3,8") for l in server_log()), "pukul terkirim ke server")
    pg.screenshot(path=f"{out}/e2e_after_punch.png")

    # pasang Dirt lagi
    pg.mouse.move(x, y); pg.mouse.down(button="right"); pg.wait_for_timeout(250); pg.mouse.up(button="right"); pg.wait_for_timeout(300)
    check(any(l.startswith("place:2@3,8") for l in server_log()), "pasang terkirim ke server")
    check("x9" in pg.inner_text("#hotbar"), "inventori Dirt berkurang jadi 9 setelah gema server")

    # zoom: roda mouse memperbesar, tombol 0 mengembalikan
    z0 = pg.evaluate("gtView.zoom")
    pg.mouse.move(box["x"] + 50, box["y"] + 50); pg.mouse.wheel(0, -200); pg.wait_for_timeout(200)
    z1 = pg.evaluate("gtView.zoom")
    check(z1 > z0, f"zoom roda mouse ({z0} -> {z1})")
    pg.keyboard.press("Digit0"); pg.wait_for_timeout(150)
    check(pg.evaluate("gtView.zoom") == 1, "tombol 0 mengembalikan zoom")

    # chat
    pg.fill("#chatinput", "halo dunia"); pg.press("#chatinput", "Enter"); pg.wait_for_timeout(300)
    check("say:halo dunia" in server_log(), "chat terkirim")
    check(not errors, "tanpa galat JS: " + "; ".join(errors[:3]))
    b.close()
sys.exit(1 if fails else 0)
