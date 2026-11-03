/** Desktop flavors share the built-in Web composition. */
import { PROFILE_TEMPLATES, type ProfileTemplate } from '@deepseek-ai/dsh-official-bundles'

/**
 * Select initial bundles without mutating the shared Web template.
 * @param _harness2 - Custom distribution identity; Harness² is built into both flavors through base.
 * @returns Ordered desktop profile bundles.
 */
export function desktopProfileBundles(_harness2 = false): readonly string[] {
  const web = PROFILE_TEMPLATES.web as ProfileTemplate
  return [...web.bundles]
}
