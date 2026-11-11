"""Headless check of the V1 page: fake camera, each stimulus, notes per family, screenshots."""
import asyncio, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'; URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:8766/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 950}, permissions=['camera'])
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await pg.goto(URL)
        await pg.wait_for_function("document.getElementById('status').textContent.includes('press Start')", timeout=120000)
        print('status:', await pg.locator('#status').text_content())
        await pg.evaluate("(() => { const f = window.fire; })()")
        await pg.click('#go')
        for kind in ['rotate', 'webcam', 'grating', 'flash']:
            await pg.select_option('#kind', kind); await pg.wait_for_timeout(9000)
            print(kind, '|', await pg.locator('#status').text_content())
            await pg.screenshot(path=f'{OUT}/v1_{kind}.png')
        await pg.click('[data-l="lgn"]'); await pg.wait_for_timeout(1500); await pg.locator('.heroEye').screenshot(path=f'{OUT}/v1_lgn.png')
        await pg.locator('.rollbox').scroll_into_view_if_needed(); await pg.wait_for_timeout(500); await pg.screenshot(path=f'{OUT}/v1_roll.png')
        await pg.locator('#lobeWrap').scroll_into_view_if_needed(); await pg.wait_for_timeout(8000); await pg.locator('.lobeBox').screenshot(path=f'{OUT}/v1_3d.png')
        print('errors:', errs[:6]); await b.close()
asyncio.run(main())
