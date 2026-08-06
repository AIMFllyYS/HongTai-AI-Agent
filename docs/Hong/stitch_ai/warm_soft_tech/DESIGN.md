---
name: Warm Soft Tech
colors:
  surface: '#f8faf7'
  surface-dim: '#d8dbd8'
  surface-bright: '#f8faf7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f1'
  surface-container: '#eceeeb'
  surface-container-high: '#e6e9e6'
  surface-container-highest: '#e1e3e0'
  on-surface: '#191c1b'
  on-surface-variant: '#3f4945'
  inverse-surface: '#2e312f'
  inverse-on-surface: '#eff1ee'
  outline: '#707975'
  outline-variant: '#bfc9c4'
  surface-tint: '#29695b'
  primary: '#00342b'
  on-primary: '#ffffff'
  primary-container: '#004d40'
  on-primary-container: '#7ebdac'
  inverse-primary: '#94d3c1'
  secondary: '#006a62'
  on-secondary: '#ffffff'
  secondary-container: '#81f3e5'
  on-secondary-container: '#006f66'
  tertiary: '#292f2c'
  on-tertiary: '#ffffff'
  tertiary-container: '#3f4542'
  on-tertiary-container: '#adb2ae'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#afefdd'
  primary-fixed-dim: '#94d3c1'
  on-primary-fixed: '#00201a'
  on-primary-fixed-variant: '#065043'
  secondary-fixed: '#84f5e8'
  secondary-fixed-dim: '#66d9cc'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#dfe4df'
  tertiary-fixed-dim: '#c2c8c3'
  on-tertiary-fixed: '#171d1a'
  on-tertiary-fixed-variant: '#424845'
  background: '#f8faf7'
  on-background: '#191c1b'
  surface-variant: '#e1e3e0'
  silk-white: '#FBFDFA'
  mint-whisper: '#F2F7F2'
  deep-emerald: '#004D40'
  vitality-turquoise: '#26A69A'
  data-text: '#1A1C1A'
  muted-text: '#606B66'
typography:
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: 0.01em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0.01em
  data-display:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0.02em
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.08em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 40px
  container-max: 1200px
  gutter: 16px
---

## Brand & Style
The brand personality is **Professional, Empathetic, and High-Precision**. It aims to dismantle the cold, clinical associations of traditional healthcare technology, replacing them with a "Warm Soft Tech" aesthetic that feels both technically advanced and human-centric.

The design style is a hybrid of **Minimalism** and **Glassmorphism**. It leverages expansive "breathing room" and a light, airy foundation to reduce cognitive load. Subtle translucent layers and backdrop blurs provide a sense of depth and modernity, while high-contrast primary accents maintain the authoritative "Profound Logic" heritage. The target response is one of calm confidence—users should feel they are using a sophisticated AI tool that cares about their well-being.

## Colors
The palette shifts the interface from heavy, dark environments to a luminous, layered foundation.

- **Silk White (#FBFDFA)**: The primary surface color, providing a warm, non-clinical base for the entire application.
- **Mint Whisper (#F2F7F2)**: Used for secondary containers, section backgrounds, and subtle card fills to provide low-contrast differentiation.
- **Deep Emerald (#004D40)**: Retained as the high-precision primary accent. Use this for Primary CTAs, brand marks, and critical text headings.
- **Vitality Turquoise (#26A69A)**: The "Interactive" color. Used for highlights, toggle states, progress bars, and hover/active feedback.

For feedback states (Success, Warning, Error), derive tints from the primary palette to maintain harmony, ensuring they are always accompanied by icons for accessibility.

## Typography
The typographic system balances approachability with technical rigor.

- **Plus Jakarta Sans** handles all editorial and brand-facing text. Its soft curves reinforce the "Warm" aspect of the brand.
- **Inter** is introduced specifically for **Data and AI Scores**. Its neutral, geometric construction provides the "High-Precision" look required for technical health insights.
- **Readability**: A generous line-height of 1.6x is applied to all body text to ensure maximum legibility, especially when consuming health-related data.
- **Letter Spacing**: Headlines use slightly negative tracking for a tight, modern feel, while body and labels use expanded tracking to improve the "airy" quality of the design.

## Layout & Spacing
The layout follows a **Fluid Grid** philosophy with a focus on high "Whitespace Ratios."

- **Grid**: A 12-column system for desktop and a 4-column system for mobile.
- **Margins**: Use 24px side margins on mobile to create a sense of exclusivity and breathing room.
- **Vertical Rhythm**: Spacing is strictly based on 8px increments. Use `xl` (40px) or larger between major sections to emphasize the "Lightweight" and "Uncluttered" nature of the interface.
- **Reflow**: On mobile viewports (393x852), components should stack vertically, and horizontal scrolling should be reserved exclusively for secondary data chips or image galleries.

## Elevation & Depth
Depth is created through **Soft Tech Glassmorphism** and tonal layering rather than traditional drop shadows.

- **Surfaces**: Use `Silk White` as the base. Containers use `Mint Whisper` with a subtle 1px border (#E0E8E3) to define edges.
- **Glassmorphism**: For navigation bars, overlays, and modal windows, use semi-transparent backgrounds (approx. 70-80% opacity) with a `backdrop-blur` of 12px to 20px. This keeps the user grounded in their current context while maintaining the "light/airy" feel.
- **Shadows**: When depth is essential (e.g., a floating action button), use highly diffused, low-opacity shadows tinted with `Deep Emerald` (e.g., `rgba(0, 77, 64, 0.08)`) to avoid a "dirty" gray appearance.

## Shapes
The shape language is significantly softened to reflect the "Wellness" focus.

The standard corner radius is set to **12px-16px** (Rounded). This creates a friendlier, organic feel compared to the previous "Round 8" standard.
- **Small Elements**: Checkboxes and small tags use 4px.
- **Standard Components**: Buttons and Input fields use 12px.
- **Large Containers**: Cards and Modals use 16px to 24px.
- **Pill Shapes**: Used exclusively for chips and status indicators to differentiate them from interactive buttons.

## Components
- **Buttons**: Primary buttons use a solid `Deep Emerald` fill with white text. Secondary buttons use a `Vitality Turquoise` outline or a soft `Mint Whisper` ghost style.
- **Glass Cards**: Use a white semi-transparent background with a 1px border. Content inside cards should have generous internal padding (20px-24px).
- **Inputs**: Text fields use a 12px radius. The background should be `Silk White` with a subtle `Mint Whisper` border that transitions to `Vitality Turquoise` on focus.
- **Status Indicators**: Use the "Icon + Text + Color" pattern. Icons should be thin-stroke (1.5pt) to match the high-precision aesthetic.
- **Data Visuals**: AI scores and health metrics should be rendered in `Inter` with high-contrast `Deep Emerald` text, often placed within a glassmorphic "Highlight Tile" to draw the eye.
- **Navigation**: The bottom bar on mobile and the top bar on desktop should use the 20px backdrop-blur glass effect to ensure the "Airy" theme persists during scrolls.