from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:4173"
SCREEN_DIR = Path("output/playwright/screens")


def dispatch_pointer(page, selector: str, event_type: str, x: float, y: float, pointer_id: int = 1) -> None:
    page.locator(selector).evaluate(
        """
        (element, payload) => {
          element.dispatchEvent(new PointerEvent(payload.type, {
            bubbles: true,
            pointerId: payload.pointerId,
            pointerType: 'touch',
            clientX: payload.x,
            clientY: payload.y,
          }));
        }
        """,
        {"type": event_type, "pointerId": pointer_id, "x": x, "y": y},
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    page.goto(f"{BASE_URL}/", wait_until="networkidle")
    page.locator(".bottom-nav__item--settings").click()
    page.wait_for_url(f"{BASE_URL}/settings")
    page.wait_for_timeout(320)
    assert page.locator(".route-transition").count() == 1
    assert page.locator("h1").count() == 1
    click_route = page.url

    dispatch_pointer(page, ".app-content", "pointerdown", 160, 420)
    dispatch_pointer(page, ".app-content", "pointerup", 250, 420)
    page.wait_for_url(f"{BASE_URL}/assets")
    swipe_route = page.url

    page.evaluate("window.scrollTo(0, 140)")
    page.wait_for_timeout(100)
    scroll_state = page.locator(".app-shell").get_attribute("data-scroll-state")
    page.evaluate("window.scrollTo({ top: 0, behavior: 'auto' })")
    page.wait_for_function("window.scrollY <= 1")
    page.wait_for_function("document.querySelector('.app-shell')?.dataset.scrollState === 'top'")
    top_state = page.locator(".app-shell").get_attribute("data-scroll-state")

    audio_support = page.evaluate("typeof window.AudioContext === 'function' || typeof window.webkitAudioContext === 'function'")
    vibration_support = page.evaluate("typeof navigator.vibrate === 'function'")
    page.screenshot(path=str(SCREEN_DIR / "mobile-motion-settings-assets.png"), full_page=True)

    reduced_page = browser.new_page(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    reduced_page.emulate_media(reduced_motion="reduce")
    reduced_page.goto(f"{BASE_URL}/", wait_until="networkidle")
    reduced_page.locator(".bottom-nav__item--settings").click()
    reduced_page.wait_for_url(f"{BASE_URL}/settings")
    reduced_page.wait_for_function("getComputedStyle(document.querySelector('.route-transition')).opacity === '1'")
    reduced_transition = reduced_page.locator(".route-transition").evaluate(
        "element => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform })"
    )

    assert not errors, f"page errors: {errors}"
    assert click_route.endswith("/settings")
    assert swipe_route.endswith("/assets")
    assert scroll_state == "scrolled"
    assert top_state == "top"
    assert reduced_transition["opacity"] == "1"

    print(f"click-route={click_route}; swipe-route={swipe_route}")
    print(f"scroll-state={scroll_state}; top-state={top_state}")
    print(f"audio-support={int(audio_support)}; vibration-support={int(vibration_support)}")
    print(f"reduced-motion-transform={reduced_transition['transform']}")
    print("page-errors=0")
    browser.close()
