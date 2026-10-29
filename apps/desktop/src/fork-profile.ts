/** Explicit custom Desktop composition; official profiles remain unchanged. */
import { PROFILE_TEMPLATES, type ProfileTemplate } from '@deepseek-ai/dsh-official-bundles'

/** Opt-in bundle shipped by the custom Harness² installer. */
export const HARNESS2_DESKTOP_BUNDLE = '@deepseek-ai/dsh-experimental-harness2-bundle'

/**
 * Select initial bundles without mutating the shared Web template.
 * @param harness2 - Whether this is the custom Harness² desktop build.
 * @returns Ordered desktop profile bundles.
 */
export function desktopProfileBundles(harness2 = false): readonly string[] {
  const web = PROFILE_TEMPLATES.web as ProfileTemplate
  return [...web.bundles, ...(harness2 ? [HARNESS2_DESKTOP_BUNDLE] : [])]
}
