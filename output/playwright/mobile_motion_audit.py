from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:4173"
SCREEN_DIR = Path("output/playwright/screens")


def dispatch_pointer(
    page,
    selector: str,
    event_type: str,
    x: float,
    y: float,
    pointer_id: int = 1,
    pointer_type: str = "touch",
) -> None:
    page.locator(selector).evaluate(
        """
        (element, payload) => {
          element.dispatchEvent(new PointerEvent(payload.type, {
            bubbles: true,
            pointerId: payload.pointerId,
            pointerType: payload.pointerType,
            button: 0,
            buttons: payload.type === 'pointerup' ? 0 : 1,
            clientX: payload.x,
            clientY: payload.y,
          }));
        }
        """,
        {"type": event_type, "pointerId": pointer_id, "pointerType": pointer_type, "x": x, "y": y},
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    page.goto(f"{BASE_URL}/", wait_until="networkidle")
    page.locator(".bottom-nav__item--settings").click()
    page.wait_for_url(f"{BASE_URL}/settings")
    page.wait_for_timeout(40)
    assert page.locator(".route-transition").count() == 1
    assert page.locator("h1").count() == 1
    click_route = page.url
    direct_transition = page.locator(".route-transition").get_attribute("data-transition-mode")
    nav_snapshot = page.locator(".bottom-nav").evaluate(
        """nav => {
          const rect = nav.getBoundingClientRect();
          return {
            bottom: rect.bottom,
            parentIsBody: nav.parentElement === document.body,
            position: getComputedStyle(nav).position,
            viewportHeight: window.innerHeight,
          };
        }"""
    )

    page.evaluate(
        """() => {
          window.__routeSwipeTransitionEvents = [];
          const track = document.querySelector('.route-swipe-track');
          track?.addEventListener('transitionrun', event => {
            window.__routeSwipeTransitionEvents.push({
              property: event.propertyName,
              path: location.pathname,
              time: performance.now(),
            });
          });
        }"""
    )

    dispatch_pointer(page, ".route-swipe-viewport", "pointerdown", 160, 420)
    dispatch_pointer(page, ".route-swipe-viewport", "pointermove", 220, 420)
    page.wait_for_timeout(50)
    swipe_mid = page.locator(".route-swipe-viewport").evaluate(
        """viewport => ({
          state: viewport.dataset.swipeState,
          target: viewport.dataset.swipeTarget,
          headings: [...viewport.querySelectorAll('.route-swipe-pane h1')].map(heading => heading.textContent),
          visiblePanes: [...viewport.querySelectorAll('.route-swipe-pane')].map(pane => {
            const rect = pane.getBoundingClientRect();
            return { left: rect.left, right: rect.right, visible: rect.right > 0 && rect.left < innerWidth };
          }).filter(pane => pane.visible),
        })"""
    )
    page.screenshot(path=str(SCREEN_DIR / "mobile-swipe-adjacent-panes.png"), full_page=False)
    dispatch_pointer(page, ".route-swipe-viewport", "pointerup", 250, 420)
    page.wait_for_url(f"{BASE_URL}/assets")
    page.wait_for_timeout(320)
    swipe_route = page.url
    swipe_transition_events = page.evaluate("() => window.__routeSwipeTransitionEvents")

    dispatch_pointer(page, ".route-swipe-viewport", "pointerdown", 290, 420, pointer_type="mouse")
    dispatch_pointer(page, ".route-swipe-viewport", "pointermove", 190, 420, pointer_type="mouse")
    page.wait_for_timeout(50)
    mouse_drag_transform = page.locator(".route-swipe-track").evaluate("element => getComputedStyle(element).transform")
    dispatch_pointer(page, ".route-swipe-viewport", "pointerup", 140, 420, pointer_type="mouse")
    page.wait_for_url(f"{BASE_URL}/settings")
    page.wait_for_timeout(320)
    mouse_left_route = page.url

    dispatch_pointer(page, ".route-swipe-viewport", "pointerdown", 120, 420, pointer_type="mouse")
    dispatch_pointer(page, ".route-swipe-viewport", "pointermove", 220, 420, pointer_type="mouse")
    dispatch_pointer(page, ".route-swipe-viewport", "pointerup", 270, 420, pointer_type="mouse")
    page.wait_for_url(f"{BASE_URL}/assets")
    mouse_right_route = page.url

    dispatch_pointer(page, ".route-swipe-viewport", "pointerdown", 180, 420, pointer_type="mouse")
    dispatch_pointer(page, ".route-swipe-viewport", "pointermove", 185, 520, pointer_type="mouse")
    dispatch_pointer(page, ".route-swipe-viewport", "pointerup", 185, 560, pointer_type="mouse")
    assert page.url.endswith("/assets")

    page.evaluate("window.scrollTo(0, 140)")
    page.wait_for_timeout(100)
    scroll_state = page.locator(".app-shell").get_attribute("data-scroll-state")
    nav_after_scroll = page.locator(".bottom-nav").evaluate(
        """nav => ({
          bottom: nav.getBoundingClientRect().bottom,
          position: getComputedStyle(nav).position,
          viewportHeight: window.innerHeight,
        })"""
    )
    page.evaluate("window.scrollTo({ top: 0, behavior: 'auto' })")
    page.wait_for_function("window.scrollY <= 1")
    page.wait_for_function("document.querySelector('.app-shell')?.dataset.scrollState === 'top'")
    top_state = page.locator(".app-shell").get_attribute("data-scroll-state")

    audio_support = page.evaluate("typeof window.AudioContext === 'function' || typeof window.webkitAudioContext === 'function'")
    vibration_support = page.evaluate("typeof navigator.vibrate === 'function'")
    page.screenshot(path=str(SCREEN_DIR / "mobile-motion-settings-assets.png"), full_page=True)

    page.locator(".asset-row").first.click()
    page.wait_for_url(f"{BASE_URL}/create")
    page.wait_for_timeout(320)
    animated_transition = page.locator(".route-transition").get_attribute("data-transition-mode")

    reduced_page = browser.new_page(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    reduced_page.emulate_media(reduced_motion="reduce")
    reduced_page.goto(f"{BASE_URL}/", wait_until="networkidle")
    reduced_page.locator(".bottom-nav__item--settings").click()
    reduced_page.wait_for_url(f"{BASE_URL}/settings")
    reduced_direct_transition = reduced_page.locator(".route-transition").get_attribute("data-transition-mode")
    reduced_page.wait_for_function("getComputedStyle(document.querySelector('.route-transition')).opacity === '1'")
    reduced_transition = reduced_page.locator(".route-transition").evaluate(
        "element => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform })"
    )

    assert not errors, f"page errors: {errors}"
    assert click_route.endswith("/settings")
    assert swipe_route.endswith("/assets")
    assert swipe_mid["state"] == "dragging"
    assert swipe_mid["target"] == "/assets"
    assert len(swipe_mid["headings"]) == 2
    assert len(swipe_mid["visiblePanes"]) == 2
    assert abs(swipe_mid["visiblePanes"][0]["right"] - swipe_mid["visiblePanes"][1]["left"]) <= 1
    assert direct_transition == "instant"
    assert [event["property"] for event in swipe_transition_events] == ["transform"], swipe_transition_events
    assert nav_snapshot["parentIsBody"] is True
    assert nav_snapshot["position"] == "fixed"
    assert abs(nav_snapshot["bottom"] - nav_snapshot["viewportHeight"]) <= 1
    assert mouse_drag_transform != "none"
    assert mouse_left_route.endswith("/settings")
    assert mouse_right_route.endswith("/assets")
    assert scroll_state == "scrolled"
    assert nav_after_scroll["position"] == "fixed"
    assert abs(nav_after_scroll["bottom"] - nav_after_scroll["viewportHeight"]) <= 1
    assert top_state == "top"
    assert animated_transition == "animated"
    assert reduced_transition["opacity"] == "1"
    assert reduced_direct_transition == "instant"

    print(f"click-route={click_route}; swipe-route={swipe_route}; mouse-left={mouse_left_route}; mouse-right={mouse_right_route}")
    print(f"scroll-state={scroll_state}; top-state={top_state}")
    print(f"nav-parent-body={int(nav_snapshot['parentIsBody'])}; nav-position={nav_snapshot['position']}; nav-bottom-clearance={nav_after_scroll['viewportHeight'] - nav_after_scroll['bottom']:.1f}")
    print(f"mouse-drag-transform={mouse_drag_transform}")
    print(f"swipe-mid-state={swipe_mid['state']}; swipe-mid-headings={len(swipe_mid['headings'])}; swipe-mid-visible-panes={len(swipe_mid['visiblePanes'])}")
    print(f"page-entry-transition={animated_transition}")
    print(f"audio-support={int(audio_support)}; vibration-support={int(vibration_support)}")
    print(f"reduced-motion-transform={reduced_transition['transform']}")
    print("page-errors=0")
    browser.close()
