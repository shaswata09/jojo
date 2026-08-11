/**
 * The two sections for the two pages behind the sidebar's status tiles.
 *
 * They are together because that is the only thing they have in common and it
 * is the thing readers get wrong: both are full pages reached from a readout
 * that does not look like a link, and both are fetched separately from the rest
 * of the app.
 */

import { Address, Go, NotConnected, Screen } from '@/components/guide/screens/ScreenParts'
import { S } from '@/components/guide/screens/sections'
import { graphPath, guidePath, settingsPath, transferPath } from '@/lib/links'

/* -------------------------------- graph ----------------------------------- */

export function GraphScreen() {
  return (
    <Screen
      id={S.graph}
      title="Graph"
      where="the sidebar's Browser storage tile"
      to={graphPath()}
      open="the graph"
    >
      <p className="text-sm text-text-2">
        Your records drawn as what they are stored as: a node for each one, an edge for each pointer
        between two of them. Colour is the kind of record and size is how much points at it.
        Underneath the picture is a query panel that answers the questions a list cannot, like which
        applications have no follow-up scheduled. <Go to={guidePath('graph')}>The graph</Go> goes
        through all of it — this section is only here to say where the page is and what it does not
        do.
      </p>

      <h3 className="mt-4 text-sm font-medium">What is not obvious</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          The legend rows hide a kind of record from the picture. Questions still run over the whole
          graph — an answer that changed because you had hidden something would be worse than no
          answer.
        </li>
        <li>
          The line under the pickers that looks like code is labelled{' '}
          <span className="text-text-1">illustrative</span> and means it. Nothing parses it; it is
          there so that seeing the shape beside the words makes the pickers legible.
        </li>
        <li>
          This page and Transfer are fetched separately from the rest of jojo, so on a cold load you
          may see a named panel for a moment while the code arrives. It says so rather than
          spinning.
        </li>
      </ul>

      <Address>
        carries nothing — not the selected node, not the question, not the types you have hidden. A
        view you set up here cannot be sent to anyone; the query examples in the panel are the
        shareable version.
      </Address>
    </Screen>
  )
}

/* ------------------------------ transfer ---------------------------------- */

export function TransferScreen() {
  return (
    <Screen
      id={S.transfer}
      title="Transfer"
      where="the sidebar's Transfer tile, and Settings"
      to={transferPath()}
    >
      <p className="text-sm text-text-2">
        Handing everything to a second device: pick which end this machine is, read out the pairing
        code, see exactly what would go and how much of it, and decide whether documents come along.
        The counts are read from your own store, group by group, which is the point of walking
        through it — what it says it would move is what you actually have.
      </p>

      <NotConnected title="Nothing is transmitted">
        This build opens no connection, asks for no camera and writes to no store. The pairing code
        is minted fresh each visit and pairs with nothing; the progress it walks through is a
        demonstration of the shape the real handoff would take, and the page says so under the code
        rather than in a banner you would scroll past. The way to move your records to another
        machine today is the export in <Go to={settingsPath()}>Settings &rarr; Your data</Go>.
      </NotConnected>

      <ul className="mt-3.5 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          Files are the one group switched off by default — they are the heavy half of a handoff and
          the half you most likely already have on the other device. The receiving end gets no say,
          because a device quietly dropping half of what arrived would be the worse surprise.
        </li>
        <li>
          The animation is a WebGPU scene redrawing every frame. There is a switch behind the gear
          to put it away, which is worth it on battery.
        </li>
        <li>
          With an empty store the page says there is nothing to move and points at the demo data,
          rather than offering to send zero of everything.
        </li>
      </ul>

      <Address>carries nothing.</Address>
    </Screen>
  )
}
