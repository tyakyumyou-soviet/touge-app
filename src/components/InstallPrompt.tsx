import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function InstallPrompt() {
  const [registrationError, setRegistrationError] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) window.setInterval(() => registration.update(), 60 * 60 * 1000)
    },
    onRegisterError() { setRegistrationError(true) },
  })
  useEffect(() => {
    const connected = () => setOnline(true)
    const disconnected = () => setOnline(false)
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected)
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected) }
  }, [])
  if (!online) return <div className="update-toast" role="status"><span>オフラインモードで実行中</span></div>
  if (registrationError) return <div className="update-toast warning" role="alert"><span>PWAの更新設定を修復してください</span><button onClick={() => window.resetTougeApp?.()}>修復</button><button onClick={() => setRegistrationError(false)} aria-label="閉じる">×</button></div>
  if (needRefresh) return <div className="update-toast" role="status"><span>新しいバージョンがあります</span><button onClick={() => updateServiceWorker(true)}>更新</button><button onClick={() => setNeedRefresh(false)} aria-label="閉じる">×</button></div>
  if (offlineReady) return <div className="update-toast" role="status"><span>オフライン利用の準備ができました</span><button onClick={() => setOfflineReady(false)} aria-label="閉じる">×</button></div>
  return null
}
