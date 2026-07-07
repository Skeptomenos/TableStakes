import { renderSVG } from 'uqr'

import { gameRoute } from '../../shared/routes'

export interface ShareCardProps {
  code: string
  port: string
  addresses: string[]
}

/**
 * Host share surface (SPEC.md): QR-first sharing with full URL and
 * five-digit code fallback, LAN address hints, and a clear warning when
 * the server is only reachable on localhost.
 */
export function ShareCard({ code, port, addresses }: ShareCardProps) {
  const host = addresses[0] ?? 'localhost'
  const url = `http://${host}:${port}${gameRoute(code)}`
  const extraAddresses = addresses.slice(1)

  return (
    <section className="card share-card" aria-label="Share this table">
      <h2 className="card__title">Share this table</h2>
      <div
        className="share-card__qr"
        role="img"
        aria-label={`QR code for ${url}`}
        dangerouslySetInnerHTML={{
          __html: renderSVG(url, {
            // Ivory card stock, felt-dark ink — the QR is a physical
            // object in the Felt & Ledger world, not a white sticker.
            whiteColor: '#e9e5d9',
            blackColor: '#0e1210',
          }),
        }}
      />
      <p className="share-card__url">{url}</p>
      <p className="share-card__code" aria-label="Game code">
        {code}
      </p>
      {addresses.length === 0 ? (
        <p className="share-card__warning">
          Only reachable on this computer — connect the laptop to your Wi-Fi
          so phones can join.
        </p>
      ) : null}
      {extraAddresses.length > 0 ? (
        <p className="share-card__hint">
          Also reachable via {extraAddresses.join(', ')}
        </p>
      ) : null}
    </section>
  )
}
