/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface Window {
  __tougeReady?: boolean
  __tougeMarkReady?: () => void
  __tougeShowBootError?: (message?: string) => void
  resetTougeApp?: () => Promise<void>
}
