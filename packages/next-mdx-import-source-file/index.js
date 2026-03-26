// Next.js MDX integration expects a plain function export named `useMDXComponents`.
// Nextra calls it at module scope, so it must NOT be a React hook.
export function useMDXComponents(components) {
  return components || {}
}

