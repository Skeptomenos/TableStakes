// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ShareCard } from './ShareCard'

afterEach(cleanup)

describe('ShareCard', () => {
  it('shows QR code, full URL, and the five-digit code for a LAN address', () => {
    const { container } = render(
      <ShareCard code="48317" port="8080" addresses={['192.168.1.5']} />,
    )
    expect(screen.getByText('48317')).toBeTruthy()
    expect(
      screen.getByText('http://192.168.1.5:8080/g/48317'),
    ).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
    expect(screen.queryByText(/only reachable on this computer/i)).toBeNull()
  })

  it('warns when the server is only reachable on localhost', () => {
    render(<ShareCard code="48317" port="8080" addresses={[]} />)
    expect(screen.getByText(/only reachable on this computer/i)).toBeTruthy()
  })

  it('lists additional addresses as reachability hints', () => {
    render(
      <ShareCard
        code="48317"
        port="8080"
        addresses={['192.168.1.5', '10.0.0.7']}
      />,
    )
    expect(screen.getByText(/10\.0\.0\.7/)).toBeTruthy()
  })
})
