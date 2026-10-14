import { promises as fs } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'

// Scritture su /data che non lasciano mai un file a metà: file temporaneo, fsync, rename.
// Una coda per file evita che due scritture concorrenti si sovrappongano.
const queues = new Map<string, Promise<unknown>>()

function enqueue<T>(file: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(file) ?? Promise.resolve()
  const next = prev.then(task, task)
  queues.set(file, next.catch(() => undefined))
  return next
}

export function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  return enqueue(file, async () => {
    const dir = dirname(file)
    await fs.mkdir(dir, { recursive: true })
    const tmp = join(dir, `.${basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
    const handle = await fs.open(tmp, 'w')
    try {
      await handle.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fs.rename(tmp, file)
    } catch (err) {
      await fs.rm(tmp, { force: true })
      throw err
    }
  })
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Una riga JSON in coda al file (registri append-only: conversazioni, consumi, audit). */
export function appendJsonl(file: string, record: unknown): Promise<void> {
  return enqueue(file, async () => {
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8')
  })
}

export async function readJsonl<T>(file: string): Promise<T[]> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return []
  }
  const out: T[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line) as T) } catch { /* riga troncata da un crash: si salta */ }
  }
  return out
}
