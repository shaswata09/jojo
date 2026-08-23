import { Link } from 'react-router'
import { Download, Upload } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { settingsPath } from '@/lib/links'

/**
 * Receiving, on a device that cannot.
 *
 * ## What this used to be
 *
 * A pairing code field that accepted any well-formed string, and a permanently
 * disabled "Turn on the camera" button labelled "Inert here, on purpose". Both
 * were honest about being props — the copy said so — and both were still the
 * wrong thing on the screen. A person who types a code into a field and sees
 * "Paired" has been told this computer is about to receive something. It never
 * was, and the sentence explaining that sat underneath the control rather than
 * in place of it.
 *
 * ## Why there is nothing to build here
 *
 * A web page cannot accept an inbound connection. `TCPServerSocket` exists in
 * Chrome only for Isolated Web Apps — a packaged, enterprise-installed thing
 * that jojo is not — and nothing equivalent is proposed for the open web. So a
 * phone cannot reach this browser, whatever network both are on and whatever
 * either device is willing to do about it.
 *
 * That is why the whole transfer is shaped the way it is: the phone listens
 * because it is the only side that can, and the browser connects to it. Nothing
 * here is waiting on an implementation. See `jojo-transfer-design` and
 * `lib/handoff-send.ts` for the topology this falls out of.
 *
 * ## So this points at the thing that does work
 *
 * The backup file. It has no size limit, no network in it at all, and
 * `repo/restore.ts` puts it back — the same code path the phone runs when it
 * receives one over the wire. Sending a file from a phone to a computer is
 * something every phone already does well, so jojo does not need to.
 */
export function ReceivePanel() {
  return (
    <>
      <Panel>
        <PanelTitle hint="not possible in a browser">Receive on this computer</PanelTitle>
        <p className="text-sm text-text-2">
          A web page is not allowed to accept a connection from another device. That is a rule of
          the browser rather than a setting, so no network, no permission and no other browser
          changes it — which is why the phone is the side that listens, and this computer is the
          side that connects to it.
        </p>
        <p className="mt-3 text-sm text-text-2">
          To move records the other way, export a backup on your phone and open it here. Nothing
          about that route touches a network.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Button size="sm" asChild>
            <Link to={settingsPath()}>
              <Upload className="size-3.5" strokeWidth={1.8} aria-hidden />
              Open a backup
            </Link>
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelTitle hint="between two computers">Two browsers</PanelTitle>
        <p className="text-sm text-text-2">
          Neither can listen, so two computers cannot connect to each other either. Export a backup
          from one and open it on the other — it carries every record and every document, and it is
          the same file the phone receives.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" asChild>
            <Link to={settingsPath()}>
              <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
              Export a backup
            </Link>
          </Button>
        </div>
      </Panel>
    </>
  )
}
