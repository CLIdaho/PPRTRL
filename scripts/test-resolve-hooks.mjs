const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    // Only relative, extensionless specifiers get a second chance. Anything
    // else failing to resolve is a real error worth surfacing.
    if (!specifier.startsWith('.') || /\.[cm]?[jt]sx?$/.test(specifier)) throw error
    for (const ext of CANDIDATES) {
      try {
        return await nextResolve(specifier + ext, context)
      } catch {
        // Try the next candidate extension.
      }
    }
    throw error
  }
}
