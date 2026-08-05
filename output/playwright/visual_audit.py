import json
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


ROUTES = [
    ("home", "/"),
    ("processing", "/analyze/processing"),
    ("analysis-result", "/analyze/result"),
    ("video-detail", "/analyze/detail/video"),
    ("gallery-detail", "/analyze/detail/gallery"),
    ("create", "/create"),
    ("publish", "/publish"),
    ("assets", "/assets"),
    ("settings", "/settings"),
    ("vitality-scan", "/vitality/scan"),
    ("vitality-result", "/vitality/result"),
]
TAB_ROUTES = {"/analyze/result", "/analyze/detail/video", "/analyze/detail/gallery", "/assets"}
VITALITY_ROUTES = {"/vitality/scan", "/vitality/result"}
TEXT_ROOTS = (Path("apps/web/src"), Path("tests"))
TEXT_EXTENSIONS = {".css", ".html", ".ts", ".tsx"}
EXPECTED_VITALITY_COLORS = {
    "shellBackground": "rgb(251, 253, 250)",
    "primaryBackground": "rgb(38, 166, 154)",
    "headingColor": "rgb(0, 77, 64)",
}


def assert_utf8_text_is_clean() -> None:
    for root in TEXT_ROOTS:
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix not in TEXT_EXTENSIONS:
                continue
            text = path.read_text(encoding="utf-8")
            assert "\ufffd" not in text, f"UTF-8 replacement character found in {path}"


def assert_tabs_are_associated(page: Page, route: str) -> None:
    if route not in TAB_ROUTES:
        return

    assert page.locator('[role="tablist"]').count() == 1, f"{route}: expected one tablist"
    tabs = page.locator('[role="tab"]')
    panels = page.locator('[role="tabpanel"]')
    assert tabs.count() > 0, f"{route}: expected tabs"
    assert panels.count() == 1, f"{route}: expected one visible tabpanel"

    panel_id = panels.first.get_attribute("id")
    labelled_by = panels.first.get_attribute("aria-labelledby")
    assert panel_id and labelled_by, f"{route}: tabpanel must expose id and aria-labelledby"
    assert page.locator(f'[id="{panel_id}"]').count() == 1
    assert page.locator(f'[id="{labelled_by}"]').count() == 1

    for index in range(tabs.count()):
        tab = tabs.nth(index)
        assert tab.get_attribute("aria-controls") == panel_id, f"{route}: tab {index} controls the wrong panel"


def assert_local_visual_resources(page: Page, route: str) -> str:
    assert page.evaluate("document.fonts.check('16px \\\"Noto Sans SC\\\"')"), f"{route}: local Noto Sans SC font is not ready"
    sources = page.locator("img").evaluate_all("images => images.map(image => image.currentSrc || image.src)")
    external = [source for source in sources if not source.startswith("http://127.0.0.1:4173/")]
    assert not external, f"{route}: external runtime media remains: {external}"
    return f"local-font=1;local-images={len(sources)}"


def assert_page_mark(page: Page, route: str) -> str:
    marks = page.locator(".brand-logo--mark")
    assert marks.count() >= 1, f"{route}: expected at least one transparent page mark"
    sources = marks.locator("img").evaluate_all("images => images.map(image => image.currentSrc || image.src)")
    assert all(source.endswith("/brand/pulse-flow-mark.png") for source in sources), f"{route}: page mark uses the wrong asset: {sources}"
    style = marks.first.evaluate(
        """element => {
          const computed = getComputedStyle(element);
          return {
            borderWidth: computed.borderWidth,
            borderStyle: computed.borderStyle,
            backgroundColor: computed.backgroundColor,
            boxShadow: computed.boxShadow,
          };
        }"""
    )
    assert style["borderWidth"] == "0px" and style["borderStyle"] == "none", f"{route}: page mark has a visible border: {style}"
    assert style["backgroundColor"] in {"rgba(0, 0, 0, 0)", "transparent"}, f"{route}: page mark has a background: {style}"
    assert style["boxShadow"] == "none", f"{route}: page mark has a shadow: {style}"

    header_mark = page.locator(".app-header .brand-logo--mark")
    if not header_mark.count():
        return f"page-mark={len(sources)};transparent=1"

    geometry = header_mark.first.evaluate(
        """element => {
          const mark = element.getBoundingClientRect();
          const title = element.closest('.app-header').querySelector('.app-header__title-wrap').getBoundingClientRect();
          return { markWidth: mark.width, titleGap: title.left - mark.right };
        }"""
    )
    assert 32.5 <= geometry["markWidth"] <= 33.5, f"{route}: page mark size drifted: {geometry}"
    assert 6.5 <= geometry["titleGap"] <= 7.5, f"{route}: page mark/title gap drifted: {geometry}"
    return f"page-mark={len(sources)};transparent=1;markWidth={geometry['markWidth']:.1f};titleGap={geometry['titleGap']:.1f}"


def vitality_color_snapshot(page: Page) -> dict[str, str | None]:
    return page.locator(".app-shell").evaluate(
        """element => {
          const primary = element.querySelector('.scan-actions .button--primary, .vitality-result__actions .button--primary');
          const heading = element.querySelector('.app-header h1');
          const styles = target => target ? getComputedStyle(target) : null;
          return {
            theme: element.getAttribute('data-visual-theme'),
            shellBackground: styles(element)?.backgroundColor ?? null,
            primaryBackground: styles(primary)?.backgroundColor ?? null,
            headingColor: styles(heading)?.color ?? null,
          };
        }"""
    )


def assert_vitality_theme(page: Page, route: str) -> str:
    snapshot = vitality_color_snapshot(page)
    assert snapshot["theme"] == "warm-soft-tech", f"{route}: missing warm-soft-tech scope"
    for key, expected in EXPECTED_VITALITY_COLORS.items():
        assert snapshot[key] == expected, f"{route}: {key}={snapshot[key]!r}, expected {expected!r}"
    assert all(old not in json.dumps(snapshot) for old in ("176, 113, 80", "242, 223, 210")), f"{route}: old brown tone remains"
    return ", ".join(f"{key}={snapshot[key]}" for key in EXPECTED_VITALITY_COLORS)


def audit_assets(page: Page) -> str:
    assert page.get_by_role("button", name="上传", exact=True).count() == 1
    assert page.locator(".app-header .brand-logo img").count() == 0, "assets keeps its page-specific folder mark"
    assert page.locator(".bottom-nav .brand-logo img").count() == 1

    metrics = page.locator(".asset-row").evaluate_all(
        """rows => rows.map(row => {
          const media = row.querySelector('.asset-row__media')?.getBoundingClientRect();
          const body = row.querySelector('.asset-row__body')?.getBoundingClientRect();
          return {
            mediaRight: media?.right ?? null,
            bodyLeft: body?.left ?? null,
            mediaWidth: media?.width ?? null,
            mediaHeight: media?.height ?? null,
          };
        })"""
    )
    assert metrics, "assets: expected asset rows"
    for index, metric in enumerate(metrics):
        assert metric["mediaRight"] <= metric["bodyLeft"] + 0.5, f"assets row {index} overlaps its text: {metric}"
        assert metric["mediaWidth"] >= 120, f"assets row {index} thumbnail is unexpectedly narrow: {metric}"
        assert metric["mediaHeight"] > 0, f"assets row {index} thumbnail has no height: {metric}"

    return f"assets geometry: rows={len(metrics)};thumbnail={metrics[0]['mediaWidth']:.1f}x{metrics[0]['mediaHeight']:.1f};no-overlap=1"


def audit_home_empty_state(browser, output_dir: Path) -> str:
    page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    page.goto("http://127.0.0.1:4173/", wait_until="networkidle", timeout=30_000)
    toggle = page.get_by_role("button", name="切换空状态测试")
    assert toggle.count() == 1
    toggle.click()
    page.wait_for_timeout(100)
    assert page.get_by_text("暂无拆解记录", exact=True).count() == 1
    assert page.get_by_role("button", name="了解如何拆解").count() == 1
    assert toggle.get_attribute("aria-pressed") == "true"
    page.screenshot(path=str(output_dir / "home-empty.png"), full_page=True)

    page.evaluate("document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, document.documentElement.scrollHeight)")
    page.wait_for_timeout(50)
    metrics = page.evaluate(
        """() => {
          const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
          const panel = document.querySelector('.state-panel')?.getBoundingClientRect();
          return {
            navTop: nav?.top ?? null,
            panelBottom: panel?.bottom ?? null,
            scrollY: window.scrollY,
          };
        }"""
    )
    assert metrics["navTop"] is not None and metrics["panelBottom"] is not None
    assert metrics["panelBottom"] <= metrics["navTop"] + 1, f"home empty state overlaps fixed nav: {metrics}"
    page.close()
    return f"home-empty=1;nav-clearance={metrics['navTop'] - metrics['panelBottom']:.1f}px"


def main() -> None:
    output_dir = Path("output/playwright/screens")
    output_dir.mkdir(parents=True, exist_ok=True)
    base_url = "http://127.0.0.1:4173"
    audit_rows: list[str] = []
    evidence_rows: list[str] = []

    assert_utf8_text_is_clean()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name, route in ROUTES:
            page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
            page_errors: list[str] = []
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.goto(f"{base_url}{route}", wait_until="networkidle", timeout=30_000)
            page.wait_for_timeout(300)
            page.screenshot(path=str(output_dir / f"{name}.png"), full_page=True)
            body_text = page.locator("body").inner_text()
            assert body_text.strip()
            assert page.locator(".app-shell").count() == 1
            assert page.locator("h1").count() == 1, f"{route}: expected one h1"
            assert page.locator(".bottom-nav .brand-logo img").count() == 1, f"{route}: AI nav should use the shared logo"
            if route in {"/", "/vitality/scan"}:
                assert page.locator(".app-header .brand-logo img").count() == 1, f"{route}: brand header should use the shared logo"
            evidence_rows.append(f"{route}\t{assert_local_visual_resources(page, route)}")
            evidence_rows.append(f"{route}\t{assert_page_mark(page, route)}")
            assert_tabs_are_associated(page, route)
            if route in VITALITY_ROUTES:
                evidence_rows.append(f"{route}\t{assert_vitality_theme(page, route)}")
            if route == "/assets":
                evidence_rows.append(f"{route}\t{audit_assets(page)}")
            audit_rows.append(f"{route}\t{page.locator('body').bounding_box()['height']:.0f}px\th1=1\t{len(page_errors)} errors")
            if page_errors:
                raise AssertionError(f"{route}: {page_errors}")
            page.close()

        evidence_rows.append(f"/\t{audit_home_empty_state(browser, output_dir)}")

        desktop = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
        desktop.goto(f"{base_url}/", wait_until="networkidle", timeout=30_000)
        desktop.wait_for_timeout(300)
        assert desktop.locator("h1").count() == 1
        desktop.screenshot(path=str(output_dir / "home-desktop.png"), full_page=True)
        desktop.close()

        assets_preview = browser.new_page(viewport={"width": 536, "height": 900}, device_scale_factor=1)
        assets_preview.goto(f"{base_url}/assets", wait_until="networkidle", timeout=30_000)
        assets_preview.wait_for_timeout(300)
        assets_preview.screenshot(path=str(output_dir / "assets-536x900.png"), full_page=True)
        assets_preview.close()
        browser.close()

    report = [
        "route\tpage height\th1\tpage errors",
        *audit_rows,
        "",
        "foundation evidence",
        *evidence_rows,
        "",
        "screenshots: 390x844 mobile routes; 536x900 assets visual check; 1280x900 home desktop; home-empty static state",
        "brand, font and fixture media are bundled locally; browser/platform rasterization can still differ, so no pixel identity is claimed",
    ]
    Path("output/playwright/visual-audit.txt").write_text("\n".join(report) + "\n", encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
