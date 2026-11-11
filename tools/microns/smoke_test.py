"""Headless check: load the page with a fake camera, run each stimulus, count notes, grab screenshots."""
import asyncio, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 950}, permissions=['camera'])
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await pg.goto('http://localhost:8766/index.html')
        await pg.wait_for_function("document.getElementById('status').textContent.includes('running')", timeout=90000)
        print('status:', await pg.locator('#status').text_content())
        await pg.click('#go')
        for kind in ['rotate', 'webcam', 'bar', 'flash']:
            await pg.select_option('#kind', kind); await pg.wait_for_timeout(5000)
            n = await pg.evaluate("document.querySelectorAll('#roll').length")
            notes = await pg.evaluate("window.__notes = (window.__notes||0)")
            await pg.screenshot(path=f'{OUT}/mh_{kind}.png')
        await pg.select_option('#kind', 'rotate')
        await pg.locator('#lobeWrap').scroll_into_view_if_needed(); await pg.wait_for_timeout(6000)
        await pg.locator('.lobeBox').screenshot(path=f'{OUT}/mh_3d.png')
        print('errors:', errs[:6])
        await b.close()
asyncio.run(main())
