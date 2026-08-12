import { useRegisterSW } from 'virtual:pwa-register/react'

export function InstallPrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW()
  if (!needRefresh) return null
  return <div className="update-toast" role="status"><span>新しいバージョンがあります</span><button onClick={() => updateServiceWorker(true)}>更新</button><button onClick={() => setNeedRefresh(false)} aria-label="閉じる">×</button></div>
}
