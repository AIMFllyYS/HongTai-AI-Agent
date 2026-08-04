from pathlib import Path

from playwright.sync_api import sync_playwright


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


def main() -> None:
    output_dir = Path("output/playwright/screens")
    output_dir.mkdir(parents=True, exist_ok=True)
    base_url = "http://127.0.0.1:4173"
    audit_rows: list[str] = []

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
            audit_rows.append(f"{route}\t{page.locator('body').bounding_box()['height']:.0f}px\t{len(page_errors)} errors")
            if page_errors:
                raise AssertionError(f"{route}: {page_errors}")
            page.close()

        desktop = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
        desktop.goto(f"{base_url}/", wait_until="networkidle", timeout=30_000)
        desktop.wait_for_timeout(300)
        desktop.screenshot(path=str(output_dir / "home-desktop.png"), full_page=True)
        desktop.close()
        browser.close()

    Path("output/playwright/visual-audit.txt").write_text("route\tpage height\tpage errors\n" + "\n".join(audit_rows) + "\n", encoding="utf-8")
    print("\n".join(audit_rows))


if __name__ == "__main__":
    main()
