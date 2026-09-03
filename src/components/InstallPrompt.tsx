import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function InstallPrompt() {
  const [registrationError, setRegistrationError] = useState(false)
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) window.setInterval(() => registration.update(), 60 * 60 * 1000)
    },
    onRegisterError() { setRegistrationError(true) },
  })
  // navigator.onLine is only a browser hint. In embedded browsers it may be
  // false even when this local app and Firebase are reachable, so never turn
  // the whole UI into a misleading "offline mode" based on that value alone.
  // The Service Worker still keeps the app and cached map assets available
  // when the device really is offline.
  if (registrationError) return <div className="update-toast warning" role="alert"><span>PWAの更新設定を修復してください</span><button onClick={() => window.resetTougeApp?.()}>修復</button><button onClick={() => setRegistrationError(false)} aria-label="閉じる">×</button></div>
  if (needRefresh) return <div className="update-toast" role="status"><span>新しいバージョンがあります</span><button onClick={() => updateServiceWorker(true)}>更新</button><button onClick={() => setNeedRefresh(false)} aria-label="閉じる">×</button></div>
  if (offlineReady) return <div className="update-toast" role="status"><span>オフライン利用の準備ができました</span><button onClick={() => setOfflineReady(false)} aria-label="閉じる">×</button></div>
  return null
}
