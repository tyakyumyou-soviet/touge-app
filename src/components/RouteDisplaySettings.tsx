import { useMemo, useState } from 'react'
import type { Course, UserProfile } from '../types'
import { isCourseVisibleByMapPreferences, mapRouteSourceForCourse, mapRouteSourcesFromProfile, visibleMapFriendIds, type MapRouteSource } from '../lib/mapRoutePreferences'

interface Props {
  profile: UserProfile
  courses: Course[]
  userId: string
  friendIds: string[]
  friendNames: Record<string, string>
  onChange: (values: Partial<UserProfile>) => void
}

const sourceMeta: Record<MapRouteSource, { label: string; description: string; icon: string }> = {
  official: { label: '公式コース', description: '初期収録・おすすめ', icon: '◆' },
  mine: { label: '自分のコース', description: '自分で作成したコース', icon: '●' },
  friends: { label: 'フレンドのコース', description: '共有されたコース', icon: '◎' },
}

type Tab = 'all' | MapRouteSource

export function RouteDisplaySettings({ profile, courses, userId, friendIds, friendNames, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [friendFilter, setFriendFilter] = useState('all')
  const sources = mapRouteSourcesFromProfile(profile)
  const allowedFriendIds = visibleMapFriendIds(profile, friendIds)
  const managedCourses = useMemo(() => courses.filter((course) => {
    const source = mapRouteSourceForCourse(course, userId)
    return source && (source !== 'friends' || friendIds.includes(course.authorId))
  }), [courses, friendIds, userId])
  const filteredCourses = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja')
    const selectedList = friendFilter.startsWith('list:') ? profile.friendLists?.find((list) => list.id === friendFilter.slice(5)) : null
    const selectedFriend = friendFilter.startsWith('friend:') ? friendFilter.slice(7) : null
    return managedCourses.filter((course) => {
      const source = mapRouteSourceForCourse(course, userId)
      if (!source || (tab !== 'all' && source !== tab)) return false
      if (source === 'friends' && !allowedFriendIds.has(course.authorId)) return false
      if (selectedFriend && course.authorId !== selectedFriend) return false
      if (selectedList && !selectedList.memberIds.includes(course.authorId)) return false
      return !needle || `${course.name} ${course.prefecture} ${course.area} ${course.authorName} ${friendNames[course.authorId] ?? ''}`.toLocaleLowerCase('ja').includes(needle)
    }).sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  }, [allowedFriendIds, friendFilter, friendNames, managedCourses, profile.friendLists, query, tab, userId])

  function toggleSource(source: MapRouteSource, enabled: boolean) {
    onChange({ mapRouteSources: enabled ? [...new Set([...sources, source])] : sources.filter((item) => item !== source) })
  }

  function setCourseVisibility(course: Course, visible: boolean) {
    const source = mapRouteSourceForCourse(course, userId)
    if (!source) return
    const baseVisible = sources.includes(source)
    const overrides = { ...(profile.mapRouteOverrides ?? {}) }
    if (visible === baseVisible) delete overrides[course.id]
    else overrides[course.id] = visible ? 'show' : 'hide'
    onChange({ mapRouteOverrides: overrides, hiddenRouteIds: (profile.hiddenRouteIds ?? []).filter((id) => id !== course.id) })
  }

  function setVisibleCourses(visible: boolean) {
    const overrides = { ...(profile.mapRouteOverrides ?? {}) }
    const legacyHidden = new Set(profile.hiddenRouteIds ?? [])
    filteredCourses.forEach((course) => {
      const source = mapRouteSourceForCourse(course, userId)
      if (!source) return
      if (visible === sources.includes(source)) delete overrides[course.id]
      else overrides[course.id] = visible ? 'show' : 'hide'
      legacyHidden.delete(course.id)
    })
    onChange({ mapRouteOverrides: overrides, hiddenRouteIds: [...legacyHidden] })
  }

  function resetVisibleCourses() {
    const overrides = { ...(profile.mapRouteOverrides ?? {}) }
    const ids = new Set(filteredCourses.map((course) => course.id))
    ids.forEach((id) => delete overrides[id])
    onChange({ mapRouteOverrides: overrides, hiddenRouteIds: (profile.hiddenRouteIds ?? []).filter((id) => !ids.has(id)) })
  }

  const counts = (['official', 'mine', 'friends'] as MapRouteSource[]).map((source) => {
    const items = managedCourses.filter((course) => mapRouteSourceForCourse(course, userId) === source && (source !== 'friends' || allowedFriendIds.has(course.authorId)))
    return { source, total: items.length, shown: items.filter((course) => isCourseVisibleByMapPreferences(course, profile, userId, friendIds)).length }
  })
  const selectedFriendLists = profile.friendLists ?? []

  return <section className="route-display-settings route-display-modern">
    <header className="settings-section-heading"><div><span className="settings-kicker">MAP LAYERS</span><h3>地図上のルート表示</h3><p>種類ごとの初期表示と、コースごとの例外をまとめて管理できます。</p></div><span className="settings-count">{counts.reduce((sum, item) => sum + item.shown, 0)}件表示</span></header>
    <div className="route-source-switches">
      {counts.map(({ source, total, shown }) => <label key={source} className={sources.includes(source) ? 'active' : ''}>
        <span className={`route-source-icon ${source}`} aria-hidden="true">{sourceMeta[source].icon}</span>
        <span><strong>{sourceMeta[source].label}</strong><small>{sourceMeta[source].description} · {shown}/{total}件</small></span>
        <input type="checkbox" role="switch" aria-label={`${sourceMeta[source].label}を表示`} checked={sources.includes(source)} onChange={(event) => toggleSource(source, event.target.checked)} />
      </label>)}
    </div>
    {sources.includes('friends') && <div className="route-friend-scope">
      <label><span>表示するフレンド</span><select value={profile.mapRouteFriendScope ?? 'all'} onChange={(event) => onChange({ mapRouteFriendScope: event.target.value as 'all' | 'lists' })}><option value="all">フレンド全員（{friendIds.length}人）</option><option value="lists">フレンドリストから選ぶ</option></select></label>
      {profile.mapRouteFriendScope === 'lists' && <div className="friend-list-chips">{selectedFriendLists.length ? selectedFriendLists.map((list) => <label key={list.id} className={profile.mapRouteFriendListIds?.includes(list.id) ? 'selected' : ''}><input type="checkbox" checked={profile.mapRouteFriendListIds?.includes(list.id) ?? false} onChange={(event) => onChange({ mapRouteFriendListIds: event.target.checked ? [...new Set([...(profile.mapRouteFriendListIds ?? []), list.id])] : (profile.mapRouteFriendListIds ?? []).filter((id) => id !== list.id) })} /><span>{list.name}</span><small>{list.memberIds.length}人</small></label>) : <p>フレンド画面でリストを作成できます。</p>}</div>}
    </div>}
    <div className="route-course-manager">
      <div className="route-manager-heading"><div><strong>コースごとに選ぶ</strong><small>個別の設定は上の初期表示より優先されます。</small></div><button type="button" onClick={resetVisibleCourses}>デフォルトに戻す</button></div>
      <label className="route-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="コース名・地域・フレンド名で検索" aria-label="表示するコースを検索" /></label>
      <div className="route-source-tabs" role="tablist" aria-label="コースの種類">{([['all', 'すべて'], ['official', '公式'], ['mine', '自分'], ['friends', 'フレンド']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); if (id !== 'friends') setFriendFilter('all') }}>{label}</button>)}</div>
      {tab === 'friends' && <label className="route-friend-filter"><span>フレンドで絞る</span><select value={friendFilter} onChange={(event) => setFriendFilter(event.target.value)}><option value="all">全員・全リスト</option>{friendIds.map((id) => <option key={id} value={`friend:${id}`}>{friendNames[id] ?? id.slice(0, 8)}</option>)}{selectedFriendLists.map((list) => <option key={list.id} value={`list:${list.id}`}>リスト: {list.name}</option>)}</select></label>}
      <div className="route-bulk-actions"><span>{filteredCourses.length}件</span><div><button type="button" onClick={() => setVisibleCourses(true)}>すべて表示</button><button type="button" onClick={() => setVisibleCourses(false)}>すべて非表示</button></div></div>
      <div className="route-course-list" aria-live="polite">
        {filteredCourses.length ? filteredCourses.map((course) => {
          const source = mapRouteSourceForCourse(course, userId)!
          const visible = isCourseVisibleByMapPreferences(course, profile, userId, friendIds)
          const overridden = Boolean(profile.mapRouteOverrides?.[course.id] || profile.hiddenRouteIds?.includes(course.id))
          return <label key={course.id} className={visible ? 'shown' : ''}>
            <span className={`route-source-dot ${source}`} aria-hidden="true" />
            <span className="route-course-copy"><strong>{course.name}</strong><small>{course.prefecture} · {source === 'friends' ? (friendNames[course.authorId] ?? course.authorName) : sourceMeta[source].label}{overridden ? ' · 個別設定' : ''}</small></span>
            <input type="checkbox" role="switch" aria-label={`${course.name}を地図に表示`} checked={visible} onChange={(event) => setCourseVisibility(course, event.target.checked)} />
          </label>
        }) : <div className="route-list-empty"><span>⌕</span><strong>該当するコースがありません</strong><small>検索語や表示範囲を変更してください。</small></div>}
      </div>
    </div>
  </section>
}
