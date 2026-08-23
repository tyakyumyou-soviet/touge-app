import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

interface ErrorBoundaryState { error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Touge App failed to render', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main style={{ minHeight: '100vh', padding: '32px', background: '#f3f1e8', color: '#101915', fontFamily: 'sans-serif' }}>
        <h1>峠appを読み込めませんでした</h1>
        <p>ページを再読み込みしてください。解決しない場合は、ブラウザのキャッシュを削除してからもう一度お試しください。</p>
        <button onClick={() => location.reload()} style={{ padding: '12px 18px', marginRight: '8px' }}>再読み込み</button>
        <button onClick={() => window.resetTougeApp?.()} style={{ padding: '12px 18px' }}>キャッシュを初期化</button>
        <details style={{ marginTop: '24px' }}><summary>技術情報</summary><pre>{this.state.error.message}</pre></details>
      </main>
    )
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('Application root element was not found')

// Older installed versions may have enabled navigation preload. The generated
// SPA worker does not consume that response, so explicitly disable it once a
// worker is ready to prevent cancelled-preload warnings after an update.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.ready.then((registration) => registration.navigationPreload?.disable()).catch(() => undefined)
}

createRoot(root).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>)
