---
name: Profound Logic AI
colors:
  surface: '#f8faf7'
  surface-dim: '#d8dbd8'
  surface-bright: '#f8faf7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f1'
  surface-container: '#eceeec'
  surface-container-high: '#e7e9e6'
  surface-container-highest: '#e1e3e0'
  on-surface: '#191c1b'
  on-surface-variant: '#3f4945'
  inverse-surface: '#2e3130'
  inverse-on-surface: '#eff1ef'
  outline: '#707975'
  outline-variant: '#bfc9c4'
  surface-tint: '#29695b'
  primary: '#00342b'
  on-primary: '#ffffff'
  primary-container: '#004d40'
  on-primary-container: '#7ebdac'
  inverse-primary: '#94d3c1'
  secondary: '#3b6660'
  on-secondary: '#ffffff'
  secondary-container: '#bbe9e1'
  on-secondary-container: '#3f6a64'
  tertiary: '#003330'
  on-tertiary: '#ffffff'
  tertiary-container: '#004c47'
  on-tertiary-container: '#59c0b6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#afefdd'
  primary-fixed-dim: '#94d3c1'
  on-primary-fixed: '#00201a'
  on-primary-fixed-variant: '#065043'
  secondary-fixed: '#beece4'
  secondary-fixed-dim: '#a2cfc8'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#224e48'
  tertiary-fixed: '#8ef4e9'
  tertiary-fixed-dim: '#71d7cd'
  on-tertiary-fixed: '#00201d'
  on-tertiary-fixed-variant: '#00504a'
  background: '#f8faf7'
  on-background: '#191c1b'
  surface-variant: '#e1e3e0'
typography:
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  module-title:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  section-title:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  label-md:
    fontFamily: Be Vietnam Pro
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 30px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-padding: 20px
  stack-gap-lg: 24px
  stack-gap-md: 16px
  stack-gap-sm: 8px
  gutter: 16px
  margin-page: 16px
---

## Brand & Style
The design system is engineered for a sophisticated AI agent platform that prioritizes professional utility and deep cognitive processing over superficial technological trends. The brand persona is "The Sage Architect": authoritative, calm, and highly organized.

The aesthetic blends **Modern Corporate** with **Minimalist** sensibilities, utilizing a palette of deep forest and teal tones to evoke stability and growth. It intentionally avoids the saturated purples and heavy glows common in consumer AI, opting instead for a "Paper & Ink" digital philosophy—crisp typography on structured, warm-toned surfaces. The emotional response is one of clarity and confidence, ensuring users feel they are interacting with a high-precision tool rather than an experimental toy.

## Colors
The palette is grounded in deep botanical teals to establish a sense of "intellectual depth."

- **Primary & Secondary:** Used for high-level branding, primary actions, and navigation headers. They provide the "weight" of the interface.
- **Accent (Teal-Green):** Reserved for highlights, active states, and focus indicators to guide the eye without causing fatigue.
- **Surface Strategy:** The primary workspace uses a warm-white (#FDFCFB) to reduce eye strain, while sidebars and secondary containers use a cool-grey blue (#F0F4F8) to create structural separation.
- **Semantic Logic:** Status colors are slightly desaturated to maintain the professional tone, ensuring they inform the user without screaming for attention.

## Typography
The system utilizes **Plus Jakarta Sans** for headings to provide a modern, clean geometric touch, while **Be Vietnam Pro** handles the body text for its exceptional legibility in data-heavy AI contexts.

- **Hierarchies:** Clear contrast is maintained between module titles (16-18px) and body text (14-15px).
- **Line Height:** Generous leading is applied to body text to facilitate the reading of long-form AI-generated responses.
- **Localization:** While these global fonts are specified, for Chinese characters, the system defaults to **PingFang SC** with weight mappings: Regular (400), Semibold (600).

## Layout & Spacing
The layout follows a **Fluid Grid** model with a focus on generous negative space to prevent the "cluttered dashboard" feel common in AI tools.

- **Rhythm:** A 4px/8px base unit is used for all internal component spacing.
- **Margins:** Standard mobile margins are set to 16px, increasing to 24px on tablet/desktop.
- **Safe Areas:** Navigation components respect bottom safe areas for gesture-based devices, ensuring the fixed 4-tab bar remains accessible.
- **Reflow:** Cards span the full width on mobile, transitioning to a multi-column grid on larger viewports to maintain optimal line length for AI outputs.

## Elevation & Depth
Depth is created through **Tonal Layering** supplemented by soft, ambient shadows.

- **Base Level (Level 0):** Background surfaces (#FDFCFB / #F0F4F8).
- **Card Level (Level 1):** White background with a 1px border (#E0E7E7) and a very soft shadow (0px 4px 12px rgba(0, 0, 0, 0.04)).
- **Overlay Level (Level 2):** Modals and dropdowns use a slightly more pronounced shadow (0px 10px 24px rgba(0, 77, 64, 0.08)) to indicate priority.
- **Glassmorphism:** Used sparingly for the bottom navigation bar and sticky headers (Backdrop Blur: 12px, 80% opacity) to maintain context of what lies beneath.

## Shapes
The visual language is defined by **pronounced, friendly radii** that soften the technical nature of the AI.

- **Cards:** Use a standard 16px radius. Large modal containers may increase to 24px for a more organic feel.
- **Buttons & Inputs:** Follow the 8px base (Level 2), providing enough rounding to feel modern without becoming "bubbly."
- **Status Tags:** Use a fully rounded (pill-shaped) radius to distinguish them from interactive buttons.

## Components

### Buttons
- **Primary:** Background #004D40, Text #FFFFFF. High emphasis.
- **Secondary:** Background #F0F4F8, Text #004D40. Medium emphasis.
- **Ghost:** Transparent background, Border 1px #004D40, Text #004D40. Low emphasis.

### Input Fields & Link Parsing
- **Styling:** 1px border (#D1DADA), 12px horizontal padding. Focus state uses 2px border #4DB6AC.
- **Link Parsing:** When a URL is detected, the input reveals a small "Link Preview" card inside the container with a favicon, title, and "close" icon.

### Status Labels
- **Ongoing:** Icon (Rotating loader), Text #00796B, Background 10% opacity of color.
- **Completed:** Icon (Check), Text #2E7D32, Background 10% opacity of color.
- **Pending:** Icon (Clock), Text #F57C00, Background 10% opacity of color.

### Navigation & Operation
- **Bottom Navigation:** 4 tabs (拆解, 制作, 素材, 设置). Active state uses #004D40 for icon/label; inactive uses #5E6363.
- **Bottom Action Bar:** A floating or fixed bar at the base of the content area for contextual actions (e.g., "Submit Agent"), distinct from the main navigation.

### Progress Bars
- 4px height. Track color #E0E7E7. Fill color uses a linear gradient from #4DB6AC to #004D40.

### Feedback & Overlays
- **Empty States:** Centered illustration in muted teal-grey, 16px title, 14px descriptive text, and a primary "Call to Action" button.
- **Popups:** Centered or bottom-sheet style. 24px padding, 20px title, and stacked action buttons.