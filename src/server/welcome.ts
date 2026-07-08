import { renderUnicodeCompact } from 'uqr'

/**
 * The host-terminal welcome banner: the first thing a non-technical host
 * sees after `./start.sh`. One scannable QR (the LAN game URL) plus the
 * plain URL — the host reads this aloud or holds the laptop up, nothing
 * else to explain. Pure string builder so tests can pin it.
 */
export function welcomeBanner(options: {
  port: number
  addresses: string[]
}): string {
  const { port, addresses } = options
  const lines: string[] = []
  const rule = '─'.repeat(56)

  lines.push('')
  lines.push(`  ♠ TableStakes — your phones are the chips`)
  lines.push(`  ${rule}`)

  if (addresses.length === 0) {
    lines.push('  ⚠ No Wi-Fi/LAN address found — phones cannot join yet.')
    lines.push('    Connect this computer to your Wi-Fi and restart.')
    lines.push(`    (You can still try it alone at http://localhost:${port})`)
    lines.push('')
    return lines.join('\n')
  }

  const url = `http://${addresses[0]}:${port}`
  const consoleUrl = `http://${addresses[0]}:${port}/console`
  lines.push('  1. Keep this window open — it is the table.')
  lines.push('  2. The table console opens in your browser —')
  lines.push('     set the buy-in and blinds, hit Create.')
  lines.push(`     (if it did not open: ${consoleUrl})`)
  lines.push('  3. Players: scan this with your phone camera —')
  lines.push('')
  for (const row of renderUnicodeCompact(url).split('\n')) {
    lines.push(`     ${row}`)
  }
  lines.push('')
  lines.push(`     …or type ${url} in your phone browser.`)
  if (addresses.length > 1) {
    lines.push(`     (also reachable via ${addresses.slice(1).join(', ')})`)
  }
  lines.push(`  ${rule}`)
  lines.push('  Stop the table with Ctrl+C. Games survive restarts.')
  lines.push('')
  return lines.join('\n')
}
