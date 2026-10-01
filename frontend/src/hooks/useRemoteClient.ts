import { useSyncExternalStore } from 'react'
import { getRemoteClient, subscribeRemoteClient } from '../lib/remoteRuntime'
import type { RemoteClient } from '../lib/remoteRuntime'

/**
 * What a remote browser knows about itself: the device name the desktop gave
 * it and the admin-tier calls waiting on approval. Import this only from
 * remote-only modules reached through a dynamic import (`RemoteChrome`), or the
 * desktop's entry chunk pays for `lib/remoteRuntime`.
 */
export function useRemoteClient(): RemoteClient {
  return useSyncExternalStore(subscribeRemoteClient, getRemoteClient)
}
