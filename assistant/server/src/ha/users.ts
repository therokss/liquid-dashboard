import type { HAConnection } from './connection.ts'

interface AuthUser {
  id: string
  is_owner?: boolean
  group_ids?: string[]
}

// Chi è amministratore: owner o gruppo system-admin (stessa regola di
// liquid_dashboard/server.js refreshAdminIds), con cache di 5 minuti sulla WS persistente.
export class AdminDirectory {
  private ids = new Set<string>()
  private fetchedAt = 0
  private lastForcedRefresh = 0

  constructor(
    private readonly conn: Pick<HAConnection, 'sendMessage'> | null,
    private readonly ttlMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private async refresh(): Promise<boolean> {
    if (!this.conn) return false
    try {
      const users = await this.conn.sendMessage<AuthUser[]>({ type: 'config/auth/list' }, 10_000)
      this.ids = new Set(
        (users ?? []).filter((u) => u.is_owner || (u.group_ids ?? []).includes('system-admin')).map((u) => u.id),
      )
      this.fetchedAt = this.now()
      return true
    } catch {
      return false
    }
  }

  /** true/false se si sa; null se HA non risponde e non c'è una lista precedente. */
  async isAdmin(userId: string): Promise<boolean | null> {
    const stale = this.now() - this.fetchedAt > this.ttlMs
    if (stale) {
      const ok = await this.refresh()
      if (!ok && this.fetchedAt === 0) return null
    } else if (!this.ids.has(userId) && this.now() - this.lastForcedRefresh > 10_000) {
      // Utente appena promosso admin: un refresh anticipato, al massimo ogni 10 s.
      this.lastForcedRefresh = this.now()
      await this.refresh()
    }
    return this.ids.has(userId)
  }
}
