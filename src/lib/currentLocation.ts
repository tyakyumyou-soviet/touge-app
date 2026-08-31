import type { GeocodedPoint } from './location'

/** Area search does not require a GPS lock. Retry transient failures, not denial. */
export async function currentSearchLocation(geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined = navigator.geolocation): Promise<GeocodedPoint> {
  if (!geolocation) throw new Error('この端末では現在地を取得できません。地名で探索エリアを指定してください。')
  const locate = (options: PositionOptions) => new Promise<GeolocationPosition>((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, reject, options)
  })
  let position: GeolocationPosition
  try {
    try {
      position = await locate({ enableHighAccuracy: false, maximumAge: 30_000, timeout: 8000 })
    } catch (error) {
      const code = (error as GeolocationPositionError)?.code
      if (code !== 2 && code !== 3) throw error
      position = await locate({ enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 })
    }
  } catch (error) {
    const code = (error as GeolocationPositionError)?.code
    if (code === 1) throw new Error('位置情報の利用が許可されていません。ブラウザ・端末の位置情報設定を確認するか、地名で探索エリアを指定してください。')
    if (code === 3) throw new Error('現在地の取得が時間切れになりました。電波状況のよい場所で再試行するか、地名で探索エリアを指定してください。')
    throw new Error('現在地を確認できませんでした。端末の位置情報を有効にするか、地名で探索エリアを指定してください。')
  }
  const { longitude, latitude, accuracy } = position.coords
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
    throw new Error('現在地の座標を確認できませんでした。地名で探索エリアを指定してください。')
  }
  const uncertainty = Number.isFinite(accuracy) && accuracy >= 100 ? `・位置精度 約${Math.round(accuracy)}m` : ''
  return { coordinate: [longitude, latitude], label: `現在地（${latitude.toFixed(5)}, ${longitude.toFixed(5)}${uncertainty}）` }
}
