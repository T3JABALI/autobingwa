import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { supabase } from '../../lib/supabase'

export const isNative = () => Capacitor.isNativePlatform()

// On Android, "build" is the versionCode from build.gradle
export async function getCurrentBuild() {
  if (!isNative()) return { versionName: 'web', versionCode: Number.MAX_SAFE_INTEGER }
  const info = await App.getInfo()
  return { versionName: info.version, versionCode: parseInt(info.build, 10) || 0 }
}

export async function fetchReleases() {
  const { data, error } = await supabase
    .from('app_releases')
    .select('*')
    .order('version_code', { ascending: false })
    .limit(20)
  if (error) throw error
  return data || []
}

export async function checkForUpdate() {
  const [current, releases] = await Promise.all([getCurrentBuild(), fetchReleases()])
  const latest = releases[0] || null
  const available = !!latest && latest.version_code > current.versionCode
  const mandatory = releases.some((r) => r.version_code > current.versionCode && r.mandatory)
  return { current, releases, latest, available, mandatory }
}

export async function installUpdate(url) {
  const sep = url.includes('?') ? '&' : '?'
  await Browser.open({ url: `${url}${sep}download=AutoBingwa.apk` })
}